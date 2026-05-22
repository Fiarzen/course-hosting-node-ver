import { Router, Request, Response } from "express";
import { prisma } from "../db";
import { constructWebhookEvent } from "../services/stripe";
import { verifyWebhookSignature, capturePaypalOrder } from "../services/paypal";

export const webhooksRouter = Router();

type StripeEvent = ReturnType<typeof constructWebhookEvent>;

// POST /webhooks/stripe — raw body required, no auth
webhooksRouter.post("/stripe", async (req: Request, res: Response) => {
  const signature = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not configured");
    return res.status(500).json({ error: "Webhook secret not configured" });
  }

  if (!signature || typeof signature !== "string") {
    return res.status(400).json({ error: "Missing Stripe-Signature header", code: "STRIPE_SIGNATURE_INVALID" });
  }

  let event: StripeEvent;
  try {
    event = constructWebhookEvent(req.body as Buffer, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return res.status(400).json({ error: "Invalid Stripe signature", code: "STRIPE_SIGNATURE_INVALID" });
  }

  // Idempotency: skip already processed events
  const alreadyProcessed = await prisma.stripeWebhookEvent.findUnique({
    where: { stripeEventId: event.id },
  });
  if (alreadyProcessed) {
    return res.status(200).json({ received: true });
  }

  try {
    await handleEvent(event);
    await prisma.stripeWebhookEvent.create({
      data: { stripeEventId: event.id, eventType: event.type },
    });
  } catch (err) {
    console.error(`Error processing Stripe event ${event.id} (${event.type}):`, err);
    return res.status(500).json({ error: "Failed to process webhook event" });
  }

  return res.status(200).json({ received: true });
});

async function handleEvent(event: StripeEvent): Promise<void> {
  const data = event.data.object as unknown as Record<string, unknown>;
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(data);
      break;
    case "checkout.session.expired":
      await handleCheckoutSessionExpired(data);
      break;
    case "payment_intent.payment_failed":
      await handlePaymentIntentFailed(data);
      break;
    default:
      break;
  }
}

async function handleCheckoutSessionCompleted(session: Record<string, unknown>): Promise<void> {
  const sessionId = session["id"] as string;
  const purchase = await prisma.coursePurchase.findUnique({
    where: { checkoutSessionId: sessionId },
  });
  if (!purchase) {
    console.warn(`checkout.session.completed: no purchase found for session ${sessionId}`);
    return;
  }

  const paymentIntent = session["payment_intent"];
  const customer = session["customer"];

  await prisma.$transaction(async (tx) => {
    await tx.coursePurchase.update({
      where: { id: purchase.id },
      data: {
        status: "SUCCEEDED",
        paidAt: new Date(),
        paymentIntentId: typeof paymentIntent === "string" ? paymentIntent : null,
        stripeCustomerId: typeof customer === "string" ? customer : null,
      },
    });

    await tx.courseEnrollment.upsert({
      where: { userId_courseId: { userId: purchase.userId, courseId: purchase.courseId } },
      update: {},
      create: { userId: purchase.userId, courseId: purchase.courseId },
    });
  });

  console.log(`checkout.session.completed: purchase ${purchase.id} succeeded, enrollment created for user ${purchase.userId} course ${purchase.courseId}`);
}

async function handleCheckoutSessionExpired(session: Record<string, unknown>): Promise<void> {
  const sessionId = session["id"] as string;
  const purchase = await prisma.coursePurchase.findUnique({
    where: { checkoutSessionId: sessionId },
  });
  if (!purchase || purchase.status !== "PENDING") return;

  await prisma.coursePurchase.update({
    where: { id: purchase.id },
    data: { status: "EXPIRED" },
  });

  console.log(`checkout.session.expired: purchase ${purchase.id} marked EXPIRED`);
}

async function handlePaymentIntentFailed(paymentIntent: Record<string, unknown>): Promise<void> {
  const paymentIntentId = paymentIntent["id"] as string;
  const purchase = await prisma.coursePurchase.findFirst({
    where: { paymentIntentId, status: "PENDING" },
  });
  if (!purchase) return;

  await prisma.coursePurchase.update({
    where: { id: purchase.id },
    data: { status: "FAILED" },
  });

  console.log(`payment_intent.payment_failed: purchase ${purchase.id} marked FAILED`);
}

