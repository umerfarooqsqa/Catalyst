import { requireProfile, getProjects } from "@/lib/auth";
import { getCategories } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import MasterLibrary from "@/components/MasterLibrary";

export const dynamic = "force-dynamic";

export default async function MasterLibraryPage() {
  const { userId, level } = await requireProfile();
  const supabase = await createClient();

  const [{ data: master }, categories, projects] = await Promise.all([
    supabase
      .from("base_page")
      .select("*")
      .eq("source_type", "master_bug")
      .order("times_reused", { ascending: false })
      .limit(100),
    getCategories(),
    getProjects(),
  ]);

  return (
    <MasterLibrary
      initial={master ?? []}
      categories={categories}
      projects={projects}
      role={level}
      userId={userId}
    />
  );
}
