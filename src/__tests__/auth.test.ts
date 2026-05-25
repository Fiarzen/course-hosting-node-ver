import request from "supertest";
import bcrypt from "bcrypt";
import { app } from "../app";
import { prisma } from "../db";
import { mockUser } from "./helpers";

jest.mock("../db");
jest.mock("../services/email", () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendAdminPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));

const db = prisma as jest.Mocked<typeof prisma>;

describe("POST /auth/login", () => {
  it("returns 400 when email or password is missing", async () => {
    const res = await request(app).post("/auth/login").send({ email: "a@b.com" });
    expect(res.status).toBe(400);
  });

  it("returns 401 when user is not found", async () => {
    (db.user.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await request(app).post("/auth/login").send({ email: "x@x.com", password: "pass" });
    expect(res.status).toBe(401);
  });

  it("returns 401 when password is wrong", async () => {
    (db.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    const res = await request(app).post("/auth/login").send({ email: mockUser.email, password: "wrongpassword" });
    expect(res.status).toBe(401);
  });

  it("returns 200 with token and user (no password) on success", async () => {
    const hashed = await bcrypt.hash("correct", 10);
    const userWithHash = { ...mockUser, password: hashed, authToken: "new-token" };
    (db.user.findUnique as jest.Mock).mockResolvedValue(userWithHash);
    (db.user.update as jest.Mock).mockResolvedValue(userWithHash);

    const res = await request(app).post("/auth/login").send({ email: mockUser.email, password: "correct" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    expect(res.body.user).not.toHaveProperty("password");
    expect(res.body.user.email).toBe(mockUser.email);
  });
});

describe("POST /auth/reset-password", () => {
  it("returns 400 when token or newPassword is missing", async () => {
    const res = await request(app).post("/auth/reset-password").send({ token: "abc" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when reset token is not found", async () => {
    (db.user.findFirst as jest.Mock).mockResolvedValue(null);
    const res = await request(app).post("/auth/reset-password").send({ token: "bad-token", newPassword: "newpass" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when reset token is expired", async () => {
    const expiredUser = {
      ...mockUser,
      passwordResetToken: "expired-token",
      passwordResetTokenExpiry: new Date(Date.now() - 1000),
    };
    (db.user.findFirst as jest.Mock).mockResolvedValue(expiredUser);
    const res = await request(app).post("/auth/reset-password").send({ token: "expired-token", newPassword: "newpass" });
    expect(res.status).toBe(400);
  });

  it("returns 200 and resets password successfully", async () => {
    const validUser = {
      ...mockUser,
      passwordResetToken: "valid-token",
      passwordResetTokenExpiry: new Date(Date.now() + 60000),
    };
    (db.user.findFirst as jest.Mock).mockResolvedValue(validUser);
    (db.user.update as jest.Mock).mockResolvedValue(validUser);

    const res = await request(app).post("/auth/reset-password").send({ token: "valid-token", newPassword: "newpass123" });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/reset/i);
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ passwordResetToken: null, authToken: null }),
      })
    );
  });
});

describe("POST /auth/forgot-password", () => {
  it("returns 400 when email is missing", async () => {
    const res = await request(app).post("/auth/forgot-password").send({});
    expect(res.status).toBe(400);
  });

  it("returns 200 with generic message when email not found", async () => {
    (db.user.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await request(app).post("/auth/forgot-password").send({ email: "nobody@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if that email/i);
  });

  it("returns 200 and sends reset email when user exists", async () => {
    const { sendPasswordResetEmail } = require("../services/email");
    (db.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (db.user.update as jest.Mock).mockResolvedValue(mockUser);

    const res = await request(app).post("/auth/forgot-password").send({ email: mockUser.email });

    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(mockUser.email, expect.any(String));
  });
});

describe("POST /auth/verify-email", () => {
  it("returns 400 when token is missing", async () => {
    const res = await request(app).post("/auth/verify-email").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when token is not found", async () => {
    (db.user.findFirst as jest.Mock).mockResolvedValue(null);
    const res = await request(app).post("/auth/verify-email").send({ token: "bad-token" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when verification token is expired", async () => {
    const expiredUser = {
      ...mockUser,
      emailVerificationToken: "expired-token",
      emailVerificationTokenExpiry: new Date(Date.now() - 1000),
    };
    (db.user.findFirst as jest.Mock).mockResolvedValue(expiredUser);
    const res = await request(app).post("/auth/verify-email").send({ token: "expired-token" });
    expect(res.status).toBe(400);
  });

  it("returns 200 and marks email as verified", async () => {
    const validUser = {
      ...mockUser,
      emailVerificationToken: "valid-verify-token",
      emailVerificationTokenExpiry: new Date(Date.now() + 60000),
    };
    (db.user.findFirst as jest.Mock).mockResolvedValue(validUser);
    (db.user.update as jest.Mock).mockResolvedValue({ ...validUser, emailVerified: true, emailVerificationToken: null });

    const res = await request(app).post("/auth/verify-email").send({ token: "valid-verify-token" });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/verified/i);
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ emailVerified: true, emailVerificationToken: null }),
      })
    );
  });
});

describe("POST /auth/resend-verification", () => {
  it("returns 401 when no Authorization header", async () => {
    const res = await request(app).post("/auth/resend-verification");
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is invalid", async () => {
    (db.user.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .post("/auth/resend-verification")
      .set("Authorization", "Bearer bad-token");
    expect(res.status).toBe(401);
  });

  it("returns 400 when email already verified", async () => {
    const verifiedUser = { ...mockUser, emailVerified: true };
    (db.user.findUnique as jest.Mock).mockResolvedValue(verifiedUser);
    const res = await request(app)
      .post("/auth/resend-verification")
      .set("Authorization", "Bearer student-token");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already verified/i);
  });

  it("returns 200 and sends verification email", async () => {
    const { sendVerificationEmail } = require("../services/email");
    (db.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (db.user.update as jest.Mock).mockResolvedValue(mockUser);

    const res = await request(app)
      .post("/auth/resend-verification")
      .set("Authorization", "Bearer student-token");

    expect(res.status).toBe(200);
    expect(sendVerificationEmail).toHaveBeenCalledWith(mockUser.email, expect.any(String));
  });
});
