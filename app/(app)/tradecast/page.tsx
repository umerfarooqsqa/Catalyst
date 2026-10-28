import ProjectsView from "../projects/projects-view";

export const dynamic = "force-dynamic";

/** Tradecast's own projects list (0064). */
export default function TradecastProjectsPage() {
  return <ProjectsView area="tradecast" />;
}
