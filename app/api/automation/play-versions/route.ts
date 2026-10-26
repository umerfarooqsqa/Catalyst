import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform, resolveProject } from "@/lib/automation-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The runner's daily Google Play snapshot (aktrade utils/play_snapshot.py): each Android
 * app's live release and the production release on its way, stored per project
 * (migration 0055). The admin My Queue compares them with the project's current version
 * on every load (lib/play-version.ts). Idempotent per project (upsert).
 *
 * POST { platform: "android", snapshot_date, apps: [{ house, package, play_key, reachable,
 *        error, live_version, live_code, upcoming_version, upcoming_code, upcoming_track,
 *        upcoming_status, upcoming_fraction, checked_at }] }
 */
export async function POST(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;

  const body = await req.json().catch(() => null);
  const platform = parsePlatform(body?.platform);
  if (!platform) return badPlatform();
  if (platform !== "android") {
    return NextResponse.json({ error: "Google Play versions are for Android projects only" }, { status: 400 });
  }
  const apps = Array.isArray(body?.apps) ? body.apps : null;
  if (!apps) return NextResponse.json({ error: "apps must be an array" }, { status: 400 });

  const supabase = serviceRoleClient();
  const synced: string[] = [];
  const skipped: { house: string; reason: string }[] = [];
  const text = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
  const int = (v: unknown) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.trunc(Number(v)) : null);
  const snapshotDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.snapshot_date ?? "")) ? String(body.snapshot_date) : null;

  for (const a of apps) {
    const house = String(a?.house ?? "");
    const pkg = text(a?.package);
    if (!house || !pkg) {
      skipped.push({ house, reason: "house and package are required" });
      continue;
    }
    const found = await resolveProject(house, "android");
    if (!found.project) {
      skipped.push({ house, reason: found.error });
      continue;
    }
    const fraction = Number(a?.upcoming_fraction);
    const checkedAt = text(a?.checked_at);
    const { error } = await supabase.from("play_versions").upsert(
      {
        project_id: found.project.id,
        package: pkg,
        play_key: text(a?.play_key),
        reachable: a?.reachable !== false,
        error: text(a?.error),
        live_version: text(a?.live_version),
        live_code: int(a?.live_code),
        upcoming_version: text(a?.upcoming_version),
        upcoming_code: int(a?.upcoming_code),
        upcoming_track: text(a?.upcoming_track),
        upcoming_status: text(a?.upcoming_status),
        upcoming_fraction: a?.upcoming_fraction != null && Number.isFinite(fraction) ? fraction : null,
        snapshot_date: snapshotDate,
        checked_at: checkedAt && !Number.isNaN(Date.parse(checkedAt)) ? checkedAt : new Date().toISOString(),
      },
      { onConflict: "project_id" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    synced.push(house);
  }
  return NextResponse.json({ platform, synced, skipped });
}
