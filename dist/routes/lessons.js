"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lessonsRouter = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const storage_1 = require("../services/storage");
exports.lessonsRouter = (0, express_1.Router)();
function isAdmin(user) {
    return user && user.role === "ADMIN";
}
async function isCourseAuthor(user, courseId) {
    if (!user)
        return false;
    const course = await db_1.prisma.course.findUnique({ where: { id: courseId } });
    return !!course && course.authorId === user.id;
}
async function isEnrolledInCourse(userId, courseId) {
    const count = await db_1.prisma.courseEnrollment.count({ where: { userId, courseId } });
    return count > 0;
}
async function isOnCourseAllowList(email, courseId) {
    const course = await db_1.prisma.course.findUnique({
        where: { id: courseId },
        include: { allowedEmails: true },
    });
    if (!course)
        return false;
    if (!course.restrictedToAllowList)
        return true;
    const normalized = email.toLowerCase();
    return course.allowedEmails.some((e) => e.email.toLowerCase() === normalized);
}
async function canViewFullLessonContent(user, courseId) {
    if (!user)
        return false;
    const course = await db_1.prisma.course.findUnique({ where: { id: courseId } });
    if (!course)
        return false;
    if (isAdmin(user) || (course.authorId && course.authorId === user.id))
        return true;
    if (!(await isOnCourseAllowList(user.email, courseId)))
        return false;
    return await isEnrolledInCourse(user.id, courseId);
}
// GET /lessons
exports.lessonsRouter.get("/", async (req, res) => {
    const user = req.user || null;
    if (!user)
        return res.status(401).json({ error: "Not authenticated" });
    if (isAdmin(user)) {
        const all = await db_1.prisma.lesson.findMany();
        return res.json(all);
    }
    const enrollments = await db_1.prisma.courseEnrollment.findMany({ where: { userId: user.id } });
    const authoredCourses = await db_1.prisma.course.findMany({ where: { authorId: user.id } });
    const accessibleCourseIds = new Set();
    enrollments.forEach((e) => accessibleCourseIds.add(e.courseId));
    authoredCourses.forEach((c) => accessibleCourseIds.add(c.id));
    const lessons = await db_1.prisma.lesson.findMany({});
    const filtered = lessons.filter((l) => accessibleCourseIds.has(l.courseId));
    return res.json(filtered);
});
// GET /lessons/course/:courseId
exports.lessonsRouter.get("/course/:courseId", async (req, res) => {
    const user = req.user || null;
    if (!user)
        return res.status(401).json({ error: "Not authenticated" });
    const courseId = Number(req.params.courseId);
    const course = await db_1.prisma.course.findUnique({ where: { id: courseId } });
    if (!course)
        return res.status(404).json({ error: "Course not found" });
    const orderedLessons = await db_1.prisma.lesson.findMany({
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
    return res.json(orderedLessons);
});
// POST /lessons (multipart)
exports.lessonsRouter.post("/", storage_1.upload.single("pdf"), async (req, res) => {
    const user = req.user || null;
    if (!user)
        return res.status(401).json({ error: "Not authenticated" });
    if (!isAdmin(user) && !(await isCourseAuthor(user, Number(req.body.courseId)))) {
        return res
            .status(403)
            .json({ error: "Only course authors or admins can create lessons for this course" });
    }
    const { title, content, courseId, videoUrl } = req.body;
    const cid = Number(courseId);
    const course = await db_1.prisma.course.findUnique({ where: { id: cid } });
    if (!course)
        return res.status(400).json({ error: `Course not found with id: ${cid}` });
    const pdfUrl = await (0, storage_1.uploadPdfFromRequest)(req.file || undefined);
    const count = await db_1.prisma.lesson.count({ where: { courseId: cid } });
    const orderIndex = count + 1;
    const lesson = await db_1.prisma.lesson.create({
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
});
// GET /lessons/:lessonId
exports.lessonsRouter.get("/:lessonId", async (req, res) => {
    const user = req.user || null;
    if (!user)
        return res.status(401).json({ error: "Not authenticated" });
    const lessonId = Number(req.params.lessonId);
    const lesson = await db_1.prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson)
        return res.status(404).json({ error: "Lesson not found" });
    if (!(await canViewFullLessonContent(user, lesson.courseId))) {
        return res.status(403).json({
            error: "You must be enrolled in the course (or be the author/admin) to view this lesson",
        });
    }
    return res.json(lesson);
});
// PUT /lessons/:lessonId (multipart)
exports.lessonsRouter.put("/:lessonId", storage_1.upload.single("pdf"), async (req, res) => {
    const user = req.user || null;
    if (!user)
        return res.status(401).json({ error: "Not authenticated" });
    const lessonId = Number(req.params.lessonId);
    const lesson = await db_1.prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson)
        return res.status(404).json({ error: "Lesson not found" });
    const course = await db_1.prisma.course.findUnique({ where: { id: lesson.courseId } });
    const isAuthor = course && course.authorId === user.id;
    if (!isAdmin(user) && !isAuthor) {
        return res
            .status(403)
            .json({ error: "Only course authors or admins can update lessons for this course" });
    }
    const { title, content, videoUrl, clearPdf } = req.body;
    let pdfUrl = lesson.pdfUrl;
    if (req.file) {
        pdfUrl = await (0, storage_1.uploadPdfFromRequest)(req.file);
    }
    else if (String(clearPdf) === "true") {
        pdfUrl = null;
    }
    const updated = await db_1.prisma.lesson.update({
        where: { id: lessonId },
        data: {
            title,
            content,
            videoUrl: videoUrl ?? lesson.videoUrl,
            pdfUrl,
        },
    });
    return res.json(updated);
});
// DELETE /lessons/:lessonId
exports.lessonsRouter.delete("/:lessonId", async (req, res) => {
    const user = req.user || null;
    if (!user)
        return res.status(401).json({ error: "Not authenticated" });
    const lessonId = Number(req.params.lessonId);
    const lesson = await db_1.prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson)
        return res.status(404).json({ error: "Lesson not found" });
    const course = await db_1.prisma.course.findUnique({ where: { id: lesson.courseId } });
    const isAuthor = course && course.authorId === user.id;
    if (!isAdmin(user) && !isAuthor) {
        return res
            .status(403)
            .json({ error: "Only course authors or admins can delete lessons for this course" });
    }
    await db_1.prisma.lessonProgress.deleteMany({ where: { lessonId } });
    await db_1.prisma.lesson.delete({ where: { id: lessonId } });
    return res.status(204).send();
});
// POST /lessons/course/:courseId/reorder
exports.lessonsRouter.post("/course/:courseId/reorder", async (req, res) => {
    const user = req.user || null;
    if (!user)
        return res.status(401).json({ error: "Not authenticated" });
    const courseId = Number(req.params.courseId);
    const course = await db_1.prisma.course.findUnique({ where: { id: courseId } });
    if (!course)
        return res.status(404).json({ error: "Course not found" });
    const isAuthor = course.authorId === user.id;
    if (!isAdmin(user) && !isAuthor) {
        return res
            .status(403)
            .json({ error: "Only course authors or admins can reorder lessons for this course" });
    }
    const orderedLessonIds = Array.isArray(req.body)
        ? req.body.map((id) => Number(id))
        : [];
    const lessons = await db_1.prisma.lesson.findMany({
        where: { courseId },
        orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
    });
    const byId = new Map();
    lessons.forEach((l) => byId.set(l.id, l));
    let index = 1;
    for (const id of orderedLessonIds) {
        const lesson = byId.get(id);
        if (lesson) {
            await db_1.prisma.lesson.update({ where: { id }, data: { orderIndex: index++ } });
            byId.delete(id);
        }
    }
    for (const [id, lesson] of byId.entries()) {
        if (!lesson.orderIndex || lesson.orderIndex < 1) {
            await db_1.prisma.lesson.update({ where: { id }, data: { orderIndex: index++ } });
        }
    }
    const updated = await db_1.prisma.lesson.findMany({
        where: { courseId },
        orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
    });
    return res.json(updated);
});
