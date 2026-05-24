import request from "supertest";
import { app } from "../app";
import { prisma } from "../db";
import { mockUser, mockCourse, mockPaidCourse, mockAllowlistedCourse } from "./helpers";

jest.mock("../db");

const db = prisma as jest.Mocked<typeof prisma>;

function setupAuth(user = mockUser) {
  (db.user.findUnique as jest.Mock).mockImplementation(({ where }: any) => {
    if (where.authToken !== undefined) return Promise.resolve(where.authToken === `${user.role.toLowerCase()}-token` ? user : null);
    if (where.id !== undefined) return Promise.resolve(user);
    return Promise.resolve(null);
  });
}

const studentToken = "student-token";

describe("POST /enrollments/courses/:courseId", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(app).post("/enrollments/courses/10");
    expect(res.status).toBe(401);
  });

  it("returns 404 when course not found", async () => {
    setupAuth();
    (db.course.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await request(app).post("/enrollments/courses/999").set("Authorization", `Bearer ${studentToken}`);
    expect(res.status).toBe(404);
  });

  it("returns 403 when course is allowlist-restricted and user is not on it", async () => {
    setupAuth();
    (db.course.findUnique as jest.Mock).mockResolvedValue(mockAllowlistedCourse);

    const res = await request(app).post(`/enrollments/courses/${mockAllowlistedCourse.id}`).set("Authorization", `Bearer ${studentToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 402 when course is paid and user has no succeeded purchase", async () => {
    setupAuth();
    (db.course.findUnique as jest.Mock).mockResolvedValue(mockPaidCourse);
    (db.coursePurchase.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await request(app).post(`/enrollments/courses/${mockPaidCourse.id}`).set("Authorization", `Bearer ${studentToken}`);
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("PAYMENT_REQUIRED");
  });

  it("returns 409 when already enrolled", async () => {
    setupAuth();
    (db.course.findUnique as jest.Mock).mockResolvedValue(mockCourse);
    (db.courseEnrollment.findUnique as jest.Mock).mockResolvedValue({ id: 1, userId: mockUser.id, courseId: mockCourse.id });

    const res = await request(app).post(`/enrollments/courses/${mockCourse.id}`).set("Authorization", `Bearer ${studentToken}`);
    expect(res.status).toBe(409);
  });

  it("enrolls user in a free course successfully", async () => {
    setupAuth();
    (db.course.findUnique as jest.Mock).mockResolvedValue(mockCourse);
    (db.courseEnrollment.findUnique as jest.Mock).mockResolvedValue(null);
    (db.courseEnrollment.create as jest.Mock).mockResolvedValue({ id: 1, userId: mockUser.id, courseId: mockCourse.id, enrolledAt: new Date() });

    const res = await request(app).post(`/enrollments/courses/${mockCourse.id}`).set("Authorization", `Bearer ${studentToken}`);
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(mockUser.id);
  });

  it("enrolls user in paid course when they have a succeeded purchase", async () => {
    setupAuth();
    (db.course.findUnique as jest.Mock).mockResolvedValue(mockPaidCourse);
    (db.coursePurchase.findFirst as jest.Mock).mockResolvedValue({ id: 1, userId: mockUser.id, courseId: mockPaidCourse.id, status: "SUCCEEDED" });
    (db.courseEnrollment.findUnique as jest.Mock).mockResolvedValue(null);
    (db.courseEnrollment.create as jest.Mock).mockResolvedValue({ id: 2, userId: mockUser.id, courseId: mockPaidCourse.id, enrolledAt: new Date() });

    const res = await request(app).post(`/enrollments/courses/${mockPaidCourse.id}`).set("Authorization", `Bearer ${studentToken}`);
    expect(res.status).toBe(201);
  });
});

describe("GET /enrollments/my-courses", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/enrollments/my-courses");
    expect(res.status).toBe(401);
  });

  it("returns enrollment list with progress", async () => {
    setupAuth();
    (db.courseEnrollment.findMany as jest.Mock).mockResolvedValue([
      { id: 1, userId: mockUser.id, courseId: mockCourse.id, enrolledAt: new Date(), course: mockCourse },
    ]);
    (db.lesson.findMany as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }]);
    (db.lessonProgress.count as jest.Mock).mockResolvedValue(1);

    const res = await request(app).get("/enrollments/my-courses").set("Authorization", `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].totalLessons).toBe(2);
    expect(res.body[0].completedLessons).toBe(1);
    expect(res.body[0].progress).toBe(50);
  });
});

describe("DELETE /enrollments/courses/:courseId", () => {
  it("returns 404 when not enrolled", async () => {
    setupAuth();
    (db.course.findUnique as jest.Mock).mockResolvedValue(mockCourse);
    (db.courseEnrollment.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await request(app).delete(`/enrollments/courses/${mockCourse.id}`).set("Authorization", `Bearer ${studentToken}`);
    expect(res.status).toBe(404);
  });

  it("unenrolls and removes lesson progress", async () => {
    const enrollment = { id: 1, userId: mockUser.id, courseId: mockCourse.id };
    setupAuth();
    (db.course.findUnique as jest.Mock).mockResolvedValue(mockCourse);
    (db.courseEnrollment.findUnique as jest.Mock).mockResolvedValue(enrollment);
    (db.lessonProgress.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });
    (db.courseEnrollment.delete as jest.Mock).mockResolvedValue(enrollment);

    const res = await request(app).delete(`/enrollments/courses/${mockCourse.id}`).set("Authorization", `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(db.lessonProgress.deleteMany).toHaveBeenCalled();
    expect(db.courseEnrollment.delete).toHaveBeenCalled();
  });
});

describe("POST /enrollments/lessons/:lessonId/complete", () => {
  it("returns 403 when user is not enrolled in the course", async () => {
    const lesson = { id: 1, courseId: mockCourse.id };
    setupAuth();
    (db.lesson.findUnique as jest.Mock).mockResolvedValue(lesson);
    (db.courseEnrollment.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await request(app).post("/enrollments/lessons/1/complete").set("Authorization", `Bearer ${studentToken}`);
    expect(res.status).toBe(403);
  });

  it("marks lesson as complete and returns progress record", async () => {
    const lesson = { id: 1, courseId: mockCourse.id };
    const progressRecord = { id: 1, userId: mockUser.id, lessonId: 1, completed: true, completedAt: new Date() };
    setupAuth();
    (db.lesson.findUnique as jest.Mock).mockResolvedValue(lesson);
    (db.courseEnrollment.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
    (db.lessonProgress.upsert as jest.Mock).mockResolvedValue(progressRecord);

    const res = await request(app).post("/enrollments/lessons/1/complete").set("Authorization", `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(true);
  });
});
