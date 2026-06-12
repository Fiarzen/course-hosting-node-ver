function baseUrl(): string {
  return process.env.PAYPAL_ENVIRONMENT === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");
  }
  return { clientId, clientSecret };
}

async function getAccessToken(): Promise<string> {
  const { clientId, clientSecret } = credentials();
  const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${encoded}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal token request failed: ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export interface CreateOrderParams {
  courseId: number;
  userId: number;
  courseTitle: string;
  priceCents: number;
  currency: string;
}

export interface CreateOrderResult {
  orderId: string;
  approvalUrl: string;
}

export async function createPaypalOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
  const successUrl = process.env.PAYPAL_SUCCESS_URL;
  const cancelUrl = process.env.PAYPAL_CANCEL_URL;
  if (!successUrl || !cancelUrl) {
    throw new Error("PAYPAL_SUCCESS_URL and PAYPAL_CANCEL_URL must be set");
  }

  const token = await getAccessToken();
  const amount = (params.priceCents / 100).toFixed(2);

  const res = await fetch(`${baseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: `course-${params.courseId}-user-${params.userId}`,
          description: params.courseTitle,
          amount: {
            currency_code: params.currency.toUpperCase(),
            value: amount,
          },
        },
      ],
      application_context: {
        return_url: successUrl,
        cancel_url: cancelUrl,
        brand_name: "mindleaf",
        landing_page: "BILLING",
        user_action: "PAY_NOW",
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal create order failed: ${text}`);
  }

  const order = (await res.json()) as {
    id: string;
    links: Array<{ rel: string; href: string }>;
  };

  const approvalLink = order.links.find((l) => l.rel === "approve");
  if (!approvalLink) throw new Error("No approval URL returned by PayPal");

  return { orderId: order.id, approvalUrl: approvalLink.href };
}

export interface CaptureResult {
  status: string;
  captureId: string | null;
  amountCents: number | null;
  currency: string | null;
}

// PayPal amounts are decimal strings like "19.99".
export function paypalAmountToCents(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

export async function capturePaypalOrder(orderId: string): Promise<CaptureResult> {
  const token = await getAccessToken();

  const res = await fetch(`${baseUrl()}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal capture failed: ${text}`);
  }

  const data = (await res.json()) as {
    status: string;
    purchase_units?: Array<{
      payments?: {
        captures?: Array<{
          id: string;
          amount?: { currency_code?: string; value?: string };
        }>;
      };
    }>;
  };

  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    status: data.status,
    captureId: capture?.id ?? null,
    amountCents: paypalAmountToCents(capture?.amount?.value),
    currency: capture?.amount?.currency_code?.toLowerCase() ?? null,
  };
}

export async function verifyWebhookSignature(
  headers: Record<string, string | string[] | undefined>,
  body: unknown,
): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    console.warn("PAYPAL_WEBHOOK_ID not set — skipping signature verification");
    return false;
  }

  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    return false;
  }

  const header = (key: string) => {
    const val = headers[key];
    return Array.isArray(val) ? val[0] : val ?? "";
  };

  const res = await fetch(`${baseUrl()}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      auth_algo: header("paypal-auth-algo"),
      cert_url: header("paypal-cert-url"),
      transmission_id: header("paypal-transmission-id"),
      transmission_sig: header("paypal-transmission-sig"),
      transmission_time: header("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: body,
    }),
  });

  if (!res.ok) return false;
  const result = (await res.json()) as { verification_status: string };
  return result.verification_status === "SUCCESS";
}
