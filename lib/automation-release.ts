import "server-only";
import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";

/**
 * Shared plumbing for the /api/automation/* ingestion routes (Phase 6):
 * shared-secret auth, and "find the house's project + the release row for
 * this version, creating the release if this is the first thing posted for
 * it". Service-role only -- these routes have no user session.
 */
export function checkAutomationSecret(req: Request): NextResponse | null {
  const expected = process.env.AUTOMATION_INGEST_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "AUTOMATION_INGEST_SECRET is not configured on this deployment" },
      { status: 503 },
    );
  }
  if (req.headers.get("x-automation-secret") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export type Platform = "android" | "ios";

/**
 * Automation targets a (house, platform) pair: Android runs on the Windows
 * runner, iOS on the Mac runner. A missing value means "android" so the
 * existing Windows setup keeps working unchanged. Returns null if invalid.
 */
export function parsePlatform(value: unknown): Platform | null {
  if (value === undefined || value === null || value === "") return "android";
  const v = String(value).toLowerCase();
  return v === "android" || v === "ios" ? v : null;
}

export function badPlatform() {
  return NextResponse.json({ error: "platform must be 'android' or 'ios'" }, { status: 400 });
}

/**
 * The one rule for "which catalyst project is this house on this platform":
 * the Android project carries house_slug; its iOS sibling carries the same
 * value in house_group with platform = 'ios' (house_slug stays null there).
 */
export async function resolveProject(house: string, platform: Platform) {
  const supabase = serviceRoleClient();
  const base = supabase
    .from("projects")
    .select("id, name, house_slug, house_group, platform, current_version, release_notes_ref, notify_emails");
  const { data: project, error } =
    platform === "android"
      ? await base.eq("house_slug", house).maybeSingle()
      : await base.eq("house_group", house).eq("platform", "ios").maybeSingle();
  if (error) throw new Error(error.message);
  if (!project) {
    return {
      error: `No catalyst ${platform} project is mapped to house '${house}'`,
      status: 404 as const,
    };
  }
  return { project };
}

export async function resolveRelease(house: string, version: string, platform: Platform = "android", create = true) {
  const supabase = serviceRoleClient();
  const found = await resolveProject(house, platform);
  if (!found.project) return { error: found.error, status: found.status };
  const project = found.project;

  const { data: existing, error: relErr } = await supabase
    .from("releases")
    .select("*")
    .eq("project_id", project.id)
    .eq("version", version)
    .maybeSingle();
  if (relErr) throw new Error(relErr.message);
  if (existing) return { project, release: existing };
  if (!create) return { error: `No release '${version}' exists yet for '${house}' (${platform})`, status: 404 as const };

  const { data: created, error: insErr } = await supabase
    .from("releases")
    .insert({
      project_id: project.id,
      version,
      release_notes_ref: project.release_notes_ref,
      notify_emails: project.notify_emails,
    })
    .select("*")
    .single();
  if (insErr) throw new Error(insErr.message);
  return { project, release: created };
}
