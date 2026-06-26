import { notFound } from "next/navigation";
import { getBrand } from "@/lib/db-brands";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { loadCreativeIntelligence } from "@/lib/creative/brand-intelligence";
import { IntelligenceDashboard } from "./IntelligenceDashboard";

export const dynamic = "force-dynamic";

export default async function BrandIntelligencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const brand = await getBrand(id);
  if (!brand) notFound();

  const sb = await createServerSupabaseClient();
  const ci = await loadCreativeIntelligence(sb, id, brand.industry);

  return <IntelligenceDashboard brand={brand} ci={ci} />;
}
