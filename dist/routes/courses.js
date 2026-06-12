"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coursesRouter = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const publicRouter = (0, express_1.Router)();
const protectedRouter = (0, express_1.Router)();
function canSeeCourse(user, course) {
    if (!course.restrictedToAllowList)
        return true;
    if (!user)
        return false;
    if (user.role === "ADMIN")
        return true;
    if (course.authorId && course.authorId === user.id)
        return true;
    const allowedEmails = course.allowedEmails;
    return allowedEmails?.some((e) => e.email.toLowerCase() === user.email.toLowerCase());
}
// GET /courses (public listing with allowlist logic)
publicRouter.get("/", async (req, res) => {
    const user = req.user || null;
    // allowedEmails is needed for the visibility check but must never reach the
    // client, and author must be a safe subset — the full User row carries the
    // password hash and live auth/reset tokens.
    const courses = await db_1.prisma.course.findMany({
        include: {
            allowedEmails: { select: { email: true } },
            author: { select: { id: true, name: true } },
        },
    });
    const visible = courses
        .filter((c) => canSeeCourse(user, c))
        .map(({ allowedEmails, ...course }) => course);
    res.json(visible);
});
// POST /courses (creator/admin)
protectedRouter.post("/", async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: "Not authenticated" });
    if (req.user.role !== "CREATOR" && req.user.role !== "ADMIN") {
        return res.status(403).json({ error: "Forbidden" });
    }
    const { title, description, authorId, isPaid, priceCents, currency } = req.body || {};
    if (isPaid === true) {
        if (!priceCents || typeof priceCents !== "number" || !Number.isInteger(priceCents) || priceCents <= 0) {
            return res.status(422).json({ error: "priceCents must be a positive integer when isPaid is true", code: "COURSE_NOT_PURCHASABLE" });
        }
        if (!currency || typeof currency !== "string") {
            return res.status(422).json({ error: "currency is required when isPaid is true", code: "COURSE_NOT_PURCHASABLE" });
        }
    }
    // Only admins may attribute a course to another user.
    const resolvedAuthorId = req.user.role === "ADMIN" && Number.isInteger(authorId)
        ? authorId
        : req.user.id;
    const course = await db_1.prisma.course.create({
        data: {
            title,
            description,
            authorId: resolvedAuthorId,
            isPaid: isPaid === true,
            priceCents: isPaid === true ? priceCents : null,
            currency: isPaid === true ? currency.toLowerCase() : null,
        },
    });
    res.json(course);
});
// GET /courses/my-created
protectedRouter.get("/my-created", async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: "Not authenticated" });
    const courses = await db_1.prisma.course.findMany({ where: { authorId: req.user.id } });
    res.json(courses);
});
// GET /courses/:courseId/access
protectedRouter.get("/:courseId/access", async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: "Not authenticated" });
    const id = Number(req.params.courseId);
    const course = await db_1.prisma.course.findUnique({
        where: { id },
        include: { allowedEmails: true },
    });
    if (!course)
        return res.status(404).json({ error: "Course not found" });
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
protectedRouter.put("/:courseId/access", async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: "Not authenticated" });
    const id = Number(req.params.courseId);
    const body = req.body || {};
    const course = await db_1.prisma.course.findUnique({
        where: { id },
        include: { allowedEmails: true },
    });
    if (!course)
        return res.status(404).json({ error: "Course not found" });
    const isAdmin = req.user.role === "ADMIN";
    const isAuthor = course.authorId === req.user.id;
    if (!isAdmin && !isAuthor) {
        return res.status(403).json({ error: "Not allowed to modify access for this course" });
    }
    const restricted = Boolean(body.restrictedToAllowList);
    const emails = Array.isArray(body.allowedEmails) ? body.allowedEmails : [];
    const normalized = Array.from(new Set(emails
        .filter((e) => typeof e === "string")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)));
    await db_1.prisma.$transaction([
        db_1.prisma.course.update({
            where: { id },
            data: { restrictedToAllowList: restricted },
        }),
        db_1.prisma.courseAllowedEmail.deleteMany({ where: { courseId: id } }),
        db_1.prisma.courseAllowedEmail.createMany({
            data: normalized.map((email) => ({ courseId: id, email })),
        }),
    ]);
    const updated = await db_1.prisma.course.findUnique({
        where: { id },
        include: { allowedEmails: true },
    });
    res.json({
        restrictedToAllowList: updated?.restrictedToAllowList,
        allowedEmails: updated?.allowedEmails.map((e) => e.email) || [],
    });
});
// DELETE /courses/:courseId
protectedRouter.delete("/:courseId", async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: "Not authenticated" });
    const id = Number(req.params.courseId);
    const course = await db_1.prisma.course.findUnique({ where: { id } });
    if (!course)
        return res.status(404).json({ error: "Course not found" });
    const isAdmin = req.user.role === "ADMIN";
    const isAuthor = course.authorId === req.user.id;
    if (!isAdmin && !isAuthor) {
        return res.status(403).json({ error: "Not allowed to delete this course" });
    }
    // Clean up: lesson progress, lessons, enrollments, then course
    await db_1.prisma.$transaction(async (tx) => {
        const lessons = await tx.lesson.findMany({ where: { courseId: id } });
        const lessonIds = lessons.map((l) => l.id);
        if (lessonIds.length > 0) {
            await tx.lessonProgress.deleteMany({ where: { lessonId: { in: lessonIds } } });
            await tx.lesson.deleteMany({ where: { id: { in: lessonIds } } });
        }
        await tx.courseEnrollment.deleteMany({ where: { courseId: id } });
        await tx.courseAllowedEmail.deleteMany({ where: { courseId: id } });
        await tx.coursePurchase.deleteMany({ where: { courseId: id } });
        await tx.course.delete({ where: { id } });
    });
    res.json({ message: "Course deleted" });
});
// PUT /courses/:courseId/pricing (author/admin only)
protectedRouter.put("/:courseId/pricing", async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    const id = Number(req.params.courseId);
    const course = await db_1.prisma.course.findUnique({ where: { id } });
    if (!course)
        return res.status(404).json({ error: "Course not found", code: "COURSE_NOT_FOUND" });
    const isAdmin = req.user.role === "ADMIN";
    const isAuthor = course.authorId === req.user.id;
    if (!isAdmin && !isAuthor) {
        return res.status(403).json({ error: "Not allowed to modify pricing for this course" });
    }
    const { isPaid, priceCents, currency } = req.body || {};
    if (typeof isPaid !== "boolean") {
        return res.status(422).json({ error: "isPaid must be a boolean", code: "COURSE_NOT_PURCHASABLE" });
    }
    if (isPaid === true) {
        if (!priceCents || typeof priceCents !== "number" || !Number.isInteger(priceCents) || priceCents <= 0) {
            return res.status(422).json({ error: "priceCents must be a positive integer when isPaid is true", code: "COURSE_NOT_PURCHASABLE" });
        }
        if (!currency || typeof currency !== "string") {
            return res.status(422).json({ error: "currency is required when isPaid is true", code: "COURSE_NOT_PURCHASABLE" });
        }
    }
    const updated = await db_1.prisma.course.update({
        where: { id },
        data: {
            isPaid,
            priceCents: isPaid ? priceCents : null,
            currency: isPaid ? currency.toLowerCase() : null,
        },
    });
    return res.json({
        courseId: updated.id,
        isPaid: updated.isPaid,
        priceCents: updated.priceCents ?? null,
        currency: updated.currency ?? null,
    });
});
// PUT /courses/:courseId/featured (admin only — controls the public homepage)
protectedRouter.put("/:courseId/featured", async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: "Not authenticated" });
    if (req.user.role !== "ADMIN") {
        return res.status(403).json({ error: "Only admins can feature courses" });
    }
    const id = Number(req.params.courseId);
    const course = await db_1.prisma.course.findUnique({ where: { id } });
    if (!course)
        return res.status(404).json({ error: "Course not found" });
    const { featured } = req.body || {};
    if (typeof featured !== "boolean") {
        return res.status(422).json({ error: "featured must be a boolean" });
    }
    const updated = await db_1.prisma.course.update({
        where: { id },
        data: { featured },
    });
    res.json({ courseId: updated.id, featured: updated.featured });
});
exports.coursesRouter = { publicRouter, protectedRouter };
