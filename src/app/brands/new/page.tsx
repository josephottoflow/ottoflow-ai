"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Briefcase, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function NewBrandPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    // Normalize website to include protocol so zod URL parse succeeds.
    const normalizedWebsite =
      website.startsWith("http://") || website.startsWith("https://")
        ? website
        : `https://${website}`;

    try {
      const res = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          website: normalizedWebsite.trim(),
          industry: industry.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      const { brandId } = (await res.json()) as { brandId: string };
      router.push(`/brands/${brandId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 max-w-[720px] mx-auto">
      <Link
        href="/brands"
        className="inline-flex items-center gap-1.5 text-xs text-white/45 hover:text-white/70 transition-colors mb-6"
      >
        <ArrowLeft size={12} />
        Back to brands
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{
            background:
              "linear-gradient(135deg, rgba(124,58,237,0.2), rgba(99,102,241,0.1))",
            border: "1px solid rgba(124,58,237,0.2)",
          }}
        >
          <Briefcase size={18} className="text-violet-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Research a Brand</h1>
          <p className="text-sm text-white/45">
            Three inputs. Ottoflow does the rest.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="glass rounded-2xl p-6 mt-6 space-y-5">
        <div>
          <Label htmlFor="name">Company Name</Label>
          <Input
            id="name"
            placeholder="Acme Realty"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={submitting}
            autoFocus
          />
        </div>

        <div>
          <Label htmlFor="website">Website</Label>
          <Input
            id="website"
            placeholder="acmerealty.com"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            required
            disabled={submitting}
            inputMode="url"
          />
          <p className="text-[11px] text-white/35 mt-1.5">
            We&apos;ll fetch the homepage and key sub-pages.
          </p>
        </div>

        <div>
          <Label htmlFor="industry">Industry</Label>
          <Input
            id="industry"
            placeholder="Luxury Real Estate"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            required
            disabled={submitting}
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <p className="text-[11px] text-white/40">
            Research takes ~60–90 seconds and uses Gemini Flash + Google Search.
          </p>
          <Button
            type="submit"
            variant="gradient"
            size="sm"
            disabled={submitting || !name || !website || !industry}
            className="gap-1.5"
          >
            {submitting ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                Queuing…
              </>
            ) : (
              <>
                <Sparkles size={13} />
                Start Research
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
