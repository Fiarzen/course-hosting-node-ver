import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "../db";
import { AuthenticatedRequest } from "../middleware/auth";
import {
  sendVerificationEmail,
  sendAdminPasswordResetEmail,
} from "../services/email";

const publicRouter = Router();
const protectedRouter = Router();

// POST /users/register
publicRouter.post("/register", async (req, res) => {
  const { name, email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "Email already registered" });
  }

  const hashed = await bcrypt.hash(password, 10);
  const verificationToken = crypto.randomUUID();
  const user = await prisma.user.create({
    data: {
      name: name || null,
      email,
      password: hashed,
      role: "STUDENT",
      emailVerificationToken: verificationToken,
      emailVerificationTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  await sendVerificationEmail(email, verificationToken);

  const { password: _pw, ...safeUser } = user as any;
  return res.status(201).json(safeUser);
});

// GET /users (admin only)
protectedRouter.get("/", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  const me = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!me || me.role !== "ADMIN") {
    return res.status(403).json({ error: "Only admins can access this endpoint" });
  }

  const users = await prisma.user.findMany();
  return res.json(users.map(({ password, ...rest }) => rest));
});

// GET /users/me
protectedRouter.get("/me", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const { password, ...safeUser } = user as any;
  return res.json(safeUser);
});

// POST /users/:userId/upgrade-to-creator (admin only)
protectedRouter.post("/:userId/upgrade-to-creator", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  const admin = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!admin || admin.role !== "ADMIN") {
    return res.status(403).json({ error: "Only admins can upgrade users" });
  }

  const userId = Number(req.params.userId);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: "User not found" });

  if (user.role === "CREATOR" || user.role === "ADMIN") {
    return res.status(400).json({ error: "User is already a CREATOR or ADMIN" });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { role: "CREATOR" },
  });

  const { password, ...safeUser } = updated as any;
  return res.json({ message: "User successfully upgraded to CREATOR", user: safeUser });
});

// POST /users/:userId/reset-password (admin creates token)
protectedRouter.post("/:userId/reset-password", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  const admin = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!admin || admin.role !== "ADMIN") {
    return res.status(403).json({ error: "Only admins can reset passwords" });
  }

  const userId = Number(req.params.userId);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordResetToken: token,
      passwordResetTokenExpiry: expiresAt,
    },
  });

  await sendAdminPasswordResetEmail(user.email, token);

  const resetPath = `/reset-password?token=${token}`;

  return res.json({
    message: "Password reset link generated",
    resetToken: token,
    resetPath,
  });
});

// DELETE /users/:userId (admin only)
protectedRouter.delete("/:userId", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });

  const admin = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!admin || admin.role !== "ADMIN") {
    return res.status(403).json({ error: "Only admins can delete users" });
  }

  const userId = Number(req.params.userId);
  if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });

  if (userId === req.user.id) {
    return res.status(400).json({ error: "Admins cannot delete their own account" });
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return res.status(404).json({ error: "User not found" });

  if (target.role === "ADMIN") {
    return res.status(400).json({ error: "Cannot delete an ADMIN account" });
  }

  await prisma.$transaction(async (tx) => {
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

export const usersRouter = { publicRouter, protectedRouter };
