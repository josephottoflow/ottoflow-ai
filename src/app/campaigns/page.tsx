import { Megaphone } from "lucide-react";
import { listBrands } from "@/lib/db-brands";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { NewCampaign } from "./NewCampaign";
import { CampaignLibrary } from "./CampaignLibrary";
import type { DbCampaign } from "@/lib/types";

export const dynamic = "force-dynamic";

async function loadCampaigns(): Promise<DbCampaign[]> {
  try {
    const sb = await createServerSupabaseClient();
    const { data } = await sb
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    return (data ?? []) as DbCampaign[];
  } catch {
    return [];
  }
}

export default async function CampaignsPage() {
  const [brands, campaigns] = await Promise.all([listBrands(), loadCampaigns()]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 lg:px-8">
      <div className="flex items-center gap-2.5 mb-1">
        <Megaphone size={18} className="text-[#F2A863]" />
        <h1 className="text-xl font-bold text-white tracking-tight">Campaigns</h1>
      </div>
      <p className="text-sm text-white/45 mb-6">
        One request → a complete, strategically-aligned campaign package.
      </p>

      <div className="mb-8">
        <NewCampaign brands={brands.map((b) => ({ id: b.id, name: b.name }))} />
      </div>

      {campaigns.length === 0 ? (
        <p className="text-sm text-white/40">No campaigns yet — generate your first above.</p>
      ) : (
        <CampaignLibrary initial={campaigns} />
      )}
    </div>
  );
}
