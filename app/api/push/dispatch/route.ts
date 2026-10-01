import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { sendPushToUser, type PushPayload } from "@/lib/push-server";

export const runtime = "nodejs";

/**
 * Called by the Supabase `trg_notifications_push` webhook after a row is
 * inserted into `public.notifications`. Authenticated by a shared secret
 * (`X-Push-Secret` must equal `PUSH_DISPATCH_SECRET`). Delivers the Web
 * Push to the recipient's devices.
 */
type Body = {
  notification_id?: string;
  user_id?: string;
  type?: string;
  message?: string;
  related_bug_id?: string | null;
  related_task_id?: string | null;
};

function secretOk(header: string | null): boolean {
  const expected = process.env.PUSH_DISPATCH_SECRET ?? "";
  if (!expected || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!secretOk(req.headers.get("x-push-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const { user_id, message, related_bug_id, related_task_id } = body;
  if (!user_id || !message) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const admin = serviceRoleClient();

  // Resolve a deep link. Notifications don't carry project_id, so look it up.
  let url = "/notifications";
  if (related_bug_id) {
    const { data } = await admin
      .from("bugs")
      .select("project_id")
      .eq("id", related_bug_id)
      .single();
    url = data?.project_id
      ? `/projects/${data.project_id}/bugs?focus=${related_bug_id}`
      : "/notifications";
  } else if (related_task_id) {
    const { data } = await admin
      .from("tasks")
      .select("project_id")
      .eq("id", related_task_id)
      .single();
    url = data?.project_id
      ? `/projects/${data.project_id}/tasks?focus=${related_task_id}`
      : "/notifications";
  }

  const payload: PushPayload = {
    title: "Catalyst",
    body: message,
    url,
    tag: related_bug_id ?? related_task_id ?? body.notification_id ?? undefined,
    vibrate: [180, 80, 180],
  };

  const result = await sendPushToUser(admin, user_id, payload);
  return NextResponse.json({ ok: true, ...result });
}
