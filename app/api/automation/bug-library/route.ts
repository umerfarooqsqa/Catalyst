import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform, resolveProject } from "@/lib/automation-release";
import { evaluateGate, type ClaimedBug, type RunResults } from "@/lib/regression-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * REQ-14: the Bug Library entries tied to a house, so the runner can queue
 * regression test jobs for them once the release-notes test points pass.
 *
 * "Tied to the house" = a `master_bug` row on this platform's list that is
 * either stamped with the house (`house_slug`, e.g. automation-found
 * recurring bugs) or was copied into this house's project (a bug whose
 * `base_page_id` points at it). `client_requirement` rows are not bugs and
 * are excluded. Unassigned (platform NULL) rows are excluded too -- they
 * haven't been classified Android/iOS yet.
 *
 * With `version`, also returns that release's status and the REQ-14 gate
 * (lib/regression-gate.ts): whether every bug the release notes claim as
 * fixed had its test_bug_<id8> test pass in this release. Read-only.
 */
const ENTRY_COLUMNS =
  "id, title, description, steps_to_reproduce, severity, tags, house_slug, recurring_count, updated_at, category:bug_categories(name)";

export async function GET(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;

  const url = new URL(req.url);
  const house = url.searchParams.get("house");
  const version = url.searchParams.get("version");
  if (!house) return NextResponse.json({ error: "house is required" }, { status: 400 });
  const platform = parsePlatform(url.searchParams.get("platform"));
  if (!platform) return badPlatform();

  const found = await resolveProject(house, platform);
  if (!found.project) return NextResponse.json({ error: found.error }, { status: found.status });
  const project = found.project;
  const supabase = serviceRoleClient();

  const { data: copied, error: copiedErr } = await supabase
    .from("bugs")
    .select("base_page_id")
    .eq("project_id", project.id)
    .not("base_page_id", "is", null);
  if (copiedErr) return NextResponse.json({ error: copiedErr.message }, { status: 500 });
  const copiedIds = [...new Set((copied ?? []).map((b) => b.base_page_id as string))];

  const byHouse = supabase
    .from("base_page")
    .select(ENTRY_COLUMNS)
    .eq("source_type", "master_bug")
    .eq("platform", platform)
    .eq("house_slug", house);
  const byCopy = copiedIds.length
    ? supabase
        .from("base_page")
        .select(ENTRY_COLUMNS)
        .eq("source_type", "master_bug")
        .eq("platform", platform)
        .in("id", copiedIds)
    : null;
  const [a, b] = await Promise.all([byHouse, byCopy]);
  if (a.error) return NextResponse.json({ error: a.error.message }, { status: 500 });
  if (b?.error) return NextResponse.json({ error: b.error.message }, { status: 500 });

  const entries = new Map<string, NonNullable<typeof a.data>[number]>();
  for (const row of [...(a.data ?? []), ...(b?.data ?? [])]) entries.set(row.id, row);

  let release: Record<string, unknown> | null = null;
  if (version) {
    const { data: rel, error: relErr } = await supabase
      .from("releases")
      .select("id, version, status, claimed_bugs")
      .eq("project_id", project.id)
      .eq("version", version)
      .maybeSingle();
    if (relErr) return NextResponse.json({ error: relErr.message }, { status: 500 });
    if (rel) {
      const { data: runs, error: runErr } = await supabase
        .from("automation_runs")
        .select("created_at, test_results")
        .eq("release_id", rel.id);
      if (runErr) return NextResponse.json({ error: runErr.message }, { status: 500 });
      const gate = evaluateGate(
        (rel.claimed_bugs ?? []) as unknown as ClaimedBug[],
        (runs ?? []) as unknown as RunResults[],
      );
      release = { version: rel.version, status: rel.status, gate };
    }
  }

  return NextResponse.json({
    project: project.name,
    house,
    platform,
    release,
    entries: [...entries.values()],
  });
}
