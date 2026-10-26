import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform, resolveProject } from "@/lib/automation-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only, for the aktrade runner's start gate: the house's open app warnings (migration
 * 0056, checked in the cloud) and Play's live/upcoming release facts (play_versions).
 * GET ?house=<slug>&platform=android
 */
export async function GET(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;
  const url = new URL(req.url);
  const platform = parsePlatform(url.searchParams.get("platform"));
  if (!platform) return badPlatform();
  const house = url.searchParams.get("house") ?? "";
  if (!house) return NextResponse.json({ error: "house is required" }, { status: 400 });
  const found = await resolveProject(house, platform);
  if (!found.project) return NextResponse.json({ error: found.error }, { status: found.status });
  const supabase = serviceRoleClient();
  const [{ data: warnings }, { data: play }] = await Promise.all([
    supabase
      .from("app_warnings")
      .select("id, source, kind, severity, title, detail, active, first_seen_at, last_seen_at")
      .eq("project_id", found.project.id)
      .eq("status", "open")
      .order("last_seen_at", { ascending: false }),
    supabase
      .from("play_versions")
      .select("live_version, live_code, upcoming_version, upcoming_code, upcoming_status, checked_at")
      .eq("project_id", found.project.id)
      .maybeSingle(),
  ]);
  return NextResponse.json({ house, project: found.project.name, warnings: warnings ?? [], play: play ?? null });
}
