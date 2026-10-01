import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push-server";

export const runtime = "nodejs";

/** Send the signed-in user a test push — used by the "Send test" button. */
export async function POST() {
  const { userId } = await requireProfile();
  const admin = serviceRoleClient();

  const result = await sendPushToUser(admin, userId, {
    title: "Catalyst",
    body: "🔔 Test notification — push is working on this device.",
    url: "/notifications",
    tag: "catalyst-test",
    vibrate: [180, 80, 180],
  });

  if (result.skipped === "not_configured") {
    return NextResponse.json(
      { error: "Push isn't configured on the server (missing VAPID keys)." },
      { status: 503 },
    );
  }
  if (result.sent === 0) {
    return NextResponse.json(
      { error: "No push subscription found for this device. Turn push on first." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, ...result });
}
