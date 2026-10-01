"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { isManager } from "@/lib/permissions";
import type { AutomationRunner, ProjectAutomation as Link, RoleLevel } from "@/lib/types/models";

type Platform = "android" | "ios";
type JobRow = {
  id: string;
  kind: string;
  status: "queued" | "claimed" | "generated" | "failed" | "cancelled";
  note: string | null;
  created_at: string;
  generated_tests: unknown;
  bug: { id: string; title: string } | null;
  runner: { name: string } | null;
};
type ProjectRow = {
  id: string;
  name: string;
  platform: string | null;
  house_slug: string | null;
  house_group: string | null;
  current_version: string | null;
};

const ONLINE_MS = 2 * 60 * 1000;
const STATUS_TONE = { queued: "blue", claimed: "amber", generated: "green", failed: "red", cancelled: "slate" } as const;
const STATUS_LABEL = {
  queued: "Queued",
  claimed: "With runner",
  generated: "Test generated",
  failed: "Failed",
  cancelled: "Cancelled",
} as const;

export default function ProjectAutomation({
  project,
  link,
  runners,
  jobs,
  bugs,
  role,
  userId,
}: {
  project: ProjectRow;
  link: Link | null;
  runners: AutomationRunner[];
  jobs: JobRow[];
  bugs: { id: string; title: string; status: string }[];
  role: RoleLevel;
  userId: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const canManage = isManager(role);
  const platform = project.platform as Platform | null;
  const house = project.house_slug ?? project.house_group;
  const machine = platform === "ios" ? "Mac" : "Windows";
  const expectedFolder = platform && house ? `projects/${platform}/${house}` : null;

  const [now, setNow] = useState(() => Date.now());
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [bugPick, setBugPick] = useState("");

  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      router.refresh();
    }, 15000);
    return () => clearInterval(t);
  }, [router]);

  const active = (j: JobRow) => j.status === "queued" || j.status === "claimed";
  const activeBugIds = new Set(jobs.filter((j) => active(j) && j.bug).map((j) => j.bug!.id));
  const bugsToSend = bugs.filter((b) => !activeBugIds.has(b.id));
  const projectQueued = jobs.some((j) => j.kind === "source_coverage" && active(j));

  async function insertJobs(rows: { kind: string; bug_id?: string }[]) {
    if (!platform) return "This project has no platform set.";
    const { error } = await supabase
      .from("test_jobs")
      .insert(rows.map((r) => ({ project_id: project.id, platform, created_by: userId, ...r })));
    if (!error) return null;
    return error.code === "23505" ? "That already has an active automation job." : error.message;
  }

  async function automateProject() {
    setErr(null);
    setMsg(null);
    const e = await insertJobs([{ kind: "source_coverage" }]);
    if (e) return setErr(e);
    setMsg(`Queued the whole project for the ${machine} runner.`);
    router.refresh();
  }

  async function sendBug() {
    if (!bugPick) return;
    setErr(null);
    setMsg(null);
    const e = await insertJobs([{ kind: "bug", bug_id: bugPick }]);
    if (e) return setErr(e);
    setMsg(`Sent "${bugs.find((b) => b.id === bugPick)?.title}" to the ${machine} runner.`);
    setBugPick("");
    router.refresh();
  }

  async function queueAll() {
    if (bugsToSend.length === 0) return;
    setErr(null);
    setMsg(null);
    const e = await insertJobs(bugsToSend.map((b) => ({ kind: "bug", bug_id: b.id })));
    if (e) return setErr(e);
    setMsg(`Queued ${bugsToSend.length} bug${bugsToSend.length === 1 ? "" : "s"} for the ${machine} runner.`);
    router.refresh();
  }

  async function cancelJob(id: string) {
    setErr(null);
    const { error } = await supabase
      .from("test_jobs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "queued");
    if (error) return setErr(error.message);
    router.refresh();
  }

  if (!platform || !house) {
    return (
      <Card className="p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Automation</h2>
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          ⚠ No app is linked to this project yet, so it has no automation folder and a runner cannot generate tests
          for it. An admin needs to map this project to one of the automated apps first.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      {msg && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</p>}

      <Card className="p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Automation folder</h2>
          <Badge tone={platform === "ios" ? "amber" : "green"}>
            {platform === "ios" ? "iOS → Mac runner" : "Android → Windows runner"}
          </Badge>
        </div>
        <p className="text-sm text-slate-600">
          Linked to <code className="rounded bg-slate-100 px-1.5 py-0.5">{link?.folder ?? expectedFolder}</code> in the aktrade
          repo. It holds this project&apos;s own app source, jobs, generated tests and reports.
        </p>
        {link ? (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Badge tone="slate">{link.tests_total} tests generated</Badge>
            <Badge tone="green">{link.tests_approved} approved</Badge>
            <Badge tone={link.tests_pending ? "amber" : "slate"}>{link.tests_pending} awaiting review</Badge>
            <span className="self-center text-slate-400" suppressHydrationWarning>
              {link.last_run_at ? `last run ${fmtDateTime(link.last_run_at)} · ` : "no runs yet · "}
              synced {fmtDateTime(link.last_synced_at)}
              {link.runner_name ? ` by ${link.runner_name}` : ""}
            </span>
          </div>
        ) : (
          <p className="mt-2 text-xs text-amber-700">
            Not reported by a runner yet. Start the dashboard on the {machine} machine (it syncs its project folders on
            startup).
          </p>
        )}
        <div className="mt-3 space-y-1">
          {runners.length === 0 ? (
            <p className="text-xs text-slate-500">No {machine} runner has connected yet.</p>
          ) : (
            runners.map((r) => {
              const online = now - new Date(r.last_seen_at).getTime() < ONLINE_MS;
              return (
                <div key={r.id} className="flex items-center gap-2 text-sm">
                  <span className={`h-2.5 w-2.5 rounded-full ${online ? "bg-green-500" : "bg-slate-300"}`} aria-hidden />
                  <span className="font-medium text-slate-700">{r.name}</span>
                  <Badge tone={online ? "green" : "slate"}>{online ? "online" : "offline"}</Badge>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {canManage && (
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Send to automation</h2>
          <div className="flex flex-wrap gap-2">
            <Button onClick={automateProject} disabled={projectQueued}>
              {projectQueued ? "Whole project already queued" : "Automate whole project"}
            </Button>
            <Button variant="secondary" onClick={queueAll} disabled={bugsToSend.length === 0}>
              Queue all open bugs ({bugsToSend.length})
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <select
              value={bugPick}
              onChange={(e) => setBugPick(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5"
            >
              <option value="">{bugs.length === 0 ? "No open bugs in this project" : "Send a single bug…"}</option>
              {bugs.map((b) => (
                <option key={b.id} value={b.id} disabled={activeBugIds.has(b.id)}>
                  {b.title}
                  {activeBugIds.has(b.id) ? " — already in automation" : ""}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={sendBug} disabled={!bugPick}>
              Send bug
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">This project&apos;s jobs</h2>
        {jobs.length === 0 ? (
          <EmptyState title="No jobs yet" />
        ) : (
          <table className="min-w-full text-sm">
            <tbody className="divide-y divide-grid-line">
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="px-2 py-1.5">
                    <div className="font-medium text-slate-800">
                      {j.kind === "source_coverage" ? (
                        <>
                          <Badge tone="violet">Whole project</Badge> {project.name}
                        </>
                      ) : (
                        (j.bug?.title ?? "(bug deleted)")
                      )}
                    </div>
                    <div className="text-xs text-slate-400" suppressHydrationWarning>
                      {fmtDateTime(j.created_at)}
                      {j.runner ? ` · ${j.runner.name}` : ""}
                      {Array.isArray(j.generated_tests) && j.generated_tests.length
                        ? ` · ${j.generated_tests.length} test(s)`
                        : ""}
                    </div>
                    {j.note && <div className="text-xs text-slate-500">{j.note}</div>}
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
        )}
      </Card>
    </div>
  );
}
