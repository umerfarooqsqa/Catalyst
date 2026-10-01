import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform, resolveRelease } from "@/lib/automation-release";
import { areaFromTestKey } from "@/lib/bug-area";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// area: the runner's guess, frontend (an Appium UI test) or backend (an API test); migration 0041.
type Failure = { key: string; title: string; error?: string; steps?: string; area?: string };

// A generated test for a portal bug is named test_bug_<first 8 chars of the bug id>_<slug>.
const BUG_TEST = /test_bug_([0-9a-f]{8})/i;

const REGRESSED_FROM = new Set(["closed", "fixed", "ready_for_retest"]);

/**
 * REQ-6: failed automation tests become bugs, deduplicated on a stable key
 * (the test's node id) so a repeat failure finds its existing bug instead
 * of filing a duplicate.
 *
 * "Recurring" (auto-pulled into that house's Bug Library) means the bug
 * came back: either it had been closed / fixed / marked ready for retest
 * and failed again (a regression -- it is also reopened), or it is still
 * failing in a later release than the one it was first filed under. The
 * same test failing twice within one release is NOT recurrence.
 *
 * A failing test_bug_<id8>_* test reproduces an existing portal bug: it
 * updates THAT bug (reopening it if it was closed / fixed / ready for
 * retest) instead of filing a new "[Automation]" duplicate, and leaves its
 * human-written description, steps and release untouched.
 *
 * A new bug's area (frontend/backend) is the runner's `area`, else derived from
 * the test's path (akdapiautomation/ = backend, tests/ = frontend). An existing
 * bug's area is never changed here: QA may have corrected it. The bug goes to that
 * area's developer (trg_bugs_default_assignee).
 */
export async function POST(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;

  const body = await req.json().catch(() => null);
  const { house, version } = body ?? {};
  const failures: Failure[] = Array.isArray(body?.failures) ? body.failures : [];
  if (!house || !version) {
    return NextResponse.json({ error: "house and version are required" }, { status: 400 });
  }

  const platform = parsePlatform(body.platform);
  if (!platform) return badPlatform();
  const resolved = await resolveRelease(String(house), String(version), platform);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { project, release } = resolved;

  const supabase = serviceRoleClient();
  const created: string[] = [];
  const updated: string[] = [];
  const recurring: string[] = [];
  const cols = "id, title, severity, area, status, release_id, occurrences, description, source";

  // The project's bug ids, loaded once and only if a test_bug_<id8> test failed.
  let projectBugIds: string[] | null = null;
  const originalBugId = async (key: string): Promise<string | null> => {
    const m = BUG_TEST.exec(key);
    if (!m) return null;
    if (projectBugIds === null) {
      const { data } = await supabase.from("bugs").select("id").eq("project_id", project.id);
      projectBugIds = (data ?? []).map((b) => String(b.id));
    }
    const prefix = m[1].toLowerCase();
    const hits = projectBugIds.filter((id) => id.toLowerCase().startsWith(prefix));
    return hits.length === 1 ? hits[0] : null; // unknown or ambiguous: fall back to the automation key
  };

  // Role categories that exist (migration 0043): a guess naming a removed one is dropped.
  const { data: areaRows } = await supabase.from("role_categories").select("key");
  const areaKeys = new Set((areaRows ?? []).map((r) => r.key));

  for (const f of failures) {
    if (!f.key || !f.title) continue;
    const description = (f.error ?? "").slice(0, 4000) || null;
    const steps = (f.steps ?? "").slice(0, 4000) || null;

    const originalId = await originalBugId(f.key);
    const { data: existing, error: findErr } = originalId
      ? await supabase.from("bugs").select(cols).eq("id", originalId).maybeSingle()
      : await supabase.from("bugs").select(cols).eq("project_id", project.id).eq("automation_key", f.key).maybeSingle();
    if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });

    const guess = f.area && areaKeys.has(f.area) ? f.area : areaFromTestKey(f.key);
    const area = guess && areaKeys.has(guess) ? guess : null;
    if (!existing) {
      const { error } = await supabase.from("bugs").insert({
        project_id: project.id,
        title: `[Automation] ${f.title}`.slice(0, 300),
        description,
        steps_to_reproduce: steps,
        severity: "minor",
        area,
        source: "automation",
        automation_key: f.key,
        release_id: release.id,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      created.push(f.key);
      continue;
    }

    const regressed = REGRESSED_FROM.has(existing.status);
    const ownBug = existing.source === "automation"; // filed by this route: its text is ours to refresh
    // A human-filed bug's release_id is the release it was reported in, not the last automation run.
    const laterRelease = ownBug && !!existing.release_id && existing.release_id !== release.id;
    const isRecurrence = regressed || laterRelease;

    const { error } = await supabase
      .from("bugs")
      .update({
        ...(ownBug ? { description, release_id: release.id } : {}),
        ...(isRecurrence
          ? { recurring: true, occurrences: existing.occurrences + 1, ...(regressed ? { status: "reopened" as const } : {}) }
          : {}),
      })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    updated.push(f.key);

    if (isRecurrence) {
      recurring.push(f.key);
      const { data: lib } = await supabase
        .from("base_page")
        .select("id, recurring_count, area")
        .eq("source_type", "master_bug")
        .eq("house_slug", String(house))
        .eq("platform", platform)
        .eq("title", existing.title)
        .maybeSingle();
      if (lib) {
        await supabase
          .from("base_page")
          .update({ recurring_count: lib.recurring_count + 1, ...(lib.area ? {} : { area: existing.area }) })
          .eq("id", lib.id);
      } else {
        await supabase.from("base_page").insert({
          title: existing.title,
          description,
          severity: existing.severity,
          area: existing.area,
          source_type: "master_bug",
          house_slug: String(house),
          platform, // the Bug Library list follows the project the failure came from
          tags: ["recurring", "automation"],
          recurring_count: 1,
        });
      }
    }
  }

  return NextResponse.json({ created, updated, recurring });
}
