"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Badge, PageHeader, EmptyState, cx } from "@/components/ui";
import { SEVERITY_LABELS } from "@/lib/severity";
import { fmtDate, titleCase } from "@/lib/format";
import { exportRows } from "@/lib/export";
import { canCreateBugs, canManageMasterLibrary } from "@/lib/permissions";
import ImportBugsDialog from "@/components/ImportBugsDialog";
import AreaChip from "@/components/AreaChip";
import { AREAS, AREA_SHORT, AREA_LABELS, isBugArea, suggestArea } from "@/lib/bug-area";
import type { BugArea } from "@/lib/bug-area";
import { SEVERITIES } from "@/lib/types/models";
import type {
  BasePageEntry,
  BugCategory,
  Project,
  RoleLevel,
  Severity,
} from "@/lib/types/models";

type Tab = "android" | "ios" | "unassigned";
const TAB_LABEL: Record<Tab, string> = { android: "Android", ios: "iOS", unassigned: "Unassigned" };
const other = (p: "android" | "ios") => (p === "android" ? "ios" : "android");

/** The Android list connects only to Android projects and the iOS list only to
 * iOS projects. Unassigned entries have no platform yet, so they can go to any
 * project until they are classified. Projects with no platform set never match
 * an Android/iOS entry. */
function projectMatchesEntry(
  p: { platform: string | null },
  m: { platform: string | null },
): boolean {
  return !m.platform || p.platform === m.platform;
}

