import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform, resolveProject } from "@/lib/automation-release";
import { normalizeVersion, notesText, saveReleaseNotes } from "@/lib/release-notes";
import { parseVersionFromReleaseNotes } from "@/lib/parse-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE = 10 * 1024 * 1024;

/**
 * Release notes from the aktrade Development Portal ("📄 Release notes").
 * Body: { house, platform, text?, file_name?, file_b64?, version?, preview? }
 *
 * - `preview: true`: extracts the text and the version it states, and saves
 *   nothing. The portal shows the version for the tester to confirm or correct.
 * - Otherwise: stores the notes on that version's release (created if needed),
 *   makes it the project's current version, and cross-checks the notes against
 *   the project's bugs. See lib/release-notes.ts.
 */
export async function POST(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;

  const body = await req.json().catch(() => null);
  const house = String(body?.house ?? "");
  if (!house) return NextResponse.json({ error: "house is required" }, { status: 400 });
  const platform = parsePlatform(body?.platform);
  if (!platform) return badPlatform();
  const found = await resolveProject(house, platform);
  if (!found.project) return NextResponse.json({ error: found.error }, { status: found.status });

  let file: Buffer | null = null;
  let text = typeof body?.text === "string" ? body.text : "";
  const fileName = body?.file_name ? String(body.file_name) : null;
  if (body?.file_b64) {
    file = Buffer.from(String(body.file_b64), "base64");
    if (file.length > MAX_FILE) return NextResponse.json({ error: "The file is larger than 10 MB" }, { status: 413 });
    try {
      text = await notesText(file, fileName || "notes.txt");
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
  }
  if (!text.trim()) return NextResponse.json({ error: "The release notes are empty" }, { status: 400 });

  const guessed = parseVersionFromReleaseNotes(text);
  if (body?.preview) {
    return NextResponse.json({
      version: guessed,
      text: text.slice(0, 20000),
      current_version: found.project.current_version,
    });
  }

  const version = normalizeVersion(String(body?.version || guessed || ""));
  if (!version) {
    return NextResponse.json(
      { error: "No app version found in the notes: enter it (e.g. 1.0.7)" },
      { status: 400 },
    );
  }
  try {
    const saved = await saveReleaseNotes(serviceRoleClient(), found.project, { version, text, fileName, file });
    return NextResponse.json(saved);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
