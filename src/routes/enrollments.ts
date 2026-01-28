import { Router } from "express";
import { prisma } from "../db";
import { AuthenticatedRequest } from "../middleware/auth";

export const enrollmentsRouter = Router();

// POST /enrollments/courses/:courseId
enrollmentsRouter.post("/courses/:courseId", async (req: AuthenticatedRequest, res) => {
  const user = req.user || null;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const courseId = Number(req.params.courseId);
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return res.status(404).json({ error: "User not found" });

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { allowedEmails: true },
  });
  if (!course) return res.status(404).json({ error: "Course not found" });

  const isAdmin = dbUser.role === "ADMIN";
  const isAuthor = course.authorId === dbUser.id;
  if (course.restrictedToAllowList && !isAdmin && !isAuthor) {
    const normalized = dbUser.email.toLowerCase();
    const allowed = course.allowedEmails.some((e) => e.email.toLowerCase() === normalized);
    if (!allowed) {
      return res.status(403).json({
        error: "Enrollment restricted: you are not on this course's allowlist",
      });
    }
  }

  const existing = await prisma.courseEnrollment.findUnique({
    where: {
      userId_courseId: {
        userId: dbUser.id,
        courseId,
      },
    },
  });
  if (existing) {
    return res.status(409).json({ error: "Already enrolled in this course" });
  }

  const enrollment = await prisma.courseEnrollment.create({
    data: {
      userId: dbUser.id,
      courseId,
    },
  });

  return res.status(201).json(enrollment);
});

// GET /enrollments/my-courses
enrollmentsRouter.get("/my-courses", async (req: AuthenticatedRequest, res) => {
  const user = req.user || null;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return res.status(404).json({ error: "User not found" });

  const enrollments = await prisma.courseEnrollment.findMany({
    where: { userId: dbUser.id },
    include: { course: true },
  });

  const result = await Promise.all(
    enrollments.map(async (enrollment) => {
      const lessons = await prisma.lesson.findMany({ where: { courseId: enrollment.courseId } });
      const totalLessons = lessons.length;
      const completedLessons = await prisma.lessonProgress.count({
        where: {
          userId: dbUser.id,
          lesson: { courseId: enrollment.courseId },
          completed: true,
        },
      });

      return {
        course: enrollment.course,
        enrolledAt: enrollment.enrolledAt.toISOString(),
        totalLessons,
        completedLessons,
        progress: totalLessons > 0 ? (completedLessons * 100.0) / totalLessons : 0.0,
      };
    })
  );

  return res.json(result);
});

// DELETE /enrollments/courses/:courseId
enrollmentsRouter.delete("/courses/:courseId", async (req: AuthenticatedRequest, res) => {
  const user = req.user || null;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const courseId = Number(req.params.courseId);
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return res.status(404).json({ error: "User not found" });

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) return res.status(404).json({ error: "Course not found" });

  const enrollment = await prisma.courseEnrollment.findUnique({
    where: { userId_courseId: { userId: dbUser.id, courseId } },
  });
  if (!enrollment) {
    return res.status(404).json({ error: "You are not enrolled in this course" });
  }

  await prisma.lessonProgress.deleteMany({
    where: { userId: dbUser.id, lesson: { courseId } },
  });

  await prisma.courseEnrollment.delete({ where: { id: enrollment.id } });

  return res.json({ message: "Unenrolled from course" });
});

// POST /enrollments/lessons/:lessonId/complete
enrollmentsRouter.post("/lessons/:lessonId/complete", async (req: AuthenticatedRequest, res) => {
  const user = req.user || null;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const lessonId = Number(req.params.lessonId);
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return res.status(404).json({ error: "User not found" });

  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
  if (!lesson) return res.status(404).json({ error: "Lesson not found" });

  const enrolled = await prisma.courseEnrollment.findUnique({
    where: {
      userId_courseId: {
        userId: dbUser.id,
        courseId: lesson.courseId,
      },
    },
  });
  if (!enrolled) {
    return res.status(403).json({
      error: "You must be enrolled in the course to complete lessons",
    });
  }

  const progress = await prisma.lessonProgress.upsert({
    where: {
      userId_lessonId: {
        userId: dbUser.id,
        lessonId,
      },
    },
    update: {
      completed: true,
      completedAt: new Date(),
    },
    create: {
      userId: dbUser.id,
      lessonId,
      completed: true,
      completedAt: new Date(),
    },
  });

  return res.json(progress);
});

// GET /enrollments/courses/:courseId/progress
enrollmentsRouter.get("/courses/:courseId/progress", async (req: AuthenticatedRequest, res) => {
  const user = req.user || null;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const courseId = Number(req.params.courseId);
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return res.status(404).json({ error: "User not found" });

  const enrolled = await prisma.courseEnrollment.findUnique({
    where: { userId_courseId: { userId: dbUser.id, courseId } },
  });
  if (!enrolled) {
    return res.status(403).json({ error: "You are not enrolled in this course" });
  }

  const lessons = await prisma.lesson.findMany({ where: { courseId } });
  const lessonProgress = await Promise.all(
    lessons.map(async (lesson) => {
      const progress = await prisma.lessonProgress.findUnique({
        where: {
          userId_lessonId: {
            userId: dbUser.id,
            lessonId: lesson.id,
          },
        },
      });

      return {
        lesson,
        completed: progress?.completed ?? false,
        completedAt: progress?.completedAt?.toISOString() ?? null,
      };
    })
  );

  const completedCount = lessonProgress.filter((p) => p.completed).length;
  const progressPercent = lessons.length > 0 ? (completedCount * 100.0) / lessons.length : 0.0;

  return res.json({
    lessons: lessonProgress,
    totalLessons: lessons.length,
    completedLessons: completedCount,
    progress: progressPercent,
  });
});
