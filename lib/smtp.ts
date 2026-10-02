import "server-only";
import { connect, type TLSSocket } from "node:tls";
import { randomUUID } from "node:crypto";

/**
 * A minimal SMTP client over implicit TLS (port 465, e.g. smtp.gmail.com), with no
 * dependencies: node:tls works in Node (next dev) and on Workers (nodejs_compat). Sends one
 * multipart text + HTML message, authenticated with AUTH PLAIN (for Gmail: an app password).
 */
export type SmtpConfig = { host: string; port: number; user: string; pass: string };
export type SmtpMessage = { from: string; to: string; subject: string; text: string; html?: string };

const TIMEOUT_MS = 20_000;

/** "Name <a@b.c>" -> "a@b.c". */
export function addressOf(s: string): string {
  const m = /<([^>]+)>/.exec(s);
  return (m ? m[1] : s).trim();
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const wrap76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n");
// RFC 2047, so a non-ASCII subject or display name survives.
const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

function encodeAddress(s: string): string {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(s);
  if (!m || !m[1]) return addressOf(s);
  const name = m[1].replace(/^"|"$/g, "");
  return `${/^[\w .-]*$/.test(name) ? `"${name}"` : encodeWord(name)} <${m[2]}>`;
}

export function buildMessage(msg: SmtpMessage, now = new Date()): string {
  const boundary = `catalyst-${randomUUID()}`;
  const domain = addressOf(msg.from).split("@")[1] ?? "localhost";
  const parts = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(msg.text)),
  ];
  if (msg.html) {
    parts.push(
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(b64(msg.html)),
    );
  }
  parts.push(`--${boundary}--`, "");
  return [
    `From: ${encodeAddress(msg.from)}`,
    `To: ${encodeAddress(msg.to)}`,
    `Subject: ${encodeWord(msg.subject.replace(/[\r\n]+/g, " "))}`,
    `Date: ${now.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    ...parts,
  ]
    .join("\r\n")
    .replace(/\r\n\./g, "\r\n.."); // dot-stuffing (base64 never needs it; headers might)
}

/** Reads one complete (possibly multi-line) SMTP reply at a time. */
function replies(socket: TLSSocket) {
  let buf = "";
  const waiting: ((r: { code: number; text: string }) => void)[] = [];
  const ready: { code: number; text: string }[] = [];
  socket.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    for (;;) {
      const lines = buf.split("\r\n");
      const end = lines.findIndex((l) => /^\d{3}( |$)/.test(l));
      if (end === -1) break;
      const reply = { code: Number(lines[end].slice(0, 3)), text: lines.slice(0, end + 1).join("\n") };
      buf = lines.slice(end + 1).join("\r\n");
      const w = waiting.shift();
      if (w) w(reply);
      else ready.push(reply);
    }
  });
  return () =>
    new Promise<{ code: number; text: string }>((resolve) => {
      const r = ready.shift();
      if (r) resolve(r);
      else waiting.push(resolve);
    });
}

export async function sendSmtp(cfg: SmtpConfig, msg: SmtpMessage): Promise<{ sent: boolean; reason?: string }> {
  let socket: TLSSocket | null = null;
  const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined };
  try {
    const run = async () => {
      const s = connect({ host: cfg.host, port: cfg.port, servername: cfg.host });
      socket = s;
      const failed = new Promise<never>((_, reject) => {
        s.once("error", reject);
        s.once("close", () => reject(new Error("connection closed by the server")));
      });
      // the server closes after QUIT: that rejection is expected and must not go unhandled
      failed.catch(() => {});
      await Promise.race([new Promise<void>((r) => s.once("secureConnect", () => r())), failed]);
      const next = replies(s);
      const expect = async (codes: number[], what: string) => {
        const r = await Promise.race([next(), failed]);
        if (!codes.includes(r.code)) throw new Error(`${what}: ${r.text.slice(0, 300)}`);
        return r;
      };
      const send = (line: string) => s.write(`${line}\r\n`);

      await expect([220], "greeting");
      send(`EHLO ${addressOf(msg.from).split("@")[1] ?? "localhost"}`);
      await expect([250], "EHLO");
      send(`AUTH PLAIN ${b64(`\0${cfg.user}\0${cfg.pass}`)}`);
      await expect([235], "login refused");
      send(`MAIL FROM:<${addressOf(msg.from)}>`);
      await expect([250], "sender refused");
      send(`RCPT TO:<${addressOf(msg.to)}>`);
      await expect([250, 251], "recipient refused");
      send("DATA");
      await expect([354], "DATA");
      s.write(`${buildMessage(msg)}\r\n.\r\n`);
      await expect([250], "message refused");
      send("QUIT");
    };
    await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer.id = setTimeout(() => reject(new Error(`no answer from ${cfg.host} in ${TIMEOUT_MS / 1000} s`)), TIMEOUT_MS);
      }),
    ]);
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: `SMTP ${cfg.host}: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    clearTimeout(timer.id);
    (socket as TLSSocket | null)?.destroy();
  }
}
