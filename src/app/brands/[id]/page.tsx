import { notFound } from "next/navigation";
import {
  getBrand,
  getLatestResearchJob,
  getBrandCompetitors,
  getBrandKeywords,
  getBrandPillars,
} from "@/lib/db-brands";
import { BrandDetailClient } from "./BrandDetailClient";

export const dynamic = "force-dynamic";

export default async function BrandDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const brand = await getBrand(id);
  if (!brand) notFound();

  const [job, competitors, keywords, pillars] = await Promise.all([
    getLatestResearchJob(id),
    getBrandCompetitors(id),
    getBrandKeywords(id),
    getBrandPillars(id),
  ]);

  return (
    <BrandDetailClient
      initialBrand={brand}
      initialJob={job}
      initialCompetitors={competitors}
      initialKeywords={keywords}
      initialPillars={pillars}
    />
  );
}
