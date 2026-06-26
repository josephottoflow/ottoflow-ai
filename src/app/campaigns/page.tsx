import Link from "next/link";
import { Megaphone } from "lucide-react";
import { listBrands } from "@/lib/db-brands";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { NewCampaign } from "./NewCampaign";
import type { DbCampaign } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  planning: "bg-white/[0.06] text-white/50",
  generating: "bg-amber-500/[0.1] text-amber-300",
  review: "bg-cyan-500/[0.1] text-cyan-300",
  ready: "bg-emerald-500/[0.1] text-emerald-300",
  failed: "bg-rose-500/[0.1] text-rose-300",
};

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
        <Megaphone size={18} className="text-violet-400" />
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
        <ul className="space-y-2">
          {campaigns.map((c) => (
            <li key={c.id}>
              <Link
                href={`/campaigns/${c.id}`}
                className="glass card-hover rounded-2xl p-4 flex items-center gap-3 block"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white/85 truncate">
                    {c.title || c.prompt}
                  </p>
                  <p className="text-xs text-white/40 truncate">
                    {c.platform} · {c.asset_count} asset{c.asset_count === 1 ? "" : "s"}
                  </p>
                </div>
                <span
                  className={`flex-shrink-0 text-3xs font-semibold uppercase tracking-wider px-2 py-1 rounded-full ${STATUS_TONE[c.status] ?? STATUS_TONE.planning}`}
                >
                  {c.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
