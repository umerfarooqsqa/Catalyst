"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, cx } from "@/components/ui";
import { SEVERITY_LABELS } from "@/lib/severity";
import type { Severity } from "@/lib/types/models";

/**
 * "Import from WhatsApp" (migration 0046): upload Grok's "Catalyst import" sheet, review
 * what each row will become, then import. The database decides (whatsapp_import): it finds
 * each row's project, creates missing ones once (if allowed), and never imports an item_id
 * twice. The preview is the same function in dry-run mode, so it shows exactly what Import does.
 * Rows come from a file, or from the inbox Grok sends to (/api/intake/whatsapp, migration 0047).
 */
type Row = Record<string, string>;
type Planned = {
  item_id: string | null;
  action: "bug" | "task" | "skip";
  reason: string | null;
  title: string;
  project_id: string | null;
  project_name: string | null;
  how: "house" | "name" | "chosen" | "new" | "ambiguous" | "none" | null;
  severity: Severity | null;
  category_id: string | null;
  area: string | null;
  bug_id: string | null;
  task_id: string | null;
};
type Result = { rows: Planned[]; created_projects: { id: string | null; name: string; platform: string }[]; dry_run: boolean };
type ProjectOpt = { id: string; name: string; platform: string | null };

const COLUMNS = [
  "item_id", "first_seen", "last_seen", "whatsapp_group", "house", "app_name", "platform", "type", "title",
  "description", "original_message", "reporter", "severity", "category", "area", "status", "notes",
];

const key = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function readSheet(buf: ArrayBuffer): Row[] {
  const wb = XLSX.read(buf);
  const name = wb.SheetNames.find((n) => n.trim().toLowerCase() === "catalyst import") ?? wb.SheetNames[0];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: "", raw: false });
  return json
    .map((r) => {
      const row: Row = {};
      for (const [h, v] of Object.entries(r)) {
        const k = key(h);
        if (COLUMNS.includes(k)) row[k] = String(v ?? "").trim();
      }
      return row;
    })
    .filter((r) => Object.values(r).some(Boolean));
}

export type InboxRow = { item_id: string; row: Row; last_received_at: string };

