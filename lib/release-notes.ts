import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimedBugs, crossCheck, extractClaims, type ClaimedBug, type Discrepancy } from "@/lib/release-cross-check";
// The version is read from the notes by lib/parse-version.ts (parseVersionFromReleaseNotes), shared with the settings page.

/**
 * Release notes for one app version: adding them is what opens a release for
 * testing. The runner refuses to start a run until the project's current
 * version has notes AND the phone's installed app reports that version (see
 * aktrade utils/release_notes.py::start_gate).
 *
 * Storage (no extra columns needed):
 * - The notes document (the uploaded file, or pasted text as a .txt) goes to
 *   the private `attachments` bucket under `release-notes/<project>/<version>/...`.
 * - Its path is stored as the release's `release_notes_ref`, the "pointer to
 *   the release notes document" that column was designed for. The project's
 *   `release_notes_ref` and `current_version` follow the newest notes.
 * - Adding notes also runs the REQ-6 cross-check, filling the release's
 *   `discrepancies` and `claimed_bugs` (the REQ-14 gate).
 */

const VERSION_OK = /^v?\d+(?:\.\d+){1,3}$/;

export function normalizeVersion(v: string): string | null {
  const s = v.trim();
  return VERSION_OK.test(s) ? s.replace(/^v/i, "") : null;
}

export type SavedNotes = {
  version: string;
  release_id: string;
  path: string;
  claims: number;
  discrepancies: Discrepancy[];
  claimed_bugs: ClaimedBug[];
};

/**
 * Stores the notes for `version` of `project` (creating that release if needed),
 * makes it the project's current version, and cross-checks the notes against the
 * project's bugs. `supabase` must be a service-role client (releases are written
 * only by the server).
 */
export async function saveReleaseNotes(
  supabase: SupabaseClient,
  project: { id: string },
  opts: { version: string; text: string; fileName?: string | null; file?: Buffer | null },
): Promise<SavedNotes> {
  const version = normalizeVersion(opts.version);
  if (!version) throw new Error(`'${opts.version}' is not an app version (expected e.g. 1.0.7)`);
  const text = opts.text.trim();
  if (!text) throw new Error("The release notes are empty");

  // Store the document first: a failed upload must not leave an empty release behind.
  const safeName = (opts.fileName || "release-notes.txt").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
  const path = `release-notes/${project.id}/${version}/${Date.now()}-${safeName}`;
  const ext = safeName.toLowerCase().split(".").pop() ?? "";
  const contentType = opts.file
    ? ({
        pdf: "application/pdf",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        md: "text/markdown; charset=utf-8",
      } as Record<string, string>)[ext] ?? "text/plain; charset=utf-8"
    : "text/plain; charset=utf-8";
  const { error: upErr } = await supabase.storage
    .from("attachments")
    .upload(path, opts.file ?? Buffer.from(text, "utf8"), { contentType, upsert: false });
  if (upErr) throw new Error(`Could not store the notes: ${upErr.message}`);

  const { data: found, error: findErr } = await supabase
    .from("releases")
    .select("id")
    .eq("project_id", project.id)
    .eq("version", version)
    .maybeSingle();
  if (findErr) throw new Error(findErr.message);
  let releaseId = found?.id as string | undefined;
  if (!releaseId) {
    const { data, error } = await supabase
      .from("releases")
      .insert({ project_id: project.id, version })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    releaseId = data.id as string;
  }

  const { data: bugs, error: bugsErr } = await supabase
    .from("bugs")
    .select("id, title, status")
    .eq("project_id", project.id);
  if (bugsErr) throw new Error(bugsErr.message);
  const claims = extractClaims(text);
  const discrepancies = claims.length ? crossCheck(claims, bugs ?? []) : [];
  const claimed = claims.length ? claimedBugs(claims, bugs ?? []) : [];

  const { error: relErr } = await supabase
    .from("releases")
    .update({ release_notes_ref: path, discrepancies, claimed_bugs: claimed })
    .eq("id", releaseId);
  if (relErr) throw new Error(relErr.message);
  const { error: projErr } = await supabase
    .from("projects")
    .update({ current_version: version, release_notes_ref: path })
    .eq("id", project.id);
  if (projErr) throw new Error(projErr.message);

  return { version, release_id: releaseId, path, claims: claims.length, discrepancies, claimed_bugs: claimed };
}

/** Extracts text from an uploaded notes file (PDF/DOCX/TXT/MD). */
export async function notesText(file: Buffer, fileName: string): Promise<string> {
  const { extractDocumentText } = await import("@/lib/extract-text");
  return (await extractDocumentText(file, fileName)).trim();
}
