"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, cx } from "@/components/ui";
import { SEVERITY_LABELS } from "@/lib/severity";
import { titleCase } from "@/lib/format";
import { AREAS, AREA_SHORT, areaPatch, suggestArea } from "@/lib/bug-area";
import type { AreaDevelopers, BugArea } from "@/lib/bug-area";
import type { BugCategory, BugWithJoins } from "@/lib/types/models";

/**
 * Classify the bugs whose area isn't set (migration 0041): each comes with the
 * suggested area pre-picked (or none, when the text doesn't say), QA adjusts and
 * saves them in one go. Like VersionsPanel's "Review & confirm".
 */
export default function ClassifyAreaDialog({
  bugs,
  categories,
  developers,
  developerName,
  onClose,
  onDone,
}: {
  bugs: BugWithJoins[];
  categories: BugCategory[];
  developers: AreaDevelopers;
  developerName: (id: string) => string;
  onClose: () => void;
  onDone: (saved: number, moved: number) => void;
}) {
  const suggestions = useMemo(
    () =>
      new Map(
        bugs.map((b) => [
          b.id,
          suggestArea(`${b.title} ${b.description ?? ""} ${b.steps_to_reproduce ?? ""}`, categories, b.category_id),
        ]),
      ),
    [bugs, categories],
  );
  const [picked, setPicked] = useState<Map<string, BugArea | null>>(
    () => new Map(bugs.map((b) => [b.id, suggestions.get(b.id)?.area ?? null])),
  );
  const [reassign, setReassign] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const chosen = [...picked.values()].filter(Boolean).length;
  const anyDeveloper = AREAS.some((a) => developers[a]);

  const pick = (id: string, area: BugArea | null) =>
    setPicked((m) => new Map(m).set(id, m.get(id) === area ? null : area));

  async function save() {
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    let saved = 0;
    let moved = 0;
    for (const b of bugs) {
      const area = picked.get(b.id);
      if (!area) continue;
      const patch = areaPatch(b, area, developers, reassign);
      const { error } = await supabase.from("bugs").update(patch).eq("id", b.id);
      if (error) {
        setBusy(false);
        setErr(`${b.title}: ${error.message}`);
        if (saved) onDone(saved, moved);
        return;
      }
      saved++;
      if (patch.assignee_id) moved++;
    }
    setBusy(false);
    onDone(saved, moved);
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-stretch justify-center overflow-y-auto bg-slate-900/40 sm:items-start sm:p-8"
      onClick={onClose}
    >
      <div
        className="flex min-h-full w-full max-w-3xl flex-col bg-white shadow-xl sm:min-h-0 sm:rounded-sm sm:border sm:border-grid-line"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-grid-line bg-white px-4 py-3 sm:px-5">
          <h2 className="font-semibold text-slate-800">Classify bugs by area</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:max-h-[70vh] sm:p-5">
          <p className="text-sm text-slate-600">
            {bugs.length} bug{bugs.length === 1 ? " has" : "s have"} no area yet. The suggestion from each bug&apos;s
            text is already picked; change any that are wrong. Bugs left without a choice stay unclassified. Frontend =
            the app&apos;s screens and layout; backend = the server/API (wrong data, failed orders, feed, login
            service); database = queries and records; DevOps = servers, deployments, downtime.
          </p>
          <ul className="divide-y divide-grid-line rounded-md border border-grid-line">
            {bugs.map((b) => {
              const s = suggestions.get(b.id);
              const cur = picked.get(b.id) ?? null;
              return (
                <li key={b.id} className="flex flex-wrap items-start gap-2 px-3 py-2 text-sm sm:flex-nowrap">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-slate-800">{b.title}</span>
                    <span className="ml-2 inline-flex gap-1 align-middle">
                      <Badge tone={b.severity === "critical" ? "red" : b.severity === "major" ? "amber" : "slate"}>
                        {SEVERITY_LABELS[b.severity]}
                      </Badge>
                      <Badge tone="blue">{titleCase(b.status)}</Badge>
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-400">
                      {s ? `suggested ${AREA_SHORT[s.area]}: ${s.matched.join(", ") || "category"}` : "no suggestion"}
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 gap-1" role="radiogroup" aria-label={`Area for ${b.title}`}>
                    {AREAS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        role="radio"
                        aria-checked={cur === a}
                        onClick={() => pick(b.id, a)}
                        className={cx(
                          "rounded-md border px-2.5 py-1 text-xs",
                          cur === a
                            ? "border-brand bg-brand text-white"
                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                        )}
                      >
                        {AREA_SHORT[a]}
                      </button>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
          {anyDeveloper && (
            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input type="checkbox" className="mt-0.5" checked={reassign} onChange={(e) => setReassign(e.target.checked)} />
              <span>
                Move open bugs that are unassigned or still with the project developer to the area&apos;s developer (
                {AREAS.map((a) => `${AREA_SHORT[a]}: ${developers[a] ? developerName(developers[a]!) : "none"}`).join(", ")}
                ). Bugs assigned to someone else keep their assignee.
              </span>
            </label>
          )}
          {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-grid-line px-4 py-3 sm:px-5">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || chosen === 0}>
            {busy ? "Saving…" : `Save ${chosen} bug${chosen === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
