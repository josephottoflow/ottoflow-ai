import { notFound } from "next/navigation";
import {
  getBrand,
  getLatestResearchJob,
  getBrandCompetitors,
  getBrandKeywords,
  getBrandPillars,
  getBrandTopics,
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

  const [job, competitors, keywords, pillars, topics] = await Promise.all([
    getLatestResearchJob(id),
    getBrandCompetitors(id),
    getBrandKeywords(id),
    getBrandPillars(id),
    getBrandTopics(id),
  ]);

  return (
    <BrandDetailClient
      initialBrand={brand}
      initialJob={job}
      initialCompetitors={competitors}
      initialKeywords={keywords}
      initialPillars={pillars}
      initialTopics={topics}
    />
  );
}
