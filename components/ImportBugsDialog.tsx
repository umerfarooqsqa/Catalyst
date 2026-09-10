"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { Button, Select, cx } from "@/components/ui";
import { SEVERITIES } from "@/lib/types/models";
import type { BugCategory, Severity } from "@/lib/types/models";
import { suggestCategory } from "@/lib/severity";

type Field = "title" | "description" | "steps" | "severity" | "expected" | "tags";
const FIELDS: { key: Field; label: string; required?: boolean }[] = [
  { key: "title", label: "Title", required: true },
  { key: "description", label: "Description" },
  { key: "expected", label: "Expected behavior (appended to description)" },
  { key: "steps", label: "Steps to reproduce" },
  { key: "severity", label: "Severity" },
  { key: "tags", label: "Tags / Module" },
];

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
    tags: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");

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
        tags: guess(hdrs, "module", "tag", "component", "area"),
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
      return {
        title,
        description,
        steps_to_reproduce: val("steps") || null,
        severity,
        tags,
        category_id: cat?.id ?? null,
      };
    });
  }, [rawRows, map, categories]);

  const valid = preview.filter((p) => p.title);

  async function doImport() {
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.from("base_page").insert(
      valid.map((p) => ({
        source_type: "master_bug" as const,
        title: p.title,
        description: p.description,
        steps_to_reproduce: p.steps_to_reproduce,
        severity: p.severity,
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
    onDone(valid.length);
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

              <div className="max-h-64 overflow-auto rounded-sm border border-grid-line">
                <table className="sheet">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Severity</th>
                      <th>Tags</th>
                      <th className="min-w-[16rem]">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 50).map((p, i) => (
                      <tr key={i} className={cx(!p.title && "opacity-40")}>
                        <td className="font-medium text-slate-800">
                          {p.title || "(no title — skipped)"}
                        </td>
                        <td>{p.severity}</td>
                        <td>{p.tags.join(", ")}</td>
                        <td className="text-slate-500">
                          {p.description?.slice(0, 120)}
                        </td>
                      </tr>
                    ))}
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
            disabled={busy || valid.length === 0 || !map.title}
          >
            {busy ? "Importing…" : `Import ${valid.length} bug${valid.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
