# Creating a Paid Course — Step-by-Step Guide

This guide covers everything needed to publish a paid course on mindleaf and accept payments via Stripe or PayPal.

---

## Prerequisites

- You must be logged in with a **CREATOR** or **ADMIN** account.
- The backend must have the Stripe and/or PayPal environment variables set (see [Environment Setup](#environment-setup) below).

---

## 1. Environment Setup

Before any paid course can be purchased, add the following variables to your Railway backend service (Settings → Variables):

### Stripe

| Variable | Where to find it |
|---|---|
| `STRIPE_SECRET_KEY` | [Stripe Dashboard](https://dashboard.stripe.com/apikeys) → Secret key (`sk_live_…` or `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Webhooks → your endpoint → Signing secret |
| `STRIPE_SUCCESS_URL` | `https://your-frontend.netlify.app/payment/success?session_id={CHECKOUT_SESSION_ID}` |
| `STRIPE_CANCEL_URL` | `https://your-frontend.netlify.app/payment/cancel` |

### PayPal

| Variable | Where to find it |
|---|---|
| `PAYPAL_CLIENT_ID` | [PayPal Developer](https://developer.paypal.com/dashboard/applications) → your app → Client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal Developer → your app → Secret |
| `PAYPAL_ENVIRONMENT` | `sandbox` for testing, `live` for production |
| `PAYPAL_WEBHOOK_ID` | PayPal Developer → Webhooks → your webhook → ID |
| `PAYPAL_SUCCESS_URL` | `https://your-frontend.netlify.app/payment/success` |
| `PAYPAL_CANCEL_URL` | `https://your-frontend.netlify.app/payment/cancel` |

---

## 2. Register Stripe Webhooks

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks).
2. Click **Add endpoint**.
3. Set the URL to: `https://your-backend.railway.app/webhooks/stripe`
4. Select these events:
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `payment_intent.payment_failed`
5. Copy the **Signing secret** and set it as `STRIPE_WEBHOOK_SECRET` in Railway.

> **Local testing:** use the [Stripe CLI](https://stripe.com/docs/stripe-cli):
> ```bash
> stripe listen --forward-to http://localhost:8080/webhooks/stripe
> ```

---

## 3. Register PayPal Webhooks

1. Go to [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications).
2. Select your app → **Webhooks** → **Add Webhook**.
3. Set the URL to: `https://your-backend.railway.app/webhooks/paypal`
4. Subscribe to these events:
   - `PAYMENT.CAPTURE.COMPLETED`
   - `PAYMENT.CAPTURE.DENIED`
   - `PAYMENT.CAPTURE.DECLINED`
5. Copy the **Webhook ID** and set it as `PAYPAL_WEBHOOK_ID` in Railway.

---

## 4. Create a Paid Course

### Via the UI

1. Log in as **CREATOR** or **ADMIN**.
2. Navigate to **My Courses** → **+ Create Course**.
3. Fill in:
   - **Title** and **Description**
   - Under **Pricing**, check **This is a paid course**
   - Enter the **Price** (e.g. `9.99`) and select **Currency** (GBP, USD, EUR)
4. Optionally restrict access to specific emails via **Restrict access to specific users**.
5. Click **Create Course**.

### Via the API

```http
POST /courses
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Advanced TypeScript",
  "description": "Deep dive into TypeScript generics and patterns",
  "isPaid": true,
  "priceCents": 1999,
  "currency": "gbp"
}
```

---

## 5. Update Pricing on an Existing Course

### Via the UI

1. Go to **My Courses**.
2. Click **Manage Lessons** on the course you want to update.
3. Scroll to the **Pricing** panel.
4. Toggle **Paid course**, enter the new price and currency.
5. Click **Save pricing**.

### Via the API

```http
PUT /courses/:courseId/pricing
Authorization: Bearer <token>
Content-Type: application/json

{
  "isPaid": true,
  "priceCents": 2499,
  "currency": "usd"
}
```

> **Note:** Price changes only affect *new* purchases. Existing buyers keep the price they paid (recorded in `CoursePurchase.amountCents`).

---

## 6. Add Lessons

1. In **My Courses**, click **+ Add Lesson** next to your course.
2. Add a title, content, optional YouTube video URL, and optional PDF.
3. Reorder lessons using the Up/Down buttons in **Manage Lessons**.

---

## 7. What Learners See

| Course type | Learner action |
|---|---|
| Free | "Enroll" button — instant access |
| Paid, not purchased | "Pay by Card" (Stripe) and "Pay with PayPal" buttons |
| Paid, payment succeeded | Automatic enrollment, full lesson access |
| Paid, payment pending | Prompt to complete or retry checkout |

### Payment flow

1. Learner clicks **Pay by Card** or **Pay with PayPal**.
2. They are redirected to Stripe Checkout or PayPal.
3. After approval, they land on `/payment/success`:
   - **Stripe**: the page polls `GET /payments/courses/:courseId/status` until enrollment is confirmed.
   - **PayPal**: the page calls `POST /payments/paypal/capture` to complete the payment, then confirms enrollment.
4. Enrollment is created — the learner has full access to all lessons.

---

## 8. Test the Flow (Sandbox / Test Mode)

### Stripe test cards

| Card | Result |
|---|---|
| `4242 4242 4242 4242` | Success |
| `4000 0000 0000 9995` | Decline |

Use any future expiry date and any 3-digit CVC.

### PayPal sandbox

1. In [PayPal Developer](https://developer.paypal.com/dashboard/accounts) create a sandbox **Personal** account.
2. Use those credentials on the PayPal approval page when testing.
3. Set `PAYPAL_ENVIRONMENT=sandbox` in your backend env.

---

## 9. Auditing Purchases

Every payment attempt is stored in the `CoursePurchase` table:

| Field | Description |
|---|---|
| `paymentMethod` | `STRIPE` or `PAYPAL` |
| `status` | `PENDING` → `SUCCEEDED` / `FAILED` / `EXPIRED` / `REFUNDED` |
| `amountCents` | Price at time of purchase (historical snapshot) |
| `paidAt` | Timestamp of successful capture |
| `checkoutSessionId` | Stripe session ID (Stripe purchases only) |
| `paypalOrderId` | PayPal order ID (PayPal purchases only) |

Query all purchases for a course:

```sql
SELECT u.email, cp.status, cp."paymentMethod", cp."amountCents", cp."paidAt"
FROM "CoursePurchase" cp
JOIN "User" u ON u.id = cp."userId"
WHERE cp."courseId" = <id>
ORDER BY cp."createdAt" DESC;
```

---

## 10. Convert a Free Course to Paid (and Back)

- **Free → Paid**: use `PUT /courses/:courseId/pricing` with `isPaid: true`. Learners already enrolled keep access; new learners must pay.
- **Paid → Free**: set `isPaid: false`. All existing purchases are preserved in the audit log. New learners can enroll for free.

Neither direction automatically changes existing enrollments.
