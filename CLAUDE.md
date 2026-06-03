# CLAUDE.md — course-hosting-node-ver

## What this project is
Express + TypeScript + Prisma backend for **mindleaf**, a course-hosting platform.
Deployed on **Railway** via Docker. Frontend lives in `../course-hosting-frontend` (React, Netlify).

## Build and run
```bash
npm run dev          # ts-node-dev with hot reload
npm run build        # tsc → dist/
npm start            # node dist/server.js

npx prisma generate  # regenerate client after schema changes
npx prisma migrate dev --name <name>   # dev migration
npx prisma migrate deploy              # production (run inside Docker CMD)
```

After any schema change: run `prisma generate`, then `npm run build`.

## Deployment (Railway + Docker)
- `railway.json` sets builder to `DOCKERFILE`.
- `Dockerfile` builds the image (Node 20, OpenSSL, `npm ci`, `tsc`) then at container start:
  ```
  until npx prisma migrate deploy; do sleep 5; done && node dist/server.js
  ```
  The retry loop handles Railway's brief DB unavailability at container start.
- Migrations live in `prisma/migrations/`. **Never use `prisma db push` in production** — the migrations directory is present so `migrate deploy` is always used.
- Private DB hostname is `postgres.railway.internal` — only reachable at runtime, not during Docker build.

---

## Server wiring (`src/server.ts`)
Mount order matters:

1. **`/webhooks`** — mounted first with `express.raw({ type: "application/json" })` before `express.json()`. Stripe signature verification requires the raw body bytes.
2. `express.json()` — parses all other request bodies.
3. Public routes (no auth): `/auth`, `/users` (public router), `/courses` (public router), `/files` (static).
4. `authMiddleware` — reads `Authorization: Bearer <token>`, looks up `User.authToken`, sets `req.user`.
5. Protected routes: `/users`, `/courses`, `/lessons`, `/enrollments`, `/payments`.

PayPal webhooks (`POST /webhooks/paypal`) are also mounted under `/webhooks` but use the JSON-parsed body — PayPal verification is done via an API call, not raw bytes.

---

## Route reference

### `/auth`
- `POST /auth/login` → sets new UUID `authToken`, returns `{ token, user }`.
- `POST /auth/reset-password` → validates one-time reset token, hashes new password.

### `/users`
Public: `POST /users/register`.
Protected: `GET /users` (admin), `GET /users/me`, `POST /users/:id/upgrade-to-creator` (admin), `POST /users/:id/reset-password` (admin).

### `/courses`
Public: `GET /courses` — respects allowlist visibility; now includes `isPaid`, `priceCents`, `currency` on each course.
Protected:
- `POST /courses` — CREATOR/ADMIN; accepts optional `{ isPaid, priceCents, currency }`.
- `GET /courses/my-created`
- `GET /courses/:courseId/access`, `PUT /courses/:courseId/access`
- `PUT /courses/:courseId/pricing` — CREATOR/ADMIN; `{ isPaid, priceCents, currency }`. Price changes only affect new purchases; existing `CoursePurchase` records keep their historical snapshot.
- `DELETE /courses/:courseId` — cascades lessons, progress, enrollments, allowlist.

### `/lessons`
All auth-required. Content visibility: admin/author always; others need allowlist + enrollment. Access helpers (`isAdmin`, `isCourseAuthor`, `canViewFullLessonContent`, `canEditCourse`) live in `src/routes/courseAccess.ts` and are shared with `/assessments`.
- `GET /lessons`, `GET /lessons/course/:courseId`, `GET /lessons/:lessonId`
- `POST /lessons` — multipart, `pdf` field, increments `orderIndex`.
- `PUT /lessons/:lessonId`, `DELETE /lessons/:lessonId`
- `POST /lessons/course/:courseId/reorder`

**`Lesson.content` holds sanitized HTML** (authored with a TipTap WYSIWYG editor on the frontend). The backend stores it as a plain string and does not sanitize; the frontend renders it through DOMPurify. Legacy lessons created before the editor hold plain text and the frontend falls back to `whitespace-pre-wrap`. The lesson PDF is embedded inline in the lesson view (iframe over the signed URL) with an "open in new tab" fallback link.

### `/assessments`
Standalone, **course-scoped** multiple-choice quizzes used as a **self-check** — questions and correct answers are persisted, but student attempts/scores are **not** stored anywhere. All auth-required; mounted after `authMiddleware` (single router, like `/lessons`).
- `GET /assessments/course/:courseId` — list a course's assessments. Requires course view access (`canViewFullLessonContent`). **`isCorrect` is stripped** from choices for students; included only for the course author/admin (so they can edit).
- `GET /assessments/:assessmentId` — single assessment, same `isCorrect`-stripping rule.
- `POST /assessments/:assessmentId/check` — **stateless grader, no DB writes.** Body `{ answers: [{ questionId, choiceId }] }` → `{ assessmentId, score, total, results: [{ questionId, selectedChoiceId, correctChoiceId, isCorrect }] }`. This is how students see their score without correct answers ever reaching the client beforehand.
- `POST /assessments` — CREATOR/ADMIN (course author or admin). JSON body `{ courseId, title, description?, questions: [{ prompt, choices: [{ text, isCorrect }] }] }`. Validates ≥1 question, ≥2 choices/question, ≥1 correct/question.
- `PUT /assessments/:assessmentId` — author/admin; replaces title/description + questions/choices wholesale in a transaction (deletes old questions, cascade removes choices).
- `DELETE /assessments/:assessmentId` — author/admin; cascades questions + choices.

