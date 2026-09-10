import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canManageRequirements } from "@/lib/permissions";
import { extractDocumentText } from "@/lib/extract-text";
import { extractRequirements } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { userId, level } = await requireProfile();
  if (!canManageRequirements(level)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const supabase = await createClient();

  const { data: doc, error: docErr } = await supabase
    .from("requirement_documents")
    .select("*")
    .eq("id", id)
    .single();
  if (docErr || !doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  if (doc.status === "processing") {
    return NextResponse.json({ error: "Already processing" }, { status: 409 });
  }
  if (doc.status === "completed") {
    return NextResponse.json(
      { status: "completed", extracted: doc.requirements_extracted },
      { status: 200 },
    );
  }

  // Claim the document; bail if another request already claimed it.
  const { data: claimed } = await supabase
    .from("requirement_documents")
    .update({ status: "processing", error_message: null })
    .eq("id", id)
    .eq("status", doc.status)
    .select("id");
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: "Already processing" }, { status: 409 });
  }

  const fail = async (message: string) => {
    // Never clobber a status another request may have moved to completed.
    await supabase
      .from("requirement_documents")
      .update({ status: "failed", error_message: message.slice(0, 800) })
      .eq("id", id)
      .eq("status", "processing");
    return NextResponse.json({ status: "failed", error: message }, { status: 502 });
  };

  try {
    const { data: blob, error: dlErr } = await supabase.storage
      .from("requirement-documents")
      .download(doc.file_path);
    if (dlErr || !blob) throw new Error(`Could not read the uploaded file: ${dlErr?.message ?? "missing"}`);

    const buffer = Buffer.from(await blob.arrayBuffer());
    const text = await extractDocumentText(buffer, doc.file_name);

    const { data: categories } = await supabase
      .from("bug_categories")
      .select("id, name, keyword_hints, default_severity");

    const extracted = await extractRequirements(text, categories ?? []);
    if (extracted.length === 0) {
      return await fail("No requirements could be extracted from this document");
    }

    const rows = extracted.map((r) => ({
      source_type: "client_requirement" as const,
      project_id: doc.project_id,
      requirement_document_id: doc.id,
      title: r.title,
      description: r.description,
      category_id: r.category_id,
      severity: r.severity,
      created_by: userId,
    }));

    const { error: insErr } = await supabase.from("base_page").insert(rows);
    if (insErr) throw new Error(`Saving extracted requirements failed: ${insErr.message}`);

    await supabase
      .from("requirement_documents")
      .update({
        status: "completed",
        error_message: null,
        requirements_extracted: rows.length,
      })
      .eq("id", id);

    return NextResponse.json({ status: "completed", extracted: rows.length });
  } catch (e) {
    return await fail(e instanceof Error ? e.message : "Extraction failed");
  }
}
