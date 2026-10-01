import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform } from "@/lib/automation-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["queued", "claimed", "generated", "failed", "cancelled"];

/**
 * Read-only view of a platform's automation queue, for the runner's own
 * dashboard ("what is waiting for this machine?"). Never changes anything --
 * claiming stays in POST jobs/claim.
 *
 * GET ?platform=android|ios  (default android)  &status=queued,claimed  &limit=100
 */
export async function GET(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;

  const url = new URL(req.url);
  const platform = parsePlatform(url.searchParams.get("platform"));
  if (!platform) return badPlatform();

  const statusParam = url.searchParams.get("status");
  const statuses = statusParam ? statusParam.split(",").map((s) => s.trim()).filter(Boolean) : null;
  if (statuses && statuses.some((s) => !STATUSES.includes(s))) {
    return NextResponse.json({ error: `status must be a comma list of: ${STATUSES.join(", ")}` }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1), 200);

  const supabase = serviceRoleClient();
  let query = supabase
    .from("test_jobs")
    .select(
      "id, kind, status, note, created_at, claimed_at, completed_at, generated_tests, bug:bugs(id, title, severity), project:projects(name, house_slug, house_group), runner:automation_runners(name)",
    )
    .eq("platform", platform)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (statuses) query = query.in("status", statuses);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const jobs = (data ?? []).map((j) => ({
    id: j.id,
    kind: j.kind,
    status: j.status,
    note: j.note,
    created_at: j.created_at,
    claimed_at: j.claimed_at,
    completed_at: j.completed_at,
    tests: Array.isArray(j.generated_tests) ? j.generated_tests.length : 0,
    bug: j.bug,
    project: j.project?.name ?? null,
    house: j.project?.house_slug ?? j.project?.house_group ?? null,
    runner: j.runner?.name ?? null,
  }));
  return NextResponse.json({ platform, jobs });
}
