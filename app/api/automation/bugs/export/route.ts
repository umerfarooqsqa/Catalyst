import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform, resolveProject, resolveRelease } from "@/lib/automation-release";
import type { Database } from "@/lib/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Severity = Database["public"]["Enums"]["bug_severity"];
const SEVERITIES: Severity[] = ["critical", "major", "minor", "trivial"];
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);

/**
 * "Export to catalyst" from the aktrade dashboard: a tester picks a failed test
 * (Test Results / Control Center) or a Development Portal finding, chooses the
 * house, version and severity, and it is filed as a bug in THAT house's project.
 * It works like the Bug Library's "Copy to project…", except that the bug comes
 * from automation and can carry its screenshot.
 *
 * GET  ?house=&platform=: the house's project, its versions (newest first) and
 *      the severities, for the export form.
 * POST {house, platform, version?, title, description?, steps?, severity, key?,
 *       force?, screenshot_b64?, screenshot_type?, screenshot_name?}
 *      - Creates the bug (source 'automation', open) under that version's release.
 *        With no version given, the project's current version is used.
 *      - With `key` (the test node id, or finding:<run>:<n>), a bug already
 *        exported with that key in this project is returned instead of a
 *        duplicate ({status:"exists"}) unless force=true.
 *      - The screenshot becomes an attachment of the bug.
 *
 * Only an existing release can be chosen. The one exception is the project's
 * current version, whose release is created on first use: a typo must not
 * create a new version.
 */
export async function GET(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;
  const url = new URL(req.url);
  const house = url.searchParams.get("house") ?? "";
  const platform = parsePlatform(url.searchParams.get("platform") ?? "android");
  if (!platform) return badPlatform();
  if (!house) return NextResponse.json({ error: "house is required" }, { status: 400 });

  const found = await resolveProject(house, platform);
  if (!found.project) return NextResponse.json({ error: found.error }, { status: found.status });
  const { project } = found;
  const { data: releases, error } = await serviceRoleClient()
    .from("releases")
    .select("version, started_at")
    .eq("project_id", project.id)
    .order("started_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const versions = (releases ?? []).map((r) => String(r.version));
  if (project.current_version && !versions.includes(project.current_version)) versions.unshift(project.current_version);
  return NextResponse.json({
    project: { id: project.id, name: project.name, current_version: project.current_version },
    versions,
    severities: SEVERITIES,
  });
}

export async function POST(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;
  const body = await req.json().catch(() => null);
  const house = String(body?.house ?? "").trim();
  const title = String(body?.title ?? "").trim();
  if (!house || !title) return NextResponse.json({ error: "house and title are required" }, { status: 400 });
  const platform = parsePlatform(body?.platform ?? "android");
  if (!platform) return badPlatform();
  const severity = String(body?.severity ?? "minor") as Severity;
  if (!SEVERITIES.includes(severity)) {
    return NextResponse.json({ error: `severity must be one of: ${SEVERITIES.join(", ")}` }, { status: 400 });
  }

  const found = await resolveProject(house, platform);
  if (!found.project) return NextResponse.json({ error: found.error }, { status: found.status });
  const version = String(body?.version ?? "").trim() || found.project.current_version || "";
  if (!version) {
    return NextResponse.json({ error: `Project '${found.project.name}' has no current version: choose one` }, { status: 400 });
  }
  const resolved = await resolveRelease(house, version, platform, version === found.project.current_version);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { project, release } = resolved;

  const supabase = serviceRoleClient();
  const key = body?.key ? String(body.key).slice(0, 500) : null;
  if (key && !body?.force) {
    const { data: existing, error } = await supabase
      .from("bugs")
      .select("id, title, status")
      .eq("project_id", project.id)
      .eq("automation_key", key)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (existing) {
      return NextResponse.json({ status: "exists", project_id: project.id, bug: existing, version });
    }
  }

  let screenshot: File | null = null;
  if (body?.screenshot_b64) {
    const type = String(body.screenshot_type ?? "image/png");
    if (!IMAGE_TYPES.has(type)) return NextResponse.json({ error: "screenshot must be PNG or JPEG" }, { status: 400 });
    const bin = Uint8Array.from(atob(String(body.screenshot_b64)), (c) => c.charCodeAt(0));
    if (bin.byteLength > MAX_SCREENSHOT_BYTES) return NextResponse.json({ error: "screenshot is larger than 8 MB" }, { status: 400 });
    const name = String(body.screenshot_name ?? "screenshot").replace(/[^\w.-]/g, "_").slice(0, 80);
    screenshot = new File([bin], name.match(/\.(png|jpe?g)$/i) ? name : `${name}.${type === "image/png" ? "png" : "jpg"}`, { type });
  }

  const { data: bug, error: insErr } = await supabase
    .from("bugs")
    .insert({
      project_id: project.id,
      title: title.slice(0, 300),
      description: String(body?.description ?? "").slice(0, 8000) || null,
      steps_to_reproduce: String(body?.steps ?? "").slice(0, 8000) || null,
      severity,
      source: "automation",
      // A forced re-export must not collide with the first bug's key.
      automation_key: key && body?.force ? `${key}#${Date.now()}` : key,
      release_id: release.id,
    })
    .select("id, title, status")
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  let attachError: string | null = null;
  if (screenshot) {
    const path = `${bug.id}/${Date.now()}-${screenshot.name}`;
    const { error: upErr } = await supabase.storage.from("attachments").upload(path, screenshot);
    if (upErr) attachError = upErr.message;
    else {
      const { error } = await supabase.from("attachments").insert({
        bug_id: bug.id,
        file_path: path,
        file_name: screenshot.name,
        file_size_bytes: screenshot.size,
        uploaded_by: null, // filed by automation, not a signed-in user
      });
      if (error) attachError = error.message;
    }
  }

  return NextResponse.json({ status: "created", project_id: project.id, bug, version, attach_error: attachError });
}
