import request from "supertest";
import { app } from "../app";
import { prisma } from "../db";
import { mockUser, mockAdmin, mockCreator, mockCourse } from "./helpers";

jest.mock("../db");
jest.mock("../services/email", () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  sendAdminPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));

const db = prisma as jest.Mocked<typeof prisma>;

// Wire up auth middleware: authToken lookup resolves to mockAdmin for admin routes
function setupAuthMock(tokenMap: Record<string, any>) {
  (db.user.findUnique as jest.Mock).mockImplementation(({ where }: any) => {
    if (where.authToken !== undefined) return Promise.resolve(tokenMap[where.authToken] ?? null);
    return Promise.resolve(null);
  });
}

describe("POST /users/register", () => {
  it("returns 400 when email is missing", async () => {
    const res = await request(app).post("/users/register").send({ password: "pass" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when password is missing", async () => {
    const res = await request(app).post("/users/register").send({ email: "a@b.com" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when password is shorter than 6 characters", async () => {
    const res = await request(app).post("/users/register").send({ email: "a@b.com", password: "pass" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 6/i);
  });

  it("returns 409 when email already registered", async () => {
    (db.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    const res = await request(app).post("/users/register").send({ email: mockUser.email, password: "pass123" });
    expect(res.status).toBe(409);
  });

  it("returns 201 with safe user (no password) on success", async () => {
    (db.user.findUnique as jest.Mock).mockResolvedValue(null);
    (db.user.create as jest.Mock).mockResolvedValue(mockUser);

    const res = await request(app).post("/users/register").send({ email: "new@example.com", password: "pass123", name: "New" });

    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty("password");
    expect(res.body.email).toBe(mockUser.email);
  });
});

describe("GET /users/me", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/users/me");
    expect(res.status).toBe(401);
  });

  it("returns 200 with user on success", async () => {
    setupAuthMock({ "student-token": mockUser });
    (db.user.findUnique as jest.Mock).mockImplementation(({ where }: any) => {
      if (where.authToken !== undefined) return Promise.resolve(where.authToken === "student-token" ? mockUser : null);
      if (where.id !== undefined) return Promise.resolve(mockUser);
      return Promise.resolve(null);
    });

    const res = await request(app).get("/users/me").set("Authorization", "Bearer student-token");

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(mockUser.email);
    expect(res.body).not.toHaveProperty("password");
  });
});

describe("POST /users/:id/upgrade-to-creator", () => {
  it("returns 403 when caller is not admin", async () => {
    (db.user.findUnique as jest.Mock).mockImplementation(({ where }: any) => {
      if (where.authToken !== undefined) return Promise.resolve(where.authToken === "student-token" ? mockUser : null);
      if (where.id !== undefined) return Promise.resolve(mockUser);
      return Promise.resolve(null);
    });

    const res = await request(app)
      .post(`/users/${mockUser.id}/upgrade-to-creator`)
      .set("Authorization", "Bearer student-token");
    expect(res.status).toBe(403);
  });

  it("returns 404 when target user not found", async () => {
    (db.user.findUnique as jest.Mock).mockImplementation(({ where }: any) => {
      if (where.authToken !== undefined) return Promise.resolve(where.authToken === "admin-token" ? mockAdmin : null);
      if (where.id === mockAdmin.id) return Promise.resolve(mockAdmin);
      return Promise.resolve(null); // target user 999 not found
    });

    const res = await request(app)
      .post("/users/999/upgrade-to-creator")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(404);
  });

  it("returns 400 when user is already CREATOR", async () => {
    const alreadyCreator = { ...mockUser, id: 5, role: "CREATOR" };
    (db.user.findUnique as jest.Mock).mockImplementation(({ where }: any) => {
      if (where.authToken !== undefined) return Promise.resolve(where.authToken === "admin-token" ? mockAdmin : null);
      if (where.id === mockAdmin.id) return Promise.resolve(mockAdmin);
      if (where.id === alreadyCreator.id) return Promise.resolve(alreadyCreator);
      return Promise.resolve(null);
    });

    const res = await request(app)
      .post(`/users/${alreadyCreator.id}/upgrade-to-creator`)
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(400);
  });

  it("returns 200 and upgrades user to CREATOR", async () => {
    const targetUser = { ...mockUser, id: 7, role: "STUDENT" };
    const upgradedUser = { ...targetUser, role: "CREATOR" };
    (db.user.findUnique as jest.Mock).mockImplementation(({ where }: any) => {
      if (where.authToken !== undefined) return Promise.resolve(where.authToken === "admin-token" ? mockAdmin : null);
      if (where.id === mockAdmin.id) return Promise.resolve(mockAdmin);
      if (where.id === targetUser.id) return Promise.resolve(targetUser);
      return Promise.resolve(null);
    });
    (db.user.update as jest.Mock).mockResolvedValue(upgradedUser);

    const res = await request(app)
      .post(`/users/${targetUser.id}/upgrade-to-creator`)
      .set("Authorization", "Bearer admin-token");

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("CREATOR");
    expect(res.body.user).not.toHaveProperty("password");
  });
});

describe("DELETE /users/:userId", () => {
  const targetUser = { ...mockUser, id: 7, role: "STUDENT" };

  function setupAdminAuth() {
    (db.user.findUnique as jest.Mock).mockImplementation(({ where }: any) => {
      if (where.authToken !== undefined) return Promise.resolve(where.authToken === "admin-token" ? mockAdmin : null);
      if (where.id === mockAdmin.id) return Promise.resolve(mockAdmin);
      if (where.id === targetUser.id) return Promise.resolve(targetUser);
      return Promise.resolve(null);
    });
  }

  beforeEach(() => {
    (db.$transaction as jest.Mock).mockImplementation((fn: any) => fn(db));
    (db.course.findMany as jest.Mock).mockResolvedValue([]);
    (db.lesson.findMany as jest.Mock).mockResolvedValue([]);
    (db.lessonProgress.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    (db.lesson.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    (db.courseEnrollment.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    (db.courseAllowedEmail.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    (db.coursePurchase.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    (db.course.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    (db.user.delete as jest.Mock).mockResolvedValue(targetUser);
  });

  it("returns 401 when not authenticated", async () => {
    const res = await request(app).delete(`/users/${targetUser.id}`);
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not ADMIN", async () => {
    (db.user.findUnique as jest.Mock).mockImplementation(({ where }: any) => {
      if (where.authToken !== undefined) return Promise.resolve(where.authToken === "student-token" ? mockUser : null);
      if (where.id !== undefined) return Promise.resolve(mockUser);
      return Promise.resolve(null);
    });

    const res = await request(app)
      .delete(`/users/${targetUser.id}`)
      .set("Authorization", "Bearer student-token");
    expect(res.status).toBe(403);
  });

  it("returns 400 when admin tries to delete themselves", async () => {
    setupAdminAuth();

    const res = await request(app)
      .delete(`/users/${mockAdmin.id}`)
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own account/i);
  });

  it("returns 404 when target user not found", async () => {
    (db.user.findUnique as jest.Mock).mockImplementation(({ where }: any) => {
      if (where.authToken !== undefined) return Promise.resolve(where.authToken === "admin-token" ? mockAdmin : null);
      if (where.id === mockAdmin.id) return Promise.resolve(mockAdmin);
      return Promise.resolve(null);
    });

    const res = await request(app)
      .delete("/users/999")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(404);
  });

  it("returns 400 when target is an ADMIN", async () => {
    const otherAdmin = { ...mockAdmin, id: 99, email: "other-admin@example.com" };
    (db.user.findUnique as jest.Mock).mockImplementation(({ where }: any) => {
      if (where.authToken !== undefined) return Promise.resolve(where.authToken === "admin-token" ? mockAdmin : null);
      if (where.id === mockAdmin.id) return Promise.resolve(mockAdmin);
      if (where.id === otherAdmin.id) return Promise.resolve(otherAdmin);
      return Promise.resolve(null);
    });

    const res = await request(app)
      .delete(`/users/${otherAdmin.id}`)
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ADMIN/);
  });

  it("returns 200 and deletes user with no authored courses", async () => {
    setupAdminAuth();

    const res = await request(app)
      .delete(`/users/${targetUser.id}`)
      .set("Authorization", "Bearer admin-token");

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("User deleted successfully");
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: targetUser.id } });
    expect(db.course.deleteMany).not.toHaveBeenCalled();
  });

  it("cascades deletes authored courses and all related data", async () => {
    setupAdminAuth();
    const authoredCourse = { ...mockCourse, id: 20, authorId: targetUser.id };
    const authoredLesson = { id: 50, courseId: 20, title: "Lesson", orderIndex: 1 };
    (db.course.findMany as jest.Mock).mockResolvedValue([authoredCourse]);
    (db.lesson.findMany as jest.Mock).mockResolvedValue([authoredLesson]);

    const res = await request(app)
      .delete(`/users/${targetUser.id}`)
      .set("Authorization", "Bearer admin-token");

    expect(res.status).toBe(200);
    expect(db.lessonProgress.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { lessonId: { in: [authoredLesson.id] } } })
    );
    expect(db.lesson.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [authoredLesson.id] } } })
    );
    expect(db.courseEnrollment.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { courseId: { in: [authoredCourse.id] } } })
    );
    expect(db.courseAllowedEmail.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { courseId: { in: [authoredCourse.id] } } })
    );
    expect(db.coursePurchase.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { courseId: { in: [authoredCourse.id] } } })
    );
    expect(db.course.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [authoredCourse.id] } } })
    );
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: targetUser.id } });
  });
});
