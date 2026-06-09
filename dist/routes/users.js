"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersRouter = void 0;
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db");
const rateLimit_1 = require("../middleware/rateLimit");
const email_1 = require("../services/email");
const publicRouter = (0, express_1.Router)();
const protectedRouter = (0, express_1.Router)();
// POST /users/register
publicRouter.post("/register", rateLimit_1.authLimiter, async (req, res) => {
    const { name, email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }
    if (typeof password !== "string" || password.length < 6) {
        return res
            .status(400)
            .json({ error: "Password must be at least 6 characters" });
    }
    const existing = await db_1.prisma.user.findUnique({ where: { email } });
    if (existing) {
        return res.status(409).json({ error: "Email already registered" });
    }
    const hashed = await bcrypt_1.default.hash(password, 10);
    const verificationToken = crypto_1.default.randomUUID();
    const user = await db_1.prisma.user.create({
        data: {
            name: name || null,
            email,
            password: hashed,
            role: "STUDENT",
            emailVerificationToken: verificationToken,
            emailVerificationTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
        },
    });
    await (0, email_1.sendVerificationEmail)(email, verificationToken);
    const { password: _pw, ...safeUser } = user;
    return res.status(201).json(safeUser);
});
// GET /users (admin only)
protectedRouter.get("/", async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: "Not authenticated" });
    const me = await db_1.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!me || me.role !== "ADMIN") {
        return res.status(403).json({ error: "Only admins can access this endpoint" });
    }
    const users = await db_1.prisma.user.findMany();
    return res.json(users.map(({ password, ...rest }) => rest));
});
// GET /users/me
protectedRouter.get("/me", async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: "Not authenticated" });
    const user = await db_1.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
        return res.status(404).json({ error: "User not found" });
    }
    const { password, ...safeUser } = user;
    return res.json(safeUser);
});
// POST /users/:userId/upgrade-to-creator (admin only)
protectedRouter.post("/:userId/upgrade-to-creator", async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: "Not authenticated" });
    const admin = await db_1.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!admin || admin.role !== "ADMIN") {
        return res.status(403).json({ error: "Only admins can upgrade users" });
    }
    const userId = Number(req.params.userId);
    const user = await db_1.prisma.user.findUnique({ where: { id: userId } });
    if (!user)
        return res.status(404).json({ error: "User not found" });
    if (user.role === "CREATOR" || user.role === "ADMIN") {
        return res.status(400).json({ error: "User is already a CREATOR or ADMIN" });
    }
    const updated = await db_1.prisma.user.update({
        where: { id: userId },
        data: { role: "CREATOR" },
    });
    const { password, ...safeUser } = updated;
    return res.json({ message: "User successfully upgraded to CREATOR", user: safeUser });
});
// POST /users/:userId/reset-password (admin creates token)
protectedRouter.post("/:userId/reset-password", async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: "Not authenticated" });
    const admin = await db_1.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!admin || admin.role !== "ADMIN") {
        return res.status(403).json({ error: "Only admins can reset passwords" });
    }
    const userId = Number(req.params.userId);
    const user = await db_1.prisma.user.findUnique({ where: { id: userId } });
    if (!user)
        return res.status(404).json({ error: "User not found" });
    const token = crypto_1.default.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await db_1.prisma.user.update({
        where: { id: userId },
        data: {
            passwordResetToken: token,
            passwordResetTokenExpiry: expiresAt,
        },
    });
    await (0, email_1.sendAdminPasswordResetEmail)(user.email, token);
    const resetPath = `/reset-password?token=${token}`;
    return res.json({
        message: "Password reset link generated",
        resetToken: token,
        resetPath,
    });
});
// DELETE /users/:userId (admin only)
protectedRouter.delete("/:userId", async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: "Not authenticated" });
    const admin = await db_1.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!admin || admin.role !== "ADMIN") {
        return res.status(403).json({ error: "Only admins can delete users" });
    }
    const userId = Number(req.params.userId);
    if (isNaN(userId))
        return res.status(400).json({ error: "Invalid user ID" });
    if (userId === req.user.id) {
        return res.status(400).json({ error: "Admins cannot delete their own account" });
    }
    const target = await db_1.prisma.user.findUnique({ where: { id: userId } });
    if (!target)
        return res.status(404).json({ error: "User not found" });
    if (target.role === "ADMIN") {
        return res.status(400).json({ error: "Cannot delete an ADMIN account" });
    }
    await db_1.prisma.$transaction(async (tx) => {
        const authoredCourses = await tx.course.findMany({ where: { authorId: userId } });
        const authoredCourseIds = authoredCourses.map((c) => c.id);
        if (authoredCourseIds.length > 0) {
            const authoredLessons = await tx.lesson.findMany({
                where: { courseId: { in: authoredCourseIds } },
            });
            const authoredLessonIds = authoredLessons.map((l) => l.id);
            if (authoredLessonIds.length > 0) {
                await tx.lessonProgress.deleteMany({ where: { lessonId: { in: authoredLessonIds } } });
                await tx.lesson.deleteMany({ where: { id: { in: authoredLessonIds } } });
            }
            await tx.courseEnrollment.deleteMany({ where: { courseId: { in: authoredCourseIds } } });
            await tx.courseAllowedEmail.deleteMany({ where: { courseId: { in: authoredCourseIds } } });
            await tx.coursePurchase.deleteMany({ where: { courseId: { in: authoredCourseIds } } });
            await tx.course.deleteMany({ where: { id: { in: authoredCourseIds } } });
        }
        await tx.lessonProgress.deleteMany({ where: { userId } });
        await tx.courseEnrollment.deleteMany({ where: { userId } });
        await tx.coursePurchase.deleteMany({ where: { userId } });
        await tx.user.delete({ where: { id: userId } });
    });
    return res.json({ message: "User deleted successfully" });
});
exports.usersRouter = { publicRouter, protectedRouter };
