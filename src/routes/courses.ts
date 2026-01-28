import { Router } from "express";
import { prisma } from "../db";
import { AuthenticatedRequest } from "../middleware/auth";

const publicRouter = Router();
const protectedRouter = Router();

function canSeeCourse(user: any | null, course: any): boolean {
  if (!course.restrictedToAllowList) return true;
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  if (course.authorId && course.authorId === user.id) return true;
  const allowedEmails = course.allowedEmails as { email: string }[];
  return allowedEmails?.some((e) => e.email.toLowerCase() === user.email.toLowerCase());
}

// GET /courses (public listing with allowlist logic)
publicRouter.get("/", async (req: AuthenticatedRequest, res) => {
  const user = req.user || null;
  const courses = await prisma.course.findMany({
    include: { allowedEmails: true, author: true },
  });

  const visible = courses.filter((c) => canSeeCourse(user, c));
  res.json(visible);
});

// POST /courses (creator/admin)
protectedRouter.post("/", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  if (req.user.role !== "CREATOR" && req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { title, description, authorId } = req.body || {};
  const course = await prisma.course.create({
    data: {
      title,
      description,
      authorId: authorId ?? req.user.id,
    },
  });

  res.json(course);
});

// GET /courses/my-created
protectedRouter.get("/my-created", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  const courses = await prisma.course.findMany({ where: { authorId: req.user.id } });
  res.json(courses);
});

// GET /courses/:courseId/access
protectedRouter.get("/:courseId/access", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  const id = Number(req.params.courseId);
  const course = await prisma.course.findUnique({
    where: { id },
    include: { allowedEmails: true },
  });
  if (!course) return res.status(404).json({ error: "Course not found" });

  const isAdmin = req.user.role === "ADMIN";
  const isAuthor = course.authorId === req.user.id;
  if (!isAdmin && !isAuthor) {
    return res.status(403).json({ error: "Not allowed to view access settings for this course" });
  }

  res.json({
    restrictedToAllowList: course.restrictedToAllowList,
    allowedEmails: course.allowedEmails.map((e) => e.email),
  });
});

// PUT /courses/:courseId/access
protectedRouter.put("/:courseId/access", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  const id = Number(req.params.courseId);
  const body = req.body || {};
  const course = await prisma.course.findUnique({
    where: { id },
    include: { allowedEmails: true },
  });
  if (!course) return res.status(404).json({ error: "Course not found" });

  const isAdmin = req.user.role === "ADMIN";
  const isAuthor = course.authorId === req.user.id;
  if (!isAdmin && !isAuthor) {
    return res.status(403).json({ error: "Not allowed to modify access for this course" });
  }

  const restricted = Boolean(body.restrictedToAllowList);
  const emails: string[] = Array.isArray(body.allowedEmails) ? body.allowedEmails : [];
  const normalized = Array.from(
    new Set(
      emails
        .filter((e) => typeof e === "string")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    )
  );

  await prisma.$transaction([
    prisma.course.update({
      where: { id },
      data: { restrictedToAllowList: restricted },
    }),
    prisma.courseAllowedEmail.deleteMany({ where: { courseId: id } }),
    prisma.courseAllowedEmail.createMany({
      data: normalized.map((email) => ({ courseId: id, email })),
    }),
  ]);

  const updated = await prisma.course.findUnique({
    where: { id },
    include: { allowedEmails: true },
  });

  res.json({
    restrictedToAllowList: updated?.restrictedToAllowList,
    allowedEmails: updated?.allowedEmails.map((e) => e.email) || [],
  });
});

// DELETE /courses/:courseId
protectedRouter.delete("/:courseId", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  const id = Number(req.params.courseId);
  const course = await prisma.course.findUnique({ where: { id } });
  if (!course) return res.status(404).json({ error: "Course not found" });

  const isAdmin = req.user.role === "ADMIN";
  const isAuthor = course.authorId === req.user.id;
  if (!isAdmin && !isAuthor) {
    return res.status(403).json({ error: "Not allowed to delete this course" });
  }

  // Clean up: lesson progress, lessons, enrollments, then course
  await prisma.$transaction(async (tx) => {
    const lessons = await tx.lesson.findMany({ where: { courseId: id } });
    const lessonIds = lessons.map((l) => l.id);
    if (lessonIds.length > 0) {
      await tx.lessonProgress.deleteMany({ where: { lessonId: { in: lessonIds } } });
      await tx.lesson.deleteMany({ where: { id: { in: lessonIds } } });
    }

    await tx.courseEnrollment.deleteMany({ where: { courseId: id } });
    await tx.courseAllowedEmail.deleteMany({ where: { courseId: id } });
    await tx.course.delete({ where: { id } });
  });

  res.json({ message: "Course deleted" });
});

export const coursesRouter = { publicRouter, protectedRouter };
