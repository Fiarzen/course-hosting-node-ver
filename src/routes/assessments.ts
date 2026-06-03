import { Router } from "express";
import { prisma } from "../db";
import { AuthenticatedRequest } from "../middleware/auth";
import { canViewFullLessonContent, canEditCourse } from "./courseAccess";

export const assessmentsRouter = Router();

type ChoiceInput = { text?: unknown; isCorrect?: unknown };
type QuestionInput = { prompt?: unknown; choices?: unknown };

// Shape an assessment for the client. Correct-answer flags are only included
// for authors/admins; students never receive `isCorrect` (they grade via the
// stateless /check endpoint instead).
function serializeAssessment(assessment: any, includeAnswers: boolean) {
  return {
    id: assessment.id,
    title: assessment.title,
    description: assessment.description,
    courseId: assessment.courseId,
    createdAt: assessment.createdAt,
    questions: (assessment.questions || []).map((q: any) => ({
      id: q.id,
      prompt: q.prompt,
      orderIndex: q.orderIndex,
      choices: (q.choices || []).map((c: any) => ({
        id: c.id,
        text: c.text,
        orderIndex: c.orderIndex,
        ...(includeAnswers ? { isCorrect: c.isCorrect } : {}),
      })),
    })),
  };
}

const assessmentInclude = {
  questions: {
    orderBy: { orderIndex: "asc" as const },
    include: { choices: { orderBy: { orderIndex: "asc" as const } } },
  },
};

// Validate + normalize the nested questions/choices payload for create/update.
function parseQuestions(
  raw: unknown,
): { ok: true; questions: { prompt: string; choices: { text: string; isCorrect: boolean }[] }[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "An assessment needs at least one question" };
  }
  const questions: { prompt: string; choices: { text: string; isCorrect: boolean }[] }[] = [];
  for (const q of raw as QuestionInput[]) {
    const prompt = typeof q.prompt === "string" ? q.prompt.trim() : "";
    if (!prompt) return { ok: false, error: "Every question needs a prompt" };
    if (!Array.isArray(q.choices) || q.choices.length < 2) {
      return { ok: false, error: "Every question needs at least two choices" };
    }
    const choices: { text: string; isCorrect: boolean }[] = [];
    let correctCount = 0;
    for (const c of q.choices as ChoiceInput[]) {
      const text = typeof c.text === "string" ? c.text.trim() : "";
      if (!text) return { ok: false, error: "Every choice needs text" };
      const isCorrect = c.isCorrect === true;
      if (isCorrect) correctCount++;
      choices.push({ text, isCorrect });
    }
    if (correctCount < 1) {
      return { ok: false, error: "Every question needs a correct answer" };
    }
    questions.push({ prompt, choices });
  }
  return { ok: true, questions };
}

// GET /assessments/course/:courseId — list assessments for a course
assessmentsRouter.get(
  "/course/:courseId",
  async (req: AuthenticatedRequest, res) => {
    const user = req.user || null;
    if (!user) return res.status(401).json({ error: "Not authenticated", code: "AUTH_REQUIRED" });

    const courseId = Number(req.params.courseId);
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course)
      return res.status(404).json({ error: "Course not found", code: "COURSE_NOT_FOUND" });

    if (!(await canViewFullLessonContent(user, courseId))) {
      return res.status(403).json({
        error: "You must be enrolled in the course (or be the author/admin) to view assessments",
        code: "NOT_ALLOWED_FOR_COURSE",
      });
    }

    const includeAnswers = await canEditCourse(user, courseId);
    const assessments = await prisma.assessment.findMany({
      where: { courseId },
      orderBy: { createdAt: "asc" },
      include: assessmentInclude,
    });

    return res.json(assessments.map((a) => serializeAssessment(a, includeAnswers)));
  },
);

// GET /assessments/:assessmentId — single assessment
assessmentsRouter.get("/:assessmentId", async (req: AuthenticatedRequest, res) => {
  const user = req.user || null;
  if (!user) return res.status(401).json({ error: "Not authenticated", code: "AUTH_REQUIRED" });

  const assessmentId = Number(req.params.assessmentId);
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    include: assessmentInclude,
  });
  if (!assessment)
    return res.status(404).json({ error: "Assessment not found", code: "ASSESSMENT_NOT_FOUND" });

  if (!(await canViewFullLessonContent(user, assessment.courseId))) {
    return res.status(403).json({
      error: "You must be enrolled in the course (or be the author/admin) to view this assessment",
      code: "NOT_ALLOWED_FOR_COURSE",
    });
  }

  const includeAnswers = await canEditCourse(user, assessment.courseId);
  return res.json(serializeAssessment(assessment, includeAnswers));
});

