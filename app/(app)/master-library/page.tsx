import { redirect } from "next/navigation";
import { requireProfile, getProjects, getUserPlatform } from "@/lib/auth";
import { getCategories } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import MasterLibrary from "@/components/MasterLibrary";
import { isTradecast, seesMain, seesTradecast } from "@/lib/tradecast";
import { isManager } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function MasterLibraryPage() {
  const { userId, level } = await requireProfile();
  // Tradecast has its own library (0064); its team is sent there
  const userPlatform = await getUserPlatform();
  if (!seesMain(userPlatform)) redirect("/tradecast/library");
  // Admins, QA and cross-platform categories also get a Tradecast tab here (2026-11-12, decided
  // with the user); Android/iOS developers don't (RLS would show them no entries anyway).
  const showTradecast = seesTradecast(userPlatform);
  const supabase = await createClient();

  const [{ data: master }, categories, projects, waiting] = await Promise.all([
    supabase
      .from("base_page")
      .select("*")
      .eq("source_type", "master_bug")
      .eq("platform", "android") // default tab; the client switches lists
      .is("collection", null) // Java to Flutter entries (0071) have their own tab
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
      projects={showTradecast ? projects : projects.filter((p) => !isTradecast(p))}
      showTradecast={showTradecast}
      role={level}
      userId={userId}
      whatsappWaiting={waiting && !waiting.error ? (waiting.data ?? []).length : null}
    />
  );
}
