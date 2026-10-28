import { redirect } from "next/navigation";
import { requireProfile, getProjects, getUserPlatform } from "@/lib/auth";
import { getCategories } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import MasterLibrary from "@/components/MasterLibrary";
import { TRADECAST, isTradecast, seesTradecast } from "@/lib/tradecast";

export const dynamic = "force-dynamic";

// Grok's WhatsApp groups are an Android/iOS thing: no button here (a spread, so this page also
// builds against a MasterLibrary without that prop)
const noWhatsApp = { whatsappWaiting: null };

/**
 * Tradecast's own Bug Library (0064): the same library, one list of Tradecast entries, copied
 * only into Tradecast projects. Android/iOS developers are sent away (RLS would show them
 * nothing anyway).
 */
export default async function TradecastLibraryPage() {
  const [{ userId, level }, userPlatform] = await Promise.all([requireProfile(), getUserPlatform()]);
  if (!seesTradecast(userPlatform)) redirect("/master-library");
  const supabase = await createClient();

  const [{ data: master }, categories, projects] = await Promise.all([
    supabase
      .from("base_page")
      .select("*")
      .eq("source_type", "master_bug")
      .eq("platform", TRADECAST)
      .order("times_reused", { ascending: false })
      .limit(100),
    getCategories(),
    getProjects(),
  ]);

  return (
    <MasterLibrary
      area="tradecast"
      initial={master ?? []}
      categories={categories}
      projects={projects.filter(isTradecast)}
      role={level}
      userId={userId}
      {...noWhatsApp}
    />
  );
}