// POST /assessments/:assessmentId/check — stateless self-check grader (no DB writes)
assessmentsRouter.post(
  "/:assessmentId/check",
  async (req: AuthenticatedRequest, res) => {
    const user = req.user || null;
    if (!user) return res.status(401).json({ error: "Not authenticated", code: "AUTH_REQUIRED" });

    const assessmentId = Number(req.params.assessmentId);
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: assessmentInclude,
    });
    if (!assessment)
      return res.status(404).json({ error: "Assessment not found", code: "ASSESSMENT_NOT_FOUND" });

    if (!(await canViewFullLessonContent(user, assessment.courseId))) {
      return res.status(403).json({
        error: "You must be enrolled in the course (or be the author/admin) to take this assessment",
        code: "NOT_ALLOWED_FOR_COURSE",
      });
    }

    const answers: { questionId?: unknown; choiceId?: unknown }[] = Array.isArray(
      req.body?.answers,
    )
      ? req.body.answers
      : [];
    const answerByQuestion = new Map<number, number>();
    for (const a of answers) {
      const qid = Number(a.questionId);
      const cid = Number(a.choiceId);
      if (Number.isInteger(qid) && Number.isInteger(cid)) {
        answerByQuestion.set(qid, cid);
      }
    }

    let score = 0;
    const results = assessment.questions.map((q) => {
      const correctChoice = q.choices.find((c) => c.isCorrect);
      const selectedChoiceId = answerByQuestion.get(q.id) ?? null;
      const isCorrect =
        correctChoice != null && selectedChoiceId === correctChoice.id;
      if (isCorrect) score++;
      return {
        questionId: q.id,
        selectedChoiceId,
        correctChoiceId: correctChoice ? correctChoice.id : null,
        isCorrect,
      };
    });

    return res.json({
      assessmentId: assessment.id,
      score,
      total: assessment.questions.length,
      results,
    });
  },
);

// POST /assessments — create (author/admin)
assessmentsRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const user = req.user || null;
  if (!user) return res.status(401).json({ error: "Not authenticated", code: "AUTH_REQUIRED" });

  const { courseId, title, description, questions } = req.body || {};
  const cid = Number(courseId);
  if (!Number.isInteger(cid))
    return res.status(422).json({ error: "courseId is required", code: "VALIDATION_ERROR" });

  const course = await prisma.course.findUnique({ where: { id: cid } });
  if (!course)
    return res.status(404).json({ error: "Course not found", code: "COURSE_NOT_FOUND" });

  if (!(await canEditCourse(user, cid))) {
    return res.status(403).json({
      error: "Only course authors or admins can create assessments for this course",
      code: "NOT_ALLOWED_FOR_COURSE",
    });
  }

  const titleStr = typeof title === "string" ? title.trim() : "";
  if (!titleStr)
    return res.status(422).json({ error: "Title is required", code: "VALIDATION_ERROR" });

  const parsed = parseQuestions(questions);
  if (!parsed.ok)
    return res.status(422).json({ error: parsed.error, code: "VALIDATION_ERROR" });

  const created = await prisma.assessment.create({
    data: {
      title: titleStr,
      description: typeof description === "string" && description.trim() ? description.trim() : null,
      courseId: cid,
      questions: {
        create: parsed.questions.map((q, qi) => ({
          prompt: q.prompt,
          orderIndex: qi,
          choices: {
            create: q.choices.map((c, ci) => ({
              text: c.text,
              isCorrect: c.isCorrect,
              orderIndex: ci,
            })),
          },
        })),
      },
    },
    include: assessmentInclude,
  });

  return res.status(201).json(serializeAssessment(created, true));
});

// PUT /assessments/:assessmentId — replace title/description + questions (author/admin)
assessmentsRouter.put("/:assessmentId", async (req: AuthenticatedRequest, res) => {
  const user = req.user || null;
  if (!user) return res.status(401).json({ error: "Not authenticated", code: "AUTH_REQUIRED" });

  const assessmentId = Number(req.params.assessmentId);
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
  });
  if (!assessment)
    return res.status(404).json({ error: "Assessment not found", code: "ASSESSMENT_NOT_FOUND" });

  if (!(await canEditCourse(user, assessment.courseId))) {
    return res.status(403).json({
      error: "Only course authors or admins can edit this assessment",
      code: "NOT_ALLOWED_FOR_COURSE",
    });
  }

  const { title, description, questions } = req.body || {};
  const titleStr = typeof title === "string" ? title.trim() : "";
  if (!titleStr)
    return res.status(422).json({ error: "Title is required", code: "VALIDATION_ERROR" });

  const parsed = parseQuestions(questions);
  if (!parsed.ok)
    return res.status(422).json({ error: parsed.error, code: "VALIDATION_ERROR" });

  // Replace questions/choices wholesale inside a transaction. Cascading delete
  // on the question relation removes orphaned choices.
  const updated = await prisma.$transaction(async (tx) => {
    await tx.assessmentQuestion.deleteMany({ where: { assessmentId } });
    return tx.assessment.update({
      where: { id: assessmentId },
      data: {
        title: titleStr,
        description:
          typeof description === "string" && description.trim() ? description.trim() : null,
        questions: {
          create: parsed.questions.map((q, qi) => ({
            prompt: q.prompt,
            orderIndex: qi,
            choices: {
              create: q.choices.map((c, ci) => ({
                text: c.text,
                isCorrect: c.isCorrect,
                orderIndex: ci,
              })),
            },
          })),
        },
      },
      include: assessmentInclude,
    });
  });

  return res.json(serializeAssessment(updated, true));
});

// DELETE /assessments/:assessmentId — (author/admin)
assessmentsRouter.delete("/:assessmentId", async (req: AuthenticatedRequest, res) => {
  const user = req.user || null;
  if (!user) return res.status(401).json({ error: "Not authenticated", code: "AUTH_REQUIRED" });

  const assessmentId = Number(req.params.assessmentId);
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
  });
  if (!assessment)
    return res.status(404).json({ error: "Assessment not found", code: "ASSESSMENT_NOT_FOUND" });

  if (!(await canEditCourse(user, assessment.courseId))) {
    return res.status(403).json({
      error: "Only course authors or admins can delete this assessment",
      code: "NOT_ALLOWED_FOR_COURSE",
    });
  }

  await prisma.assessment.delete({ where: { id: assessmentId } });
  return res.status(204).send();
});
