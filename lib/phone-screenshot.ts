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
  "Can't reach the aktrade Control Center on this PC. It starts by itself when you log in to Windows " +
  "(task \"Aktrade Control Center\"); if it was closed, start it again (python web_dashboard.py in the " +
  "aktrade folder), then try again.";
const BLOCKED =
  "Chrome is blocking this site from reaching the Control Center on this PC. Click the icon at the left " +
  "of the address bar → Site settings → Local network access → Allow, reload, and try again.";

/**
 * Why the Control Center can't be reached: Chrome's Local Network Access permission (an https page
 * calling localhost) when it is denied, else the Control Center isn't running.
 */
export async function unreachableReason(): Promise<string> {
  for (const name of ["local-network-access", "loopback-network", "local-network"]) {
    try {
      const st = await navigator.permissions.query({ name } as unknown as PermissionDescriptor);
      if (st.state === "denied") return BLOCKED;
      break;
    } catch {
      // this browser doesn't know that permission name: try the next one
    }
  }
  return NOT_RUNNING;
}

async function helper(path: string): Promise<Response> {
  try {
    return await fetch(`${PHONE_HELPER_URL}${path}`, { cache: "no-store" });
  } catch {
    throw new Error(await unreachableReason());
  }
}

async function errorOf(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.error ?? `The Control Center answered ${res.status}.`;
}

/** The phones ready for a screenshot. None ready: throws the Control Center's reason (e.g. "tap Allow"). */
export async function listPhones(): Promise<Phone[]> {
  const res = await helper("/adb/devices");
  if (!res.ok) throw new Error(await errorOf(res));
  const body = (await res.json()) as { devices?: Phone[]; reason?: string };
  const phones = body.devices ?? [];
  if (!phones.length) {
    throw new Error(body.reason ?? "No phone connected: plug it in over USB, unlock it, and allow USB debugging.");
  }
  return phones;
}

/** The phone's current screen as a PNG file named after the bug and time. */
export async function capturePhone(serial: string, bugId: string): Promise<File> {
  const res = await helper(`/adb/screenshot?serial=${encodeURIComponent(serial)}`);
  if (!res.ok) throw new Error(await errorOf(res));
  const blob = await res.blob();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return new File([blob], `phone-screenshot-${bugId.slice(0, 8)}-${stamp}.png`, { type: "image/png" });
}
