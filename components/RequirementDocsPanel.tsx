"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Badge, cx } from "@/components/ui";
import { SEVERITY_LABELS } from "@/lib/severity";
import { fmtDateTime, titleCase } from "@/lib/format";
import { canManageRequirements } from "@/lib/permissions";
import type {
  BasePageEntry,
  BugCategory,
  RequirementDocument,
  RoleLevel,
} from "@/lib/types/models";

const STATUS_TONE: Record<string, "slate" | "blue" | "green" | "red" | "amber"> = {
  pending: "slate",
  processing: "amber",
  completed: "green",
  failed: "red",
};

export default function RequirementDocsPanel({
  projectId,
  docs,
  extracted,
  categories,
  role,
  userId,
}: {
  projectId: string;
  docs: RequirementDocument[];
  extracted: BasePageEntry[];
  categories: Pick<BugCategory, "id" | "name">[];
  role: RoleLevel;
  userId: string;
}) {
  const router = useRouter();
  const canManage = canManageRequirements(role);
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(extracted.length > 0);

  const catName = (id: string | null) =>
    id ? (categories.find((c) => c.id === id)?.name ?? "—") : "—";

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const path = `${projectId}/${Date.now()}-${file.name}`;
      const up = await supabase.storage
        .from("requirement-documents")
        .upload(path, file);
      if (up.error) throw new Error(up.error.message);

      const { data: doc, error } = await supabase
        .from("requirement_documents")
        .insert({
          project_id: projectId,
          file_path: path,
          file_name: file.name,
          file_size_bytes: file.size,
          uploaded_by: userId,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      setMsg("Uploaded — extracting requirements with Gemini…");
      router.refresh();
      await runProcess(doc.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function runProcess(docId: string) {
    if (running) return;
    setErr(null);
    setRunning(docId);
    try {
      const res = await fetch(`/api/requirement-documents/${docId}/process`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 200) {
        setErr(body.error || `Extraction failed (${res.status})`);
      } else {
        setMsg(`Extracted ${body.extracted} requirement(s) into the library.`);
        setOpen(true);
      }
    } finally {
      setRunning(null);
      router.refresh();
    }
  }

  async function copyToBug(r: BasePageEntry) {
    setErr(null);
    const { error } = await supabase.from("bugs").insert({
      project_id: projectId,
      title: r.title,
      description: r.description,
      steps_to_reproduce: r.steps_to_reproduce,
      severity: r.severity,
      category_id: r.category_id,
      base_page_id: r.id,
      created_by: userId,
    });
    if (error) return setErr(error.message);
    await supabase
      .from("base_page")
      .update({
        times_reused: r.times_reused + 1,
        last_reused_at: new Date().toISOString(),
      })
      .eq("id", r.id);
    setMsg(`"${r.title}" copied into the bug sheet as an independent row.`);
    router.refresh();
  }

  async function deleteDoc(docId: string) {
    if (
      !confirm(
        "Delete this document and every requirement extracted from it?",
      )
    )
      return;
    const { error } = await supabase
      .from("requirement_documents")
      .delete()
      .eq("id", docId);
    if (error) setErr(error.message);
    else router.refresh();
  }

  return (
    <Card className="mb-6 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">
            Client requirements documents
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Upload a PDF / DOCX / TXT. Gemini splits it into atomic
            requirements stored in the shared library (
            <span className="font-medium">base_page</span>), ready to reuse
            into bugs. No live link back.
          </p>
        </div>
        {canManage && (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              onChange={onFile}
              disabled={busy}
              className="hidden"
              id="reqdoc-file"
            />
            <label
              htmlFor="reqdoc-file"
              className={cx(
                "inline-flex cursor-pointer items-center rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-fg",
                busy && "pointer-events-none opacity-50",
              )}
            >
              {busy ? "Working…" : "+ Upload document"}
            </label>
          </div>
        )}
      </div>

      {err && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </p>
      )}
      {msg && (
        <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          {msg}
        </p>
      )}

      {docs.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded border border-slate-100 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <span className="font-medium text-slate-800">
                  {d.file_name}
                </span>
                <span className="ml-2 text-xs text-slate-400">
                  {fmtDateTime(d.created_at)}
                  {d.status === "completed"
                    ? ` · ${d.requirements_extracted} extracted`
                    : ""}
                </span>
                {d.status === "failed" && d.error_message && (
                  <p className="text-xs text-red-600">{d.error_message}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={STATUS_TONE[d.status] ?? "slate"}>
                  {titleCase(d.status)}
                </Badge>
                {canManage &&
                  (d.status === "failed" || d.status === "pending") && (
                    <button
                      onClick={() => runProcess(d.id)}
                      disabled={running !== null}
                      className="text-xs text-brand hover:underline disabled:opacity-40"
                    >
                      {running === d.id ? "running…" : "run"}
                    </button>
                  )}
                {canManage && (
                  <button
                    onClick={() => deleteDoc(d.id)}
                    className="text-xs text-slate-400 hover:text-red-600"
                  >
                    delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {extracted.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            {open ? "▾" : "▸"} Extracted requirements ({extracted.length})
          </button>
          {open && (
            <ul className="mt-2 space-y-1.5">
              {extracted.map((r) => (
                <li
                  key={r.id}
                  className="rounded border border-slate-100 px-3 py-2 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          tone={
                            r.severity === "critical"
                              ? "red"
                              : r.severity === "major"
                                ? "amber"
                                : "slate"
                          }
                        >
                          {SEVERITY_LABELS[r.severity]}
                        </Badge>
                        <span className="font-medium text-slate-800">
                          {r.title}
                        </span>
                        <span className="text-xs text-slate-400">
                          {catName(r.category_id)}
                        </span>
                      </div>
                      {r.description && (
                        <p className="mt-1 text-slate-600">{r.description}</p>
                      )}
                    </div>
                    {canManage && (
                      <button
                        onClick={() => copyToBug(r)}
                        className="shrink-0 rounded bg-brand/10 px-2 py-1 text-xs font-medium text-brand-fg hover:bg-brand/20"
                      >
                        Copy to bug
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
