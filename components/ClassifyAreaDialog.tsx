"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, cx } from "@/components/ui";
import { useRoleCategories } from "@/components/RoleCategories";
import { SEVERITY_LABELS } from "@/lib/severity";
import { titleCase } from "@/lib/format";
import { areaPatch, shortLabel, suggestArea } from "@/lib/bug-area";
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
  const roleCats = useRoleCategories();
  const suggestions = useMemo(
    () =>
      new Map(
        bugs.map((b) => [
          b.id,
          suggestArea(`${b.title} ${b.description ?? ""} ${b.steps_to_reproduce ?? ""}`, roleCats, categories, b.category_id),
        ]),
      ),
    [bugs, roleCats, categories],
  );
  const [picked, setPicked] = useState<Map<string, BugArea | null>>(
    () => new Map(bugs.map((b) => [b.id, suggestions.get(b.id)?.area ?? null])),
  );
  const [reassign, setReassign] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const chosen = [...picked.values()].filter(Boolean).length;
  const withPerson = roleCats.filter((c) => developers.areas[c.key]);

  const pick = (id: string, area: BugArea | null) => setPicked((m) => new Map(m).set(id, area));

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
          <h2 className="font-semibold text-slate-800">Classify bugs by role category</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:max-h-[70vh] sm:p-5">
          <p className="text-sm text-slate-600">
            {bugs.length} bug{bugs.length === 1 ? " has" : "s have"} no area yet. The suggestion from each bug&apos;s
            text is already picked; change any that are wrong. Bugs left without a choice stay unclassified. Frontend =
            the app&apos;s screens and layout; backend = the server/API (wrong data, failed orders, feed, login
            service), and so on for each role category.
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
                      {s ? `suggested ${shortLabel(roleCats, s.area)}: ${s.matched.join(", ") || "bug category"}` : "no suggestion"}
                    </span>
                  </span>
                  <select
                    value={cur ?? ""}
                    onChange={(e) => pick(b.id, e.target.value || null)}
                    aria-label={`Category for ${b.title}`}
                    className={cx(
                      "shrink-0 rounded-md border px-2 py-1 text-xs",
                      cur ? "border-brand bg-brand/5 text-slate-800" : "border-slate-300 text-slate-500",
                    )}
                  >
                    <option value="">Leave unclassified</option>
                    {roleCats.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
          {withPerson.length > 0 && (
            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input type="checkbox" className="mt-0.5" checked={reassign} onChange={(e) => setReassign(e.target.checked)} />
              <span>
                Move open bugs that are unassigned or still with the project developer to the category&apos;s person (
                {withPerson.map((c) => `${c.short_label}: ${developerName(developers.areas[c.key]!)}`).join(", ")}). Bugs
                assigned to someone else keep their assignee.
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