// POST /webhooks/paypal — standard JSON body (PayPal verification uses API call, not raw bytes)
webhooksRouter.post("/paypal", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const eventType = (body["event_type"] as string) ?? "";
  const eventId = (body["id"] as string) ?? "";

  // Verify signature via PayPal API
  const valid = await verifyWebhookSignature(req.headers as Record<string, string | undefined>, body);
  if (!valid) {
    console.warn(`PayPal webhook signature invalid for event ${eventId}`);
    return res.status(400).json({ error: "Invalid PayPal signature" });
  }

  // Idempotency: reuse StripeWebhookEvent table with paypal- prefix
  const dedupeKey = `paypal-${eventId}`;
  const alreadyProcessed = await prisma.stripeWebhookEvent.findUnique({
    where: { stripeEventId: dedupeKey },
  });
  if (alreadyProcessed) {
    return res.status(200).json({ received: true });
  }

  try {
    if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
      await handlePaypalCaptureCompleted(body);
    } else if (eventType === "PAYMENT.CAPTURE.DENIED" || eventType === "PAYMENT.CAPTURE.DECLINED") {
      await handlePaypalCaptureFailed(body);
    }

    await prisma.stripeWebhookEvent.create({
      data: { stripeEventId: dedupeKey, eventType },
    });
  } catch (err) {
    console.error(`Error processing PayPal event ${eventId} (${eventType}):`, err);
    return res.status(500).json({ error: "Failed to process PayPal webhook" });
  }

  return res.status(200).json({ received: true });
});

async function handlePaypalCaptureCompleted(body: Record<string, unknown>): Promise<void> {
  const resource = body["resource"] as Record<string, unknown> | undefined;
  if (!resource) return;

  // Extract order ID from supplementary data
  const supplementary = resource["supplementary_data"] as Record<string, unknown> | undefined;
  const relatedIds = supplementary?.["related_ids"] as Record<string, unknown> | undefined;
  const orderId = relatedIds?.["order_id"] as string | undefined;
  const captureId = resource["id"] as string | undefined;

  if (!orderId) {
    console.warn("PAYMENT.CAPTURE.COMPLETED: no order_id in supplementary_data");
    return;
  }

  const purchase = await prisma.coursePurchase.findUnique({
    where: { paypalOrderId: orderId },
  });
  if (!purchase) {
    console.warn(`PAYMENT.CAPTURE.COMPLETED: no purchase found for PayPal order ${orderId}`);
    return;
  }

  // If already succeeded (captured via return flow), skip
  if (purchase.status === "SUCCEEDED") return;

  // Fallback: perform capture if still PENDING
  if (purchase.status === "PENDING") {
    try {
      const captureResult = await capturePaypalOrder(orderId);
      if (captureResult.status !== "COMPLETED") return;
    } catch (err) {
      console.error(`PAYMENT.CAPTURE.COMPLETED webhook: capture call failed for order ${orderId}:`, err);
      return;
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.coursePurchase.update({
      where: { id: purchase.id },
      data: { status: "SUCCEEDED", paidAt: new Date(), paypalCaptureId: captureId ?? null },
    });
    await tx.courseEnrollment.upsert({
      where: { userId_courseId: { userId: purchase.userId, courseId: purchase.courseId } },
      update: {},
      create: { userId: purchase.userId, courseId: purchase.courseId },
    });
  });

  console.log(`PAYMENT.CAPTURE.COMPLETED (webhook): purchase ${purchase.id} succeeded, user ${purchase.userId} enrolled in course ${purchase.courseId}`);
}

async function handlePaypalCaptureFailed(body: Record<string, unknown>): Promise<void> {
  const resource = body["resource"] as Record<string, unknown> | undefined;
  const supplementary = (resource?.["supplementary_data"] as Record<string, unknown> | undefined);
  const relatedIds = supplementary?.["related_ids"] as Record<string, unknown> | undefined;
  const orderId = relatedIds?.["order_id"] as string | undefined;
  if (!orderId) return;

  const purchase = await prisma.coursePurchase.findUnique({
    where: { paypalOrderId: orderId },
  });
  if (!purchase || purchase.status !== "PENDING") return;

  await prisma.coursePurchase.update({
    where: { id: purchase.id },
    data: { status: "FAILED" },
  });

  console.log(`PayPal capture failed (webhook): purchase ${purchase.id} marked FAILED`);
}
