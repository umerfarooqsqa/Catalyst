import { requireProfile, getProjects } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { RoleCategoriesProvider } from "@/components/RoleCategories";
import { getRoleCategories } from "@/lib/data";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [{ userId, profile, level }, projects, roleCategories] = await Promise.all([
    requireProfile(),
    getProjects(),
    getRoleCategories(),
  ]);

  return (
    <RoleCategoriesProvider value={roleCategories}>
    <AppShell
      userId={userId}
      projects={projects}
      level={level}
      roleLabel={profile.roles?.label ?? "Viewer"}
      fullName={profile.full_name}
    >
      {children}
    </AppShell>
    </RoleCategoriesProvider>
  );
}
