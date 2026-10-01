import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { isManager } from "@/lib/permissions";
import { extractDocumentText } from "@/lib/extract-text";
import { parseVersionFromReleaseNotes } from "@/lib/parse-version";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * REQ-2: parses a release-notes upload (PDF/DOCX/TXT/MD) or a pasted text
 * block and returns the version it identifies, for the project settings
 * page to pre-fill -- the tester can still edit/override it manually
 * before saving. Nothing is persisted here; this is a stateless parse.
 *
 * Pattern-matching, not an LLM call -- see lib/parse-version.ts for why.
 *
 * Regular user-session auth (not the shared-secret automation auth) --
 * called from the browser by whoever is editing the project's settings.
 */
export async function POST(req: Request) {
  const { level } = await requireProfile();
  if (!isManager(level)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let text: string;
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      text = await extractDocumentText(buffer, file.name);
    } else {
      const { text: pasted } = await req.json();
      text = String(pasted || "");
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not read the release notes" },
      { status: 400 },
    );
  }

  if (!text.trim()) {
    return NextResponse.json({ error: "No text found to parse" }, { status: 400 });
  }

  const version = parseVersionFromReleaseNotes(text);
  return NextResponse.json({ version });
}
