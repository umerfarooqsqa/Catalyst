import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform, resolveProject } from "@/lib/automation-release";
import type { Database } from "@/lib/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Severity = Database["public"]["Enums"]["bug_severity"];
const SEVERITIES: Severity[] = ["critical", "major", "minor", "trivial"];
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Client requirements documents. A local Claude Code session splits the document into
 * atomic requirements, a person reviews them on the aktrade Development Portal, and
 * they are saved here. This replaced the Gemini pipeline
 * (app/api/requirement-documents/[id]/process, removed 2026-09-29).
 * A document reaches the runner either from the Development Portal itself, or
 * uploaded on the Requirements page here ("Send to Claude Code", status pending)
 * and taken by the runner through ./claim.
 *
 * GET  ?house=&platform= returns the house's project, the bug categories (so Claude
 *      picks from real names) and the documents already added.
 *      With &rows=1: the project's client requirements themselves (id, title,
 *      description, severity, category, document), for the runner's auto-test.
 * POST {house, platform, file_name, file_b64?, document_id?, requirements: [{title,
 *      description, category?, severity}]}
 *      - With `document_id` (a document uploaded here): that row becomes completed.
 *        The file is already in the bucket. A document that is already completed,
 *        or belongs to another project, is refused.
 *      - Otherwise: stores the file in the private `requirement-documents` bucket,
 *        as "<project id>/<timestamp>-<name>", and creates a completed
 *        requirement_documents row.
 *      - Inserts each requirement into base_page as a client_requirement of that
 *        project. Those rows are shown on the project's Requirements page and can be
 *        copied into bugs, exactly as before.
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
  const supabase = serviceRoleClient();
  if (url.searchParams.get("rows") === "1") {
    // The requirements themselves, for the runner's auto-test (aktrade utils/autotest_context.py).
    const { data: rows, error } = await supabase
      .from("base_page")
      .select("id, title, description, severity, created_at, category:bug_categories(name), document:requirement_documents(file_name)")
      .eq("source_type", "client_requirement")
      .eq("project_id", found.project.id)
      .order("created_at", { ascending: true })
      .limit(1000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      project: { id: found.project.id, name: found.project.name },
      requirements: (rows ?? []).map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        severity: r.severity,
        category: r.category?.name ?? null,
        document: r.document?.file_name ?? null,
      })),
    });
  }
  const [{ data: categories, error: cErr }, { data: docs, error: dErr }] = await Promise.all([
    supabase.from("bug_categories").select("id, name").order("name"),
    supabase
      .from("requirement_documents")
      .select("id, file_name, status, requirements_extracted, created_at")
      .eq("project_id", found.project.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (cErr || dErr) return NextResponse.json({ error: (cErr ?? dErr)!.message }, { status: 500 });
  return NextResponse.json({
    project: { id: found.project.id, name: found.project.name },
    categories: (categories ?? []).map((c) => c.name),
    severities: SEVERITIES,
    documents: docs ?? [],
  });
}

type Incoming = { title?: unknown; description?: unknown; category?: unknown; severity?: unknown };

export async function POST(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;
  const body = await req.json().catch(() => null);
  const house = String(body?.house ?? "").trim();
  const fileName = String(body?.file_name ?? "").replace(/[^\w. ()-]/g, "_").slice(0, 120) || "requirements.txt";
  const incoming: Incoming[] = Array.isArray(body?.requirements) ? body.requirements : [];
  if (!house) return NextResponse.json({ error: "house is required" }, { status: 400 });
  const platform = parsePlatform(body?.platform ?? "android");
  if (!platform) return badPlatform();

  const rows = incoming
    .map((r) => ({
      title: String(r.title ?? "").trim().slice(0, 300),
      description: String(r.description ?? "").trim().slice(0, 4000) || null,
      category: String(r.category ?? "").trim(),
      severity: (SEVERITIES.includes(String(r.severity) as Severity) ? String(r.severity) : "minor") as Severity,
    }))
    .filter((r) => r.title);
  if (rows.length === 0) return NextResponse.json({ error: "No requirements to save" }, { status: 400 });
  if (rows.length > MAX_ROWS) return NextResponse.json({ error: `At most ${MAX_ROWS} requirements per document` }, { status: 400 });

  const found = await resolveProject(house, platform);
  if (!found.project) return NextResponse.json({ error: found.error }, { status: found.status });
  const project = found.project;
  const supabase = serviceRoleClient();

  const documentId = body?.document_id ? String(body.document_id) : null;
  let doc: { id: string };
  let undo: () => PromiseLike<unknown>; // if the requirements can't be inserted: no half-saved document
  if (documentId) {
    // Uploaded on the Requirements page and claimed by the runner: complete that row.
    if (!UUID.test(documentId)) return NextResponse.json({ error: "bad document_id" }, { status: 400 });
    const { data: existing, error: exErr } = await supabase
      .from("requirement_documents")
      .select("id, project_id, status")
      .eq("id", documentId)
      .maybeSingle();
    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
    if (!existing || existing.project_id !== project.id) {
      return NextResponse.json({ error: "No such document in this project (deleted in catalyst?)" }, { status: 404 });
    }
    const { data: took, error: upErr } = await supabase
      .from("requirement_documents")
      .update({ status: "completed", requirements_extracted: rows.length, error_message: null })
      .eq("id", documentId)
      .neq("status", "completed")
      .select("id");
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    if (!took?.length) return NextResponse.json({ error: "This document was already saved" }, { status: 409 });
    doc = { id: documentId };
    undo = () =>
      supabase
        .from("requirement_documents")
        .update({ status: existing.status, requirements_extracted: 0 })
        .eq("id", documentId);
  } else {
    let bytes: Uint8Array<ArrayBuffer> | null = null;
    if (body?.file_b64) {
      bytes = Uint8Array.from(atob(String(body.file_b64)), (c) => c.charCodeAt(0));
      if (bytes.byteLength > MAX_FILE_BYTES) return NextResponse.json({ error: "The file is larger than 20 MB" }, { status: 400 });
    }
    const path = `${project.id}/${Date.now()}-${fileName}`;
    if (bytes) {
      const { error } = await supabase.storage.from("requirement-documents").upload(path, new File([bytes], fileName));
      if (error) return NextResponse.json({ error: `Storing the file failed: ${error.message}` }, { status: 500 });
    }

    const { data: created, error: docErr } = await supabase
      .from("requirement_documents")
      .insert({
        project_id: project.id,
        file_path: bytes ? path : `${project.id}/(no file: pasted text)`,
        file_name: fileName,
        file_size_bytes: bytes?.byteLength ?? null,
        status: "completed",
        requirements_extracted: rows.length,
        uploaded_by: null, // added from the automation side, not by a signed-in user
      })
      .select("id")
      .single();
    if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 });
    doc = created;
    undo = () => supabase.from("requirement_documents").delete().eq("id", created.id);
  }

  const { data: categories } = await supabase.from("bug_categories").select("id, name");
  const byName = new Map((categories ?? []).map((c) => [c.name.toLowerCase(), c.id]));
  const { error: insErr } = await supabase.from("base_page").insert(
    rows.map((r) => ({
      source_type: "client_requirement" as const,
      project_id: project.id,
      requirement_document_id: doc.id,
      title: r.title,
      description: r.description,
      category_id: byName.get(r.category.toLowerCase()) ?? null,
      severity: r.severity,
    })),
  );
  if (insErr) {
    await undo();
    return NextResponse.json({ error: `Saving the requirements failed: ${insErr.message}` }, { status: 500 });
  }
  return NextResponse.json({ document_id: doc.id, project_id: project.id, saved: rows.length });
}
