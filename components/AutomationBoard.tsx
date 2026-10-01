"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { isManager } from "@/lib/permissions";
import type { AutomationRunner, RoleLevel } from "@/lib/types/models";

type Platform = "android" | "ios";
type JobRow = {
  id: string;
  platform: Platform;
  kind: string;
  status: "queued" | "claimed" | "generated" | "failed" | "cancelled";
  note: string | null;
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  generated_tests: unknown;
  bug: { id: string; title: string } | null;
  project: { id: string; name: string; house_slug: string | null; house_group: string | null } | null;
  runner: { name: string } | null;
};
type ProjectRow = {
  id: string;
  name: string;
  platform: string | null;
  house_slug: string | null;
  house_group: string | null;
};
const hasApp = (p: { house_slug: string | null; house_group: string | null } | null | undefined) =>
  !!(p && (p.house_slug || p.house_group));
const NO_APP = "No app is linked to this project yet, so a runner cannot generate tests for it until an admin maps it to one of the automated apps.";

const LANES: { platform: Platform; title: string; machine: string; os: string }[] = [
  { platform: "android", title: "Android", machine: "Windows runner", os: "Windows" },
  { platform: "ios", title: "iOS", machine: "Mac runner", os: "a Mac" },
];
const ONLINE_MS = 2 * 60 * 1000;
const STATUS_TONE = { queued: "blue", claimed: "amber", generated: "green", failed: "red", cancelled: "slate" } as const;
const STATUS_LABEL = {
  queued: "Queued",
  claimed: "With runner",
  generated: "Test generated",
  failed: "Failed",
  cancelled: "Cancelled",
} as const;

