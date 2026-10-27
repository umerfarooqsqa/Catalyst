import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { serviceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * "Send test": files a real notification for the signed-in user, so the push travels the same
 * way every notification does (notifications row → trg_notifications_push → pg_net →
 * /api/push/dispatch → the device). Before (fixed 2026-10-27) it pushed directly, so the test
 * arrived even while the real path was switched off.
 */
export async function POST() {
  const { userId } = await requireProfile();
  const admin = serviceRoleClient();

  const { data: url } = await admin.rpc("monitor_setting", { p_key: "push_dispatch_url" });
  if (!url) {
    return NextResponse.json(
      { error: "Push isn't switched on on the server (push_dispatch_url is not set)." },
      { status: 503 },
    );
  }
  const { count } = await admin
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (!count) {
    return NextResponse.json({ error: "No device of yours gets pushes yet. Turn push on first." }, { status: 409 });
  }
  const { error } = await admin.from("notifications").insert({
    user_id: userId,
    type: "status_change",
    message: "Test notification: push works on your devices.",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    ok: true,
    message: `Test sent the real way to ${count} device${count === 1 ? "" : "s"}: it should arrive within a few seconds.`,
  });
}
