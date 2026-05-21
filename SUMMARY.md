# Claude Code Project Summary
## Scope and source of truth
This summary is based on:
- TypeScript source in `src/**/*.ts`
- Prisma schema in `prisma/schema.prisma`
- compiled JavaScript in `dist/**/*.js` for cross-checking

For code changes, `src/` + `prisma/schema.prisma` should be treated as canonical.

## What this project is
Express + Prisma backend for a course platform with:
- account registration/login and token auth
- role-based permissions (`STUDENT`, `CREATOR`, `ADMIN`)
- course creation, course access allowlists, and deletion cleanup
- lesson CRUD/reorder plus PDF attachments
- course enrollment and lesson completion progress

## Entry point and app wiring (`src/server.ts`)
- Loads env via `dotenv`.
- Configures CORS from `CORS_ALLOWED_ORIGINS` (CSV list), allows credentials.
- Parses JSON request bodies.
- Serves local uploads directory at `/files`.
- Public mounts:
  - `/auth`
  - `/users` (public router)
  - `/courses` (public router)
- Applies `authMiddleware` for protected routes, then mounts:
  - `/users` (protected router)
  - `/courses` (protected router)
  - `/lessons`
  - `/enrollments`
- Root route: `GET /` -> backend running message.
- Global JSON 500 handler.

## DB access (`src/db.ts`)
- Shared Prisma singleton client to avoid duplicate clients in dev reload scenarios.
- Prisma client logs `warn` and `error`.

## Auth and authorization
### Token auth (`src/middleware/auth.ts`)
- Reads `Authorization: Bearer <token>`.
- Looks up user by `User.authToken`.
- Sets `req.user = { id, email, role }` if valid.
- Does not reject requests directly; route handlers perform checks.

### Role checks (`src/middleware/roles.ts`)
- Utility middleware exists (`requireAuth`, `requireAnyRole`) but most route files perform inline auth/role checks.

## Route behavior
### `/auth` (`src/routes/auth.ts`)
- `POST /auth/login`: validates credentials, sets new UUID `authToken`, returns token + safe user.
- `POST /auth/reset-password`: validates reset token + expiry, hashes new password, clears reset/auth tokens.

### `/users` (`src/routes/users.ts`)
Public:
- `POST /users/register`: creates `STUDENT` user, bcrypt password hash, unique email check.

Protected:
- `GET /users`: admin-only list (password removed).
- `GET /users/me`: current user profile.
- `POST /users/:userId/upgrade-to-creator`: admin-only role upgrade.
- `POST /users/:userId/reset-password`: admin-generated reset token + expiry.

### `/courses` (`src/routes/courses.ts`)
Public:
- `GET /courses`: list filtered by allowlist visibility logic.

Protected:
- `POST /courses`: creator/admin only.
- `GET /courses/my-created`: authored courses.
- `GET /courses/:courseId/access`: author/admin access settings.
- `PUT /courses/:courseId/access`: replace allowlist + restricted flag in transaction.
- `DELETE /courses/:courseId`: author/admin only, cascades cleanup of lessons/progress/enrollments/allowlist rows.

### `/lessons` (`src/routes/lessons.ts`)
- Auth required across endpoints.
- Visibility requires admin/author OR (allowlisted + enrolled) for full content.
- `GET /lessons`, `GET /lessons/course/:courseId`, `GET /lessons/:lessonId`: return signed PDF URLs when PDF is S3-backed.
- `POST /lessons`: author/admin per-course, multipart upload (`pdf`), assigns incremental `orderIndex`.
- `PUT /lessons/:lessonId`: author/admin update, supports replacing or clearing PDF.
- `DELETE /lessons/:lessonId`: author/admin delete with lesson progress cleanup.
- `POST /lessons/course/:courseId/reorder`: author/admin reorder by posted lesson-id array.

### `/enrollments` (`src/routes/enrollments.ts`)
- `POST /enrollments/courses/:courseId`: enroll self (allowlist restrictions enforced unless admin/author).
- `GET /enrollments/my-courses`: includes total/completed lesson counts and progress %.
- `DELETE /enrollments/courses/:courseId`: unenroll + remove course-specific lesson progress.
- `POST /enrollments/lessons/:lessonId/complete`: upsert lesson completion record.
- `GET /enrollments/courses/:courseId/progress`: per-lesson completion + aggregate progress.

## File storage and PDF URLs (`src/services/storage.ts`)
- Uses multer memory storage (`upload.single("pdf")`).
- S3 mode enabled by `AWS_S3_ENABLED === "true"` and bucket presence.
- Supports custom S3-compatible endpoint via `AWS_ENDPOINT_URL` (path-style forced).
- On upload:
  - stores object at key `pdfs/<uuid>_<originalname>`
  - persists the **S3 key** (not full public URL) in `Lesson.pdfUrl`
- Retrieval:
  - `getSignedPdfUrl` returns original local `/files/...` paths as-is
  - for S3 keys, returns 1-hour signed URL via `GetObjectCommand`
- Local fallback writes files to `uploads/pdfs` and stores `/files/pdfs/<name>`.

## Prisma schema (`prisma/schema.prisma`)
Datasource:
- PostgreSQL via `DATABASE_URL`.

Models and key constraints:
- `User`
  - unique: `email`, `authToken`
  - fields: role, password reset token + expiry
- `Course`
  - optional author relation to `User` (`CourseAuthor`)
  - allowlist gate: `restrictedToAllowList`
- `CourseAllowedEmail`
  - unique composite: `[courseId, email]`
- `Lesson`
  - belongs to `Course`
  - optional `videoUrl`, optional `pdfUrl`, optional `orderIndex`
- `CourseEnrollment`
  - unique composite: `[userId, courseId]`
- `LessonProgress`
  - unique composite: `[userId, lessonId]`
  - tracks `completed` + `completedAt`

## Important env vars
- `DATABASE_URL`
- `PORT`
- `CORS_ALLOWED_ORIGINS`
- `AWS_S3_ENABLED`
- `AWS_S3_BUCKET_NAME`
- `AWS_REGION`
- `AWS_ENDPOINT_URL` (optional, for S3-compatible providers)

## Claude Code guidance
- Prefer editing `src/**/*.ts` and `prisma/schema.prisma`; regenerate `dist` afterward.
- Trace request flow from `src/server.ts` into the route modules.
- For PDF/download bugs, inspect both upload path and signed-URL path in `src/services/storage.ts`.
- If behavior appears different between `src` and `dist`, trust `src` as implementation intent and rebuild to sync artifacts.
