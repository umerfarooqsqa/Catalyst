"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { suggestArea } from "@/lib/bug-area";
import { useRoleCategories } from "@/components/RoleCategories";
import { Card, Badge, cx } from "@/components/ui";
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

// pending = uploaded here, waiting for a runner; processing = a runner took it
// (aktrade app/api/automation/requirements/claim) and it is being extracted or reviewed.
const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for Claude Code",
  processing: "With Claude Code",
  completed: "Completed",
  failed: "Failed",
};

const MAX_BYTES = 20 * 1024 * 1024;

// "#101" is more likely a number than a colour, so 3-digit codes need a letter.
const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])/gi;
const isColour = (code: string) => code.length > 4 || /[a-f]/i.test(code);

/** Text with a colour chip beside every hex code, so a reader sees the colour, not just its code. */
function ColorText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(HEX)) {
    if (!isColour(m[0])) continue;
    parts.push(text.slice(last, m.index));
    parts.push(
      <span
        key={m.index}
        aria-hidden
        className="mx-0.5 inline-block h-3 w-3 rounded-sm border border-slate-300 align-[-1px]"
        style={{ background: m[0] }}
      />,
      m[0],
    );
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

export default function RequirementDocsPanel({
  projectId,
  docs,
  extracted,
  categories,
  role,
  userId,
  hasApp,
}: {
  projectId: string;
  docs: RequirementDocument[];
  extracted: BasePageEntry[];
  categories: Pick<BugCategory, "id" | "name">[];
  role: RoleLevel;
  userId: string;
  /** The project is linked to an aktrade app (house), so a runner can pick documents up. */
  hasApp: boolean;
}) {
  const roleCats = useRoleCategories();
  const router = useRouter();
  const canManage = canManageRequirements(role);
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(extracted.length > 0);

  const catName = (id: string | null) =>
    id ? (categories.find((c) => c.id === id)?.name ?? "—") : "—";

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setMsg(null);
    if (file.size > MAX_BYTES) {
      setErr("The file is larger than 20 MB.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setBusy(true);
    try {
      const path = `${projectId}/${Date.now()}-${file.name.replace(/[^\w. ()-]/g, "_")}`;
      const up = await supabase.storage.from("requirement-documents").upload(path, file);
      if (up.error) throw new Error(up.error.message);
      const { error } = await supabase.from("requirement_documents").insert({
        project_id: projectId,
        file_path: path,
        file_name: file.name,
        file_size_bytes: file.size,
        status: "pending",
        uploaded_by: userId,
      });
      if (error) {
        await supabase.storage.from("requirement-documents").remove([path]);
        throw new Error(error.message);
      }
      setMsg(
        `"${file.name}" was sent to Claude Code. The automation machine picks it up at its next sync (within about 5 minutes while its dashboard is running). The requirements appear here once someone has reviewed them in the Development Portal.`,
      );
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function sendAgain(docId: string) {
    setErr(null);
    const { error } = await supabase
      .from("requirement_documents")
      .update({ status: "pending", error_message: null })
      .eq("id", docId);
    if (error) setErr(error.message);
    else {
      setMsg("Sent to Claude Code again.");
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
      // a requirement isn't a bug yet: suggest frontend/backend from its text (QA can change it)
      area: r.area ?? suggestArea(`${r.title} ${r.description ?? ""}`, roleCats)?.area ?? null,
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
            Send a PDF / DOCX / TXT / MD here, or add it on the aktrade{" "}
            <span className="font-medium">Development Portal</span> (next to the release notes).
            Claude Code splits it into atomic requirements in plain language: sizes as a share of
            the screen, colours by name, look and hex code. Someone reviews them on the Development
            Portal, and they land here, ready to copy into bugs. No live link back.
          </p>
          {canManage && !hasApp && (
            <p className="mt-1 text-xs text-amber-700">
              This project has no app linked, so no automation machine can pick documents up. Link
              it from the Development Portal&apos;s &quot;Add an app&quot; first.
            </p>
          )}
        </div>
        {canManage && hasApp && (
          <div className="shrink-0">
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
              {busy ? "Sending…" : "Send to Claude Code"}
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
                <span className="ml-2 text-xs text-slate-400" suppressHydrationWarning>
                  {fmtDateTime(d.created_at)}
                  {d.status === "completed"
                    ? ` · ${d.requirements_extracted} extracted`
                    : ""}
                </span>
                {d.status === "failed" && d.error_message && (
                  <p className="text-xs text-red-600">{d.error_message}</p>
                )}
                {d.status === "processing" && (
                  <p className="text-xs text-slate-500">
                    Being extracted, or waiting for review on the Development Portal.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={STATUS_TONE[d.status] ?? "slate"}>
                  {STATUS_LABEL[d.status] ?? titleCase(d.status)}
                </Badge>
                {canManage && hasApp && d.status === "failed" && (
                  <button
                    onClick={() => sendAgain(d.id)}
                    className="text-xs text-brand hover:underline"
                  >
                    send again
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
                        <p className="mt-1 text-slate-600">
                          <ColorText text={r.description} />
                        </p>
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
