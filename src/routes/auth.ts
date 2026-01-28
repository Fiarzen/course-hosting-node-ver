import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "../db";

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
