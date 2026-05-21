Problem statement
The backend currently allows direct self-enrollment into courses. We need Stripe payments for paid courses so access is granted only after verified successful payment, while free-course enrollment remains unchanged.
Confirmed payment scope (one-time only)
This plan is explicitly one-time purchases per course using Stripe Checkout in mode=payment.
A successful one-time payment grants enrollment without renewal.
No subscriptions, recurring billing, trials, seat billing, or installment billing are included.
Current state
The API is Express + TypeScript with route modules in src/routes and data models in prisma/schema.prisma.
Enrollment is created directly in POST /enrollments/courses/:courseId in src/routes/enrollments.ts.
Lesson access depends on enrollment checks in src/routes/lessons.ts.
There is no Stripe dependency, payment model, webhook endpoint, or Stripe env configuration in .env.example.
Target architecture
For paid courses, enrollment becomes a fulfillment step after successful payment.
Flow:
Authenticated learner requests checkout session for a paid course.
Backend creates Stripe Checkout Session (mode=payment, one line item, quantity 1) and records CoursePurchase as PENDING.
Stripe posts webhook events to backend.
On checkout.session.completed, backend marks purchase SUCCEEDED and creates enrollment idempotently.
Existing lesson authorization remains unchanged because it already relies on enrollment.
Proposed changes
1) Prisma schema updates
Update Course in prisma/schema.prisma:
isPaid Boolean default false
priceCents Int? (required when isPaid=true)
currency String default lowercase ISO code (e.g. gbp)
Add enum CoursePurchaseStatus:
PENDING, SUCCEEDED, FAILED, EXPIRED, REFUNDED
Add model CoursePurchase:
linkage: userId, courseId
Stripe IDs: checkoutSessionId (unique), paymentIntentId (nullable), stripeCustomerId (nullable)
snapshot: amountCents, currency
lifecycle: status, paidAt, expiresAt
operational: createdAt, updatedAt
relations to User and Course
Add model StripeWebhookEvent for idempotency:
stripeEventId (unique), eventType, processedAt
Add indexes at least for CoursePurchase(userId, courseId), CoursePurchase(status), and Stripe lookup fields.
Run migration and Prisma client generation.
2) Stripe service and configuration
Add Stripe SDK dependency and create src/services/stripe.ts for:
Stripe client initialization
checkout session creation
webhook signature verification
event parsing helpers
Checkout session creation rules:
mode: "payment"
one line item with course priceCents, currency, and course title
quantity: 1
metadata includes courseId and userId
success/cancel URLs from env
Add .env.example vars:
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_SUCCESS_URL
STRIPE_CANCEL_URL
No subscription-related env vars are added.
3) API contracts (exact request/response)
All new error responses should use shape:
{ "error": "human readable message", "code": "MACHINE_CODE" }
3.1 POST /payments/courses/:courseId/checkout-session
Auth required.
Request body:
{} (no required fields)
Success 200 response:
{ "purchaseId": number, "courseId": number, "status": "PENDING", "checkoutSessionId": string, "checkoutUrl": string, "expiresAt": string|null, "reused": boolean }
Rules:
if a non-expired pending purchase exists for same user/course, reuse it and return reused=true
if caller already enrolled, return 409 with code ALREADY_ENROLLED
if course not found, return 404 with code COURSE_NOT_FOUND
if course is free or invalidly priced for payment, return 422 with code COURSE_NOT_PURCHASABLE
if allowlist blocks purchase, return 403 with code NOT_ALLOWED_FOR_COURSE
3.2 GET /payments/courses/:courseId/status
Auth required.
Success 200 response:
{ "courseId": number, "isPaid": boolean, "priceCents": number|null, "currency": string|null, "isEnrolled": boolean, "purchase": { "purchaseId": number, "status": "PENDING"|"SUCCEEDED"|"FAILED"|"EXPIRED"|"REFUNDED", "checkoutSessionId": string|null, "paymentIntentId": string|null, "amountCents": number|null, "currency": string|null, "paidAt": string|null } | null, "canEnrollDirectly": boolean }
Semantics:
free course -> canEnrollDirectly=true, purchase=null
paid course with succeeded purchase -> canEnrollDirectly=true
paid course without succeeded purchase -> canEnrollDirectly=false
3.3 POST /webhooks/stripe
Public endpoint (no auth middleware).
Request requirements:
raw request body (not JSON-parsed)
Stripe-Signature header
Success response: 200 { "received": true }
Invalid signature: 400 { "error": "Invalid Stripe signature", "code": "STRIPE_SIGNATURE_INVALID" }
3.4 Updated POST /enrollments/courses/:courseId
Auth required.
Behavior:
free course: existing enroll behavior unchanged (201 enrollment)
paid course with succeeded purchase: enroll (201 enrollment)
paid course without succeeded purchase: 402 { "error": "Payment required for this course", "code": "PAYMENT_REQUIRED" }
4) Webhook handling contract
Handle at minimum:
checkout.session.completed
resolve purchase by checkoutSessionId
mark SUCCEEDED, set paidAt
create enrollment if missing
checkout.session.expired
if purchase still PENDING, mark EXPIRED
payment_intent.payment_failed
if mapped purchase still pending, mark FAILED
Idempotency requirements:
skip already processed Stripe event IDs using StripeWebhookEvent
webhook retries/duplicates must not create duplicate enrollments
purchase update + enrollment creation should be transaction-safe
5) Creator/admin pricing management contracts
Extend POST /courses to accept optional pricing fields:
{ "title": string, "description": string, "authorId"?: number, "isPaid"?: boolean, "priceCents"?: number|null, "currency"?: string }
Add endpoint PUT /courses/:courseId/pricing (author/admin only):
request: { "isPaid": boolean, "priceCents": number|null, "currency": string|null }
response: { "courseId": number, "isPaid": boolean, "priceCents": number|null, "currency": string|null }
Validation:
isPaid=false -> priceCents stored null
isPaid=true -> priceCents required integer > 0 and currency required
Price changes affect only new purchases; existing CoursePurchase keeps historical amount snapshot.
6) Error handling and observability
Add explicit machine codes at least for:
AUTH_REQUIRED
COURSE_NOT_FOUND
COURSE_NOT_PURCHASABLE
ALREADY_ENROLLED
NOT_ALLOWED_FOR_COURSE
PAYMENT_REQUIRED
CHECKOUT_CREATE_FAILED
STRIPE_SIGNATURE_INVALID
Log Stripe event IDs, checkout session IDs, purchase IDs, and enrollment IDs for traceability without logging secrets.
7) Validation and rollout
Validation:
npm run build
Prisma migration + generate succeeds
Stripe test-mode checkout and webhook forwarding (Stripe CLI)
regression checks for existing free-course enrollment and lesson access
Rollout:
deploy schema with backward-compatible defaults (isPaid=false)
existing courses remain free until explicitly marked paid
frontend can adopt checkout flow incrementally
Acceptance criteria
Paid course access is only granted after successful Stripe one-time payment.
Duplicate webhook deliveries do not create duplicate enrollments.
A learner cannot directly enroll in a paid course without a succeeded purchase.
Free-course behavior remains unchanged.
Payment history is auditable per user/course via CoursePurchase records.
Out of scope for this iteration
Subscriptions/recurring billing, coupon systems, advanced tax automation, installment plans, and automatic refund-triggered unenrollment.
Parallelization assessment
Parallel child agents are not proposed for this planning task because schema, enrollment gating, webhook idempotency, and endpoint contracts are tightly coupled and this request is for plan refinement only.