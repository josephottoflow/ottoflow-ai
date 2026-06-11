import { notFound } from "next/navigation";
import {
  getBrand,
  getBrandEvidence,
  getBrandResearchRuns,
  getBrandGroundedArtifacts,
} from "@/lib/db-brands";
import { ResearchWorkspaceClient } from "./ResearchWorkspaceClient";

export const dynamic = "force-dynamic";

/**
 * Research Workspace (V2 Phase 2B) — read-only window into the brand's
 * evidence layer: Evidence Library + Viewer, Research Timeline, and the
 * Grounding Inspector. All data is RLS-scoped via db-brands.
 */
export default async function ResearchWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const brand = await getBrand(id);
  if (!brand) notFound();

  const [evidence, runs, artifacts] = await Promise.all([
    getBrandEvidence(id),
    getBrandResearchRuns(id),
    getBrandGroundedArtifacts(id),
  ]);

  return (
    <ResearchWorkspaceClient
      brand={{ id: brand.id, name: brand.name }}
      evidence={evidence}
      runs={runs}
      artifacts={artifacts}
    />
  );
}
