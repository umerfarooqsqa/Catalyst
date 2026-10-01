import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform } from "@/lib/automation-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A runner asks for its next piece of work. It only ever gets jobs for the
 * platform it registered with (Windows runner -> Android, Mac runner -> iOS):
 * the platform in the body must match the runner's registration, and the
 * claim itself is a single atomic SQL function (`claim_test_job`, `skip
 * locked`), so a job is never handed out twice.
 *
 * Returns { job: null } when the queue is empty, otherwise the job plus the
 * bug's full context (title, description, steps to reproduce, ...).
 */
export async function POST(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;

  const body = await req.json().catch(() => null);
  const runnerName = String(body?.runner ?? "").trim();
  if (!runnerName) return NextResponse.json({ error: "runner (name) is required" }, { status: 400 });
  const platform = parsePlatform(body?.platform);
  if (!platform) return badPlatform();

  const supabase = serviceRoleClient();
  const { data: runner, error: runnerErr } = await supabase
    .from("automation_runners")
    .select("id, platform")
    .eq("name", runnerName)
    .maybeSingle();
  if (runnerErr) return NextResponse.json({ error: runnerErr.message }, { status: 500 });
  if (!runner) {
    return NextResponse.json({ error: `Runner '${runnerName}' is not registered; POST /api/automation/runners first` }, { status: 404 });
  }
  if (runner.platform !== platform) {
    return NextResponse.json(
      { error: `Runner '${runnerName}' is registered for ${runner.platform}, not ${platform}` },
      { status: 403 },
    );
  }

  await supabase
    .from("automation_runners")
    .update({ last_seen_at: new Date().toISOString(), status: "idle" })
    .eq("id", runner.id);

  const { data: claimed, error: claimErr } = await supabase.rpc("claim_test_job", {
    p_platform: platform,
    p_runner_id: runner.id,
  });
  if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 });
  const job = claimed?.[0];
  if (!job) return NextResponse.json({ job: null });

  const [{ data: project }, { data: bug }] = await Promise.all([
    supabase.from("projects").select("name, house_slug, house_group, platform").eq("id", job.project_id).maybeSingle(),
    job.bug_id
      ? supabase
          .from("bugs")
          .select("id, title, description, steps_to_reproduce, severity, priority, status, created_at, category:bug_categories(name)")
          .eq("id", job.bug_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return NextResponse.json({
    job: {
      id: job.id,
      kind: job.kind,
      platform: job.platform,
      house: project?.house_slug ?? project?.house_group ?? null,
      project: project?.name ?? null,
      bug,
    },
  });
}
