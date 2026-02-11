import { Router } from "express";
import { prisma } from "../db";
import { AuthenticatedRequest } from "../middleware/auth";
import { upload, uploadPdfFromRequest } from "../services/storage";
import { getSignedPdfUrl } from "../services/storage";
export const lessonsRouter = Router();

function isAdmin(user: any | null) {
  return user && user.role === "ADMIN";
}

async function isCourseAuthor(user: any | null, courseId: number) {
  if (!user) return false;
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  return !!course && course.authorId === user.id;
}

async function isEnrolledInCourse(userId: number, courseId: number) {
  const count = await prisma.courseEnrollment.count({
    where: { userId, courseId },
  });
  return count > 0;
}

async function isOnCourseAllowList(email: string, courseId: number) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { allowedEmails: true },
  });
  if (!course) return false;
  if (!course.restrictedToAllowList) return true;
  const normalized = email.toLowerCase();
  return course.allowedEmails.some((e) => e.email.toLowerCase() === normalized);
}

async function canViewFullLessonContent(user: any | null, courseId: number) {
  if (!user) return false;
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) return false;
  if (isAdmin(user) || (course.authorId && course.authorId === user.id))
    return true;
  if (!(await isOnCourseAllowList(user.email, courseId))) return false;
  return await isEnrolledInCourse(user.id, courseId);
}

// GET /lessons
// GET /lessons
lessonsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const user = req.user || null;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  if (isAdmin(user)) {
    const all = await prisma.lesson.findMany();

    // Generate signed URLs for PDFs
    for (let lesson of all) {
      if (lesson.pdfUrl) {
        lesson.pdfUrl = (await getSignedPdfUrl(lesson.pdfUrl)) || lesson.pdfUrl;
      }
    }

    return res.json(all);
  }

  const enrollments = await prisma.courseEnrollment.findMany({
    where: { userId: user.id },
  });
  const authoredCourses = await prisma.course.findMany({
    where: { authorId: user.id },
  });
  const accessibleCourseIds = new Set<number>();
  enrollments.forEach((e) => accessibleCourseIds.add(e.courseId));
  authoredCourses.forEach((c) => accessibleCourseIds.add(c.id));

  const lessons = await prisma.lesson.findMany({});
  const filtered = lessons.filter((l) => accessibleCourseIds.has(l.courseId));

  // Generate signed URLs for PDFs
  for (let lesson of filtered) {
    if (lesson.pdfUrl) {
      lesson.pdfUrl = (await getSignedPdfUrl(lesson.pdfUrl)) || lesson.pdfUrl;
    }
  }

  return res.json(filtered);
});

// GET /lessons/course/:courseId
lessonsRouter.get(
  "/course/:courseId",
  async (req: AuthenticatedRequest, res) => {
    const user = req.user || null;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const courseId = Number(req.params.courseId);
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) return res.status(404).json({ error: "Course not found" });

    const orderedLessons = await prisma.lesson.findMany({
      where: { courseId },
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
    });

    if (!(await canViewFullLessonContent(user, courseId))) {
      let index = 0;
      const summaries = orderedLessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        orderIndex: lesson.orderIndex,
        position: ++index,
      }));
      return res.json(summaries);
    }

    // Generate signed URLs for PDFs
    for (let lesson of orderedLessons) {
      if (lesson.pdfUrl) {
        lesson.pdfUrl = (await getSignedPdfUrl(lesson.pdfUrl)) || lesson.pdfUrl;
      }
    }

    return res.json(orderedLessons);
  },
);

// GET /lessons/:lessonId
lessonsRouter.get("/:lessonId", async (req: AuthenticatedRequest, res) => {
  const user = req.user || null;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const lessonId = Number(req.params.lessonId);
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
  if (!lesson) return res.status(404).json({ error: "Lesson not found" });

  if (!(await canViewFullLessonContent(user, lesson.courseId))) {
    return res.status(403).json({
      error:
        "You must be enrolled in the course (or be the author/admin) to view this lesson",
    });
  }

  // Generate signed URL for PDF
  if (lesson.pdfUrl) {
    lesson.pdfUrl = (await getSignedPdfUrl(lesson.pdfUrl)) || lesson.pdfUrl;
  }

  return res.json(lesson);
});

