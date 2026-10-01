import { NextResponse } from "next/server";
import { serviceRoleClient } from "@/lib/supabase/admin";
import { badPlatform, checkAutomationSecret, parsePlatform } from "@/lib/automation-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OS_FOR_PLATFORM = { android: "windows", ios: "macos" } as const;

/**
 * A test runner announces itself (register + heartbeat in one call, idempotent
 * by name). The portal shows each platform's runner as online while heartbeats
 * keep arriving. The rule this whole feature exists for is enforced here too,
 * with a readable error before the database check would fire: Android tests
 * run on Windows, iOS tests on a Mac.
 *
 * Runners only ever call the portal; the portal never connects to them.
 */
export async function POST(req: Request) {
  const authError = checkAutomationSecret(req);
  if (authError) return authError;

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (body?.platform === undefined || body?.platform === null || body?.platform === "") {
    return NextResponse.json({ error: "platform is required ('android' or 'ios')" }, { status: 400 });
  }
  const platform = parsePlatform(body.platform);
  if (!platform) return badPlatform();
  const os = String(body?.os ?? "").toLowerCase();
  if (os !== OS_FOR_PLATFORM[platform]) {
    return NextResponse.json(
      {
        error: `${platform === "ios" ? "iOS" : "Android"} tests run on ${
          platform === "ios" ? "a Mac (macos)" : "Windows (windows)"
        }; this runner reported os='${os || "unknown"}'.`,
      },
      { status: 422 },
    );
  }

  const supabase = serviceRoleClient();
  const { data, error } = await supabase
    .from("automation_runners")
    .upsert(
      {
        name,
        platform,
        os,
        status: String(body?.status ?? "idle"),
        app_version: body?.app_version ? String(body.app_version) : null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "name" },
    )
    .select("id, name, platform, os")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runner: data });
}
