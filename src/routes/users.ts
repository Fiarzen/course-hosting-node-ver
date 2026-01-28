import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "../db";
import { AuthenticatedRequest } from "../middleware/auth";

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
  const user = await prisma.user.create({
    data: {
      name: name || null,
      email,
      password: hashed,
      role: "STUDENT",
    },
  });

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

  const resetPath = `/reset-password?token=${token}`;

  return res.json({
    message: "Password reset link generated",
    resetToken: token,
    resetPath,
  });
});

export const usersRouter = { publicRouter, protectedRouter };