### `/enrollments`
- `POST /enrollments/courses/:courseId` — **payment gate**: paid courses return **402 `PAYMENT_REQUIRED`** if no `SUCCEEDED` purchase exists for that user/course. Free courses enroll immediately. Allowlist still enforced for both.
- `GET /enrollments/my-courses` — includes `totalLessons`, `completedLessons`, `progress %`.
- `DELETE /enrollments/courses/:courseId` — unenrolls + removes lesson progress.
- `POST /enrollments/lessons/:lessonId/complete`
- `GET /enrollments/courses/:courseId/progress`

### `/payments`
All auth-required.

**Stripe:**
- `POST /payments/courses/:courseId/checkout-session` → creates Stripe Checkout Session (mode=payment), records `CoursePurchase` as PENDING, returns `{ purchaseId, courseId, status, checkoutSessionId, checkoutUrl, expiresAt, reused }`. Reuses existing non-expired PENDING Stripe purchase.
- `GET /payments/courses/:courseId/status` → `{ courseId, isPaid, priceCents, currency, isEnrolled, purchase, canEnrollDirectly }`.

**PayPal:**
- `POST /payments/courses/:courseId/paypal-order` → creates PayPal order via REST v2, records `CoursePurchase`, returns `{ purchaseId, courseId, paypalOrderId, approvalUrl, reused }`.
- `POST /payments/paypal/capture` body `{ token: orderId }` — captures the PayPal order, marks SUCCEEDED, upserts `CourseEnrollment` in a transaction. Idempotent if already SUCCEEDED.

