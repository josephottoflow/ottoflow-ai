import { getRenderJobs, getKPISummary } from "@/lib/db";
import { VideoPageClient } from "./VideoPageClient";

export const revalidate = 15; // refresh more frequently — live queue

export default async function VideoPipelinePage() {
  const [renderJobs, kpis] = await Promise.all([
    getRenderJobs(undefined, 20),
    getKPISummary(),
  ]);

  return <VideoPageClient renderJobs={renderJobs} kpis={kpis} />;
}
