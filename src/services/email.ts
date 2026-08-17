const RESEND_API_URL = "https://api.resend.com/emails";

type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

function frontendUrl(): string {
  return process.env.FRONTEND_URL ?? "https://mind-leaf.netlify.app";
}

/**
 * Sends a message via Resend and never throws. A provider outage (revoked key,
 * missing config, unverified sender domain) must not take down the request — or
 * the process, since Express 4 turns a rejected async handler into an unhandled
 * rejection. Returns whether Resend accepted the message.
 */
async function deliver(purpose: string, msg: EmailMessage): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.error(
      `Email delivery skipped (${purpose}): ${!apiKey ? "RESEND_API_KEY" : "EMAIL_FROM"} is not set`,
    );
    return false;
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, ...msg }),
    });

    if (!res.ok) {
      console.error(
        `Email delivery failed (${purpose}): ${res.status} ${await res.text()}`,
      );
      return false;
    }

    return true;
  } catch (err) {
    console.error(`Email delivery failed (${purpose}):`, err);
    return false;
  }
}

export async function sendVerificationEmail(
  to: string,
  token: string,
): Promise<boolean> {
  const link = `${frontendUrl()}/verify-email?token=${token}`;
  return deliver("verification", {
    to,
    subject: "Verify your mindleaf account",
    text: `Click the link below to verify your email address:\n\n${link}\n\nThis link expires in 1 hour. If you didn't create a mindleaf account, you can ignore this email.`,
    html: `<p>Click the link below to verify your email address:</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour. If you didn't create a mindleaf account, you can ignore this email.</p>`,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
): Promise<boolean> {
  const link = `${frontendUrl()}/reset-password?token=${token}`;
  return deliver("password-reset", {
    to,
    subject: "Reset your mindleaf password",
    text: `Click the link below to reset your password:\n\n${link}\n\nThis link expires in 1 hour. If you didn't request a password reset, you can ignore this email.`,
    html: `<p>Click the link below to reset your password:</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour. If you didn't request a password reset, you can ignore this email.</p>`,
  });
}

export async function sendAdminPasswordResetEmail(
  to: string,
  token: string,
): Promise<boolean> {
  const link = `${frontendUrl()}/reset-password?token=${token}`;
  return deliver("admin-password-reset", {
    to,
    subject: "Your mindleaf password has been reset",
    text: `An administrator has initiated a password reset for your account. Click the link below to set a new password:\n\n${link}\n\nThis link expires in 1 hour.`,
    html: `<p>An administrator has initiated a password reset for your account. Click the link below to set a new password:</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour.</p>`,
  });
}
