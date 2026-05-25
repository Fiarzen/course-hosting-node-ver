import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "../db";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "../services/email";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = crypto.randomUUID();
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { authToken: token },
  });

  const { password: _pw, ...safeUser } = updated as any;

  return res.json({ token, user: safeUser });
});

authRouter.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) {
    return res.status(400).json({ error: "Token and new password are required" });
  }

  const user = await prisma.user.findFirst({ where: { passwordResetToken: token } });
  if (!user || !user.passwordResetTokenExpiry || user.passwordResetTokenExpiry < new Date()) {
    return res.status(400).json({ error: "Invalid or expired reset token" });
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashed,
      passwordResetToken: null,
      passwordResetTokenExpiry: null,
      authToken: null,
    },
  });

  return res.json({ message: "Password has been reset successfully" });
});

authRouter.post("/forgot-password", async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.json({ message: "If that email is registered, a reset link has been sent." });
  }

  const token = crypto.randomUUID();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetToken: token,
      passwordResetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  await sendPasswordResetEmail(email, token);

  return res.json({ message: "If that email is registered, a reset link has been sent." });
});

authRouter.post("/verify-email", async (req, res) => {
  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ error: "Token is required" });
  }

  const user = await prisma.user.findFirst({ where: { emailVerificationToken: token } });
  if (!user || !user.emailVerificationTokenExpiry || user.emailVerificationTokenExpiry < new Date()) {
    return res.status(400).json({ error: "Invalid or expired verification token" });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationTokenExpiry: null,
    },
  });

  return res.json({ message: "Email verified successfully" });
});

authRouter.post("/resend-verification", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const token = authHeader.slice(7);
  const user = await prisma.user.findUnique({ where: { authToken: token } });
  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (user.emailVerified) {
    return res.status(400).json({ error: "Email already verified" });
  }

  const verificationToken = crypto.randomUUID();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerificationToken: verificationToken,
      emailVerificationTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  await sendVerificationEmail(user.email, verificationToken);

  return res.json({ message: "Verification email sent" });
});
