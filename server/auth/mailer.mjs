import nodemailer from "nodemailer";

export function createMailer(env = process.env) {
  const smtpHost = env.SMTP_HOST;
  const smtpPort = Number(env.SMTP_PORT ?? 587);
  const smtpUser = env.SMTP_USER;
  const smtpPassword = env.SMTP_PASSWORD;
  const from = env.MAIL_FROM ?? "Say it. See it. <no-reply@localhost>";
  const configured = Boolean(smtpHost);

  if (!smtpHost) {
    if (env.NODE_ENV === "production") {
      const missingConfiguration = () => {
        throw Object.assign(new Error("SMTP_HOST is required for email delivery."), { code: "MAIL_CONFIGURATION_MISSING" });
      };
      return {
        isConfigured: () => false,
        async sendVerification() { missingConfiguration(); },
        async sendPasswordReset() { missingConfiguration(); },
      };
    }
    const messages = new Map();
    return {
      isConfigured: () => true,
      async sendVerification(email, url) {
        messages.set(email, { purpose: "verification", url, createdAt: Date.now() });
        console.info(`Development email queued: verification for ${email}`);
      },
      async sendPasswordReset(email, url) {
        messages.set(email, { purpose: "password-reset", url, createdAt: Date.now() });
        console.info(`Development email queued: password reset for ${email}`);
      },
      takeDevelopmentMessage(email) {
        const message = messages.get(email.toLowerCase()) ?? null;
        messages.delete(email.toLowerCase());
        return message;
      },
    };
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: smtpUser ? { user: smtpUser, pass: smtpPassword } : undefined,
  });
  return {
    isConfigured: () => configured,
    async sendVerification(email, url) {
      await transporter.sendMail({ from, to: email, subject: "Verify your Say it. See it. account", text: `Verify your email address: ${url}\n\nThis link expires in 24 hours.` });
    },
    async sendPasswordReset(email, url) {
      await transporter.sendMail({ from, to: email, subject: "Reset your Say it. See it. password", text: `Reset your password: ${url}\n\nThis single-use link expires in 30 minutes.` });
    },
  };
}
