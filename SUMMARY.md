
## Scope
This summary is based on JavaScript files in `dist/`, including `dist/server.js` and `dist/db.js`, plus related `dist/routes/*`, `dist/middleware/*`, and `dist/services/storage.js`.

No separate root-level `server.js` or `db.js` were found; the active runtime files appear to be the ones in `dist/`.

## What this project is
Node.js + Express backend for course hosting / LMS workflows:
- user registration and auth
- role-based course creation and access management
- lesson CRUD and ordering
- enrollment and lesson-completion progress tracking
- PDF lesson asset upload (S3 or local fallback)

Database access uses Prisma via a shared singleton client.

## Server bootstrap (`dist/server.js`)
- Loads env via `dotenv`.
- Starts Express app on `PORT` (default `8080`).
- Configures CORS with `CORS_ALLOWED_ORIGINS` (comma-separated) and credentials enabled.
- Parses JSON bodies.
- Serves static uploads from `uploads` under `/files`.
- Mounts public routers:
  - `/auth`
  - `/users` (public subset)
  - `/courses` (public subset)
- Applies auth middleware globally after public mounts.
- Mounts protected routers:
  - `/users` (protected subset)
  - `/courses` (protected subset)
  - `/lessons`
  - `/enrollments`
- Health/root endpoint: `GET /` returns `{ message: "Courses Node backend is running" }`.
- Global error handler logs and returns `500 { error: "Internal server error" }`.

## DB layer (`dist/db.js`)
- Exports `prisma` from `@prisma/client`.
- Uses a global singleton pattern (`global.prisma`) to avoid multiple Prisma clients in dev/hot-reload scenarios.
- Prisma logging is configured for `error` and `warn`.

## Authentication and authorization
### Auth middleware (`dist/middleware/auth.js`)
- Reads `Authorization: Bearer <token>`.
- Looks up user by `authToken`.
- If found, attaches `req.user = { id, email, role }`.
- Always calls `next()`; missing/invalid token does not throw by itself.

### Role guard helpers (`dist/middleware/roles.js`)
- `requireAuth`: returns `401` if unauthenticated.
- `requireAnyRole(roles)`: returns `401` or `403` as needed.
- Most route files also include explicit inline role checks.

### Role model seen in routes
- `STUDENT`
- `CREATOR`
- `ADMIN`

## Route map
## `/auth` (`dist/routes/auth.js`)
- `POST /auth/login`
  - Validates email/password.
  - Uses bcrypt compare against stored hash.
  - Generates UUID token, stores in `user.authToken`.
  - Returns `{ token, user }` (password stripped).
- `POST /auth/reset-password`
  - Requires `{ token, newPassword }`.
  - Validates reset token + expiry.
  - Re-hashes password, clears reset token fields and `authToken`.

## `/users` (`dist/routes/users.js`)
Public:
- `POST /users/register`
  - Creates student user with bcrypt-hashed password.
  - Rejects duplicate email.

Protected:
- `GET /users`
  - Admin-only list of users (password removed).
- `GET /users/me`
  - Returns authenticated user profile.
- `POST /users/:userId/upgrade-to-creator`
  - Admin-only role change to `CREATOR`.
- `POST /users/:userId/reset-password`
  - Admin-only generation of reset token + 1-hour expiry.
  - Returns reset token and `resetPath`.

## `/courses` (`dist/routes/courses.js`)
Public:
- `GET /courses`
  - Lists courses visible under allowlist logic.
  - Includes `allowedEmails` and `author`.

Protected:
- `POST /courses`
  - Creator/admin can create course.
- `GET /courses/my-created`
  - Returns courses authored by current user.
- `GET /courses/:courseId/access`
  - Author/admin can view allowlist config.
- `PUT /courses/:courseId/access`
  - Author/admin can set `restrictedToAllowList` and replace allowlist emails.
- `DELETE /courses/:courseId`
  - Author/admin delete with cleanup transaction:
    - lesson progress
    - lessons
    - enrollments
    - allowed email rows
    - course row

## `/lessons` (`dist/routes/lessons.js`)
- `GET /lessons`
  - Auth required.
  - Admin sees all lessons.
  - Others see lessons from enrolled or authored courses.
- `GET /lessons/course/:courseId`
  - Auth required.
  - Returns full lessons only if admin/author/enrolled-and-allowlisted.
  - Otherwise returns limited lesson summaries.
- `POST /lessons`
  - Auth + author/admin.
  - Supports multipart upload (`pdf` file).
  - Appends lesson order by `count + 1`.
- `GET /lessons/:lessonId`
  - Auth + full-content visibility checks.
- `PUT /lessons/:lessonId`
  - Auth + author/admin.
  - Supports replacing/clearing PDF.
- `DELETE /lessons/:lessonId`
  - Auth + author/admin.
  - Deletes related lesson progress first.
- `POST /lessons/course/:courseId/reorder`
  - Auth + author/admin.
  - Rewrites `orderIndex` based on provided lesson-id list.

## `/enrollments` (`dist/routes/enrollments.js`)
- `POST /enrollments/courses/:courseId`
  - Auth required.
  - Enforces allowlist restrictions unless admin/author.
  - Prevents duplicate enrollment.
- `GET /enrollments/my-courses`
  - Returns enrolled courses plus computed progress stats.
- `DELETE /enrollments/courses/:courseId`
  - Unenrolls and removes related lesson progress for that user/course.
- `POST /enrollments/lessons/:lessonId/complete`
  - Marks lesson as completed (upsert).
- `GET /enrollments/courses/:courseId/progress`
  - Returns per-lesson completion state and overall progress %.

## File upload and storage (`dist/services/storage.js`)
- Uses `multer.memoryStorage()` and expects file field name `pdf`.
- If `AWS_S3_ENABLED === "true"` and bucket is configured:
  - uploads to `s3://<bucket>/pdfs/<uuid>_<originalname>`
  - returns public S3 URL.
- On S3 failure or disabled config:
  - writes to local `uploads/pdfs/`
  - returns `/files/pdfs/<filename>` (served by static `/files` route).

## Inferred core entities (from Prisma usage)
- `User` (email, password hash, role, auth token, password reset token/expiry)
- `Course` (author, allowlist restriction flag)
- `CourseAllowedEmail`
- `Lesson` (order index, optional video URL, optional PDF URL)
- `CourseEnrollment`
- `LessonProgress`

## Key environment variables
- `PORT`
- `CORS_ALLOWED_ORIGINS`
- `AWS_S3_ENABLED`
- `AWS_S3_BUCKET_NAME`
- `AWS_REGION`

## Claude Code notes
- Start request tracing at `dist/server.js` to see route and middleware order.
- Route behavior is organized by domain under `dist/routes/`.
- Access-control logic is split between middleware (`auth.js`, `roles.js`) and inline checks in routes.
- For file storage bugs, inspect `dist/services/storage.js` plus `/files` static serving setup in `dist/server.js`.
- If this repo also has non-`dist` source files (e.g., TypeScript), prefer editing source and rebuilding `dist` to avoid drift.
