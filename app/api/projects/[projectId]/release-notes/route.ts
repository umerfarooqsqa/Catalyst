import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { isManager } from "@/lib/permissions";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { normalizeVersion, notesText, saveReleaseNotes } from "@/lib/release-notes";
import { parseVersionFromReleaseNotes } from "@/lib/parse-version";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Adds release notes for one app version from the project's settings page
 * (VersionGateCard). multipart/form-data: `file` (PDF/DOCX/TXT/MD) or `text`,
 * plus `version`, which is taken from the notes if omitted.
 *
 * Session auth, manager or admin. The write itself uses the service role,
 * because releases are server-written only (see lib/release-notes.ts). Testing
 * for a version starts only once its notes are here.
 */
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { level } = await requireProfile();
  if (!isManager(level)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const { projectId } = await params;

  const supabase = serviceRoleClient();
  const { data: project, error: pErr } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "Unknown project" }, { status: 404 });

  let text = "";
  let file: Buffer | null = null;
  let fileName: string | null = null;
  let version = "";
  try {
    const form = await req.formData();
    const f = form.get("file");
    version = String(form.get("version") || "");
    if (f instanceof File && f.size) {
      if (f.size > 10 * 1024 * 1024) return NextResponse.json({ error: "The file is larger than 10 MB" }, { status: 413 });
      file = Buffer.from(await f.arrayBuffer());
      fileName = f.name;
      text = await notesText(file, f.name);
    } else {
      text = String(form.get("text") || "");
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read the release notes" }, { status: 400 });
  }
  if (!text.trim()) return NextResponse.json({ error: "The release notes are empty" }, { status: 400 });

  const v = normalizeVersion(version || parseVersionFromReleaseNotes(text) || "");
  if (!v) return NextResponse.json({ error: "No app version found in the notes: enter it (e.g. 1.0.7)" }, { status: 400 });
  try {
    return NextResponse.json(await saveReleaseNotes(supabase, project, { version: v, text, fileName, file }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
