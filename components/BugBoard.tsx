"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Button,
  cx,
  PageHeader,
  EmptyState,
  Badge,
  ViewToggle,
  Fab,
} from "@/components/ui";
import NewBugDialog from "@/components/NewBugDialog";
import BugDrawer from "@/components/BugDrawer";
import DueInput from "@/components/DueInput";
import VersionChip from "@/components/VersionChip";
import VersionsPanel from "@/components/VersionsPanel";
import AreaChip from "@/components/AreaChip";
import AssigneeOptions from "@/components/AssigneeOptions";
import ClassifyAreaDialog from "@/components/ClassifyAreaDialog";
import { NO_DEVELOPERS, areaPatch, isArea, peopleForArea, shortLabel, skillsOf } from "@/lib/bug-area";
import { useRoleCategories } from "@/components/RoleCategories";
import type { AreaDevelopers, BugArea } from "@/lib/bug-area";
import { SEVERITY_LABELS } from "@/lib/severity";
import { fmtDateTime, titleCase } from "@/lib/format";
import { fmtDueShort } from "@/lib/parseDue";
import { exportRows, loadBugScreenshots } from "@/lib/export";
import {
  canCreateBugs,
  canEditBug,
  developerStatusTargets,
  isManager,
} from "@/lib/permissions";
import { useGridNav } from "@/lib/useGridNav";
import { useIsMobile } from "@/lib/useIsMobile";
import type {
  BugWithJoins,
  BugCategory,
  MemberOption,
  ReleaseOption,
  Requirement,
  RoleLevel,
  Severity,
} from "@/lib/types/models";
import { SEVERITIES, PRIORITIES, BUG_STATUSES } from "@/lib/types/models";

type Props = {
  projectId: string;
  projectName: string;
  initialBugs: BugWithJoins[];
  categories: BugCategory[];
  requirements: Pick<Requirement, "id" | "title">[];
  /** The project's app versions (releases) a bug can be filed under, newest first. */
  releases: ReleaseOption[];
  currentVersion: string | null;
  members: MemberOption[];
  role: RoleLevel;
  userId: string;
  /** This house's Android/iOS sibling project, if platform-split. */
  siblingProject: { id: string; name: string; platform: string } | null;
  /** The project's platform: only people who can see it are offered as assignees. */
  projectPlatform?: string | null;
  /** The project's developers: per area (migration 0041) and for bugs with no area (0035). */
  projectDevelopers?: AreaDevelopers;
};

type SortKey = "title" | "severity" | "area" | "priority" | "status" | "due_date";
const SEV_RANK: Record<Severity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
  trivial: 3,
};
const NAV_COLS = 8; // title, severity, area, priority, status, assignee, category, due

