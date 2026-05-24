import request from "supertest";
import bcrypt from "bcrypt";
import { app } from "../app";
import { prisma } from "../db";
import { mockUser } from "./helpers";

jest.mock("../db");

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
