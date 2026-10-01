"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { Button, Select, cx } from "@/components/ui";
import { SEVERITIES } from "@/lib/types/models";
import type { BugCategory, Severity } from "@/lib/types/models";
import { suggestCategory } from "@/lib/severity";
import { AREA_SHORT, suggestArea } from "@/lib/bug-area";
import type { BugArea } from "@/lib/bug-area";

type Field = "title" | "description" | "steps" | "severity" | "area" | "expected" | "tags";
const FIELDS: { key: Field; label: string; required?: boolean }[] = [
  { key: "title", label: "Title", required: true },
  { key: "description", label: "Description" },
  { key: "expected", label: "Expected behavior (appended to description)" },
  { key: "steps", label: "Steps to reproduce" },
  { key: "severity", label: "Severity" },
  { key: "area", label: "Area: frontend / backend / database / devops (suggested from the text when empty)" },
  { key: "tags", label: "Tags / Module" },
];

/** A sheet's area cell, normalised; null = blank or unknown (then it's suggested). */
function normArea(v: string): BugArea | null {
  const s = v.toLowerCase();
  if (/\b(db|dba|database|sql|data ?base)\b/.test(s)) return "database";
  if (/\b(devops|dev ops|infra|infrastructure|ops|deploy\w*|server down)\b/.test(s)) return "devops";
  if (/\b(front\w*|ui|client|app|mobile)\b/.test(s)) return "frontend";
  if (/\b(back\w*|api|server|service)\b/.test(s)) return "backend";
  return null;
}

const SEV_ALIAS: Record<string, Severity> = {
  critical: "critical",
  blocker: "critical",
  high: "major",
  major: "major",
  medium: "minor",
  minor: "minor",
  normal: "minor",
  low: "trivial",
  trivial: "trivial",
  cosmetic: "trivial",
};

const normTitle = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\w ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function guess(headers: string[], ...needles: string[]) {
  const h = headers.findIndex((x) =>
    needles.some((n) => x.toLowerCase().replace(/[^a-z]/g, "").includes(n)),
  );
  return h === -1 ? "" : headers[h];
}

