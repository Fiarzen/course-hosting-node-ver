import sgMail from "@sendgrid/mail";

function getSgMail(): typeof sgMail {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error("SENDGRID_API_KEY is not set");
  sgMail.setApiKey(key);
  return sgMail;
}

function frontendUrl(): string {
  return process.env.FRONTEND_URL ?? "https://mind-leaf.netlify.app";
}

function fromAddress(): string {
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM is not set");
  return from;
}

export async function sendVerificationEmail(
  to: string,
  token: string,
): Promise<void> {
  const link = `${frontendUrl()}/verify-email?token=${token}`;
  await getSgMail().send({
    from: fromAddress(),
    to,
    subject: "Verify your mindleaf account",
    text: `Click the link below to verify your email address:\n\n${link}\n\nThis link expires in 1 hour. If you didn't create a mindleaf account, you can ignore this email.`,
    html: `<p>Click the link below to verify your email address:</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour. If you didn't create a mindleaf account, you can ignore this email.</p>`,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
): Promise<void> {
  const link = `${frontendUrl()}/reset-password?token=${token}`;
  await getSgMail().send({
    from: fromAddress(),
    to,
    subject: "Reset your mindleaf password",
    text: `Click the link below to reset your password:\n\n${link}\n\nThis link expires in 1 hour. If you didn't request a password reset, you can ignore this email.`,
    html: `<p>Click the link below to reset your password:</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour. If you didn't request a password reset, you can ignore this email.</p>`,
  });
}

export async function sendAdminPasswordResetEmail(
  to: string,
  token: string,
): Promise<void> {
  const link = `${frontendUrl()}/reset-password?token=${token}`;
  await getSgMail().send({
    from: fromAddress(),
    to,
    subject: "Your mindleaf password has been reset",
    text: `An administrator has initiated a password reset for your account. Click the link below to set a new password:\n\n${link}\n\nThis link expires in 1 hour.`,
    html: `<p>An administrator has initiated a password reset for your account. Click the link below to set a new password:</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour.</p>`,
  });
}
