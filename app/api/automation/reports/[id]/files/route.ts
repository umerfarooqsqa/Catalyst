import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform } from "@/lib/automation-release";
import type { Json } from "@/lib/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const TYPES: Record<string, string[]> = {
  excel: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  screenshot: ["image/jpeg", "image/png"],
};

/**
 * One file of an auto-test report (see ../../route.ts): the run's Excel workbook or a
 * failure screenshot. Stored in the private `automation-reports` bucket as
 * <project id>/<report id>/<name> (replaced if sent again), and listed in the report's
 * `files` (name -> path); the workbook's path also goes in `excel_path`.
 *
 * POST {platform, name, kind: excel|screenshot, content_type, b64}
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "bad report id" }, { status: 400 });
  const body = await req.json().catch(() => null);
  if (!parsePlatform(body?.platform)) return badPlatform();
  const kind = String(body?.kind ?? "");
  const contentType = String(body?.content_type ?? "");
  const name = String(body?.name ?? "").replace(/[^\w.() -]/g, "_").slice(0, 140);
  if (!TYPES[kind]) return NextResponse.json({ error: "kind must be excel or screenshot" }, { status: 400 });
  if (!TYPES[kind].includes(contentType)) return NextResponse.json({ error: `content_type not allowed for ${kind}` }, { status: 400 });
  if (!name || name.startsWith(".")) return NextResponse.json({ error: "bad file name" }, { status: 400 });

  const supabase = serviceRoleClient();
  const { data: report, error: rErr } = await supabase
    .from("automation_reports")
    .select("id, project_id, files")
    .eq("id", id)
    .maybeSingle();
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  if (!report) return NextResponse.json({ error: "No such report" }, { status: 404 });

  const bytes = Uint8Array.from(atob(String(body?.b64 ?? "")), (c) => c.charCodeAt(0));
  if (!bytes.byteLength) return NextResponse.json({ error: "empty file" }, { status: 400 });
  if (bytes.byteLength > MAX_FILE_BYTES) return NextResponse.json({ error: "The file is larger than 15 MB" }, { status: 413 });
  const path = `${report.project_id}/${report.id}/${name}`;
  const { error: upErr } = await supabase.storage
    .from("automation-reports")
    .upload(path, new File([bytes], name, { type: contentType }), { upsert: true, contentType });
  if (upErr) return NextResponse.json({ error: `Storing the file failed: ${upErr.message}` }, { status: 500 });

  const files = { ...((report.files ?? {}) as Record<string, string>), [name]: path };
  const { error: fErr } = await supabase
    .from("automation_reports")
    .update({ files: files as Json, ...(kind === "excel" ? { excel_path: path } : {}) })
    .eq("id", report.id);
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });
  return NextResponse.json({ path });
}
