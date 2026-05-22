import { Router } from "express";
import { prisma } from "../db";
import { AuthenticatedRequest } from "../middleware/auth";
import { createCheckoutSession } from "../services/stripe";
import { createPaypalOrder, capturePaypalOrder } from "../services/paypal";

export const paymentsRouter = Router();

// POST /payments/courses/:courseId/checkout-session
paymentsRouter.post("/courses/:courseId/checkout-session", async (req: AuthenticatedRequest, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });

  const courseId = Number(req.params.courseId);

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { allowedEmails: true },
  });
  if (!course) return res.status(404).json({ error: "Course not found", code: "COURSE_NOT_FOUND" });

  if (!course.isPaid || !course.priceCents || course.priceCents <= 0 || !course.currency) {
    return res.status(422).json({ error: "Course is not available for purchase", code: "COURSE_NOT_PURCHASABLE" });
  }

  // Allowlist check (admins and authors are always allowed)
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });

  const isAdmin = dbUser.role === "ADMIN";
  const isAuthor = course.authorId === dbUser.id;
  if (course.restrictedToAllowList && !isAdmin && !isAuthor) {
    const normalized = dbUser.email.toLowerCase();
    const allowed = course.allowedEmails.some((e) => e.email.toLowerCase() === normalized);
    if (!allowed) {
      return res.status(403).json({ error: "You are not allowed to purchase this course", code: "NOT_ALLOWED_FOR_COURSE" });
    }
  }

  // Already enrolled check
  const enrollment = await prisma.courseEnrollment.findUnique({
    where: { userId_courseId: { userId: dbUser.id, courseId } },
  });
  if (enrollment) {
    return res.status(409).json({ error: "You are already enrolled in this course", code: "ALREADY_ENROLLED" });
  }

  // Reuse non-expired pending Stripe purchase
  const now = new Date();
  const existingPurchase = await prisma.coursePurchase.findFirst({
    where: {
      userId: dbUser.id,
      courseId,
      paymentMethod: "STRIPE",
      status: "PENDING",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });
  if (existingPurchase) {
    return res.status(200).json({
      purchaseId: existingPurchase.id,
      courseId,
      status: existingPurchase.status,
      checkoutSessionId: existingPurchase.checkoutSessionId,
      checkoutUrl: `https://checkout.stripe.com/pay/${existingPurchase.checkoutSessionId}`,
      expiresAt: existingPurchase.expiresAt?.toISOString() ?? null,
      reused: true,
    });
  }

  // Create new Stripe Checkout Session
  let session;
  try {
    session = await createCheckoutSession({
      courseId,
      userId: dbUser.id,
      courseTitle: course.title,
      priceCents: course.priceCents,
      currency: course.currency,
    });
  } catch (err) {
    console.error("Stripe checkout session creation failed:", err);
    return res.status(500).json({ error: "Failed to create checkout session", code: "CHECKOUT_CREATE_FAILED" });
  }

  const expiresAt = session.expires_at ? new Date(session.expires_at * 1000) : null;

  const purchase = await prisma.coursePurchase.create({
    data: {
      userId: dbUser.id,
      courseId,
      checkoutSessionId: session.id,
      amountCents: course.priceCents,
      currency: course.currency,
      status: "PENDING",
      expiresAt,
    },
  });

  console.log(`Created purchase ${purchase.id} with checkout session ${session.id} for user ${dbUser.id} course ${courseId}`);

  return res.status(200).json({
    purchaseId: purchase.id,
    courseId,
    status: purchase.status,
    checkoutSessionId: session.id,
    checkoutUrl: session.url,
    expiresAt: purchase.expiresAt?.toISOString() ?? null,
    reused: false,
  });
});

// GET /payments/courses/:courseId/status
paymentsRouter.get("/courses/:courseId/status", async (req: AuthenticatedRequest, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });

  const courseId = Number(req.params.courseId);

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) return res.status(404).json({ error: "Course not found", code: "COURSE_NOT_FOUND" });

  const enrollment = await prisma.courseEnrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId } },
  });

  const purchase = await prisma.coursePurchase.findFirst({
    where: { userId: user.id, courseId },
    orderBy: { createdAt: "desc" },
  });

  const canEnrollDirectly =
    !course.isPaid ||
    (purchase?.status === "SUCCEEDED");

  return res.json({
    courseId,
    isPaid: course.isPaid,
    priceCents: course.priceCents ?? null,
    currency: course.currency ?? null,
    isEnrolled: !!enrollment,
    purchase: purchase
      ? {
          purchaseId: purchase.id,
          status: purchase.status,
          paymentMethod: purchase.paymentMethod,
          checkoutSessionId: purchase.checkoutSessionId ?? null,
          paymentIntentId: purchase.paymentIntentId ?? null,
          paypalOrderId: purchase.paypalOrderId ?? null,
          amountCents: purchase.amountCents ?? null,
          currency: purchase.currency ?? null,
          paidAt: purchase.paidAt?.toISOString() ?? null,
        }
      : null,
    canEnrollDirectly,
  });
});

