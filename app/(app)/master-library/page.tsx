import { redirect } from "next/navigation";
import { requireProfile, getProjects, getUserPlatform } from "@/lib/auth";
import { getCategories } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import MasterLibrary from "@/components/MasterLibrary";
import { isTradecast, seesMain } from "@/lib/tradecast";
import { isManager } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function MasterLibraryPage() {
  const { userId, level } = await requireProfile();
  // Tradecast has its own library (0064); its team is sent there
  if (!seesMain(await getUserPlatform())) redirect("/tradecast/library");
  const supabase = await createClient();

  const [{ data: master }, categories, projects, waiting] = await Promise.all([
    supabase
      .from("base_page")
      .select("*")
      .eq("source_type", "master_bug")
      .eq("platform", "android") // default tab; the client switches lists
      .order("times_reused", { ascending: false })
      .limit(100),
    getCategories(),
    getProjects(),
    // Grok's WhatsApp messages still waiting for a house (QA/admin; migration 0047)
    isManager(level) ? supabase.rpc("whatsapp_inbox_waiting") : null,
  ]);

  return (
    <MasterLibrary
      initial={master ?? []}
      categories={categories}
      projects={projects.filter((p) => !isTradecast(p))}
      role={level}
      userId={userId}
      whatsappWaiting={waiting && !waiting.error ? (waiting.data ?? []).length : null}
    />
  );
}
