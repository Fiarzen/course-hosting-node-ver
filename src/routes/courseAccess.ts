import { prisma } from "../db";

// Shared course-access helpers used by lesson and assessment routes.

export function isAdmin(user: any | null) {
  return user && user.role === "ADMIN";
}

export async function isCourseAuthor(user: any | null, courseId: number) {
  if (!user) return false;
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  return !!course && course.authorId === user.id;
}

export async function isEnrolledInCourse(userId: number, courseId: number) {
  const count = await prisma.courseEnrollment.count({
    where: { userId, courseId },
  });
  return count > 0;
}

export async function isOnCourseAllowList(email: string, courseId: number) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { allowedEmails: true },
  });
  if (!course) return false;
  if (!course.restrictedToAllowList) return true;
  const normalized = email.toLowerCase();
  return course.allowedEmails.some((e) => e.email.toLowerCase() === normalized);
}

// True when the user may see full course content (lessons, assessment answers):
// admins and the course author always; everyone else needs allowlist + enrollment.
export async function canViewFullLessonContent(
  user: any | null,
  courseId: number,
) {
  if (!user) return false;
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) return false;
  if (isAdmin(user) || (course.authorId && course.authorId === user.id))
    return true;
  if (!(await isOnCourseAllowList(user.email, courseId))) return false;
  return await isEnrolledInCourse(user.id, courseId);
}

// True when the user may author/edit content for a course (admin or author).
export async function canEditCourse(user: any | null, courseId: number) {
  return isAdmin(user) || (await isCourseAuthor(user, courseId));
}
