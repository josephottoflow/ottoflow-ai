import { getProjects } from "@/lib/db";
import { ProjectsPageClient } from "./ProjectsPageClient";

export const revalidate = 30;

export default async function ProjectsPage() {
  const projects = await getProjects();
  return <ProjectsPageClient projects={projects} />;
}
