import { notFound } from "next/navigation";
import { getProject, getContentItems, getRenderJobs, getActivity } from "@/lib/db";
import { ProjectDetailClient } from "./ProjectDetailClient";

export const revalidate = 30;

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await getProject(id);
  if (!project) notFound();

  const [content, renderJobs, activity] = await Promise.all([
    getContentItems(id),
    getRenderJobs(id, 50),
    getActivity(20),
  ]);

  return (
    <ProjectDetailClient
      project={project}
      content={content}
      renderJobs={renderJobs}
      activity={activity}
    />
  );
}
