import Link from "next/link";
import { Briefcase, Plus, Globe, ArrowRight, CheckCircle2, Loader2, AlertTriangle, Clock } from "lucide-react";
import { listBrands } from "@/lib/db-brands";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  const brands = await listBrands();

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <p className="text-sm text-white/40 mb-1">Workspace</p>
          <h1 className="text-2xl font-bold text-white tracking-tight">Brands</h1>
          <p className="text-white/45 text-sm mt-1">
            Each brand has its own research, voice, audience, and content pipeline.
          </p>
        </div>
        <Link href="/brands/new">
          <Button variant="gradient" size="sm" className="gap-1.5">
            <Plus size={14} />
            New Brand
          </Button>
        </Link>
      </div>

      {brands.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {brands.map((b) => (
            <Link key={b.id} href={`/brands/${b.id}`}>
              <div className="glass rounded-2xl p-5 card-hover h-full">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(124,58,237,0.2), rgba(99,102,241,0.1))",
                        border: "1px solid rgba(124,58,237,0.2)",
                      }}
                    >
                      <Briefcase size={16} className="text-violet-400" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-white truncate">{b.name}</h3>
                      <p className="text-2xs text-white/40 truncate">
                        {b.industry ?? "—"}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={b.status} />
                </div>

                {b.website && (
                  <div className="flex items-center gap-1.5 text-2xs text-white/45 mb-3 truncate">
                    <Globe size={11} className="flex-shrink-0" />
                    <span className="truncate">{b.website.replace(/^https?:\/\//, "")}</span>
                  </div>
                )}

                {b.profile?.summary && (
                  <p className="text-xs text-white/55 leading-relaxed line-clamp-3 mb-3">
                    {b.profile.summary}
                  </p>
                )}

                <div className="flex items-center justify-between text-3xs text-white/35 pt-3 border-t border-white/[0.04]">
                  <span>Updated {formatRelative(b.updated_at)}</span>
                  <ArrowRight size={11} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "ready":
      return (
        <Badge variant="success" className="text-3xs gap-1">
          <CheckCircle2 size={9} />
          Ready
        </Badge>
      );
    case "researching":
      return (
        <Badge variant="info" className="text-3xs gap-1">
          <Loader2 size={9} className="animate-spin" />
          Researching
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="text-3xs gap-1">
          <AlertTriangle size={9} />
          Failed
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="text-3xs gap-1">
          <Clock size={9} />
          Pending
        </Badge>
      );
  }
}

function EmptyState() {
  return (
    <div className="glass rounded-2xl p-12 text-center">
      <div
        className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
        style={{
          background: "linear-gradient(135deg, rgba(124,58,237,0.2), rgba(99,102,241,0.1))",
          border: "1px solid rgba(124,58,237,0.2)",
        }}
      >
        <Briefcase size={24} className="text-violet-400" />
      </div>
      <h2 className="text-base font-bold text-white mb-1">No brands yet</h2>
      <p className="text-sm text-white/45 mb-5">
        Add your first brand. Ottoflow will research the website, find competitors,
        and build a content strategy automatically.
      </p>
      <Link href="/brands/new">
        <Button variant="gradient" size="sm" className="gap-1.5">
          <Plus size={14} />
          Research Your First Brand
        </Button>
      </Link>
    </div>
  );
}