// POST /lessons (multipart)
lessonsRouter.post(
  "/",
  upload.single("pdf"),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user || null;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (
      !isAdmin(user) &&
      !(await isCourseAuthor(user, Number(req.body.courseId)))
    ) {
      return res.status(403).json({
        error:
          "Only course authors or admins can create lessons for this course",
      });
    }

    const { title, content, courseId, videoUrl } = req.body as any;
    const cid = Number(courseId);
    const course = await prisma.course.findUnique({ where: { id: cid } });
    if (!course)
      return res
        .status(400)
        .json({ error: `Course not found with id: ${cid}` });

    const pdfUrl = await uploadPdfFromRequest(req.file || undefined);

    const count = await prisma.lesson.count({ where: { courseId: cid } });
    const orderIndex = count + 1;

    const lesson = await prisma.lesson.create({
      data: {
        title,
        content,
        videoUrl: videoUrl || null,
        pdfUrl,
        orderIndex,
        courseId: cid,
      },
    });

    return res.json(lesson);
  },
);

// PUT /lessons/:lessonId (multipart)
lessonsRouter.put(
  "/:lessonId",
  upload.single("pdf"),
  async (req: AuthenticatedRequest, res) => {
    const user = req.user || null;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const lessonId = Number(req.params.lessonId);
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });

    const course = await prisma.course.findUnique({
      where: { id: lesson.courseId },
    });
    const isAuthor = course && course.authorId === user.id;
    if (!isAdmin(user) && !isAuthor) {
      return res.status(403).json({
        error:
          "Only course authors or admins can update lessons for this course",
      });
    }

    const { title, content, videoUrl, clearPdf } = req.body as any;

    let pdfUrl = lesson.pdfUrl;
    if (req.file) {
      pdfUrl = await uploadPdfFromRequest(req.file);
    } else if (String(clearPdf) === "true") {
      pdfUrl = null;
    }

    const updated = await prisma.lesson.update({
      where: { id: lessonId },
      data: {
        title,
        content,
        videoUrl: videoUrl ?? lesson.videoUrl,
        pdfUrl,
      },
    });

    return res.json(updated);
  },
);

// DELETE /lessons/:lessonId
lessonsRouter.delete("/:lessonId", async (req: AuthenticatedRequest, res) => {
  const user = req.user || null;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const lessonId = Number(req.params.lessonId);
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
  if (!lesson) return res.status(404).json({ error: "Lesson not found" });

  const course = await prisma.course.findUnique({
    where: { id: lesson.courseId },
  });
  const isAuthor = course && course.authorId === user.id;
  if (!isAdmin(user) && !isAuthor) {
    return res.status(403).json({
      error: "Only course authors or admins can delete lessons for this course",
    });
  }

  await prisma.lessonProgress.deleteMany({ where: { lessonId } });
  await prisma.lesson.delete({ where: { id: lessonId } });

  return res.status(204).send();
});

// POST /lessons/course/:courseId/reorder
lessonsRouter.post(
  "/course/:courseId/reorder",
  async (req: AuthenticatedRequest, res) => {
    const user = req.user || null;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const courseId = Number(req.params.courseId);
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) return res.status(404).json({ error: "Course not found" });

    const isAuthor = course.authorId === user.id;
    if (!isAdmin(user) && !isAuthor) {
      return res.status(403).json({
        error:
          "Only course authors or admins can reorder lessons for this course",
      });
    }

    const orderedLessonIds: number[] = Array.isArray(req.body)
      ? (req.body as any[]).map((id) => Number(id))
      : [];

    const lessons = await prisma.lesson.findMany({
      where: { courseId },
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
    });
    const byId = new Map<number, (typeof lessons)[0]>();
    lessons.forEach((l) => byId.set(l.id, l));

    let index = 1;
    for (const id of orderedLessonIds) {
      const lesson = byId.get(id);
      if (lesson) {
        await prisma.lesson.update({
          where: { id },
          data: { orderIndex: index++ },
        });
        byId.delete(id);
      }
    }

    for (const [id, lesson] of byId.entries()) {
      if (!lesson.orderIndex || lesson.orderIndex < 1) {
        await prisma.lesson.update({
          where: { id },
          data: { orderIndex: index++ },
        });
      }
    }

    const updated = await prisma.lesson.findMany({
      where: { courseId },
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
    });

    // Generate signed URLs for PDFs
    for (let lesson of updated) {
      if (lesson.pdfUrl) {
        lesson.pdfUrl = (await getSignedPdfUrl(lesson.pdfUrl)) || lesson.pdfUrl;
      }
    }

    return res.json(updated);
  },
);
