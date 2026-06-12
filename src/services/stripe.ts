import Stripe from "stripe";

type StripeInstance = InstanceType<typeof Stripe>;

function getStripeClient(): StripeInstance {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  return new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
}

let _stripe: StripeInstance | null = null;

function stripe(): StripeInstance {
  if (!_stripe) {
    _stripe = getStripeClient();
  }
  return _stripe;
}

interface CheckoutSessionParams {
  courseId: number;
  userId: number;
  courseTitle: string;
  priceCents: number;
  currency: string;
}

export async function createCheckoutSession(params: CheckoutSessionParams) {
  const successUrl = process.env.STRIPE_SUCCESS_URL;
  const cancelUrl = process.env.STRIPE_CANCEL_URL;

  if (!successUrl || !cancelUrl) {
    throw new Error("STRIPE_SUCCESS_URL and STRIPE_CANCEL_URL must be set");
  }

  return stripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: params.currency.toLowerCase(),
          unit_amount: params.priceCents,
          product_data: {
            name: params.courseTitle,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      courseId: String(params.courseId),
      userId: String(params.userId),
    },
    // Also stamp the payment intent itself: payment_intent.payment_failed
    // events carry only the intent, and we don't learn the intent id until
    // checkout.session.completed — this metadata is the only way to map a
    // failed payment back to its purchase.
    payment_intent_data: {
      metadata: {
        courseId: String(params.courseId),
        userId: String(params.userId),
      },
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

export async function getCheckoutSession(sessionId: string) {
  return stripe().checkout.sessions.retrieve(sessionId);
}

export function constructWebhookEvent(
  rawBody: Buffer,
  signature: string,
  webhookSecret: string,
) {
  return stripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
}
