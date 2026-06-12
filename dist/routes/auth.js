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
const email_1 = require("../services/email");
const safeUser_1 = require("../utils/safeUser");
const authToken_1 = require("../utils/authToken");
exports.authRouter = (0, express_1.Router)();
// Auth tokens are server-side session tokens; expire them so a leaked token
// is not valid forever.
const AUTH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// A precomputed bcrypt hash used to spend the same ~time comparing a password
// when the email doesn't exist as when it does. Prevents email enumeration via
// login response timing. The plaintext is irrelevant — it never matches.
const DUMMY_PASSWORD_HASH = bcrypt_1.default.hashSync("invalid-credentials-placeholder", 10);
exports.authRouter.post("/login", async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }
    const user = await db_1.prisma.user.findUnique({ where: { email } });
    // Always run a bcrypt comparison, even for a missing user, so the response
    // time does not reveal whether the email is registered.
    const ok = await bcrypt_1.default.compare(password, user?.password ?? DUMMY_PASSWORD_HASH);
    if (!user || !ok) {
        return res.status(401).json({ error: "Invalid email or password" });
    }
    const token = crypto_1.default.randomUUID();
    const updated = await db_1.prisma.user.update({
        where: { id: user.id },
        data: {
            authToken: (0, authToken_1.hashAuthToken)(token),
            authTokenExpiry: new Date(Date.now() + AUTH_TOKEN_TTL_MS),
        },
    });
    return res.json({ token, user: (0, safeUser_1.toSafeUser)(updated) });
});
exports.authRouter.post("/reset-password", async (req, res) => {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
        return res.status(400).json({ error: "Token and new password are required" });
    }
    if (typeof newPassword !== "string" || newPassword.length < 6) {
        return res
            .status(400)
            .json({ error: "Password must be at least 6 characters" });
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
            authTokenExpiry: null,
        },
    });
    return res.json({ message: "Password has been reset successfully" });
});
exports.authRouter.post("/forgot-password", async (req, res) => {
    const { email } = req.body || {};
    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }
    const user = await db_1.prisma.user.findUnique({ where: { email } });
    if (!user) {
        return res.json({ message: "If that email is registered, a reset link has been sent." });
    }
    const token = crypto_1.default.randomUUID();
    await db_1.prisma.user.update({
        where: { id: user.id },
        data: {
            passwordResetToken: token,
            passwordResetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
        },
    });
    await (0, email_1.sendPasswordResetEmail)(email, token);
    return res.json({ message: "If that email is registered, a reset link has been sent." });
});
exports.authRouter.post("/change-password", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Authentication required" });
    }
    const sessionToken = authHeader.slice(7);
    const user = await (0, authToken_1.findUserByAuthToken)(sessionToken);
    const expired = user?.authTokenExpiry != null && user.authTokenExpiry < new Date();
    if (!user || expired) {
        return res.status(401).json({ error: "Authentication required" });
    }
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
        return res
            .status(400)
            .json({ error: "Current and new password are required" });
    }
    if (typeof newPassword !== "string" || newPassword.length < 6) {
        return res
            .status(400)
            .json({ error: "Password must be at least 6 characters" });
    }
    const ok = await bcrypt_1.default.compare(currentPassword, user.password);
    if (!ok) {
        return res.status(401).json({ error: "Current password is incorrect" });
    }
    // Rotate the auth token so any other active sessions are invalidated, and
    // return the fresh token so the requesting client stays signed in.
    const hashed = await bcrypt_1.default.hash(newPassword, 10);
    const token = crypto_1.default.randomUUID();
    await db_1.prisma.user.update({
        where: { id: user.id },
        data: {
            password: hashed,
            authToken: (0, authToken_1.hashAuthToken)(token),
            authTokenExpiry: new Date(Date.now() + AUTH_TOKEN_TTL_MS),
        },
    });
    return res.json({ message: "Password changed successfully", token });
});
exports.authRouter.post("/verify-email", async (req, res) => {
    const { token } = req.body || {};
    if (!token) {
        return res.status(400).json({ error: "Token is required" });
    }
    const user = await db_1.prisma.user.findFirst({ where: { emailVerificationToken: token } });
    if (!user || !user.emailVerificationTokenExpiry || user.emailVerificationTokenExpiry < new Date()) {
        return res.status(400).json({ error: "Invalid or expired verification token" });
    }
    await db_1.prisma.user.update({
        where: { id: user.id },
        data: {
            emailVerified: true,
            emailVerificationToken: null,
            emailVerificationTokenExpiry: null,
        },
    });
    return res.json({ message: "Email verified successfully" });
});
exports.authRouter.post("/resend-verification", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Authentication required" });
    }
    const token = authHeader.slice(7);
    const user = await (0, authToken_1.findUserByAuthToken)(token);
    const expired = user?.authTokenExpiry != null && user.authTokenExpiry < new Date();
    if (!user || expired) {
        return res.status(401).json({ error: "Authentication required" });
    }
    if (user.emailVerified) {
        return res.status(400).json({ error: "Email already verified" });
    }
    const verificationToken = crypto_1.default.randomUUID();
    await db_1.prisma.user.update({
        where: { id: user.id },
        data: {
            emailVerificationToken: verificationToken,
            emailVerificationTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
        },
    });
    await (0, email_1.sendVerificationEmail)(user.email, verificationToken);
    return res.json({ message: "Verification email sent" });
});