### `/webhooks` (public — no authMiddleware)
- `POST /webhooks/stripe` — raw body + `Stripe-Signature` header. Handles `checkout.session.completed` (mark SUCCEEDED + enroll), `checkout.session.expired` (mark EXPIRED), `payment_intent.payment_failed` (mark FAILED). Idempotent via `StripeWebhookEvent` table.
- `POST /webhooks/paypal` — JSON body. Verifies signature via PayPal API call. Handles `PAYMENT.CAPTURE.COMPLETED` (fallback if return flow didn't run), `PAYMENT.CAPTURE.DENIED/DECLINED`. Idempotency stored in `StripeWebhookEvent` with `paypal-` prefix on event ID.

---

## Error response shape
All payment endpoints return: `{ "error": "human message", "code": "MACHINE_CODE" }`

Key codes: `AUTH_REQUIRED`, `COURSE_NOT_FOUND`, `COURSE_NOT_PURCHASABLE`, `ALREADY_ENROLLED`, `NOT_ALLOWED_FOR_COURSE`, `PAYMENT_REQUIRED`, `CHECKOUT_CREATE_FAILED`, `STRIPE_SIGNATURE_INVALID`. The `/assessments` routes use the same shape, adding `ASSESSMENT_NOT_FOUND` and `VALIDATION_ERROR`.

---

## Prisma schema (`prisma/schema.prisma`)

**Models:**
- `User` — `email` unique, `authToken` unique, `role` (STUDENT/CREATOR/ADMIN), password reset token + expiry.
- `Course` — `isPaid Boolean @default(false)`, `priceCents Int?`, `currency String?`, `restrictedToAllowList Boolean @default(false)`, optional `authorId`.
- `CoursePurchase` — `paymentMethod String @default("STRIPE")`, `checkoutSessionId String? @unique` (nullable — Stripe only), `paypalOrderId String? @unique` (nullable — PayPal only), `paypalCaptureId String?`, `paymentIntentId String?`, `stripeCustomerId String?`, `amountCents Int`, `currency String`, `status CoursePurchaseStatus`, `paidAt DateTime?`, `expiresAt DateTime?`.
- `StripeWebhookEvent` — `stripeEventId String @unique`, `eventType String`. Also used for PayPal event deduplication (key prefixed `paypal-`).
- `CourseAllowedEmail` — `[courseId, email]` unique composite.
- `Lesson` — `content String` (sanitized HTML; see `/lessons`), `orderIndex Int?`, `videoUrl String?`, `pdfUrl String?`.
- `CourseEnrollment` — `[userId, courseId]` unique composite.
- `LessonProgress` — `[userId, lessonId]` unique composite, `completed Boolean`, `completedAt DateTime?`.
- `Assessment` — `title`, `description String?`, `courseId` (→ `Course`, `onDelete: Cascade`). Has many `AssessmentQuestion`.
- `AssessmentQuestion` — `prompt String`, `orderIndex Int`, `assessmentId` (→ `Assessment`, cascade). Has many `AssessmentChoice`.
- `AssessmentChoice` — `text String`, `isCorrect Boolean @default(false)`, `orderIndex Int`, `questionId` (→ `AssessmentQuestion`, cascade). Single-correct in the UI (radio), but the boolean allows multi-correct later. No attempt/score model — assessments are self-checks only.

**Enum:** `CoursePurchaseStatus { PENDING SUCCEEDED FAILED EXPIRED REFUNDED }`

---

## Services

### `src/services/stripe.ts`
Lazy singleton Stripe client (initialised on first call, not at import time — avoids crash if `STRIPE_SECRET_KEY` is absent). Exports `createCheckoutSession(params)` and `constructWebhookEvent(rawBody, sig, secret)`. API version: `2026-04-22.dahlia`.

### `src/services/paypal.ts`
No SDK — uses Node 20 built-in `fetch`. Exports `createPaypalOrder(params)`, `capturePaypalOrder(orderId)`, `verifyWebhookSignature(headers, body)`. Base URL switches on `PAYPAL_ENVIRONMENT` (sandbox/live). Access token fetched fresh per call (stateless).

### `src/services/storage.ts`
`upload.single("pdf")` via multer memory storage. S3 mode: `AWS_S3_ENABLED=true`. Stores S3 key (not URL) in `Lesson.pdfUrl`. `getSignedPdfUrl` returns 1-hour signed URL for S3 keys; passes through local `/files/...` paths unchanged.

---

## Environment variables

```
# Core
DATABASE_URL
PORT                         # default 8080
CORS_ALLOWED_ORIGINS         # CSV, e.g. https://mind-leaf.netlify.app,http://localhost:3000

# S3 (optional)
AWS_S3_ENABLED               # "true" to enable
AWS_S3_BUCKET_NAME
AWS_REGION
AWS_ENDPOINT_URL             # optional, for S3-compatible providers

# Stripe
STRIPE_SECRET_KEY            # sk_live_... or sk_test_...
STRIPE_WEBHOOK_SECRET        # whsec_...
STRIPE_SUCCESS_URL           # e.g. https://mind-leaf.netlify.app/payment/success?session_id={CHECKOUT_SESSION_ID}
STRIPE_CANCEL_URL            # e.g. https://mind-leaf.netlify.app/payment/cancel

# PayPal
PAYPAL_CLIENT_ID
PAYPAL_CLIENT_SECRET
PAYPAL_ENVIRONMENT           # "sandbox" or "live"
PAYPAL_WEBHOOK_ID
PAYPAL_SUCCESS_URL           # e.g. https://mind-leaf.netlify.app/payment/success
PAYPAL_CANCEL_URL            # e.g. https://mind-leaf.netlify.app/payment/cancel
```

---

## Key invariants and gotchas

- **Paid course enrollment gate**: `POST /enrollments/courses/:courseId` checks `CoursePurchase.status = SUCCEEDED` for the requesting user before creating enrollment. No succeeded purchase → 402. This is the source of truth — don't bypass it.
- **`checkoutSessionId` is nullable**: it's Stripe-only. PayPal purchases have `paypalOrderId` instead. Any query filtering by `checkoutSessionId` should also filter by `paymentMethod = "STRIPE"`.
- **Stripe raw body**: `/webhooks/stripe` is mounted before `express.json()` with `express.raw()`. If you add new middleware to `server.ts`, don't insert it between the webhook mount and the raw body parser.
- **PayPal capture is synchronous on return**: the primary enrollment path is `POST /payments/paypal/capture` called by the frontend on the success page. The webhook (`PAYMENT.CAPTURE.COMPLETED`) is a fallback only.
- **Stripe client lazy init**: `src/services/stripe.ts` throws at call time if `STRIPE_SECRET_KEY` is missing, not at import time. The server starts cleanly without Stripe configured; only payment endpoints fail.
- **Migration history**: `prisma/migrations/` is committed. Always use `prisma migrate deploy` (not `db push`) in any environment.
- **Price changes are non-retroactive**: `PUT /courses/:courseId/pricing` updates the course. Existing `CoursePurchase` rows keep their own `amountCents`/`currency` snapshot.

---

## Related files
- `CREATING_PAID_COURSE.md` — user-facing guide covering Stripe/PayPal setup, webhook registration, test cards, and purchase auditing.
- `Stripe-plan.md` — original design spec for the payment feature (for reference; implementation may differ in minor details).
- `.env.example` — template with all env vars.
- `prisma/migrations/` — `20260521_add_stripe_payments`, `20260522_add_paypal_payments`, `20260525_add_email_verification`, `20260603_add_assessments`.
