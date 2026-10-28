import ProjectsView from "./projects-view";

export const dynamic = "force-dynamic";

/** Android / iOS projects; Tradecast has its own list at /tradecast (0064). */
export default function ProjectsPage() {
  return <ProjectsView area="main" />;
}
