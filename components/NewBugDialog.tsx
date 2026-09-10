"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Badge, cx } from "@/components/ui";
import DueInput from "@/components/DueInput";
import { suggestSeverity, SEVERITY_LABELS } from "@/lib/severity";
import type {
  BasePageEntry,
  BugCategory,
  MemberOption,
  Requirement,
  Severity,
} from "@/lib/types/models";
import { SEVERITIES, PRIORITIES } from "@/lib/types/models";

type Props = {
  projectId: string;
  categories: BugCategory[];
  requirements: Pick<Requirement, "id" | "title">[];
  members: MemberOption[];
  userId: string;
  open: boolean;
  onClose: () => void;
  /** Optional library entry to seed the form (from the "copy" flow). */
  seed?: BasePageEntry | null;
};

export default function NewBugDialog({
  projectId,
  categories,
  requirements,
  members,
  open,
  onClose,
  seed,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [severity, setSeverity] = useState<Severity>("minor");
  const [severityTouched, setSeverityTouched] = useState(false);
  const [priority, setPriority] = useState("medium");
  const [categoryId, setCategoryId] = useState("");
  const [requirementId, setRequirementId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueIso, setDueIso] = useState<string | null>(null);
  const [dueErr, setDueErr] = useState<string | null>(null);
  const [basePageId, setBasePageId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dupes, setDupes] = useState<BasePageEntry[]>([]);
  const titleRef = useRef<HTMLInputElement>(null);

  // seed from a library entry (reuse) — copies fields, keeps a
  // historical pointer via base_page_id. No live link.
  useEffect(() => {
    if (!open) return;
    if (seed) {
      setTitle(seed.title);
      setDescription(seed.description ?? "");
      setSteps(seed.steps_to_reproduce ?? "");
      setSeverity(seed.severity);
      setSeverityTouched(true);
      setCategoryId(seed.category_id ?? "");
      setBasePageId(seed.id);
    }
    setTimeout(() => titleRef.current?.focus(), 50);
  }, [open, seed]);

  // Live duplicate suggestion against the master library (trigram indexed).
  useEffect(() => {
    if (!open) return;
    const q = title.trim();
    if (q.length < 3) {
      setDupes([]);
      return;
    }
    const t = setTimeout(async () => {
      const supabase = createClient();
      const { data: whole } = await supabase
        .from("base_page")
        .select("*")
        .eq("source_type", "master_bug")
        .ilike("title", `%${q}%`)
        .limit(5);

      // Broaden with a per-significant-word OR (trigram index backs the
      // title ilike) so "app crashes on session timeout" still surfaces
      // "Session dropped…" and "App crashes on opening…".
      const words = [
        ...new Set(
          q
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((w) => w.length >= 4),
        ),
      ].slice(0, 6);
      let byWord: BasePageEntry[] = [];
      if (words.length) {
        const { data } = await supabase
          .from("base_page")
          .select("*")
          .eq("source_type", "master_bug")
          .or(words.map((w) => `title.ilike.%${w}%`).join(","))
          .limit(8);
        byWord = data ?? [];
      }
      const merged = [...(whole ?? [])];
      const seen = new Set(merged.map((m) => m.id));
      for (const m of byWord) if (!seen.has(m.id)) merged.push(m);
      setDupes(merged.slice(0, 5));
    }, 250);
    return () => clearTimeout(t);
  }, [title, open]);

  // Auto-severity suggestion (keyword hints). Never forces — only fills
  // until the user changes it themselves.
  const autoSev = useMemo(
    () => suggestSeverity(`${title} ${description}`, categories),
    [title, description, categories],
  );
  useEffect(() => {
    if (!severityTouched && autoSev) setSeverity(autoSev.severity);
  }, [autoSev, severityTouched]);

  function applyCategoryTemplate(id: string) {
    setCategoryId(id);
    const cat = categories.find((c) => c.id === id);
    if (!cat) return;
    if (cat.template_steps && (!steps.trim() || confirmReplace())) {
      setSteps(cat.template_steps);
    }
    if (!severityTouched && cat.default_severity) setSeverity(cat.default_severity);
  }
  function confirmReplace() {
    return window.confirm("Replace the current steps with this category's template?");
  }

  function useMaster(mb: BasePageEntry) {
    setTitle(mb.title);
    setDescription(mb.description ?? "");
    setSteps(mb.steps_to_reproduce ?? "");
    setSeverity(mb.severity);
    setSeverityTouched(true);
    setCategoryId(mb.category_id ?? "");
    setBasePageId(mb.id);
    setDupes([]);
  }

  function reset() {
    setTitle("");
    setDescription("");
    setSteps("");
    setSeverity("minor");
    setSeverityTouched(false);
    setPriority("medium");
    setCategoryId("");
    setRequirementId("");
    setAssigneeId("");
    setDueIso(null);
    setDueErr(null);
    setBasePageId(null);
    setDupes([]);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.from("bugs").insert({
      project_id: projectId,
      title: title.trim(),
      description: description.trim() || null,
      steps_to_reproduce: steps.trim() || null,
      severity,
      priority: priority as never,
      category_id: categoryId || null,
      requirement_id: requirementId || null,
      assignee_id: assigneeId || null,
      due_date: dueIso,
      base_page_id: basePageId,
    });

    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }

    // If copied from the library, bump the reuse counter (informational only).
    if (basePageId) {
      const mb = dupes.find((d) => d.id === basePageId) ?? seed;
      await supabase
        .from("base_page")
        .update({
          times_reused: (mb?.times_reused ?? 0) + 1,
          last_reused_at: new Date().toISOString(),
        })
        .eq("id", basePageId);
    }

    setBusy(false);
    reset();
    onClose();
    router.refresh();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-stretch justify-center overflow-y-auto bg-slate-900/40 sm:items-start sm:p-8"
      onClick={() => {
        reset();
        onClose();
      }}
    >
      <div
        className="flex min-h-full w-full max-w-2xl flex-col bg-white shadow-xl sm:min-h-0 sm:rounded-sm sm:border sm:border-grid-line"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-grid-line bg-white px-4 py-3 sm:px-5">
          <h2 className="font-semibold text-slate-800">Log a bug</h2>
          <button
            onClick={() => {
              reset();
              onClose();
            }}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={submit}
          className="flex-1 space-y-4 overflow-y-auto p-4 sm:max-h-[75vh] sm:p-5"
        >
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Title
            </label>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="Short summary of the bug"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40"
            />

            {dupes.length > 0 && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2">
                <p className="mb-1 text-xs font-medium text-amber-800">
                  Similar bugs in the master library — reuse instead of
                  retyping?
                </p>
                <ul className="space-y-1">
                  {dupes.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        <Badge
                          tone={
                            d.severity === "critical"
                              ? "red"
                              : d.severity === "major"
                                ? "amber"
                                : "slate"
                          }
                        >
                          {SEVERITY_LABELS[d.severity]}
                        </Badge>{" "}
                        {d.title}
                      </span>
                      <button
                        type="button"
                        onClick={() => useMaster(d)}
                        className="shrink-0 rounded bg-brand px-2 py-0.5 text-xs font-medium text-white hover:bg-brand-fg"
                      >
                        Use this
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {basePageId && (
              <p className="mt-1 text-xs text-slate-500">
                Copied from a library entry (historical link only — edits
                won&apos;t sync back).
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Category (pre-fills steps + severity)
              </label>
              <select
                value={categoryId}
                onChange={(e) => applyCategoryTemplate(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— none —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Severity
                {autoSev && !severityTouched && (
                  <span className="ml-1 text-xs font-normal text-brand">
                    (suggested: {SEVERITY_LABELS[autoSev.severity]})
                  </span>
                )}
              </label>
              <select
                value={severity}
                onChange={(e) => {
                  setSeverity(e.target.value as Severity);
                  setSeverityTouched(true);
                }}
                className={cx(
                  "w-full rounded-md border px-3 py-2 text-sm",
                  autoSev && !severityTouched
                    ? "border-brand/50 bg-brand/5"
                    : "border-slate-300",
                )}
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABELS[s]}
                  </option>
                ))}
              </select>
              {autoSev && autoSev.matched.length > 0 && !severityTouched && (
                <p className="mt-1 text-xs text-slate-400">
                  matched: {autoSev.matched.join(", ")}
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Steps to reproduce
            </label>
            <textarea
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              rows={5}
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-brand/40"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p[0].toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Violates requirement
              </label>
              <select
                value={requirementId}
                onChange={(e) => setRequirementId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— none —</option>
                {requirements.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Assign to
              </label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— unassigned —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name}
                    {m.roles?.label ? ` · ${m.roles.label}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Due{" "}
                <span className="font-normal text-slate-400">
                  — e.g. 3d, 4h, tomorrow 9am
                </span>
              </label>
              <DueInput
                value={dueIso}
                onCommit={setDueIso}
                onError={setDueErr}
              />
              {dueErr && (
                <p className="mt-1 text-xs text-red-600">{dueErr}</p>
              )}
            </div>
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              {busy ? "Saving…" : "Create bug"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
