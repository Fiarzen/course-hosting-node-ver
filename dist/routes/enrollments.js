"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enrollmentsRouter = void 0;
const express_1 = require("express");
const db_1 = require("../db");
exports.enrollmentsRouter = (0, express_1.Router)();
// POST /enrollments/courses/:courseId
exports.enrollmentsRouter.post("/courses/:courseId", async (req, res) => {
    const user = req.user || null;
    if (!user)
        return res.status(401).json({ error: "Not authenticated" });
    const courseId = Number(req.params.courseId);
    const dbUser = await db_1.prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser)
        return res.status(404).json({ error: "User not found" });
    const course = await db_1.prisma.course.findUnique({
        where: { id: courseId },
        include: { allowedEmails: true },
    });
    if (!course)
        return res.status(404).json({ error: "Course not found" });
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
    // Payment gate: paid courses require a succeeded purchase
    if (course.isPaid) {
        const succeededPurchase = await db_1.prisma.coursePurchase.findFirst({
            where: { userId: dbUser.id, courseId, status: "SUCCEEDED" },
        });
        if (!succeededPurchase) {
            return res.status(402).json({ error: "Payment required for this course", code: "PAYMENT_REQUIRED" });
        }
    }
    const existing = await db_1.prisma.courseEnrollment.findUnique({
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
    const enrollment = await db_1.prisma.courseEnrollment.create({
        data: {
            userId: dbUser.id,
            courseId,
        },
    });
    return res.status(201).json(enrollment);
});
// GET /enrollments/my-courses
exports.enrollmentsRouter.get("/my-courses", async (req, res) => {
    const user = req.user || null;
    if (!user)
        return res.status(401).json({ error: "Not authenticated" });
    const dbUser = await db_1.prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser)
        return res.status(404).json({ error: "User not found" });
    const enrollments = await db_1.prisma.courseEnrollment.findMany({
        where: { userId: dbUser.id },
        include: { course: true },
    });
    const courseIds = enrollments.map((e) => e.courseId);
    // Two aggregate queries instead of two queries per enrolled course.
    const [lessonCounts, completedRows] = await Promise.all([
        db_1.prisma.lesson.groupBy({
            by: ["courseId"],
            where: { courseId: { in: courseIds } },
            _count: { id: true },
        }),
        db_1.prisma.lessonProgress.findMany({
            where: {
                userId: dbUser.id,
                completed: true,
                lesson: { courseId: { in: courseIds } },
            },
            select: { lesson: { select: { courseId: true } } },
        }),
    ]);
    const totalByCourse = new Map(lessonCounts.map((c) => [c.courseId, c._count.id]));
    const completedByCourse = new Map();
    for (const row of completedRows) {
        const cid = row.lesson.courseId;
        completedByCourse.set(cid, (completedByCourse.get(cid) ?? 0) + 1);
    }
    const result = enrollments.map((enrollment) => {
        const totalLessons = totalByCourse.get(enrollment.courseId) ?? 0;
        const completedLessons = completedByCourse.get(enrollment.courseId) ?? 0;
        return {
            course: enrollment.course,
            enrolledAt: enrollment.enrolledAt.toISOString(),
            totalLessons,
            completedLessons,
            progress: totalLessons > 0 ? (completedLessons * 100.0) / totalLessons : 0.0,
        };
    });
    return res.json(result);
});
// DELETE /enrollments/courses/:courseId
exports.enrollmentsRouter.delete("/courses/:courseId", async (req, res) => {
    const user = req.user || null;
    if (!user)
        return res.status(401).json({ error: "Not authenticated" });
    const courseId = Number(req.params.courseId);
    const dbUser = await db_1.prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser)
        return res.status(404).json({ error: "User not found" });
    const course = await db_1.prisma.course.findUnique({ where: { id: courseId } });
    if (!course)
        return res.status(404).json({ error: "Course not found" });
    const enrollment = await db_1.prisma.courseEnrollment.findUnique({
        where: { userId_courseId: { userId: dbUser.id, courseId } },
    });
    if (!enrollment) {
        return res.status(404).json({ error: "You are not enrolled in this course" });
    }
    await db_1.prisma.lessonProgress.deleteMany({
        where: { userId: dbUser.id, lesson: { courseId } },
    });
    await db_1.prisma.courseEnrollment.delete({ where: { id: enrollment.id } });
    return res.json({ message: "Unenrolled from course" });
});
// POST /enrollments/lessons/:lessonId/complete
exports.enrollmentsRouter.post("/lessons/:lessonId/complete", async (req, res) => {
    const user = req.user || null;
    if (!user)
        return res.status(401).json({ error: "Not authenticated" });
    const lessonId = Number(req.params.lessonId);
    const dbUser = await db_1.prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser)
        return res.status(404).json({ error: "User not found" });
    const lesson = await db_1.prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson)
        return res.status(404).json({ error: "Lesson not found" });
    const enrolled = await db_1.prisma.courseEnrollment.findUnique({
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
    const progress = await db_1.prisma.lessonProgress.upsert({
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
exports.enrollmentsRouter.get("/courses/:courseId/progress", async (req, res) => {
    const user = req.user || null;
    if (!user)
        return res.status(401).json({ error: "Not authenticated" });
    const courseId = Number(req.params.courseId);
    const dbUser = await db_1.prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser)
        return res.status(404).json({ error: "User not found" });
    const enrolled = await db_1.prisma.courseEnrollment.findUnique({
        where: { userId_courseId: { userId: dbUser.id, courseId } },
    });
    if (!enrolled) {
        return res.status(403).json({ error: "You are not enrolled in this course" });
    }
    const lessons = await db_1.prisma.lesson.findMany({ where: { courseId } });
    // One progress query for the whole course instead of one per lesson.
    const progressRows = await db_1.prisma.lessonProgress.findMany({
        where: { userId: dbUser.id, lessonId: { in: lessons.map((l) => l.id) } },
    });
    const progressByLesson = new Map(progressRows.map((p) => [p.lessonId, p]));
    const lessonProgress = lessons.map((lesson) => {
        const progress = progressByLesson.get(lesson.id);
        return {
            lesson,
            completed: progress?.completed ?? false,
            completedAt: progress?.completedAt?.toISOString() ?? null,
        };
    });
    const completedCount = lessonProgress.filter((p) => p.completed).length;
    const progressPercent = lessons.length > 0 ? (completedCount * 100.0) / lessons.length : 0.0;
    return res.json({
        lessons: lessonProgress,
        totalLessons: lessons.length,
        completedLessons: completedCount,
        progress: progressPercent,
    });
});
