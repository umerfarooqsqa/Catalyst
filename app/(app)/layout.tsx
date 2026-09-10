import { requireProfile, getProjects } from "@/lib/auth";
import AppShell from "@/components/AppShell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [{ userId, profile, level }, projects] = await Promise.all([
    requireProfile(),
    getProjects(),
  ]);

  return (
    <AppShell
      userId={userId}
      projects={projects}
      level={level}
      roleLabel={profile.roles?.label ?? "Viewer"}
      fullName={profile.full_name}
    >
      {children}
    </AppShell>
  );
}