export default function MasterLibrary({
  initial,
  categories,
  projects,
  role,
  userId,
}: {
  initial: BasePageEntry[];
  categories: BugCategory[];
  projects: Pick<Project, "id" | "name" | "platform">[];
  role: RoleLevel;
  userId: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const canManage = canManageMasterLibrary(role);
  // Adding library bugs to a project is QA's job: developers don't see "Copy to project" (RLS: bugs_qa_insert).
  const canCopy = canCreateBugs(role);

  const [rows, setRows] = useState(initial);
  // Android and iOS bugs are kept in separate lists; "unassigned" holds
  // entries nobody has classified yet (nothing is guessed).
  const [tab, setTab] = useState<Tab>("android");
  const [counts, setCounts] = useState<Record<Tab, number>>({ android: 0, ios: 0, unassigned: 0 });
  const [np, setNp] = useState<"android" | "ios">("android");
  const [q, setQ] = useState("");
  const [fSeverity, setFSeverity] = useState("");
  const [fCategory, setFCategory] = useState("");
  const [fArea, setFArea] = useState(""); // "" = all, "none" = not set
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
  const [narea, setNarea] = useState<BugArea | "">(""); // "" = use the suggestion
  const [ntags, setNtags] = useState("");
  const [dupes, setDupes] = useState<BasePageEntry[]>([]);

  // `initial` is only the first paint (the default Android tab). After that the
  // list is owned by the per-tab query below; re-applying `initial` on every
  // router.refresh() would swap other tabs' lists for the Android one.

  // Server-side search across title/description/tags via ilike + trigram.
  useEffect(() => {
    const t = setTimeout(async () => {
      let query = supabase
        .from("base_page")
        .select("*")
        .eq("source_type", "master_bug");
      query = tab === "unassigned" ? query.is("platform", null) : query.eq("platform", tab);
      if (q.trim()) {
        const s = `%${q.trim()}%`;
        query = query.or(
          `title.ilike.${s},description.ilike.${s},steps_to_reproduce.ilike.${s}`,
        );
      }
      if (fSeverity) query = query.eq("severity", fSeverity as never);
      if (fCategory) query = query.eq("category_id", fCategory);
      if (fArea) query = fArea === "none" ? query.is("area", null) : query.eq("area", fArea);
      const { data } = await query
        .order("times_reused", { ascending: false })
        .limit(100);
      let list = data ?? [];
      if (q.trim()) {
        const s = q.trim().toLowerCase();
        // include tag matches the OR filter can't express directly
        let allQ = supabase
          .from("base_page")
          .select("*")
          .eq("source_type", "master_bug");
        allQ = tab === "unassigned" ? allQ.is("platform", null) : allQ.eq("platform", tab);
        const { data: all } = await allQ;
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
  }, [q, fSeverity, fCategory, fArea, refetchKey, tab]);

  // Per-platform counts for the tab badges.
  useEffect(() => {
    supabase
      .from("base_page")
      .select("platform")
      .eq("source_type", "master_bug")
      .then(({ data }) => {
        const c: Record<Tab, number> = { android: 0, ios: 0, unassigned: 0 };
        for (const r of data ?? []) c[(r.platform as "android" | "ios" | null) ?? "unassigned"]++;
        setCounts(c);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetchKey]);

  // New entries default to the tab you're looking at.
  useEffect(() => {
    if (tab !== "unassigned") setNp(tab);
  }, [tab]);

  // Live duplicate check for the "New entry" form — as the user types a
  // title, surface existing master-library entries that look like the same
  // bug so they reuse/search instead of adding a duplicate row.
  useEffect(() => {
    if (!showNew) {
      setDupes([]);
      return;
    }
    const query = nt.trim();
    if (query.length < 3) {
      setDupes([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data: whole } = await supabase
        .from("base_page")
        .select("*")
        .eq("source_type", "master_bug")
        .eq("platform", np)
        .ilike("title", `%${query}%`)
        .limit(5);

      // Broaden with a per-significant-word OR so re-worded restatements of
      // an existing bug still surface (trigram index backs the title ilike).
      const words = [
        ...new Set(
          query
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
          .eq("platform", np)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nt, showNew, np]);

  const catName = (id: string | null) =>
    id ? (categories.find((c) => c.id === id)?.name ?? "—") : "—";

  async function copyToProject(mb: BasePageEntry, projectId: string) {
    setErr(null);
    setMsg(null);
    if (!canCopy) return;
    // Enforced here as well as in the dropdown, so a stale or hand-built call
    // can't put an iOS library bug into an Android project (or vice versa).
    const target = projects.find((x) => x.id === projectId);
    if (!target || !projectMatchesEntry(target, mb)) {
      return setErr(
        `"${mb.title}" is on the ${mb.platform === "ios" ? "iOS" : "Android"} list and can only be copied into ${
          mb.platform === "ios" ? "iOS" : "Android"
        } projects.`,
      );
    }
    const { error } = await supabase.from("bugs").insert({
      project_id: projectId,
      title: mb.title,
      description: mb.description,
      steps_to_reproduce: mb.steps_to_reproduce,
      severity: mb.severity,
      area: mb.area,
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
    if (dupes.length > 0) {
      const ok = window.confirm(
        `${dupes.length} similar ${
          dupes.length === 1 ? "entry" : "entries"
        } already exist in the master library:\n\n` +
          dupes.map((d) => `• ${d.title}`).join("\n") +
          `\n\nAdd this as a new entry anyway?`,
      );
      if (!ok) return;
    }
    const { error } = await supabase.from("base_page").insert({
      source_type: "master_bug",
      platform: np,
      title: nt.trim(),
      description: nd.trim() || null,
      steps_to_reproduce: ns.trim() || null,
      severity: nsev,
      area: narea || newAreaSuggestion?.area || null,
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
    setNarea("");
    setNtags("");
    setDupes([]);
    setShowNew(false);
    setRefetchKey((k) => k + 1);
    router.refresh();
  }

  async function setPlatform(id: string, platform: "android" | "ios") {
    setErr(null);
    const { error } = await supabase.from("base_page").update({ platform }).eq("id", id);
    if (error) return setErr(error.message);
    setRefetchKey((k) => k + 1);
    router.refresh();
  }

  async function assignAll(platform: "android" | "ios") {
    if (!confirm(`Assign all ${counts.unassigned} unassigned entries to ${TAB_LABEL[platform]}? You can still copy or move individual entries afterwards.`)) return;
    setErr(null);
    const { error } = await supabase
      .from("base_page")
      .update({ platform })
      .eq("source_type", "master_bug")
      .is("platform", null);
    if (error) return setErr(error.message);
    setMsg(`Assigned ${counts.unassigned} entries to ${TAB_LABEL[platform]}.`);
    setTab(platform);
    setRefetchKey((k) => k + 1);
    router.refresh();
  }

  // Same bug on the other platform: a new, independent entry (no live link),
  // mirroring how bugs are copied between a house's Android/iOS projects.
  async function copyToPlatform(mb: BasePageEntry, platform: "android" | "ios") {
    setErr(null);
    setMsg(null);
    const { error } = await supabase.from("base_page").insert({
      source_type: "master_bug",
      platform,
      title: mb.title,
      description: mb.description,
      steps_to_reproduce: mb.steps_to_reproduce,
      severity: mb.severity,
      area: mb.area,
      category_id: mb.category_id,
      tags: mb.tags,
      created_by: userId,
    });
    if (error) return setErr(error.message);
    setMsg(`Copied "${mb.title}" to ${TAB_LABEL[platform]}.`);
    setRefetchKey((k) => k + 1);
    router.refresh();
  }

  // Frontend / backend on a library entry (migration 0041); copied into every bug made from it.
  async function setEntryArea(id: string, area: BugArea | null) {
    setErr(null);
    const { error } = await supabase.from("base_page").update({ area }).eq("id", id);
    if (error) return setErr(error.message);
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, area } : r)));
  }
  const newAreaSuggestion = suggestArea(`${nt} ${nd} ${ns}`, categories, ncat || null);

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
        platform: m.platform ? TAB_LABEL[m.platform as Tab] : "Unassigned",
        title: m.title,
        description: m.description,
        steps_to_reproduce: m.steps_to_reproduce,
        severity: m.severity,
        area: isBugArea(m.area) ? AREA_SHORT[m.area] : "",
        category: catName(m.category_id),
        tags: m.tags,
        times_reused: m.times_reused,
      })),
      [
        { key: "platform", header: "Platform" },
        { key: "title", header: "Title" },
        { key: "description", header: "Description" },
        { key: "steps_to_reproduce", header: "Steps to Reproduce" },
        { key: "severity", header: "Severity" },
        { key: "area", header: "Area" },
        { key: "category", header: "Category" },
        { key: "tags", header: "Tags" },
        { key: "times_reused", header: "Times Reused" },
      ],
      `master-bug-library-${tab}`,
      `Master Bugs (${TAB_LABEL[tab]})`,
    ).catch((e) => window.alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  return (
    <div>
      <PageHeader
        title="Master Bug Library"
        subtitle="Shared across every project, kept separately for Android and iOS. Pulling a bug in copies it as a new, independent row — no live link back."
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
            {dupes.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5">
                <p className="mb-1 text-xs font-medium text-amber-800">
                  ⚠ {dupes.length} similar{" "}
                  {dupes.length === 1 ? "entry is" : "entries are"} already in
                  the master library — check before adding a duplicate:
                </p>
                <ul className="space-y-1">
                  {dupes.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center gap-2 rounded bg-white px-2 py-1 text-sm"
                    >
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
                      </Badge>
                      <span className="min-w-0 truncate">{d.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-slate-400">
                        reused {d.times_reused}×
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
            <div className="grid gap-2 sm:grid-cols-5">
              <select
                value={np}
                onChange={(e) => setNp(e.target.value as "android" | "ios")}
                className="rounded-md border border-slate-300 px-2 py-2 text-sm"
              >
                <option value="android">Android</option>
                <option value="ios">iOS</option>
              </select>
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
                value={narea}
                onChange={(e) => setNarea(e.target.value as BugArea | "")}
                className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                aria-label="Area"
              >
                <option value="">
                  {newAreaSuggestion ? `Area: ${AREA_SHORT[newAreaSuggestion.area]} (suggested)` : "Area: not set"}
                </option>
                {AREAS.map((a) => (
                  <option key={a} value={a}>
                    {AREA_LABELS[a]}
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

      <div className="mb-3 flex gap-1 border-b border-slate-200">
        {(["android", "ios", "unassigned"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx(
              "-mb-px rounded-t-md border px-2.5 py-2 text-sm font-medium sm:px-4",
              tab === t
                ? "border-slate-200 border-b-white bg-white text-brand-fg"
                : "border-transparent text-slate-500 hover:text-slate-700",
            )}
          >
            {TAB_LABEL[t]}
            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
              {counts[t]}
            </span>
          </button>
        ))}
      </div>
      {tab === "unassigned" && counts.unassigned > 0 && (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          These entries predate the Android/iOS split. Assign each one to a platform so it shows up in the right list.
          {canManage && (
            <span className="ml-2 whitespace-nowrap">
              Or assign all:{" "}
              <button onClick={() => assignAll("android")} className="font-medium underline">
                Android
              </button>{" "}
              ·{" "}
              <button onClick={() => assignAll("ios")} className="font-medium underline">
                iOS
              </button>
            </span>
          )}
        </p>
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
        <select
          value={fArea}
          onChange={(e) => setFArea(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5"
        >
          <option value="">All areas</option>
          {AREAS.map((a) => (
            <option key={a} value={a}>
              {AREA_SHORT[a]}
            </option>
          ))}
          <option value="none">Area not set</option>
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
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
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
                    <Badge tone={m.platform === "ios" ? "amber" : m.platform === "android" ? "green" : "slate"}>
                      {m.platform ? TAB_LABEL[m.platform as Tab] : "Unassigned"}
                    </Badge>
                    {canManage ? (
                      <select
                        value={m.area ?? ""}
                        onChange={(e) => setEntryArea(m.id, (e.target.value || null) as BugArea | null)}
                        className="rounded-full border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-700"
                        aria-label="Area"
                      >
                        <option value="">Area not set</option>
                        {AREAS.map((a) => (
                          <option key={a} value={a}>
                            {AREA_SHORT[a]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <AreaChip area={m.area} />
                    )}
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
                    <span className="text-xs text-slate-400" suppressHydrationWarning>
                      reused {m.times_reused}×
                      {m.last_reused_at
                        ? ` · last ${fmtDate(m.last_reused_at)}`
                        : ""}
                    </span>
                  </div>
                </div>

                <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 sm:w-auto sm:max-w-[15rem] sm:shrink-0 sm:flex-col sm:items-end">
                  {canCopy && (
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) copyToProject(m, e.target.value);
                      e.target.value = "";
                    }}
                    className="w-full max-w-full rounded-md border border-brand/40 bg-brand/5 px-2 py-1.5 text-xs text-brand-fg sm:w-auto sm:py-1"
                  >
                    <option value="">Copy to project…</option>
                    {projects
                      .filter((p) => projectMatchesEntry(p, m))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                  )}
                  {canManage && !m.platform && (
                    <div className="flex gap-2 text-xs">
                      <button onClick={() => setPlatform(m.id, "android")} className="text-brand-fg hover:underline">
                        → Android
                      </button>
                      <button onClick={() => setPlatform(m.id, "ios")} className="text-brand-fg hover:underline">
                        → iOS
                      </button>
                    </div>
                  )}
                  {canManage && m.platform && (
                    <button
                      onClick={() => copyToPlatform(m, other(m.platform as "android" | "ios"))}
                      className="text-xs text-brand-fg hover:underline"
                    >
                      Copy to {TAB_LABEL[other(m.platform as "android" | "ios")]}
                    </button>
                  )}
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
