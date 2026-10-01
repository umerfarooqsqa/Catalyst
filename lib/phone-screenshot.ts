/**
 * "Take phone screenshot" on a bug. The portal runs in the cloud and can't
 * reach a USB phone, so the browser asks the aktrade Control Center running
 * on the tester's own PC (`python web_dashboard.py`). That runs
 * `adb exec-out screencap -p` and hands back the PNG, which the drawer then
 * uploads to the bug like any other attachment.
 *
 * The helper only answers this portal's origin, and only from its own
 * machine. See aktrade `utils/phone_screenshot.py`. The URL must also be
 * listed in next.config.ts's CSP `connect-src`.
 */
export const PHONE_HELPER_URL = (process.env.NEXT_PUBLIC_PHONE_HELPER_URL || "http://localhost:217").replace(/\/$/, "");

export type Phone = { serial: string; model: string };

const NOT_RUNNING =
  "Can't reach the aktrade Control Center on this PC. Start it (python web_dashboard.py), " +
  "connect the phone over USB with USB debugging on, then try again.";

async function helper(path: string): Promise<Response> {
  try {
    return await fetch(`${PHONE_HELPER_URL}${path}`, { cache: "no-store" });
  } catch {
    throw new Error(NOT_RUNNING);
  }
}

async function errorOf(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.error ?? `The Control Center answered ${res.status}.`;
}

export async function listPhones(): Promise<Phone[]> {
  const res = await helper("/adb/devices");
  if (!res.ok) throw new Error(await errorOf(res));
  return ((await res.json()).devices ?? []) as Phone[];
}

/** The phone's current screen as a PNG file named after the bug and time. */
export async function capturePhone(serial: string, bugId: string): Promise<File> {
  const res = await helper(`/adb/screenshot?serial=${encodeURIComponent(serial)}`);
  if (!res.ok) throw new Error(await errorOf(res));
  const blob = await res.blob();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return new File([blob], `phone-screenshot-${bugId.slice(0, 8)}-${stamp}.png`, { type: "image/png" });
}
