"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Badge, PageHeader, EmptyState, cx } from "@/components/ui";
import { SEVERITY_LABELS } from "@/lib/severity";
import { fmtDate, titleCase } from "@/lib/format";
import { exportRows } from "@/lib/export";
import { canManageMasterLibrary } from "@/lib/permissions";
import ImportBugsDialog from "@/components/ImportBugsDialog";
import { SEVERITIES } from "@/lib/types/models";
import type {
  BasePageEntry,
  BugCategory,
  Project,
  RoleLevel,
  Severity,
} from "@/lib/types/models";

export default function MasterLibrary({
  initial,
  categories,
  projects,
  role,
  userId,
}: {
  initial: BasePageEntry[];
  categories: BugCategory[];
  projects: Pick<Project, "id" | "name">[];
  role: RoleLevel;
  userId: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const canManage = canManageMasterLibrary(role);

  const [rows, setRows] = useState(initial);
  const [q, setQ] = useState("");
  const [fSeverity, setFSeverity] = useState("");
  const [fCategory, setFCategory] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [refetchKey, setRefetchKey] = useState(0);

  const [nt, setNt] = useState("");
  const [nd, setNd] = useState("");
  const [ns, setNs] = useState("");
  const [nsev, setNsev] = useState<Severity>("minor");
  const [ncat, setNcat] = useState("");
  const [ntags, setNtags] = useState("");

  useEffect(() => setRows(initial), [initial]);

  // Server-side search across title/description/tags via ilike + trigram.
  useEffect(() => {
    const t = setTimeout(async () => {
      let query = supabase
        .from("base_page")
        .select("*")
        .eq("source_type", "master_bug");
      if (q.trim()) {
        const s = `%${q.trim()}%`;
        query = query.or(
          `title.ilike.${s},description.ilike.${s},steps_to_reproduce.ilike.${s}`,
        );
      }
      if (fSeverity) query = query.eq("severity", fSeverity as never);
      if (fCategory) query = query.eq("category_id", fCategory);
      const { data } = await query
        .order("times_reused", { ascending: false })
        .limit(100);
      let list = data ?? [];
      if (q.trim()) {
        const s = q.trim().toLowerCase();
        // include tag matches the OR filter can't express directly
        const { data: all } = await supabase
          .from("base_page")
          .select("*")
          .eq("source_type", "master_bug");
        const tagMatches = (all ?? []).filter((m) =>
          (m.tags ?? []).some((tg) => tg.toLowerCase().includes(s)),
        );
        const seen = new Set(list.map((x) => x.id));
        list = [...list, ...tagMatches.filter((m) => !seen.has(m.id))];
      }
      setRows(list);
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, fSeverity, fCategory, refetchKey]);

  const catName = (id: string | null) =>
    id ? (categories.find((c) => c.id === id)?.name ?? "—") : "—";

  async function copyToProject(mb: BasePageEntry, projectId: string) {
    setErr(null);
    setMsg(null);
    const { error } = await supabase.from("bugs").insert({
      project_id: projectId,
      title: mb.title,
      description: mb.description,
      steps_to_reproduce: mb.steps_to_reproduce,
      severity: mb.severity,
      category_id: mb.category_id,
      base_page_id: mb.id,
      created_by: userId,
    });
    if (error) return setErr(error.message);
    await supabase
      .from("base_page")
      .update({
        times_reused: mb.times_reused + 1,
        last_reused_at: new Date().toISOString(),
      })
      .eq("id", mb.id);
    const p = projects.find((x) => x.id === projectId);
    setMsg(`Copied "${mb.title}" into ${p?.name}. It's now an independent row.`);
    setRefetchKey((k) => k + 1);
    router.refresh();
  }

  async function addMaster(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const { error } = await supabase.from("base_page").insert({
      source_type: "master_bug",
      title: nt.trim(),
      description: nd.trim() || null,
      steps_to_reproduce: ns.trim() || null,
      severity: nsev,
      category_id: ncat || null,
      tags: ntags
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      created_by: userId,
    });
    if (error) return setErr(error.message);
    setNt("");
    setNd("");
    setNs("");
    setNsev("minor");
    setNcat("");
    setNtags("");
    setShowNew(false);
    setRefetchKey((k) => k + 1);
    router.refresh();
  }

  async function del(id: string) {
    if (!confirm("Delete this master library entry?")) return;
    const { error } = await supabase.from("base_page").delete().eq("id", id);
    if (error) setErr(error.message);
    else {
      setRefetchKey((k) => k + 1);
      router.refresh();
    }
  }

  function doExport() {
    exportRows(
      rows.map((m) => ({
        title: m.title,
        description: m.description,
        steps_to_reproduce: m.steps_to_reproduce,
        severity: m.severity,
        category: catName(m.category_id),
        tags: m.tags,
        times_reused: m.times_reused,
      })),
      [
        { key: "title", header: "Title" },
        { key: "description", header: "Description" },
        { key: "steps_to_reproduce", header: "Steps to Reproduce" },
        { key: "severity", header: "Severity" },
        { key: "category", header: "Category" },
        { key: "tags", header: "Tags" },
        { key: "times_reused", header: "Times Reused" },
      ],
      "master-bug-library",
      "Master Bugs",
    );
  }

  return (
    <div>
      <PageHeader
        title="Master Bug Library"
        subtitle="Shared across every project. Pulling a bug in copies it as a new, independent row — no live link back."
        actions={
          <>
            <Button variant="secondary" onClick={doExport}>
              Export .xlsx
            </Button>
            {canManage && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setShowImport(true)}
                >
                  Import from Excel
                </Button>
                <Button onClick={() => setShowNew((s) => !s)}>+ New entry</Button>
              </>
            )}
          </>
        }
      />

      {showImport && canManage && (
        <ImportBugsDialog
          categories={categories}
          userId={userId}
          onClose={() => setShowImport(false)}
          onDone={(n) => {
            setShowImport(false);
            setMsg(`Imported ${n} bug${n === 1 ? "" : "s"} into the library.`);
            setRefetchKey((k) => k + 1);
            router.refresh();
          }}
        />
      )}

      {showNew && canManage && (
        <Card className="mb-4 p-4">
          <form onSubmit={addMaster} className="space-y-2">
            <input
              placeholder="Title"
              required
              value={nt}
              onChange={(e) => setNt(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <textarea
              placeholder="Description"
              rows={2}
              value={nd}
              onChange={(e) => setNd(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <textarea
              placeholder="Steps to reproduce"
              rows={3}
              value={ns}
              onChange={(e) => setNs(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            />
            <div className="grid gap-2 sm:grid-cols-3">
              <select
                value={nsev}
                onChange={(e) => setNsev(e.target.value as Severity)}
                className="rounded-md border border-slate-300 px-2 py-2 text-sm"
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABELS[s]}
                  </option>
                ))}
              </select>
              <select
                value={ncat}
                onChange={(e) => setNcat(e.target.value)}
                className="rounded-md border border-slate-300 px-2 py-2 text-sm"
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="tags, comma, separated"
                value={ntags}
                onChange={(e) => setNtags(e.target.value)}
                className="rounded-md border border-slate-300 px-2 py-2 text-sm"
              />
            </div>
            <Button type="submit" disabled={!nt.trim()}>
              Save entry
            </Button>
          </form>
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <input
          autoFocus
          placeholder="Search title, description, steps, tags…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-72 rounded-md border border-slate-300 px-2.5 py-1.5"
        />
        <select
          value={fSeverity}
          onChange={(e) => setFSeverity(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5"
        >
          <option value="">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={fCategory}
          onChange={(e) => setFCategory(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {err && (
        <p className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </p>
      )}
      {msg && (
        <p className="mb-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          {msg}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState title="No matching library entries" />
      ) : (
        <div className="space-y-2">
          {rows.map((m) => (
            <Card key={m.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        m.severity === "critical"
                          ? "red"
                          : m.severity === "major"
                            ? "amber"
                            : "slate"
                      }
                    >
                      {SEVERITY_LABELS[m.severity]}
                    </Badge>
                    <h3 className="font-semibold text-slate-800">{m.title}</h3>
                    <span className="text-xs text-slate-400">
                      {catName(m.category_id)}
                    </span>
                  </div>
                  {m.description && (
                    <p className="mt-1 text-sm text-slate-600">
                      {m.description}
                    </p>
                  )}
                  {m.steps_to_reproduce && (
                    <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-xs text-slate-600">
                      {m.steps_to_reproduce}
                    </pre>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {(m.tags ?? []).map((t) => (
                      <span
                        key={t}
                        className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500"
                      >
                        #{t}
                      </span>
                    ))}
                    <span className="text-xs text-slate-400">
                      reused {m.times_reused}×
                      {m.last_reused_at
                        ? ` · last ${fmtDate(m.last_reused_at)}`
                        : ""}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) copyToProject(m, e.target.value);
                      e.target.value = "";
                    }}
                    className="rounded-md border border-brand/40 bg-brand/5 px-2 py-1 text-xs text-brand-fg"
                  >
                    <option value="">Copy to project…</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {canManage && (
                    <button
                      onClick={() => del(m.id)}
                      className="text-xs text-slate-400 hover:text-red-600"
                    >
                      delete
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
