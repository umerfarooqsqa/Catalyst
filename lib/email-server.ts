import "server-only";

/**
 * REQ-13 completion email via Resend's HTTP API (plain fetch -- works under
 * the Cloudflare Workers runtime, same reason push-server.ts avoids heavy
 * SDKs). Never throws for "not configured" cases: returns a reason so the
 * release can still be marked done and the caller can report why no email
 * went out.
 *
 * Env: RESEND_API_KEY (secret), EMAIL_FROM (verified sender, e.g.
 * "Catalyst QA <qa@yourdomain.com>").
 */
export type EmailResult = { sent: boolean; reason?: string };

export async function sendEmail(
  to: string[],
  subject: string,
  text: string,
): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return { sent: false, reason: "RESEND_API_KEY / EMAIL_FROM not configured" };
  }
  if (to.length === 0) {
    return { sent: false, reason: "no recipients configured (set them on the project's settings page)" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { sent: false, reason: `Resend ${res.status}: ${detail.slice(0, 300)}` };
  }
  return { sent: true };
}
