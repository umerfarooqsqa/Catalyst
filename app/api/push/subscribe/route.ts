import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serviceRoleClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Saves this device's push subscription for whoever is signed in (fix 2026-10-27).
 *  - Signed in: the endpoint is stored for this user, moving it from anyone who had it before
 *    (a shared browser after switching accounts; RLS refused that update before, so the second
 *    person silently got no pushes).
 *  - Not signed in, from the service worker's `pushsubscriptionchange`: the row holding
 *    `old_endpoint` gets the new endpoint and keys (the browser rotated them while no page was
 *    open; before, the subscription just died). Knowing a live old endpoint is the proof.
 * GET ?endpoint= says whether this user has the endpoint saved (the toggle shows "on" only then).
 */
type Body = { endpoint?: string; p256dh?: string; auth?: string; user_agent?: string; old_endpoint?: string };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.endpoint || !body.p256dh || !body.auth || !/^https:\/\//.test(body.endpoint)) {
    return NextResponse.json({ error: "missing subscription" }, { status: 400 });
  }
  const admin = serviceRoleClient();
  const row = {
    endpoint: body.endpoint,
    p256dh: body.p256dh,
    auth: body.auth,
    user_agent: (body.user_agent ?? req.headers.get("user-agent") ?? "").slice(0, 400),
  };
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (user) {
    if (body.old_endpoint && body.old_endpoint !== body.endpoint) {
      await admin.from("push_subscriptions").delete().eq("endpoint", body.old_endpoint).eq("user_id", user.id);
    }
    const { error } = await admin.from("push_subscriptions").upsert({ ...row, user_id: user.id }, { onConflict: "endpoint" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, user: true });
  }
  if (!body.old_endpoint) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: old } = await admin.from("push_subscriptions").select("user_id").eq("endpoint", body.old_endpoint).maybeSingle();
  if (!old) return NextResponse.json({ error: "unknown subscription" }, { status: 404 });
  await admin.from("push_subscriptions").delete().eq("endpoint", body.old_endpoint);
  const { error } = await admin.from("push_subscriptions").upsert({ ...row, user_id: old.user_id }, { onConflict: "endpoint" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, renewed: true });
}

/** Forgets an endpoint (turning push off, or signing out). Knowing the live endpoint is the proof. */
export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => null)) as { endpoint?: string } | null;
  if (!body?.endpoint) return NextResponse.json({ error: "missing endpoint" }, { status: 400 });
  await serviceRoleClient().from("push_subscriptions").delete().eq("endpoint", body.endpoint);
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !endpoint) return NextResponse.json({ mine: false });
  const { data } = await supabase.from("push_subscriptions").select("id").eq("endpoint", endpoint).eq("user_id", user.id).maybeSingle();
  return NextResponse.json({ mine: !!data });
}
