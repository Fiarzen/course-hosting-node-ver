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
const publicRouter = (0, express_1.Router)();
const protectedRouter = (0, express_1.Router)();
// POST /users/register
publicRouter.post("/register", async (req, res) => {
    const { name, email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }
    const existing = await db_1.prisma.user.findUnique({ where: { email } });
    if (existing) {
        return res.status(409).json({ error: "Email already registered" });
    }
    const hashed = await bcrypt_1.default.hash(password, 10);
    const user = await db_1.prisma.user.create({
        data: {
            name: name || null,
            email,
            password: hashed,
            role: "STUDENT",
        },
    });
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
    const resetPath = `/reset-password?token=${token}`;
    return res.json({
        message: "Password reset link generated",
        resetToken: token,
        resetPath,
    });
});
exports.usersRouter = { publicRouter, protectedRouter };
