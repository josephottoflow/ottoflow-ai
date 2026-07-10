"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";

const PLATFORMS = ["linkedin", "instagram", "facebook", "twitter"];

export function NewCampaign({ brands }: { brands: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [platform, setPlatform] = useState("linkedin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!brandId || prompt.trim().length < 4) {
      setError("Pick a brand and describe the campaign.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, prompt: prompt.trim(), platform }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to create campaign");
        setBusy(false);
        return;
      }
      router.push(`/campaigns/${json.campaign.id}`);
    } catch {
      setError("Network error — try again.");
      setBusy(false);
    }
  }

  if (brands.length === 0) {
    return (
      <div className="glass rounded-2xl p-5 text-sm text-white/50">
        Research a brand first — campaigns are generated for a brand.
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-5 space-y-3">
      <p className="text-sm font-semibold text-white/85">New campaign</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <select
          value={brandId}
          onChange={(e) => setBrandId(e.target.value)}
          className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white/85 sm:col-span-2"
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id} className="bg-[#1a1510]">
              {b.name}
            </option>
          ))}
        </select>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white/85 capitalize"
        >
          {PLATFORMS.map((p) => (
            <option key={p} value={p} className="bg-[#1a1510]">
              {p}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        placeholder="What is this campaign for? e.g. “Recruitment push for senior engineers — emphasise our remote culture and shipping pace.”"
        className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white/85 placeholder:text-white/30 resize-none"
      />
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[#E9863B]/90 hover:bg-[#E9863B] text-white disabled:opacity-50 transition-colors"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {busy ? "Planning campaign…" : "Generate campaign"}
      </button>
      <p className="text-3xs text-white/35">
        OttoFlow plans the strategy, then generates the full asset package — hero, supporting, quote,
        follow-up and more — each reinforcing one strategy.
      </p>
    </div>
  );
}
