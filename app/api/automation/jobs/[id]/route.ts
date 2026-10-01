import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { checkAutomationSecret } from "@/lib/automation-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FINAL = ["generated", "failed"] as const;

/**
 * A runner reports the outcome of a job it claimed: `generated` (with the list
 * of tests it wrote) or `failed` (with a note). Only the runner that claimed
 * the job may finish it, and only once.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;
  const { id } = await ctx.params;

  const body = await req.json().catch(() => null);
  const runnerName = String(body?.runner ?? "").trim();
  const status = String(body?.status ?? "");
  if (!runnerName) return NextResponse.json({ error: "runner (name) is required" }, { status: 400 });
  if (!(FINAL as readonly string[]).includes(status)) {
    return NextResponse.json({ error: `status must be one of: ${FINAL.join(", ")}` }, { status: 400 });
  }

  const supabase = serviceRoleClient();
  const { data: runner } = await supabase.from("automation_runners").select("id").eq("name", runnerName).maybeSingle();
  if (!runner) return NextResponse.json({ error: `Runner '${runnerName}' is not registered` }, { status: 404 });

  const { data: job, error: readErr } = await supabase
    .from("test_jobs")
    .select("id, status, runner_id")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (job.status !== "claimed" || job.runner_id !== runner.id) {
    return NextResponse.json(
      { error: `Job is '${job.status}'${job.runner_id !== runner.id ? " and belongs to another runner" : ""}; only the claiming runner can finish a claimed job` },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from("test_jobs")
    .update({
      status,
      note: body?.note ? String(body.note).slice(0, 2000) : null,
      generated_tests: Array.isArray(body?.generated_tests) ? body.generated_tests : [],
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, status });
}
