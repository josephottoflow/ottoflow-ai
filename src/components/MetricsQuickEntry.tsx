"use client";

/**
 * Metrics quick-entry (Analytics Ingestion v1): paste a published post's
 * link → look it up → enter metrics. The companion entry point to the
 * per-card form in the Publishing Queue.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const FIELDS = ["impressions", "reach", "likes", "comments", "shares", "saves", "clicks"] as const;

interface FoundItem {
  id: string;
  title: string;
  platform: string;
}

export function MetricsQuickEntry() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [item, setItem] = useState<FoundItem | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function lookup() {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/content/by-url?url=${encodeURIComponent(url.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        setItem(null);
        setError((data as { error?: string }).error ?? "Lookup failed");
        return;
      }
      setItem(data.item as FoundItem);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!item || busy) return;
    const payload: Record<string, number> = {};
    for (const f of FIELDS) {
      const v = vals[f]?.trim();
      if (v) {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0) {
          setError(`${f} must be a non-negative whole number`);
          return;
        }
        payload[f] = n;
      }
    }
    if (Object.keys(payload).length === 0) {
      setError("Enter at least one metric.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/content/${item.id}/metrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Failed to save");
        return;
      }
      setSaved(true);
      setItem(null);
      setUrl("");
      setVals({});
      router.refresh(); // re-render the server-loaded performance section
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-white mb-1">Record metrics by link</h3>
      <p className="text-2xs text-white/40 mb-3">
        Paste the live post&apos;s link (saved when you marked it published), then enter the
        numbers from the platform&apos;s analytics.
      </p>
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.linkedin.com/feed/update/…"
          aria-label="Published post link"
          className="flex-1 rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500/50"
        />
        <Button size="sm" variant="outline" onClick={() => void lookup()} disabled={busy} className="gap-1.5">
          {busy && !item ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
          Find post
        </Button>
      </div>

      {saved && (
        <p className="flex items-center gap-1.5 text-2xs text-emerald-400 mt-2">
          <CheckCircle2 size={12} />
          Metrics saved.
        </p>
      )}
      {error && <p className="text-2xs text-red-400 mt-2">{error}</p>}

      {item && (
        <div className="mt-3 border-t border-white/5 pt-3">
          <p className="text-xs text-white/75 mb-2">
            <Badge variant="outline" className="text-3xs mr-2">{item.platform}</Badge>
            {item.title}
          </p>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 mb-2">
            {FIELDS.map((f) => (
              <div key={f}>
                <label className="block text-3xs text-white/35 capitalize mb-0.5" htmlFor={`q-${f}`}>
                  {f}
                </label>
                <input
                  id={`q-${f}`}
                  type="number"
                  min={0}
                  value={vals[f] ?? ""}
                  onChange={(e) => setVals((p) => ({ ...p, [f]: e.target.value }))}
                  className="w-full rounded-md bg-white/[0.04] border border-white/10 px-1.5 py-1 text-2xs text-white focus:outline-none focus:border-violet-500/50"
                />
              </div>
            ))}
          </div>
          <Button size="sm" onClick={() => void save()} disabled={busy} className="h-7 text-2xs">
            {busy ? <Loader2 size={11} className="animate-spin" /> : "Save metrics"}
          </Button>
        </div>
      )}
    </div>
  );
}
