import "server-only";
import { sendSmtp } from "@/lib/smtp";

/**
 * Sends the REQ-13 completion email (directly) and the bug emails of migration 0044 (from the
 * outbox, via app/api/email/dispatch). Never throws for "not configured" cases: returns a
 * reason so the release can still be marked done and the caller can report why no email
 * went out.
 *
 * Transport, decided 2026-10-02 (the sender must be the user's Gmail address, which Resend
 * cannot send as):
 *   - SMTP when SMTP_HOST / SMTP_USER / SMTP_PASS are set: Gmail = smtp.gmail.com, port 465,
 *     the Gmail address and an app password (lib/smtp.ts, node:tls, no SDK).
 *   - otherwise Resend's HTTP API (RESEND_API_KEY).
 * EMAIL_FROM is the sender, e.g. "Catalyst QA <umerfarooqsqa@gmail.com>". Gmail sends only as
 * the signed-in account (or its verified aliases).
 */
export type EmailResult = { sent: boolean; reason?: string };

function smtpConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.replace(/\s+/g, ""); // Google shows app passwords in groups of 4
  if (!host || !user || !pass) return null;
  return { host, user, pass, port: Number(process.env.SMTP_PORT || 465) };
}

/** Why email can't be sent right now, or null when it can. */
export function emailNotConfigured(): string | null {
  if (!process.env.EMAIL_FROM?.trim()) return "EMAIL_FROM not configured";
  // SMTP chosen but incomplete: keep emails queued rather than burn their retries elsewhere.
  if (process.env.SMTP_HOST?.trim() && !smtpConfig()) return "SMTP_USER / SMTP_PASS not set";
  if (!smtpConfig() && !process.env.RESEND_API_KEY) {
    return "no transport configured (SMTP_HOST/SMTP_USER/SMTP_PASS, or RESEND_API_KEY)";
  }
  return null;
}

export async function sendEmail(
  to: string[],
  subject: string,
  text: string,
  html?: string,
): Promise<EmailResult> {
  const notConfigured = emailNotConfigured();
  if (notConfigured) return { sent: false, reason: notConfigured };
  if (to.length === 0) {
    return { sent: false, reason: "no recipients configured (set them on the project's settings page)" };
  }
  const from = process.env.EMAIL_FROM!.trim();

  const smtp = smtpConfig();
  if (smtp) {
    if (smtp.port !== 465) return { sent: false, reason: `SMTP_PORT ${smtp.port}: only 465 (implicit TLS) is supported` };
    // one message per recipient, each addressed to them alone
    const failures: string[] = [];
    for (const rcpt of to) {
      const r = await sendSmtp(smtp, { from, to: rcpt, subject, text, html });
      if (!r.sent) failures.push(`${rcpt}: ${r.reason}`);
    }
    return failures.length ? { sent: false, reason: failures.join("; ").slice(0, 500) } : { sent: true };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({ from, to, subject, text, ...(html ? { html } : {}) }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { sent: false, reason: `Resend ${res.status}: ${detail.slice(0, 300)}` };
  }
  return { sent: true };
}