export default function ImportBugsDialog({
  categories,
  userId,
  onClose,
  onDone,
}: {
  categories: BugCategory[];
  userId: string;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<Record<Field, string>>({
    title: "",
    description: "",
    expected: "",
    steps: "",
    severity: "",
    area: "",
    tags: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [existing, setExisting] = useState<{ id: string; title: string }[]>([]);
  const [skipDupes, setSkipDupes] = useState(true);
  // The Master Library is split by platform; an import goes into one list.
  const [platform, setPlatform] = useState<"android" | "ios">("android");

  // Pull every master-library title once so the preview can be scanned for
  // rows that duplicate an entry already in the sheet.
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("base_page")
      .select("id,title")
      .eq("source_type", "master_bug")
      .then(({ data }) => setExisting(data ?? []));
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        defval: null,
      });
      if (json.length === 0) {
        setErr("That sheet has no rows.");
        return;
      }
      const hdrs = Object.keys(json[0]);
      setRawRows(json);
      setHeaders(hdrs);
      setMap({
        title: guess(hdrs, "title", "summary", "bug", "issue"),
        description: guess(hdrs, "description", "detail", "actual"),
        expected: guess(hdrs, "expected"),
        steps: guess(hdrs, "steps", "repro"),
        severity: guess(hdrs, "severity", "priority"),
        area: guess(hdrs, "area", "layer", "frontend", "backend", "team"),
        tags: guess(hdrs, "module", "tag", "component"),
      });
    } catch {
      setErr("Couldn't read that file. Use .xlsx, .xls or .csv.");
    }
  }

  const preview = useMemo(() => {
    if (!map.title) return [];
    return rawRows.map((r) => {
      const val = (f: Field) =>
        map[f] ? String(r[map[f]] ?? "").trim() : "";
      const title = val("title");
      const descParts = [val("description")];
      if (val("expected")) descParts.push(`Expected: ${val("expected")}`);
      const description = descParts.filter(Boolean).join("\n\n") || null;
      const sevRaw = val("severity").toLowerCase();
      const severity: Severity = SEV_ALIAS[sevRaw] ?? "minor";
      const tags = val("tags")
        ? val("tags").split(/[,;/]/).map((t) => t.trim()).filter(Boolean)
        : [];
      const cat = suggestCategory(`${title} ${val("description")} ${tags.join(" ")}`, categories);
      const area =
        normArea(val("area")) ??
        suggestArea(`${title} ${val("description")} ${val("steps")} ${tags.join(" ")}`, categories, cat?.id)?.area ??
        null;
      return {
        title,
        description,
        steps_to_reproduce: val("steps") || null,
        severity,
        area,
        tags,
        category_id: cat?.id ?? null,
      };
    });
  }, [rawRows, map, categories]);

  // Pre-import duplicate scan of the mapped titles against the master sheet.
  const dupeMatches = useMemo(() => {
    if (existing.length === 0) return preview.map(() => [] as string[]);
    const byNorm = new Map<string, string[]>();
    for (const e of existing) {
      const k = normTitle(e.title);
      if (k) byNorm.set(k, [...(byNorm.get(k) ?? []), e.title]);
    }
    return preview.map((p) => {
      if (!p.title) return [];
      const k = normTitle(p.title);
      const exact = byNorm.get(k);
      if (exact) return exact;
      // near-match: one title fully contains the other (both non-trivial)
      const near = existing
        .filter((e) => {
          const ek = normTitle(e.title);
          return (
            ek.length >= 6 &&
            k.length >= 6 &&
            (ek.includes(k) || k.includes(ek))
          );
        })
        .map((e) => e.title);
      return [...new Set(near)];
    });
  }, [preview, existing]);

  const rows = preview.map((p, i) => ({ ...p, matched: dupeMatches[i] ?? [] }));
  const valid = rows.filter((p) => p.title);
  const dupeCount = valid.filter((p) => p.matched.length > 0).length;
  const toImport = valid.filter((p) => !(skipDupes && p.matched.length > 0));

  async function doImport() {
    if (!skipDupes && dupeCount > 0) {
      const ok = window.confirm(
        `${dupeCount} row${dupeCount === 1 ? "" : "s"} match a title already in ` +
          `the master library and will be imported as duplicate entries. Continue?`,
      );
      if (!ok) return;
    }
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.from("base_page").insert(
      toImport.map((p) => ({
        source_type: "master_bug" as const,
        platform,
        title: p.title,
        description: p.description,
        steps_to_reproduce: p.steps_to_reproduce,
        severity: p.severity,
        area: p.area,
        category_id: p.category_id,
        tags: p.tags,
        created_by: userId,
      })),
    );
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    onDone(toImport.length);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-sm border border-grid-line bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-grid-line px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">
            Import bugs from a spreadsheet
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-4">
          <label className="flex items-center gap-2 text-[13px] text-slate-600">
            Import into
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as "android" | "ios")}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="android">Android list</option>
              <option value="ios">iOS list</option>
            </select>
          </label>
          <div>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={onFile}
              className="text-[13px]"
            />
            {fileName ? (
              <p className="mt-1 text-xs text-slate-500">
                {fileName} — {rawRows.length} row{rawRows.length === 1 ? "" : "s"}
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                First sheet is used. Columns are auto-detected — adjust the mapping below.
              </p>
            )}
          </div>

          {headers.length > 0 && (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {FIELDS.map((f) => (
                  <label key={f.key} className="text-[12px] text-slate-600">
                    {f.label}
                    {f.required ? <span className="text-red-500"> *</span> : null}
                    <Select
                      value={map[f.key]}
                      onChange={(e) =>
                        setMap((m) => ({ ...m, [f.key]: e.target.value }))
                      }
                      className="mt-0.5"
                    >
                      <option value="">— none —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </Select>
                  </label>
                ))}
              </div>

              {dupeCount > 0 && (
                <div className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                  <p className="font-medium">
                    ⚠ {dupeCount} of {valid.length} row
                    {valid.length === 1 ? "" : "s"} match a title already in the
                    master library.
                  </p>
                  <label className="mt-1 flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={skipDupes}
                      onChange={(e) => setSkipDupes(e.target.checked)}
                    />
                    Skip matching rows (import {toImport.length} new)
                  </label>
                </div>
              )}

              <div className="max-h-64 overflow-auto rounded-sm border border-grid-line">
                <table className="sheet">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Severity</th>
                      <th>Area</th>
                      <th>Tags</th>
                      <th className="min-w-[16rem]">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((p, i) => {
                      const dup = p.matched.length > 0;
                      const skipped = !p.title || (skipDupes && dup);
                      return (
                        <tr
                          key={i}
                          className={cx(
                            skipped && "opacity-40",
                            dup && !skipped && "bg-amber-50",
                          )}
                        >
                          <td className="font-medium text-slate-800">
                            {p.title || "(no title — skipped)"}
                            {dup && (
                              <span
                                className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[11px] font-normal text-amber-700"
                                title={`Already in library: ${p.matched.join("; ")}`}
                              >
                                {skipDupes ? "duplicate — skipped" : "duplicate"}
                              </span>
                            )}
                          </td>
                          <td>{p.severity}</td>
                          <td>{p.area ? AREA_SHORT[p.area] : "—"}</td>
                          <td>{p.tags.join(", ")}</td>
                          <td className="text-slate-500">
                            {p.description?.slice(0, 120)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {err && (
            <p className="rounded-sm bg-red-50 px-3 py-2 text-[13px] text-red-700">
              {err}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-grid-line px-4 py-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={doImport}
            disabled={busy || toImport.length === 0 || !map.title}
          >
            {busy
              ? "Importing…"
              : `Import ${toImport.length} bug${toImport.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