export default function BugBoard({
  projectId,
  projectName,
  initialBugs,
  categories,
  requirements,
  releases,
  currentVersion,
  members,
  role,
  userId,
  siblingProject,
  projectPlatform = null,
  projectDevelopers = NO_DEVELOPERS,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const isMobile = useIsMobile();
  // Role categories (migration 0043), in their admin-set order.
  const roleCats = useRoleCategories();
  const areaRank = (a: string | null) => {
    const i = roleCats.findIndex((c) => c.key === a);
    return i === -1 ? roleCats.length : i;
  };
  const areaShort = (a: string | null) => shortLabel(roleCats, a);
  const [bugs, setBugs] = useState(initialBugs);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showNew, setShowNew] = useState(false);
  const [view, setView] = useState<"cards" | "sheet">("sheet");
  const [viewTouched, setViewTouched] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(
    params.get("focus") || params.get("bug"),
  );
  // A link to a bug (a notification -> /bugs/<id> -> ?focus=<id>) opens its drawer, also when this page is
  // already open. Only a change of the value counts, so a refresh never reopens a drawer the user closed.
  const focusParam = params.get("focus") || params.get("bug");
  const lastFocus = useRef(focusParam);
  useEffect(() => {
    if (focusParam && focusParam !== lastFocus.current) setDrawerId(focusParam);
    lastFocus.current = focusParam;
  }, [focusParam]);
  const closeDrawer = useCallback(() => {
    setDrawerId(null);
    if (params.get("focus") || params.get("bug")) {
      // drop ?focus= so the next link to the same bug opens it again
      const next = new URLSearchParams(params.toString());
      next.delete("focus");
      next.delete("bug");
      router.replace(`${window.location.pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    }
  }, [params, router]);
  const [err, setErr] = useState<string | null>(null);
  const lastClickedRow = useRef<number | null>(null);

  const [q, setQ] = useState("");
  const [fSeverity, setFSeverity] = useState("");
  const [fArea, setFArea] = useState(""); // "" = all, "none" = not set
  const [classifying, setClassifying] = useState(false);
  const [moveAutoAssigned, setMoveAutoAssigned] = useState(true);
  const [fStatus, setFStatus] = useState("");
  const [fVersion, setFVersion] = useState(""); // "" = all, "none" = no version
  const [fAssignee, setFAssignee] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [hideClosed, setHideClosed] = useState(true);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "due_date",
    dir: 1,
  });

  useEffect(() => setBugs(initialBugs), [initialBugs]);
  useEffect(() => {
    if (!viewTouched) setView(isMobile ? "cards" : "sheet");
  }, [isMobile, viewTouched]);
  const pickView = (v: "cards" | "sheet") => {
    setViewTouched(true);
    setView(v);
  };
  const refresh = useCallback(() => router.refresh(), [router]);

  // full list resolves names; only assignable users who can see this project appear in pickers:
  // their role's platform is none or this project's, or they are in a role category that spans
  // Android and iOS (backend, DBA; migration 0043), which lets them see every platform.
  const crossPlatform = useMemo(
    () => new Set(roleCats.filter((c) => c.all_platforms).map((c) => c.key)),
    [roleCats],
  );
  const onPlatform = useCallback(
    (m: MemberOption) => !m.roles?.platform || m.roles.platform === projectPlatform,
    [projectPlatform],
  );
  const assignable = useMemo(
    () =>
      members.filter(
        (m) =>
          m.roles?.assignable !== false &&
          (onPlatform(m) || skillsOf(m.skills).some((k) => crossPlatform.has(k))),
      ),
    [members, onPlatform, crossPlatform],
  );
  const developers = useMemo(
    () => assignable.filter((m) => m.roles?.level === "contributor"),
    [assignable],
  );
  const [devBusy, setDevBusy] = useState(false);
  const [devMsg, setDevMsg] = useState<string | null>(null);

  // A developer per area: they get every open, unassigned bug of that area now and every new one
  // from here on (assign_project_developer, migrations 0035 + 0041). area null = bugs with no area.
  async function assignProjectDeveloper(area: BugArea | null, developerId: string | null) {
    const name = developerId ? memberNameOf(developerId) : null;
    const which = area ? `${areaShort(area)} bugs` : "bugs with no category";
    if (
      developerId &&
      !confirm(`Make ${name} the developer for ${which}? Every open, unassigned one goes to them now, and every new one will too.`)
    )
      return;
    setErr(null);
    setDevMsg(null);
    setDevBusy(true);
    const { data, error } = await createClient().rpc("assign_project_developer", {
      p_project: projectId,
      p_developer: developerId,
      p_area: area,
    });
    setDevBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setDevMsg(
      developerId
        ? `${name} now gets ${which}: ${data ?? 0} open bug(s) assigned to them.`
        : area
          ? `No project person for ${areaShort(area)}; those bugs go to the least busy person in it, else the developer for bugs with no category.`
          : "No developer for bugs with no area; they stay unassigned.",
    );
    refresh();
  }

  // Set the area of one bug or the selected bugs; open bugs that were auto-routed follow to the
  // new area's developer (areaPatch), bugs someone assigned by hand keep their assignee.
  async function setArea(ids: string[], area: BugArea | null, reassign = true) {
    setErr(null);
    const supabase = createClient();
    for (const id of ids) {
      const b = bugs.find((x) => x.id === id);
      if (!b) continue;
      const { error } = await supabase.from("bugs").update(areaPatch(b, area, projectDevelopers, reassign)).eq("id", id);
      if (error) {
        setErr(error.message);
        break;
      }
    }
    setSelected(new Set());
    refresh();
  }
  function memberNameOf(id: string) {
    return members.find((m) => m.id === id)?.full_name ?? "?";
  }
  const memberName = useCallback(
    (id: string | null) =>
      id ? (members.find((m) => m.id === id)?.full_name ?? "?") : "—",
    [members],
  );

  /** Status picker options: every status for QA/admin; for a developer only the
   *  current one plus In progress / Fixed where allowed (migration 0034). */
  function statusOptions(b: BugWithJoins): string[] {
    if (canEditBug(role, userId, b)) return [...BUG_STATUSES];
    const targets = developerStatusTargets(role, b.status);
    return targets.length ? [b.status, ...targets] : [b.status];
  }

  async function patch(id: string, patch: Record<string, unknown>) {
    setErr(null);
    const prev = bugs;
    setBugs((bs) =>
      bs.map((b) => (b.id === id ? ({ ...b, ...patch } as BugWithJoins) : b)),
    );
    const supabase = createClient();
    const { error } = await supabase
      .from("bugs")
      .update(patch as never)
      .eq("id", id);
    if (error) {
      setErr(error.message);
      setBugs(prev);
    } else refresh();
  }

  async function bulkPatch(patch: Record<string, unknown>) {
    if (selected.size === 0) return;
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("bugs")
      .update(patch as never)
      .in("id", [...selected]);
    if (error) setErr(error.message);
    setSelected(new Set());
    refresh();
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} bug(s)? This cannot be undone.`))
      return;
    const supabase = createClient();
    const { error } = await supabase
      .from("bugs")
      .delete()
      .in("id", [...selected]);
    if (error) setErr(error.message);
    setSelected(new Set());
    refresh();
  }

  async function deleteRow(id: string, title: string) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("bugs").delete().eq("id", id);
    if (error) setErr(error.message);
    refresh();
  }

  const filtered = useMemo(() => {
    let rows = bugs.slice();
    if (hideClosed) rows = rows.filter((b) => b.status !== "closed");
    if (q.trim()) {
      const s = q.toLowerCase();
      rows = rows.filter(
        (b) =>
          b.title.toLowerCase().includes(s) ||
          (b.description ?? "").toLowerCase().includes(s),
      );
    }
    if (fSeverity) rows = rows.filter((b) => b.severity === fSeverity);
    if (fArea) rows = rows.filter((b) => (fArea === "none" ? !isArea(roleCats, b.area) : b.area === fArea));
    if (fStatus) rows = rows.filter((b) => b.status === fStatus);
    if (fVersion) rows = rows.filter((b) => (fVersion === "none" ? !b.release_id : b.release_id === fVersion));
    if (fAssignee)
      rows = rows.filter((b) =>
        fAssignee === "none" ? !b.assignee_id : b.assignee_id === fAssignee,
      );
    if (mineOnly) rows = rows.filter((b) => b.assignee_id === userId);

    rows.sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      switch (sort.key) {
        case "severity":
          av = SEV_RANK[a.severity];
          bv = SEV_RANK[b.severity];
          break;
        case "area":
          av = areaRank(a.area);
          bv = areaRank(b.area);
          break;
        case "priority":
          av = PRIORITIES.indexOf(a.priority);
          bv = PRIORITIES.indexOf(b.priority);
          break;
        case "status":
          av = BUG_STATUSES.indexOf(a.status);
          bv = BUG_STATUSES.indexOf(b.status);
          break;
        case "due_date":
          av = a.due_date ? Date.parse(a.due_date) : Infinity;
          bv = b.due_date ? Date.parse(b.due_date) : Infinity;
          break;
        default:
          av = a.title.toLowerCase();
          bv = b.title.toLowerCase();
      }
      return av < bv ? -sort.dir : av > bv ? sort.dir : 0;
    });
    return rows;
  }, [bugs, q, fSeverity, fArea, fStatus, fVersion, fAssignee, mineOnly, hideClosed, sort, userId]);
  const unclassified = useMemo(
    () => bugs.filter((b) => !isArea(roleCats, b.area) && b.status !== "closed"),
    [bugs, roleCats],
  );

  const grid = useGridNav(filtered.length, NAV_COLS);

  // global shortcuts: n / a / d
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName)) return;
      if (drawerId || showNew) return;
      if (e.key === "n" && canCreateBugs(role)) {
        e.preventDefault();
        setShowNew(true);
      } else if (e.key === "d" && selected.size > 0 && isManager(role)) {
        e.preventDefault();
        bulkPatch({ status: "closed" });
      } else if (e.key === "a" && selected.size > 0 && isManager(role)) {
        e.preventDefault();
        const who = prompt(
          `Assign ${selected.size} bug(s) to (type a name):\n` +
            assignable.map((m) => m.full_name).join("\n"),
        );
        const m = assignable.find(
          (x) => x.full_name.toLowerCase() === (who ?? "").toLowerCase().trim(),
        );
        if (m) bulkPatch({ assignee_id: m.id });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, selected, drawerId, showNew, assignable]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 },
    );
  }

  function toggleRow(rowIndex: number, shift: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && lastClickedRow.current != null) {
        const [a, b] = [lastClickedRow.current, rowIndex].sort((x, y) => x - y);
        for (let i = a; i <= b; i++) next.add(filtered[i].id);
      } else {
        const id = filtered[rowIndex].id;
        next.has(id) ? next.delete(id) : next.add(id);
      }
      return next;
    });
    lastClickedRow.current = rowIndex;
  }

  // null = idle; otherwise the button's progress text.
  const [exporting, setExporting] = useState<string | null>(null);

  // Formatted sheet of the visible bugs, with each bug's screenshots embedded
  // (preview on the Bugs sheet, full size on a "Screenshots" sheet).
  async function doExport() {
    setExporting("Preparing…");
    try {
      const { images, skipped } = await loadBugScreenshots(
        createClient(),
        filtered.map((b) => b.id),
        (done, total) => total && setExporting(`Screenshots ${done}/${total}…`),
      );
      setExporting("Building sheet…");
      await exportBugRows(images);
      if (skipped) {
        window.alert(`${skipped} image attachment(s) were not included (over the limit or could not be read).`);
      }
    } catch (e) {
      window.alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(null);
    }
  }

  function exportBugRows(images: Awaited<ReturnType<typeof loadBugScreenshots>>["images"]) {
    return exportRows(
      filtered.map((b) => ({
        title: b.title,
        description: b.description,
        steps_to_reproduce: b.steps_to_reproduce,
        app_version: b.release?.version ?? "",
        version_confirmed: b.version_confirmed_at
          ? `Yes${b.confirmer?.full_name ? ` (${b.confirmer.full_name})` : ""}, ${fmtDateTime(b.version_confirmed_at)}`
          : b.release_id ? "Not yet" : "",
        severity: b.severity,
        area: areaShort(b.area),
        priority: b.priority,
        status: b.status,
        category: b.category?.name ?? "",
        requirement: b.requirement?.title ?? "",
        assignee: memberName(b.assignee_id),
        due_date: b.due_date ? fmtDateTime(b.due_date) : "",
      })),
      [
        { key: "title", header: "Title" },
        { key: "description", header: "Description" },
        { key: "steps_to_reproduce", header: "Steps to Reproduce" },
        { key: "app_version", header: "App Version" },
        { key: "version_confirmed", header: "Version Confirmed" },
        { key: "severity", header: "Severity" },
        { key: "area", header: "Role Category" },
        { key: "priority", header: "Priority" },
        { key: "status", header: "Status" },
        { key: "category", header: "Category" },
        { key: "requirement", header: "Requirement" },
        { key: "assignee", header: "Assignee" },
        { key: "due_date", header: "Due Date" },
      ],
      `${projectName.replace(/\s+/g, "-")}-bugs`,
      "Bugs",
      { images, imageLabelKey: "title" },
    );
  }

  const drawerBug = bugs.find((b) => b.id === drawerId) ?? null;
  const allSelected =
    filtered.length > 0 && filtered.every((b) => selected.has(b.id));

  const SortHead = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <button
      onClick={() => toggleSort(k)}
      className="flex w-full items-center gap-1 text-left hover:text-slate-900"
    >
      {children}
      <span className="text-[10px] text-slate-400">
        {sort.key === k ? (sort.dir === 1 ? "▲" : "▼") : "↕"}
      </span>
    </button>
  );

  return (
    <div>
      <PageHeader
        title="Bugs"
        subtitle={
          <>
            {filtered.length} rows
            <span className="hidden sm:inline"> · click a cell then use arrow keys · Enter to edit.</span>{" "}
            {isManager(role) && (
              <span className="hidden sm:inline">
                <span className="kbd">n</span> new{" "}
                <span className="kbd">a</span> assign{" "}
                <span className="kbd">d</span> done
              </span>
            )}
          </>
        }
        actions={
          <>
            {isManager(role) && unclassified.length > 0 && (
              <Button variant="secondary" onClick={() => setClassifying(true)} title="Set the role category on bugs that have none">
                Classify {unclassified.length} bug{unclassified.length === 1 ? "" : "s"}
              </Button>
            )}
            <Button variant="secondary" onClick={doExport} disabled={exporting !== null}>
              {exporting ?? "Export .xlsx"}
            </Button>
            {canCreateBugs(role) && (
              <Button
                onClick={() => setShowNew(true)}
                className="hidden sm:inline-flex"
              >
                + New bug
              </Button>
            )}
          </>
        }
      />

      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-grid-line bg-grid-head/40 px-2 py-1.5 text-[13px]">
        <span className="font-medium text-slate-600">Developers:</span>
        {([...roleCats.map((c) => [c.key, c.short_label, projectDevelopers.areas[c.key] ?? null]), [null, "No category", projectDevelopers.none]] as [
          BugArea | null,
          string,
          string | null,
        ][]).map(([area, label, devId]) => {
          // People in this category (Admin -> Role categories); everyone while nobody is in it yet.
          // Only a category that spans Android and iOS may take someone whose role is on the other platform.
          const candidates = area && crossPlatform.has(area) ? developers : developers.filter(onPlatform);
          const { list, matched } = peopleForArea(candidates, area);
          return (
            <label key={label} className="inline-flex items-center gap-1.5">
              <span className="text-slate-500">{label}</span>
              {isManager(role) ? (
                <select
                  value={devId ?? ""}
                  disabled={devBusy}
                  onChange={(e) => assignProjectDeveloper(area, e.target.value || null)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-0.5"
                  title={
                    area && !matched
                      ? `Nobody is in ${areaShort(area)} yet (Admin → Role categories), so every developer is listed`
                      : undefined
                  }
                >
                  <option value="">— none —</option>
                  {devId && !list.some((m) => m.id === devId) && (
                    <option value={devId}>{memberNameOf(devId)}</option>
                  )}
                  {list.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name}
                      {m.roles?.label ? ` · ${m.roles.label}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-slate-800">{devId ? memberNameOf(devId) : "none"}</span>
              )}
            </label>
          );
        })}
        <span className="text-xs text-slate-400">new bugs go to their category&apos;s person, else the least busy person in it</span>
        {devMsg && <span className="text-xs text-green-700">{devMsg}</span>}
      </div>

      <VersionsPanel
        projectId={projectId}
        bugs={bugs}
        releases={releases}
        currentVersion={currentVersion}
        role={role}
        activeFilter={fVersion}
        onFilter={setFVersion}
        onChanged={refresh}
      />

      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[13px]">
        <input
          placeholder="Filter…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-40 rounded-md border border-slate-300 px-2 py-1 sm:w-56"
        />
        <select
          value={fSeverity}
          onChange={(e) => setFSeverity(e.target.value)}
          className="rounded-md border border-slate-300 px-1.5 py-1"
        >
          <option value="">Severity: all</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={fArea}
          onChange={(e) => setFArea(e.target.value)}
          className="rounded-md border border-slate-300 px-1.5 py-1"
          title="Role category (Admin → Role categories)"
        >
          <option value="">Category: all</option>
          {roleCats.map((c) => (
            <option key={c.key} value={c.key}>
              {c.short_label}
            </option>
          ))}
          <option value="none">Not set</option>
        </select>
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
          className="rounded-md border border-slate-300 px-1.5 py-1"
        >
          <option value="">Status: all</option>
          {BUG_STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </select>
        <select
          value={fVersion}
          onChange={(e) => setFVersion(e.target.value)}
          className="rounded-md border border-slate-300 px-1.5 py-1"
          title="App version the bug was found in"
        >
          <option value="">Version: all</option>
          {releases.map((r) => (
            <option key={r.id} value={r.id}>
              v{r.version}
              {r.version === currentVersion ? " (current)" : ""}
            </option>
          ))}
          <option value="none">No version</option>
        </select>
        <select
          value={fAssignee}
          onChange={(e) => setFAssignee(e.target.value)}
          className="rounded-md border border-slate-300 px-1.5 py-1"
        >
          <option value="">Assignee: any</option>
          <option value="none">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={(e) => setMineOnly(e.target.checked)}
          />
          Mine
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={hideClosed}
            onChange={(e) => setHideClosed(e.target.checked)}
          />
          Hide closed
        </label>
        <ViewToggle view={view} onChange={pickView} className="ml-auto" />
      </div>

      {selected.size > 0 && isManager(role) && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-brand-line bg-brand-soft px-2 py-1.5 text-[13px] shadow-card">
          <span className="font-medium">{selected.size} selected</span>
          <select
            onChange={(e) => {
              if (e.target.value) bulkPatch({ status: e.target.value });
              e.target.value = "";
            }}
            className="rounded-md border border-slate-300 px-1.5 py-0.5"
            defaultValue=""
          >
            <option value="">Set status…</option>
            {BUG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </select>
          <select
            onChange={(e) => {
              if (e.target.value)
                bulkPatch({
                  assignee_id: e.target.value === "none" ? null : e.target.value,
                });
              e.target.value = "";
            }}
            className="rounded-md border border-slate-300 px-1.5 py-0.5"
            defaultValue=""
          >
            <option value="">Assign to…</option>
            <option value="none">Unassign</option>
            {assignable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
                {m.roles?.label ? ` · ${m.roles.label}` : ""}
              </option>
            ))}
          </select>
          <select
            onChange={(e) => {
              const v = e.target.value;
              if (v) setArea([...selected], v === "none" ? null : (v as BugArea), moveAutoAssigned);
              e.target.value = "";
            }}
            className="rounded-md border border-slate-300 px-1.5 py-0.5"
            defaultValue=""
          >
            <option value="">Set category…</option>
            {roleCats.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
            <option value="none">Not set</option>
          </select>
          <label className="inline-flex items-center gap-1 text-xs text-slate-600" title="Open bugs that are unassigned or still with the project developer move to the area's developer">
            <input type="checkbox" checked={moveAutoAssigned} onChange={(e) => setMoveAutoAssigned(e.target.checked)} />
            move to category person
          </label>
          <Button variant="danger" onClick={bulkDelete}>
            Delete
          </Button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-slate-600 hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      {err && (
        <p className="mb-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[13px] text-red-700">
          {err}
        </p>
      )}

      {filtered.length === 0 ? (
        <EmptyState title="No bugs match">
          {bugs.length === 0
            ? "Log the first bug for this project."
            : "Adjust the filters above."}
        </EmptyState>
      ) : view === "cards" ? (
        <ul className="space-y-2">
          {filtered.map((b) => {
            const canEdit = canEditBug(role, userId, b);
            const overdue =
              !!b.due_date &&
              Date.parse(b.due_date) < Date.now() &&
              b.status !== "closed";
            return (
              <li
                key={b.id}
                onClick={() => setDrawerId(b.id)}
                className="cursor-pointer rounded-md border border-grid-line bg-white p-3 shadow-card transition active:scale-[0.99]"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    tone={
                      b.severity === "critical"
                        ? "red"
                        : b.severity === "major"
                          ? "amber"
                          : "slate"
                    }
                  >
                    {SEVERITY_LABELS[b.severity]}
                  </Badge>
                  <AreaChip area={b.area} showMissing />
                  <Badge tone="blue">{titleCase(b.status)}</Badge>
                  <VersionChip
                    version={b.release?.version}
                    confirmedAt={b.version_confirmed_at}
                    confirmedBy={b.confirmer?.full_name}
                    showMissing
                  />
                  {b.base_page_id && (
                    <span
                      className="text-xs text-slate-400"
                      title="Copied from library"
                    >
                      ⧉
                    </span>
                  )}
                  <span className="ml-auto text-slate-300">↗</span>
                </div>
                <p className="mt-1.5 font-medium text-slate-800">{b.title}</p>
                {b.steps_to_reproduce && (
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[12px] text-slate-500">
                    {b.steps_to_reproduce}
                  </p>
                )}
                <div
                  className="mt-2.5 flex flex-wrap items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  {statusOptions(b).length > 1 && (
                    <select
                      value={b.status}
                      onChange={(e) => patch(b.id, { status: e.target.value })}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-700"
                    >
                      {statusOptions(b).map((s) => (
                        <option key={s} value={s}>
                          {titleCase(s)}
                        </option>
                      ))}
                    </select>
                  )}
                  {canEdit && (
                    <select
                      value={b.assignee_id ?? ""}
                      onChange={(e) =>
                        patch(b.id, { assignee_id: e.target.value || null })
                      }
                      className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[12px]"
                    >
                      <option value="">Unassigned</option>
                      {b.assignee_id &&
                        !assignable.some((m) => m.id === b.assignee_id) && (
                          <option value={b.assignee_id}>
                            {memberName(b.assignee_id)}
                          </option>
                        )}
                      <AssigneeOptions people={assignable} area={b.area} />
                    </select>
                  )}
                  {b.due_date && (
                    <span
                      suppressHydrationWarning
                      className={cx(
                        "inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[12px] font-medium",
                        overdue
                          ? "bg-red-50 text-red-700"
                          : "bg-grid-head text-slate-600",
                      )}
                    >
                      📅 {fmtDueShort(b.due_date)}
                      {overdue ? " · overdue" : ""}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-slate-100 pt-2 text-[12px] text-slate-500">
                  <span>Reporter: {memberName(b.created_by)}</span>
                  <span>Assignee: {memberName(b.assignee_id)}</span>
                  {b.category?.name && <span>{b.category.name}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="sheet-wrap rounded-md border border-grid-line">
          <table
            className="sheet"
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                grid.sel?.c === 0 &&
                !(e.target as HTMLElement)?.closest("input,select,textarea")
              ) {
                e.preventDefault();
                setDrawerId(filtered[grid.sel.r].id);
                return;
              }
              grid.onKeyDown(e);
            }}
          >
            <thead>
              <tr>
                <th
                  className="rownum cursor-pointer"
                  title={allSelected ? "Clear selection" : "Select all rows"}
                  onClick={() =>
                    setSelected(
                      allSelected
                        ? new Set()
                        : new Set(filtered.map((b) => b.id)),
                    )
                  }
                >
                  {allSelected ? "✓" : "#"}
                </th>
                <th className="freeze min-w-[14rem]">
                  <SortHead k="title">Title</SortHead>
                </th>
                <th className="min-w-[6.5rem]">
                  <SortHead k="severity">Severity</SortHead>
                </th>
                <th className="min-w-[7rem]">
                  <SortHead k="area">Category</SortHead>
                </th>
                <th className="min-w-[6rem]">
                  <SortHead k="priority">Priority</SortHead>
                </th>
                <th className="min-w-[8rem]">
                  <SortHead k="status">Status</SortHead>
                </th>
                <th className="min-w-[9rem]">Assignee</th>
                <th className="min-w-[9rem]">Category</th>
                <th className="min-w-[8rem]">
                  <SortHead k="due_date">Due</SortHead>
                </th>
                {isManager(role) && <th className="min-w-[4rem]" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, r) => {
                const canEdit = canEditBug(role, userId, b);
                const rowSel = selected.has(b.id);
                return (
                  <tr key={b.id} className={cx(rowSel && "is-selected")}>
                    <td
                      className="rownum cursor-pointer select-none"
                      onClick={(e) => toggleRow(r, e.shiftKey)}
                      title="Click to select row"
                    >
                      {rowSel ? "✓" : r + 1}
                    </td>

                    <td {...grid.cellProps(r, 0, "freeze")}>
                      <div className="flex items-center gap-1">
                        {b.base_page_id && (
                          <span
                            className="shrink-0 text-xs text-slate-400"
                            title="Copied from library"
                          >
                            ⧉
                          </span>
                        )}
                        {!canEdit ? (
                          <span className="cell-input truncate font-medium text-slate-800" title={b.title}>
                            {b.title}
                          </span>
                        ) : (
                        <input
                          key={b.title}
                          tabIndex={-1}
                          defaultValue={b.title}
                          title={b.title}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (!v) {
                              e.target.value = b.title;
                            } else if (v !== b.title) {
                              patch(b.id, { title: v });
                            }
                          }}
                          className="cell-input min-w-0 flex-1 font-medium text-slate-800"
                        />
                        )}
                        <VersionChip
                          version={b.release?.version}
                          confirmedAt={b.version_confirmed_at}
                          confirmedBy={b.confirmer?.full_name}
                        />
                        <button
                          tabIndex={-1}
                          onClick={() => setDrawerId(b.id)}
                          title="Open bug details"
                          aria-label="Open bug details"
                          className="shrink-0 px-0.5 text-slate-400 hover:text-brand-fg"
                        >
                          ↗
                        </button>
                      </div>
                    </td>

                    <td {...grid.cellProps(r, 1)}>
                      {!canEdit ? (
                        <span className="cell-input">{SEVERITY_LABELS[b.severity]}</span>
                      ) : (
                      <select
                        tabIndex={-1}
                        value={b.severity}
                        onChange={(e) => patch(b.id, { severity: e.target.value })}
                        className="cell-input"
                      >
                        {SEVERITIES.map((s) => (
                          <option key={s} value={s}>
                            {SEVERITY_LABELS[s]}
                          </option>
                        ))}
                      </select>
                      )}
                    </td>

                    <td {...grid.cellProps(r, 2)}>
                      {!canEdit ? (
                        <span className="cell-input">{areaShort(b.area) || "—"}</span>
                      ) : (
                        <select
                          tabIndex={-1}
                          value={b.area ?? ""}
                          onChange={(e) => setArea([b.id], (e.target.value || null) as BugArea | null)}
                          className={cx("cell-input", !b.area && "text-slate-400")}
                        >
                          <option value="">Not set</option>
                          {roleCats.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.short_label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>

                    <td {...grid.cellProps(r, 3)}>
                      {!canEdit ? (
                        <span className="cell-input">{titleCase(b.priority)}</span>
                      ) : (
                      <select
                        tabIndex={-1}
                        value={b.priority}
                        onChange={(e) => patch(b.id, { priority: e.target.value })}
                        className="cell-input"
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {titleCase(p)}
                          </option>
                        ))}
                      </select>
                      )}
                    </td>

                    <td {...grid.cellProps(r, 4)}>
                      {statusOptions(b).length > 1 ? (
                        <select
                          tabIndex={-1}
                          value={b.status}
                          onChange={(e) => patch(b.id, { status: e.target.value })}
                          className="cell-input"
                        >
                          {statusOptions(b).map((s) => (
                            <option key={s} value={s}>
                              {titleCase(s)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="cell-input">{titleCase(b.status)}</span>
                      )}
                    </td>

                    <td {...grid.cellProps(r, 5)}>
                      {!canEdit ? (
                        <span className="cell-input">{b.assignee_id ? memberName(b.assignee_id) : "—"}</span>
                      ) : (
                      <select
                        tabIndex={-1}
                        value={b.assignee_id ?? ""}
                        onChange={(e) =>
                          patch(b.id, { assignee_id: e.target.value || null })
                        }
                        className="cell-input"
                      >
                        <option value="">—</option>
                        {b.assignee_id &&
                          !assignable.some((m) => m.id === b.assignee_id) && (
                            <option value={b.assignee_id}>
                              {memberName(b.assignee_id)}
                            </option>
                          )}
                        <AssigneeOptions people={assignable} area={b.area} />
                      </select>
                      )}
                    </td>

                    <td {...grid.cellProps(r, 6)}>
                      {!canEdit ? (
                        <span className="cell-input">{categories.find((c) => c.id === b.category_id)?.name ?? "—"}</span>
                      ) : (
                      <select
                        tabIndex={-1}
                        value={b.category_id ?? ""}
                        onChange={(e) =>
                          patch(b.id, { category_id: e.target.value || null })
                        }
                        className="cell-input"
                      >
                        <option value="">—</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      )}
                    </td>

                    <td {...grid.cellProps(r, 7)}>
                      {!canEdit ? (
                        <span className="cell-input">{fmtDueShort(b.due_date) || "—"}</span>
                      ) : (
                        <DueInput
                          compact
                          value={b.due_date}
                          onError={setErr}
                          onCommit={(iso) => patch(b.id, { due_date: iso })}
                        />
                      )}
                    </td>
                    {isManager(role) && (
                      <td className="text-center">
                        <button
                          type="button"
                          tabIndex={-1}
                          title={`Delete "${b.title}"`}
                          onClick={() => deleteRow(b.id, b.title)}
                          className="text-slate-400 hover:text-red-600"
                        >
                          🗑
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <NewBugDialog
        projectId={projectId}
        categories={categories}
        requirements={requirements}
        releases={releases}
        currentVersion={currentVersion}
        members={assignable}
        userId={userId}
        open={showNew}
        onClose={() => setShowNew(false)}
      />

      {drawerBug && (
        <BugDrawer
          bug={drawerBug}
          role={role}
          userId={userId}
          assignable={assignable}
          releases={releases}
          siblingProject={siblingProject}
          categories={categories}
          projectDevelopers={projectDevelopers}
          onClose={closeDrawer}
          onChanged={refresh}
        />
      )}

      {classifying && (
        <ClassifyAreaDialog
          bugs={unclassified}
          categories={categories}
          developers={projectDevelopers}
          developerName={memberNameOf}
          onClose={() => setClassifying(false)}
          onDone={(saved, moved) => {
            setClassifying(false);
            setDevMsg(`Classified ${saved} bug(s)${moved ? `; ${moved} moved to their area's developer` : ""}.`);
            refresh();
          }}
        />
      )}

      {canCreateBugs(role) && (
        <Fab label="Report a bug" onClick={() => setShowNew(true)} />
      )}
    </div>
  );
}