// POST /payments/courses/:courseId/paypal-order
paymentsRouter.post("/courses/:courseId/paypal-order", async (req: AuthenticatedRequest, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });

  const courseId = Number(req.params.courseId);

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { allowedEmails: true },
  });
  if (!course) return res.status(404).json({ error: "Course not found", code: "COURSE_NOT_FOUND" });

  if (!course.isPaid || !course.priceCents || course.priceCents <= 0 || !course.currency) {
    return res.status(422).json({ error: "Course is not available for purchase", code: "COURSE_NOT_PURCHASABLE" });
  }

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });

  const isAdmin = dbUser.role === "ADMIN";
  const isAuthor = course.authorId === dbUser.id;
  if (course.restrictedToAllowList && !isAdmin && !isAuthor) {
    const normalized = dbUser.email.toLowerCase();
    const allowed = course.allowedEmails.some((e) => e.email.toLowerCase() === normalized);
    if (!allowed) {
      return res.status(403).json({ error: "You are not allowed to purchase this course", code: "NOT_ALLOWED_FOR_COURSE" });
    }
  }

  const enrollment = await prisma.courseEnrollment.findUnique({
    where: { userId_courseId: { userId: dbUser.id, courseId } },
  });
  if (enrollment) {
    return res.status(409).json({ error: "You are already enrolled in this course", code: "ALREADY_ENROLLED" });
  }

  // Reuse non-expired pending PayPal purchase
  const existingPaypal = await prisma.coursePurchase.findFirst({
    where: {
      userId: dbUser.id,
      courseId,
      paymentMethod: "PAYPAL",
      status: "PENDING",
    },
  });
  if (existingPaypal) {
    return res.status(200).json({
      purchaseId: existingPaypal.id,
      courseId,
      status: existingPaypal.status,
      paypalOrderId: existingPaypal.paypalOrderId,
      reused: true,
    });
  }

  let orderResult;
  try {
    orderResult = await createPaypalOrder({
      courseId,
      userId: dbUser.id,
      courseTitle: course.title,
      priceCents: course.priceCents,
      currency: course.currency,
    });
  } catch (err) {
    console.error("PayPal order creation failed:", err);
    return res.status(500).json({ error: "Failed to create PayPal order", code: "CHECKOUT_CREATE_FAILED" });
  }

  const purchase = await prisma.coursePurchase.create({
    data: {
      userId: dbUser.id,
      courseId,
      paymentMethod: "PAYPAL",
      paypalOrderId: orderResult.orderId,
      amountCents: course.priceCents,
      currency: course.currency,
      status: "PENDING",
    },
  });

  console.log(`Created PayPal purchase ${purchase.id} order ${orderResult.orderId} for user ${dbUser.id} course ${courseId}`);

  return res.status(200).json({
    purchaseId: purchase.id,
    courseId,
    status: purchase.status,
    paypalOrderId: orderResult.orderId,
    approvalUrl: orderResult.approvalUrl,
    reused: false,
  });
});

// POST /payments/paypal/capture  — called by frontend after PayPal redirects back
paymentsRouter.post("/paypal/capture", async (req: AuthenticatedRequest, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });

  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ error: "token (PayPal order ID) is required" });

  const purchase = await prisma.coursePurchase.findUnique({
    where: { paypalOrderId: token },
  });
  if (!purchase) return res.status(404).json({ error: "Purchase not found", code: "COURSE_NOT_FOUND" });
  if (purchase.userId !== user.id) return res.status(403).json({ error: "Forbidden" });

  if (purchase.status === "SUCCEEDED") {
    return res.status(200).json({ purchaseId: purchase.id, courseId: purchase.courseId, status: "SUCCEEDED" });
  }
  if (purchase.status !== "PENDING") {
    return res.status(409).json({ error: `Purchase is in status ${purchase.status}`, code: "PAYMENT_REQUIRED" });
  }

  let captureResult;
  try {
    captureResult = await capturePaypalOrder(token);
  } catch (err) {
    console.error("PayPal capture failed:", err);
    return res.status(502).json({ error: "PayPal capture failed", code: "CHECKOUT_CREATE_FAILED" });
  }

  if (captureResult.status !== "COMPLETED") {
    return res.status(402).json({ error: `PayPal capture status: ${captureResult.status}`, code: "PAYMENT_REQUIRED" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.coursePurchase.update({
      where: { id: purchase.id },
      data: {
        status: "SUCCEEDED",
        paidAt: new Date(),
        paypalCaptureId: captureResult.captureId,
      },
    });

    await tx.courseEnrollment.upsert({
      where: { userId_courseId: { userId: purchase.userId, courseId: purchase.courseId } },
      update: {},
      create: { userId: purchase.userId, courseId: purchase.courseId },
    });
  });

  console.log(`PayPal capture succeeded: purchase ${purchase.id}, capture ${captureResult.captureId}, user ${purchase.userId} enrolled in course ${purchase.courseId}`);

  return res.status(200).json({ purchaseId: purchase.id, courseId: purchase.courseId, status: "SUCCEEDED" });
});
