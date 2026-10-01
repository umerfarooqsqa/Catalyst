import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { canSeeAutomation } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import AutomationBoard from "@/components/AutomationBoard";

export const dynamic = "force-dynamic";

/**
 * Where automation work is routed: bugs in Android projects go to the Windows
 * runner's queue, bugs in iOS projects to the Mac runner's queue. Runners pull
 * their own platform's jobs (outbound calls only) and heartbeat so this page
 * can show whether each machine is online.
 */
export default async function AutomationPage() {
  const { userId, level } = await requireProfile();
  if (!canSeeAutomation(level)) redirect("/dashboard");
  const supabase = await createClient();

  const [{ data: runners }, { data: jobs }, { data: projects }] = await Promise.all([
    supabase.from("automation_runners").select("*").order("name"),
    supabase
      .from("test_jobs")
      .select(
        "id, platform, kind, status, note, created_at, claimed_at, completed_at, generated_tests, bug:bugs(id, title), project:projects(id, name, house_slug, house_group), runner:automation_runners(name)",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("projects").select("id, name, platform, house_slug, house_group").order("name"),
  ]);

  return (
    <AutomationBoard
      runners={runners ?? []}
      jobs={(jobs ?? []) as never}
      projects={(projects ?? []) as never}
      role={level}
      userId={userId}
    />
  );
}