export default function WhatsAppImport({
  projects,
  categories,
  inbox,
}: {
  projects: ProjectOpt[];
  categories: { id: string; name: string }[];
  /** Grok's rows waiting for review; null before migration 0047. */
  inbox: InboxRow[] | null;
}) {
  const router = useRouter();
  const [fileName, setFileName] = useState<string | null>(null);
  const [fromInbox, setFromInbox] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [skipped, setSkipped] = useState<Record<number, boolean>>({});
  const [createProjects, setCreateProjects] = useState(true);
  const [plan, setPlan] = useState<Result | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const payload = useCallback(
    (src: Row[], pick: Record<number, string>, skip: Record<number, boolean>) =>
      src.map((r, i) => ({ ...r, ...(pick[i] ? { project_id: pick[i] } : {}), ...(skip[i] ? { skip: true } : {}) })),
    [],
  );

  const run = useCallback(
    async (src: Row[], pick: Record<number, string>, skip: Record<number, boolean>, create: boolean, dry: boolean) => {
      setErr(null);
      setBusy(true);
      const { data, error } = await createClient().rpc("whatsapp_import", {
        p_rows: payload(src, pick, skip),
        p_create_projects: create,
        p_dry_run: dry,
      });
      setBusy(false);
      if (error) {
        setErr(error.message);
        return null;
      }
      return data as unknown as Result;
    },
    [payload],
  );

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setFromInbox(false);
    setDone(null);
    setChosen({});
    setSkipped({});
    try {
      const parsed = readSheet(await file.arrayBuffer());
      if (parsed.length === 0) {
        setRows([]);
        setPlan(null);
        return setErr("No rows found. Use Grok's \"Catalyst import\" sheet (headers: item_id, type, house, title, …).");
      }
      if (!parsed.some((r) => r.item_id) || !parsed.some((r) => r.type)) {
        setRows([]);
        setPlan(null);
        return setErr("This sheet has no item_id / type columns. Use Grok's \"Catalyst import\" sheet.");
      }
      setRows(parsed);
      setPlan(await run(parsed, {}, {}, createProjects, true));
    } catch (x) {
      setErr(`Could not read the file: ${x instanceof Error ? x.message : String(x)}`);
    }
  }

  async function replan(pick = chosen, skip = skipped, create = createProjects) {
    if (rows.length) setPlan(await run(rows, pick, skip, create, true));
  }

  async function loadInbox() {
    if (!inbox?.length) return;
    const src = inbox.map((r) => {
      const row: Row = {};
      for (const [k, v] of Object.entries(r.row ?? {})) if (COLUMNS.includes(k)) row[k] = String(v ?? "");
      return row;
    });
    setFileName(null);
    setFromInbox(true);
    setDone(null);
    setChosen({});
    setSkipped({});
    setRows(src);
    setPlan(await run(src, {}, {}, createProjects, true));
  }

  async function doImport() {
    const res = await run(rows, chosen, skipped, createProjects, false);
    if (res) {
      // Rows from Grok that QA skipped here are not offered again.
      const dismissed = fromInbox ? rows.filter((_, i) => skipped[i]).map((r) => r.item_id).filter(Boolean) : [];
      if (dismissed.length) {
        const { error } = await createClient().rpc("whatsapp_inbox_dismiss", { p_item_ids: dismissed });
        if (error) setErr(`Imported, but the skipped rows could not be dismissed: ${error.message}`);
      }
      setDone(res);
      setPlan(null);
      if (fromInbox) router.refresh();
    }
  }

  const shown = done ?? plan;
  const counts = useMemo(() => {
    const r = shown?.rows ?? [];
    return {
      bugs: r.filter((x) => x.action === "bug").length,
      tasks: r.filter((x) => x.action === "task").length,
      skipped: r.filter((x) => x.action === "skip").length,
      held: r.filter((x) => x.action === "skip" && (x.how === "ambiguous" || x.reason?.startsWith("no project") || x.reason === "no house or app name")).length,
    };
  }, [shown]);

  return (
    <div className="space-y-4">
      {inbox && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-violet-200 bg-violet-50/60 p-3 text-[13px]">
          <span className="font-medium text-violet-900">From Grok:</span>
          {inbox.length ? (
            <>
              <span className="text-violet-900">
                {inbox.length} row{inbox.length === 1 ? "" : "s"} need{inbox.length === 1 ? "s" : ""} a project
                <span className="text-violet-700">
                  {" "}
                  (last received{" "}
                  <span suppressHydrationWarning>{new Date(inbox[inbox.length - 1].last_received_at).toLocaleString()}</span>)
                </span>
              </span>
              <Button onClick={loadInbox} disabled={busy}>
                Review {inbox.length} row{inbox.length === 1 ? "" : "s"}
              </Button>
            </>
          ) : (
            <span className="text-violet-700">
              nothing waiting. Rows for known projects are filed automatically; only rows whose project
              isn&apos;t in catalyst yet (or is unclear) appear here.
            </span>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-grid-line bg-white p-3 text-[13px]">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-grid-head">
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
          {fileName ? "Choose another file" : "Or upload Grok's sheet (.xlsx / .csv)"}
        </label>
        {fileName && <span className="text-slate-500">{fileName}</span>}
        {fromInbox && <span className="text-violet-700">Reviewing Grok&apos;s rows</span>}
        <label className="inline-flex items-center gap-1.5 text-slate-700">
          <input
            type="checkbox"
            checked={createProjects}
            disabled={busy || !!done}
            onChange={(e) => {
              setCreateProjects(e.target.checked);
              replan(chosen, skipped, e.target.checked);
            }}
          />
          Create a project for apps that aren&apos;t in catalyst yet (never twice)
        </label>
      </div>

      {err && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{err}</p>}

      {shown && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
            <span className="font-medium text-slate-700">
              {done ? "Imported:" : "Will import:"} {counts.bugs} bug{counts.bugs === 1 ? "" : "s"}, {counts.tasks} task
              {counts.tasks === 1 ? "" : "s"}
            </span>
            <span className="text-slate-500">
              {counts.skipped} skipped{counts.held ? ` (${counts.held} need a project)` : ""}
            </span>
            {shown.created_projects.length > 0 && (
              <span className="text-violet-700">
                {done ? "New projects created: " : "New projects: "}
                {shown.created_projects.map((p, i) => (
                  <span key={`${p.name}-${p.platform}`}>
                    {i > 0 && ", "}
                    {p.id ? (
                      <Link href={`/projects/${p.id}/bugs`} className="font-medium underline">
                        {p.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{p.name}</span>
                    )}{" "}
                    ({p.platform})
                  </span>
                ))}
              </span>
            )}
            {!done && (
              <Button className="ml-auto" onClick={doImport} disabled={busy || counts.bugs + counts.tasks === 0}>
                {busy ? "Working…" : `Import ${counts.bugs + counts.tasks} item${counts.bugs + counts.tasks === 1 ? "" : "s"}`}
              </Button>
            )}
            {done && (
              <Button
                variant="secondary"
                className="ml-auto"
                onClick={() => {
                  setDone(null);
                  setRows([]);
                  setFileName(null);
                  setFromInbox(false);
                }}
              >
                Import another sheet
              </Button>
            )}
          </div>

          <div className="sheet-wrap rounded-md border border-grid-line">
            <table className="sheet">
              <thead>
                <tr>
                  <th className="min-w-[11rem]">Item</th>
                  <th className="min-w-[5rem]">Type</th>
                  <th className="min-w-[16rem]">Title</th>
                  <th className="min-w-[15rem]">Project</th>
                  <th className="min-w-[9rem]">Category · severity</th>
                  <th className="min-w-[11rem]">{done ? "Result" : "Will be"}</th>
                  {!done && <th className="w-16">Skip</th>}
                </tr>
              </thead>
              <tbody>
                {shown.rows.map((p, i) => {
                  const src = rows[i] ?? {};
                  const filed = p.action !== "skip";
                  const needsProject = !filed && (p.how === "ambiguous" || p.reason === "no house or app name" || p.reason?.startsWith("no project"));
                  return (
                    <tr key={`${p.item_id ?? "row"}-${i}`} className={cx(!filed && "text-slate-400")}>
                      <td className="font-mono text-[12px]">
                        {p.item_id ?? "—"}
                        <div className="font-sans text-[11px] text-slate-400">{src.whatsapp_group}</div>
                      </td>
                      <td>{src.type || "—"}</td>
                      <td className={cx(filed && "font-medium text-slate-800")}>{p.title || src.title || "—"}</td>
                      <td>
                        {done || p.reason === "already imported" ? (
                          <span>{p.project_name ?? "—"}</span>
                        ) : filed || needsProject ? (
                          <select
                            value={chosen[i] ?? ""}
                            disabled={busy}
                            onChange={(e) => {
                              const next = { ...chosen };
                              if (e.target.value) next[i] = e.target.value;
                              else delete next[i];
                              setChosen(next);
                              replan(next, skipped);
                            }}
                            className={cx("cell-input", needsProject && "text-amber-700")}
                          >
                            <option value="">
                              {p.how === "new"
                                ? `➕ new: ${p.project_name}`
                                : p.project_name
                                  ? `${p.project_name} (${p.how === "house" ? "by house" : p.how === "name" ? "by name" : "chosen"})`
                                  : `Choose… (${p.reason})`}
                            </option>
                            {projects.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                                {o.platform ? ` · ${o.platform}` : ""}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span>—</span>
                        )}
                      </td>
                      <td className="text-[12px]">
                        {filed ? (
                          <>
                            {p.category_id ? catName.get(p.category_id) : <span className="text-amber-700">no category</span>}
                            {p.severity && p.action === "bug" ? ` · ${SEVERITY_LABELS[p.severity]}` : ""}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {p.action === "bug" ? (
                          done && p.bug_id && p.project_id ? (
                            <Link href={`/projects/${p.project_id}/bugs?focus=${p.bug_id}`} className="text-brand-fg hover:underline">
                              Bug ↗
                            </Link>
                          ) : (
                            <Badge tone="red">Bug</Badge>
                          )
                        ) : p.action === "task" ? (
                          done && p.task_id && p.project_id ? (
                            <Link href={`/projects/${p.project_id}/tasks?focus=${p.task_id}`} className="text-brand-fg hover:underline">
                              Task ↗
                            </Link>
                          ) : (
                            <Badge tone="blue">Task</Badge>
                          )
                        ) : (
                          <span className={cx("text-[12px]", needsProject ? "text-amber-700" : "text-slate-500")}>
                            Skip: {p.reason}
                            {p.reason === "already imported" && p.project_id && (p.bug_id || p.task_id) && (
                              <Link
                                href={`/projects/${p.project_id}/${p.bug_id ? "bugs" : "tasks"}?focus=${p.bug_id ?? p.task_id}`}
                                className="ml-1 text-brand-fg hover:underline"
                              >
                                open ↗
                              </Link>
                            )}
                          </span>
                        )}
                      </td>
                      {!done && (
                        <td className="text-center">
                          {(filed || skipped[i]) && (
                            <input
                              type="checkbox"
                              checked={!!skipped[i]}
                              disabled={busy}
                              onChange={(e) => {
                                const next = { ...skipped, [i]: e.target.checked };
                                setSkipped(next);
                                replan(chosen, next);
                              }}
                              aria-label="Skip this row"
                            />
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