function testCount(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

export default function AutomationBoard({
  runners,
  jobs,
  projects,
  role,
  userId,
}: {
  runners: AutomationRunner[];
  jobs: JobRow[];
  projects: ProjectRow[];
  role: RoleLevel;
  userId: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const canManage = isManager(role);
  const [now, setNow] = useState(() => Date.now());
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<Platform, string>>({ android: "", ios: "" });
  // Open bugs of the project picked in each lane (for "send a single bug"),
  // and which one is selected.
  type OpenBug = { id: string; title: string; status: string };
  const [openBugs, setOpenBugs] = useState<Record<Platform, OpenBug[]>>({ android: [], ios: [] });
  const [bugPick, setBugPick] = useState<Record<Platform, string>>({ android: "", ios: "" });

  useEffect(() => {
    (["android", "ios"] as Platform[]).forEach(async (platform) => {
      const projectId = pick[platform];
      if (!projectId) {
        setOpenBugs((o) => ({ ...o, [platform]: [] }));
        return;
      }
      const { data } = await supabase
        .from("bugs")
        .select("id, title, status")
        .eq("project_id", projectId)
        .in("status", ["open", "in_progress", "reopened"])
        .order("created_at", { ascending: false });
      setOpenBugs((o) => ({ ...o, [platform]: (data ?? []) as OpenBug[] }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick.android, pick.ios]);

  // Runner heartbeats and job status change outside this page, so poll.
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      router.refresh();
    }, 15000);
    return () => clearInterval(t);
  }, [router]);

  async function cancelJob(id: string) {
    setErr(null);
    const { error } = await supabase
      .from("test_jobs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "queued"); // never cancel a job a runner has already claimed
    if (error) return setErr(error.message);
    router.refresh();
  }

  async function queueAll(platform: Platform) {
    const projectId = pick[platform];
    if (!projectId) return;
    setErr(null);
    setMsg(null);
    const { data: bugs, error } = await supabase
      .from("bugs")
      .select("id")
      .eq("project_id", projectId)
      .in("status", ["open", "in_progress", "reopened"]);
    if (error) return setErr(error.message);
    const { data: active } = await supabase
      .from("test_jobs")
      .select("bug_id")
      .eq("project_id", projectId)
      .in("status", ["queued", "claimed"]);
    const busy = new Set((active ?? []).map((j) => j.bug_id));
    const todo = (bugs ?? []).filter((b) => !busy.has(b.id));
    if (todo.length === 0) return setMsg("Nothing to queue: every open bug in that project already has an active job.");
    const { error: insErr } = await supabase.from("test_jobs").insert(
      todo.map((b) => ({ project_id: projectId, platform, kind: "bug", bug_id: b.id, created_by: userId })),
    );
    if (insErr) return setErr(insErr.message);
    setMsg(`Queued ${todo.length} bug${todo.length === 1 ? "" : "s"} for the ${platform === "ios" ? "Mac" : "Windows"} runner.`);
    router.refresh();
  }

  const dupMessage = (error: { code?: string; message: string }, what: string) =>
    error.code === "23505" ? `${what} already has an active automation job.` : error.message;

  // One bug -> one job for that project's platform runner.
  async function sendBug(platform: Platform) {
    const projectId = pick[platform];
    const bugId = bugPick[platform];
    if (!projectId || !bugId) return;
    setErr(null);
    setMsg(null);
    const { error } = await supabase
      .from("test_jobs")
      .insert({ project_id: projectId, platform, kind: "bug", bug_id: bugId, created_by: userId });
    if (error) return setErr(dupMessage(error, "That bug"));
    const title = openBugs[platform].find((b) => b.id === bugId)?.title;
    setBugPick((b) => ({ ...b, [platform]: "" }));
    setMsg(`Sent "${title}" to the ${platform === "ios" ? "Mac" : "Windows"} runner.`);
    router.refresh();
  }

  // The whole project -> one "source coverage" job: the runner writes as many
  // tests as it can for the project's app from its source code, not just for
  // one bug.
  async function automateProject(platform: Platform) {
    const projectId = pick[platform];
    if (!projectId) return;
    setErr(null);
    setMsg(null);
    const { error } = await supabase
      .from("test_jobs")
      .insert({ project_id: projectId, platform, kind: "source_coverage", created_by: userId });
    if (error) return setErr(dupMessage(error, "That project"));
    const name = projects.find((p) => p.id === projectId)?.name;
    setMsg(`Queued the whole project "${name}" for the ${platform === "ios" ? "Mac" : "Windows"} runner.`);
    router.refresh();
  }

  return (
    <div>
      <PageHeader
        title="Automation"
        subtitle="Bugs in Android projects are tested on the Windows machine, bugs in iOS projects on the Mac. Each runner pulls only its own platform's queue."
      />
      {err && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      {msg && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {LANES.map((lane) => {
          const laneRunners = runners.filter((r) => r.platform === lane.platform);
          const laneJobs = jobs.filter((j) => j.platform === lane.platform);
          const count = (s: JobRow["status"]) => laneJobs.filter((j) => j.status === s).length;
          const laneProjects = projects.filter((p) => p.platform === lane.platform);
          const stuck = laneJobs.filter(
            (j) => (j.status === "queued" || j.status === "claimed") && !hasApp(j.project),
          ).length;
          const picked = laneProjects.find((p) => p.id === pick[lane.platform]);
          const laneOpenBugs = openBugs[lane.platform];
          const activeBugIds = new Set(
            jobs
              .filter((j) => (j.status === "queued" || j.status === "claimed") && j.bug)
              .map((j) => j.bug!.id),
          );
          const bugsToSend = laneOpenBugs.filter((b) => !activeBugIds.has(b.id));
          const projectQueued = jobs.some(
            (j) =>
              j.kind === "source_coverage" &&
              j.project?.id === picked?.id &&
              (j.status === "queued" || j.status === "claimed"),
          );
          return (
            <Card key={lane.platform} className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-base font-semibold text-slate-800">
                  {lane.title} <span className="text-slate-400">→</span> {lane.machine}
                </h2>
              </div>

              <div className="mb-3 space-y-1.5">
                {laneRunners.length === 0 ? (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    No runner has connected yet. Start the dashboard on {lane.os} with{" "}
                    <code>AUTOMATION_PLATFORM={lane.platform}</code>; it registers itself.
                  </p>
                ) : (
                  laneRunners.map((r) => {
                    const online = now - new Date(r.last_seen_at).getTime() < ONLINE_MS;
                    return (
                      <div key={r.id} className="flex items-center gap-2 text-sm">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${online ? "bg-green-500" : "bg-slate-300"}`}
                          aria-hidden
                        />
                        <span className="font-medium text-slate-700">{r.name}</span>
                        <Badge tone={online ? "green" : "slate"}>{online ? "online" : "offline"}</Badge>
                        <span className="text-xs text-slate-400" suppressHydrationWarning>
                          last seen {fmtDateTime(r.last_seen_at)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              {stuck > 0 && (
                <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  ⚠ {stuck} active job{stuck === 1 ? "" : "s"} belong{stuck === 1 ? "s" : ""} to projects with no app
                  linked. {NO_APP}
                </p>
              )}

              <div className="mb-3 flex flex-wrap gap-2 text-xs">
                <Badge tone="blue">{count("queued")} queued</Badge>
                <Badge tone="amber">{count("claimed")} with runner</Badge>
                <Badge tone="green">{count("generated")} generated</Badge>
                <Badge tone="red">{count("failed")} failed</Badge>
              </div>

              {canManage && (
                <div className="mb-3 space-y-2 rounded-md border border-grid-line bg-slate-50 p-3 text-sm">
                  <select
                    value={pick[lane.platform]}
                    onChange={(e) => {
                      setPick((p) => ({ ...p, [lane.platform]: e.target.value }));
                      setBugPick((b) => ({ ...b, [lane.platform]: "" }));
                    }}
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
                  >
                    <option value="">Choose a project to automate…</option>
                    {laneProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {hasApp(p) ? "" : " — no app linked"}
                      </option>
                    ))}
                  </select>

                  {picked && (
                    <>
                      {!hasApp(picked) && (
                        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          ⚠ {NO_APP} You can still queue it.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => automateProject(lane.platform)} disabled={projectQueued}>
                          {projectQueued ? "Whole project already queued" : "Automate whole project"}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => queueAll(lane.platform)}
                          disabled={bugsToSend.length === 0}
                        >
                          Queue all open bugs ({bugsToSend.length})
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={bugPick[lane.platform]}
                          onChange={(e) => setBugPick((b) => ({ ...b, [lane.platform]: e.target.value }))}
                          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5"
                        >
                          <option value="">
                            {laneOpenBugs.length === 0 ? "No open bugs in this project" : "Send a single bug…"}
                          </option>
                          {laneOpenBugs.map((b) => (
                            <option key={b.id} value={b.id} disabled={activeBugIds.has(b.id)}>
                              {b.title}
                              {activeBugIds.has(b.id) ? " — already in automation" : ""}
                            </option>
                          ))}
                        </select>
                        <Button
                          variant="secondary"
                          onClick={() => sendBug(lane.platform)}
                          disabled={!bugPick[lane.platform]}
                        >
                          Send bug
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {laneJobs.length === 0 ? (
                <EmptyState title="No jobs yet" />
              ) : (
                <div className="max-h-96 overflow-y-auto">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-grid-head text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium">Job</th>
                        <th className="px-2 py-1.5 text-left font-medium">Status</th>
                        <th className="px-2 py-1.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-grid-line">
                      {laneJobs.map((j) => (
                        <tr key={j.id}>
                          <td className="px-2 py-1.5">
                            <div className="font-medium text-slate-800">
                              {j.kind === "source_coverage" ? (
                                <>
                                  <Badge tone="violet">Whole project</Badge> {j.project?.name}
                                </>
                              ) : (
                                (j.bug?.title ?? "(bug deleted)")
                              )}
                            </div>
                            <div className="text-xs text-slate-400" suppressHydrationWarning>
                              {j.project?.name} · {fmtDateTime(j.created_at)}
                              {j.runner ? ` · ${j.runner.name}` : ""}
                              {testCount(j.generated_tests) ? ` · ${testCount(j.generated_tests)} test(s)` : ""}
                            </div>
                            {j.note && <div className="text-xs text-slate-500">{j.note}</div>}
                            {(j.status === "queued" || j.status === "claimed") && !hasApp(j.project) && (
                              <div className="text-xs text-amber-700">⚠ no app linked to this project</div>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            {canManage && j.status === "queued" && (
                              <button onClick={() => cancelJob(j.id)} className="text-xs text-slate-400 hover:text-red-600">
                                cancel
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
