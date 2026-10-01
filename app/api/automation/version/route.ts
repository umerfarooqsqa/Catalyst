import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform, resolveProject } from "@/lib/automation-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * REQ-2 version-gate source of truth: given a house slug, returns the
 * release-notes-stated version the app under test is expected to be on
 * right now. aktrade/akdapiautomation call this before running the suite
 * and abort the whole run if the app's actual version doesn't match.
 *
 * Also says whether that version has release notes (`has_release_notes`):
 * the runner refuses to start testing without them (aktrade
 * utils/release_notes.py::start_gate).
 *
 * Auth: shared-secret header (`x-automation-secret`).
 */
export async function GET(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;

  const url = new URL(req.url);
  const house = url.searchParams.get("house");
  if (!house) {
    return NextResponse.json({ error: "Provide 'house' as a query parameter" }, { status: 400 });
  }

  const platform = parsePlatform(url.searchParams.get("platform"));
  if (!platform) return badPlatform();

  const found = await resolveProject(house, platform);
  if (!found.project) return NextResponse.json({ error: found.error }, { status: found.status });
  const project = found.project;
  if (!project.current_version) {
    return NextResponse.json(
      { error: `No current_version set for '${house}' (${platform}) -- set it in the project's settings page` },
      { status: 404 },
    );
  }

  const { data: release } = await serviceRoleClient()
    .from("releases")
    .select("id, release_notes_ref, status")
    .eq("project_id", project.id)
    .eq("version", project.current_version)
    .maybeSingle();

  return NextResponse.json({
    house_slug: house,
    platform,
    project: project.name,
    expected_version: project.current_version,
    release_notes_ref: release?.release_notes_ref ?? null,
    has_release_notes: !!release?.release_notes_ref,
    release_status: release?.status ?? null,
  });
}
