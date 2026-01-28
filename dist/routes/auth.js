"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db");
exports.authRouter = (0, express_1.Router)();
exports.authRouter.post("/login", async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }
    const user = await db_1.prisma.user.findUnique({ where: { email } });
    if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
    }
    const ok = await bcrypt_1.default.compare(password, user.password);
    if (!ok) {
        return res.status(401).json({ error: "Invalid email or password" });
    }
    const token = crypto_1.default.randomUUID();
    const updated = await db_1.prisma.user.update({
        where: { id: user.id },
        data: { authToken: token },
    });
    const { password: _pw, ...safeUser } = updated;
    return res.json({ token, user: safeUser });
});
exports.authRouter.post("/reset-password", async (req, res) => {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
        return res.status(400).json({ error: "Token and new password are required" });
    }
    const user = await db_1.prisma.user.findFirst({ where: { passwordResetToken: token } });
    if (!user || !user.passwordResetTokenExpiry || user.passwordResetTokenExpiry < new Date()) {
        return res.status(400).json({ error: "Invalid or expired reset token" });
    }
    const hashed = await bcrypt_1.default.hash(newPassword, 10);
    await db_1.prisma.user.update({
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
