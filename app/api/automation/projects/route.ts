import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform } from "@/lib/automation-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9_]+$/;

/**
 * GET [?platform=android|ios] — every catalyst project that has an app (a house),
 * for the runner to build its one-folder-per-project layout from
 * (`projects/<platform>/<house>/` in the aktrade repo). Projects with no house
 * are omitted: there is no app to automate, so they get no folder.
 *
 * GET ?unmapped=1&platform=... — the opposite: projects of that platform with
 * NO house yet, so the Development Portal's "Add app" can offer to link a
 * new app to one of them instead of creating a duplicate project.
 */
export async function GET(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;

  const params = new URL(req.url).searchParams;
  const platform = params.get("platform");
  if (platform && platform !== "android" && platform !== "ios") {
    return NextResponse.json({ error: "platform must be 'android' or 'ios'" }, { status: 400 });
  }

  const supabase = serviceRoleClient();
  let query = supabase
    .from("projects")
    .select("id, name, platform, house_slug, house_group, current_version")
    .not("platform", "is", null)
    .order("name");
  if (platform) query = query.eq("platform", platform);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const projects = (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    platform: p.platform,
    // the Android project carries house_slug; its iOS sibling only house_group
    house: p.house_slug ?? p.house_group,
    version: p.current_version,
  }));
  const unmapped = params.get("unmapped") === "1";
  return NextResponse.json({ projects: projects.filter((p) => (unmapped ? !p.house : p.house)) });
}

/**
 * POST — "Add app" from the aktrade Development Portal: give a new house its
 * catalyst project. Body: { house, name, platform, version?, project_id? }.
 *
 * - The house is already mapped: returned as is ("existing").
 * - `project_id` given (or a project of that platform with the same name,
 *   case-insensitively): that project gets the house, provided it has none
 *   yet ("linked"; 409 if it's mapped to another house). Its version is
 *   filled in only if it was empty.
 * - Otherwise a new project is created ("created").
 *
 * On Android the house goes into house_slug; on iOS into house_group (the
 * same split as resolveProject). This replaces the hand-written mapping
 * migrations (0021, 0028-0030) for new apps.
 */
export async function POST(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;

  const body = await req.json().catch(() => null);
  const house = String(body?.house ?? "").trim();
  const name = String(body?.name ?? "").trim();
  const version = body?.version ? String(body.version).trim() : null;
  const projectId = body?.project_id ? String(body.project_id) : null;
  if (!SLUG.test(house) || !name) {
    return NextResponse.json({ error: "house (lowercase letters, digits, _) and name are required" }, { status: 400 });
  }
  const platform = parsePlatform(body?.platform);
  if (!platform) return badPlatform();
  const houseCol = platform === "android" ? "house_slug" : "house_group";
  const houseValue = platform === "android" ? { house_slug: house } : { house_group: house };

  const supabase = serviceRoleClient();
  const cols = "id, name, platform, house_slug, house_group, current_version";
  const shape = (p: { id: string; name: string; platform: string | null; house_slug: string | null; house_group: string | null; current_version: string | null }) => ({
    id: p.id,
    name: p.name,
    platform: p.platform,
    house: p.house_slug ?? p.house_group,
    version: p.current_version,
  });

  const { data: mapped, error: mapErr } = await supabase
    .from("projects")
    .select(cols)
    .eq(houseCol, house)
    .eq("platform", platform)
    .maybeSingle();
  if (mapErr) return NextResponse.json({ error: mapErr.message }, { status: 500 });
  if (mapped) return NextResponse.json({ status: "existing", project: shape(mapped) });

  let target = null;
  if (projectId) {
    const { data, error } = await supabase.from("projects").select(cols).eq("id", projectId).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "That project does not exist" }, { status: 404 });
    if (data.platform !== platform) {
      return NextResponse.json({ error: `That project is ${data.platform ?? "not set to a platform"}, not ${platform}` }, { status: 409 });
    }
    target = data;
  } else {
    const { data, error } = await supabase.from("projects").select(cols).eq("platform", platform).ilike("name", name);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    target = (data ?? [])[0] ?? null;
  }

  if (target) {
    const other = platform === "android" ? target.house_slug : target.house_group;
    if (other) {
      return NextResponse.json({ error: `Project '${target.name}' is already linked to app '${other}'` }, { status: 409 });
    }
    const { data, error } = await supabase
      .from("projects")
      .update({ ...houseValue, ...(target.current_version || !version ? {} : { current_version: version }) })
      .eq("id", target.id)
      .select(cols)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ status: "linked", project: shape(data) });
  }

  const { data, error } = await supabase
    .from("projects")
    .insert({
      name,
      description: "Added from the aktrade Development Portal (Add app).",
      platform,
      ...houseValue,
      current_version: version,
    })
    .select(cols)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: "created", project: shape(data) });
}
