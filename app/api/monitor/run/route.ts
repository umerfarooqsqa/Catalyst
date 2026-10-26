import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { runMonitor } from "@/lib/monitor/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The cloud app monitor's worker (migration 0056). pg_cron pings it every 5 minutes, and at
 * once when a version, package or target SDK changes (app_monitor_kick, header
 * x-monitor-secret). The secret lives only in the database (private.settings monitor_secret),
 * so it is checked there. Runs one due check per ping (Cloudflare's per-run request limit).
 */
export async function POST(req: Request) {
  const given = req.headers.get("x-monitor-secret") ?? "";
  const supabase = serviceRoleClient();
  const { data: expected } = await supabase.rpc("monitor_setting", { p_key: "monitor_secret" });
  const a = Buffer.from(given);
  const b = Buffer.from(String(expected ?? ""));
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runMonitor());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
