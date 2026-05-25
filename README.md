# mindleaf — Course Hosting Backend

Express + TypeScript + Prisma backend for **mindleaf**, a course-hosting platform. Deployed on Railway via Docker. Frontend lives in [`../course-hosting-frontend`](../course-hosting-frontend) (React, Netlify).

## Stack

- **Runtime**: Node 20, TypeScript
- **Framework**: Express
- **ORM**: Prisma (PostgreSQL)
- **Payments**: Stripe (Checkout), PayPal (REST v2)
- **Storage**: Local filesystem or AWS S3
- **Deployment**: Railway + Docker

## Getting started

```bash
npm install
cp .env.example .env    # fill in required vars
npx prisma generate
npm run dev             # ts-node-dev with hot reload
```

## Scripts

```bash
npm run dev     # hot-reload dev server
npm run build   # tsc → dist/
npm start       # node dist/server.js

npx prisma generate                        # regenerate client after schema changes
npx prisma migrate dev --name <name>       # create a dev migration
npx prisma migrate deploy                  # apply migrations (used in production)
```

## Environment variables

See [`.env.example`](.env.example) for the full list. Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` | Server port (default `8080`) |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `PAYPAL_CLIENT_ID` | PayPal app client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal app secret |
| `PAYPAL_ENVIRONMENT` | `sandbox` or `live` |
| `AWS_S3_ENABLED` | `true` to store PDFs in S3 |

## API routes

### Auth
- `POST /auth/login` — returns `{ token, user }`
- `POST /auth/reset-password` — validates one-time reset token, sets new password

### Users
- `POST /users/register` — public registration
- `GET /users/me` — authenticated user profile
- `GET /users` — admin only
- `POST /users/:id/upgrade-to-creator` — admin only

### Courses
- `GET /courses` — public course listing (includes pricing info)
- `POST /courses` — create course (CREATOR/ADMIN)
- `PUT /courses/:courseId/pricing` — update pricing (non-retroactive)
- `DELETE /courses/:courseId` — cascades all related data

### Lessons
- `GET /lessons/course/:courseId` — list lessons for a course
- `POST /lessons` — upload lesson with PDF (multipart)
- `POST /lessons/course/:courseId/reorder` — reorder lessons

### Enrollments
- `POST /enrollments/courses/:courseId` — enroll; returns `402` if course is paid and no succeeded purchase exists
- `GET /enrollments/my-courses` — enrolled courses with progress
- `POST /enrollments/lessons/:lessonId/complete` — mark lesson complete

### Payments
- `POST /payments/courses/:courseId/checkout-session` — create Stripe Checkout session
- `POST /payments/courses/:courseId/paypal-order` — create PayPal order
- `POST /payments/paypal/capture` — capture PayPal order and enroll
- `GET /payments/courses/:courseId/status` — purchase/enrollment status

### Webhooks (no auth)
- `POST /webhooks/stripe` — Stripe event handler (raw body required)
- `POST /webhooks/paypal` — PayPal event handler

## Deployment

The Docker image runs migrations on container start then starts the server:

```
until npx prisma migrate deploy; do sleep 5; done && node dist/server.js
```

The retry loop handles Railway's brief DB unavailability at startup. Never use `prisma db push` in production — always use `migrate deploy`.

## Related docs

- [`CREATING_PAID_COURSE.md`](CREATING_PAID_COURSE.md) — Stripe/PayPal setup, webhook registration, test cards, purchase auditing
- [`Stripe-plan.md`](Stripe-plan.md) — original payment feature design spec
