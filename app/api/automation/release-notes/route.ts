import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform, resolveRelease } from "@/lib/automation-release";
import { claimedBugs, crossCheck, extractClaims } from "@/lib/release-cross-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * REQ-6: cross-check a release's notes against the portal's bugs. Send
 * either `claimed_fixed` (explicit list of fixes the notes claim) or
 * `text` (raw notes -- bullet / numbered lines are taken as the claims).
 * Findings are stored on the release (`discrepancies`) and returned, along
 * with the bugs the notes claim as fixed (`claimed_bugs`, the REQ-14 gate).
 */
export async function POST(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;

  const body = await req.json().catch(() => null);
  const { house, version } = body ?? {};
  if (!house || !version) {
    return NextResponse.json({ error: "house and version are required" }, { status: 400 });
  }
  const claims: string[] = Array.isArray(body.claimed_fixed)
    ? body.claimed_fixed.map(String)
    : typeof body.text === "string"
      ? extractClaims(body.text)
      : [];
  if (claims.length === 0) {
    return NextResponse.json({ error: "Provide claimed_fixed[] or text containing bullet lines" }, { status: 400 });
  }

  const platform = parsePlatform(body.platform);
  if (!platform) return badPlatform();
  const resolved = await resolveRelease(String(house), String(version), platform);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  const supabase = serviceRoleClient();
  const { data: bugs, error: bugsErr } = await supabase
    .from("bugs")
    .select("id, title, status")
    .eq("project_id", resolved.project.id);
  if (bugsErr) return NextResponse.json({ error: bugsErr.message }, { status: 500 });

  const discrepancies = crossCheck(claims, bugs ?? []);
  const claimed = claimedBugs(claims, bugs ?? []);
  const { error } = await supabase
    .from("releases")
    .update({ discrepancies, claimed_bugs: claimed })
    .eq("id", resolved.release.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ claims: claims.length, discrepancies, claimed_bugs: claimed });
}
