import { notFound } from "next/navigation";
import { requireProfile, getProjects } from "@/lib/auth";
import ProjectTabs from "@/components/ProjectTabs";
import { canAdminister, canSeeAutomation } from "@/lib/permissions";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [{ level }, projects] = await Promise.all([
    requireProfile(),
    getProjects(),
  ]);

  const project = projects.find((p) => p.id === projectId);
  if (!project) notFound();

  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
        Project
      </div>
      <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">
        {project.name}
      </h1>
      {project.description ? (
        <p className="mt-0.5 text-sm text-slate-500">{project.description}</p>
      ) : null}
      <div className="mt-4">
        <ProjectTabs
          projectId={project.id}
          canSettings={canAdminister(level)}
          canAutomation={canSeeAutomation(level)}
        />
        {children}
      </div>
    </div>
  );
}
