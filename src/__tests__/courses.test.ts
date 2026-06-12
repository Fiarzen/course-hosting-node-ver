import request from "supertest";
import { app } from "../app";
import { prisma } from "../db";
import { mockUser, mockAdmin, mockCreator, mockCourse, mockAllowlistedCourse } from "./helpers";

jest.mock("../db");

const db = prisma as jest.Mocked<typeof prisma>;

function setupAuthMock(tokenMap: Record<string, any>) {
  (db.user.findUnique as jest.Mock).mockImplementation(({ where }: any) => {
    if (where.authToken !== undefined) return Promise.resolve(tokenMap[where.authToken] ?? null);
    return Promise.resolve(null);
  });
}

describe("GET /courses", () => {
  it("returns all public courses", async () => {
    (db.course.findMany as jest.Mock).mockResolvedValue([mockCourse]);
    const res = await request(app).get("/courses");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(mockCourse.id);
  });

  it("hides allowlisted course from unauthenticated user", async () => {
    (db.course.findMany as jest.Mock).mockResolvedValue([mockAllowlistedCourse]);
    const res = await request(app).get("/courses");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  // GET /courses is mounted before authMiddleware, so req.user is always null.
  // Allowlisted courses are always hidden from the public listing regardless of token.
  it("hides allowlisted course even when a valid token is sent (auth middleware runs after public router)", async () => {
    const courseWithAllowedUser = {
      ...mockAllowlistedCourse,
      allowedEmails: [{ email: mockUser.email }],
    };
    (db.course.findMany as jest.Mock).mockResolvedValue([courseWithAllowedUser]);
    setupAuthMock({ "student-token": mockUser });

    const res = await request(app).get("/courses").set("Authorization", "Bearer student-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe("POST /courses", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(app).post("/courses").send({ title: "Test" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not CREATOR or ADMIN", async () => {
    setupAuthMock({ "student-token": mockUser });
    const res = await request(app).post("/courses").set("Authorization", "Bearer student-token").send({ title: "Test" });
    expect(res.status).toBe(403);
  });

  it("returns 422 when isPaid is true but priceCents is missing", async () => {
    setupAuthMock({ "creator-token": mockCreator });
    const res = await request(app)
      .post("/courses")
      .set("Authorization", "Bearer creator-token")
      .send({ title: "Paid Course", isPaid: true, currency: "usd" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("COURSE_NOT_PURCHASABLE");
  });

  it("returns 422 when isPaid is true but currency is missing", async () => {
    setupAuthMock({ "creator-token": mockCreator });
    const res = await request(app)
      .post("/courses")
      .set("Authorization", "Bearer creator-token")
      .send({ title: "Paid Course", isPaid: true, priceCents: 999 });
    expect(res.status).toBe(422);
  });

  it("creates a free course successfully", async () => {
    setupAuthMock({ "creator-token": mockCreator });
    (db.course.create as jest.Mock).mockResolvedValue(mockCourse);

    const res = await request(app)
      .post("/courses")
      .set("Authorization", "Bearer creator-token")
      .send({ title: "Free Course" });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(mockCourse.id);
  });

  it("creates a paid course successfully", async () => {
    const paidCourse = { ...mockCourse, isPaid: true, priceCents: 1999, currency: "usd" };
    setupAuthMock({ "creator-token": mockCreator });
    (db.course.create as jest.Mock).mockResolvedValue(paidCourse);

    const res = await request(app)
      .post("/courses")
      .set("Authorization", "Bearer creator-token")
      .send({ title: "Paid Course", isPaid: true, priceCents: 1999, currency: "USD" });

    expect(res.status).toBe(200);
    expect(res.body.isPaid).toBe(true);
    expect(res.body.priceCents).toBe(1999);
  });
});

describe("DELETE /courses/:courseId", () => {
  it("returns 403 when caller is not author or admin", async () => {
    setupAuthMock({ "student-token": mockUser });
    (db.course.findUnique as jest.Mock).mockResolvedValue(mockCourse);

    const res = await request(app)
      .delete(`/courses/${mockCourse.id}`)
      .set("Authorization", "Bearer student-token");
    expect(res.status).toBe(403);
  });

  it("deletes course and cascades via transaction", async () => {
    setupAuthMock({ "creator-token": mockCreator });
    (db.course.findUnique as jest.Mock).mockResolvedValue(mockCourse);
    (db.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn({
      lesson: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
      lessonProgress: { deleteMany: jest.fn() },
      courseEnrollment: { deleteMany: jest.fn() },
      courseAllowedEmail: { deleteMany: jest.fn() },
      course: { delete: jest.fn() },
    }));

    const res = await request(app)
      .delete(`/courses/${mockCourse.id}`)
      .set("Authorization", "Bearer creator-token");

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);
  });
});

describe("PUT /courses/:courseId/featured", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(app)
      .put(`/courses/${mockCourse.id}/featured`)
      .send({ featured: true });
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not admin (even the course author)", async () => {
    setupAuthMock({ "creator-token": mockCreator });
    (db.course.findUnique as jest.Mock).mockResolvedValue(mockCourse);

    const res = await request(app)
      .put(`/courses/${mockCourse.id}/featured`)
      .set("Authorization", "Bearer creator-token")
      .send({ featured: true });
    expect(res.status).toBe(403);
  });

  it("returns 422 when featured is not a boolean", async () => {
    setupAuthMock({ "admin-token": mockAdmin });
    (db.course.findUnique as jest.Mock).mockResolvedValue(mockCourse);

    const res = await request(app)
      .put(`/courses/${mockCourse.id}/featured`)
      .set("Authorization", "Bearer admin-token")
      .send({ featured: "yes" });
    expect(res.status).toBe(422);
  });

  it("lets an admin feature a course", async () => {
    setupAuthMock({ "admin-token": mockAdmin });
    (db.course.findUnique as jest.Mock).mockResolvedValue(mockCourse);
    (db.course.update as jest.Mock).mockResolvedValue({ ...mockCourse, featured: true });

    const res = await request(app)
      .put(`/courses/${mockCourse.id}/featured`)
      .set("Authorization", "Bearer admin-token")
      .send({ featured: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ courseId: mockCourse.id, featured: true });
  });
});

describe("PUT /courses/:courseId/pricing", () => {
  it("returns 403 when caller is not author or admin", async () => {
    setupAuthMock({ "student-token": mockUser });
    (db.course.findUnique as jest.Mock).mockResolvedValue(mockCourse);

    const res = await request(app)
      .put(`/courses/${mockCourse.id}/pricing`)
      .set("Authorization", "Bearer student-token")
      .send({ isPaid: false });
    expect(res.status).toBe(403);
  });

  it("returns 422 when isPaid true but priceCents missing", async () => {
    setupAuthMock({ "creator-token": mockCreator });
    (db.course.findUnique as jest.Mock).mockResolvedValue(mockCourse);

    const res = await request(app)
      .put(`/courses/${mockCourse.id}/pricing`)
      .set("Authorization", "Bearer creator-token")
      .send({ isPaid: true, currency: "usd" });
    expect(res.status).toBe(422);
  });

  it("updates pricing successfully", async () => {
    const updated = { ...mockCourse, isPaid: true, priceCents: 999, currency: "usd" };
    setupAuthMock({ "creator-token": mockCreator });
    (db.course.findUnique as jest.Mock).mockResolvedValue(mockCourse);
    (db.course.update as jest.Mock).mockResolvedValue(updated);

    const res = await request(app)
      .put(`/courses/${mockCourse.id}/pricing`)
      .set("Authorization", "Bearer creator-token")
      .send({ isPaid: true, priceCents: 999, currency: "usd" });

    expect(res.status).toBe(200);
    expect(res.body.isPaid).toBe(true);
    expect(res.body.priceCents).toBe(999);
  });
});
