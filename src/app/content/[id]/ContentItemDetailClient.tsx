"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Copy,
  Check,
  Linkedin,
  Facebook,
  Globe,
  Twitter,
  BookOpen,
  Mail,
  Clock,
  Hash,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DbContentItem } from "@/lib/types";

const platformConfig: Record<
  string,
  { label: string; icon: typeof Linkedin; color: string; bg: string }
> = {
  linkedin: {
    label: "LinkedIn",
    icon: Linkedin,
    color: "#0a66c2",
    bg: "rgba(10,102,194,0.12)",
  },
  facebook: {
    label: "Facebook",
    icon: Facebook,
    color: "#1877f2",
    bg: "rgba(24,119,242,0.12)",
  },
  instagram: {
    label: "Instagram",
    icon: Globe,
    color: "#e1306c",
    bg: "rgba(225,48,108,0.12)",
  },
  twitter: {
    label: "X / Twitter",
    icon: Twitter,
    color: "#1da1f2",
    bg: "rgba(29,161,242,0.12)",
  },
  blog: {
    label: "Blog Article",
    icon: BookOpen,
    color: "#a78bfa",
    bg: "rgba(124,58,237,0.12)",
  },
  email: {
    label: "Email",
    icon: Mail,
    color: "#34d399",
    bg: "rgba(16,185,129,0.12)",
  },
};

const statusVariant: Record<
  string,
  "secondary" | "success" | "info" | "warning"
> = {
  draft: "secondary",
  approved: "success",
  published: "info",
  scheduled: "warning",
};

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

interface Props {
  item: DbContentItem;
  brandName: string | null;
}

export function ContentItemDetailClient({ item, brandName }: Props) {
  const [copied, setCopied] = useState(false);
  const platform = platformConfig[item.platform] ?? platformConfig.blog;
  const PIcon = platform.icon;

  // The worker writes hashtags + cta into engagement jsonb for AI-generated
  // items. Legacy items have {likes,shares,comments}. Guard both.
  const eng = item.engagement as
    | { hashtags?: string[]; cta?: string | null }
    | { likes: number; shares: number; comments: number }
    | null;
  const hashtags = eng && "hashtags" in eng ? eng.hashtags ?? [] : [];
  const cta = eng && "cta" in eng ? eng.cta ?? null : null;

  function copyAll() {
    const parts = [item.title];
    if (item.preview) parts.push("", item.preview);
    if (item.body) parts.push("", item.body);
    if (hashtags.length) {
      parts.push(
        "",
        hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" "),
      );
    }
    if (cta) parts.push("", cta);
    navigator.clipboard.writeText(parts.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="p-6 max-w-[900px] mx-auto">
      <Link href="/content">
        <button className="text-xs text-white/40 hover:text-white/60 flex items-center gap-1 mb-6">
          <ArrowLeft size={12} /> Back to Content
        </button>
      </Link>

      {/* Header card */}
      <div className="glass rounded-2xl p-6 mb-4">
        <div className="flex items-start gap-4">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: platform.bg }}
          >
            <PIcon size={20} style={{ color: platform.color }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-3xs uppercase tracking-wider text-white/40 font-semibold">
                {platform.label}
              </span>
              <Badge
                variant={statusVariant[item.status] ?? "secondary"}
                className="text-3xs"
              >
                {item.status}
              </Badge>
              {brandName && (
                <span className="text-3xs text-white/40">
                  · for{" "}
                  <Link
                    href={item.brand_id ? `/brands/${item.brand_id}` : "/brands"}
                    className="text-white/60 hover:text-white underline-offset-2 hover:underline"
                  >
                    {brandName}
                  </Link>
                </span>
              )}
              <span className="text-3xs text-white/30 flex items-center gap-1 ml-auto">
                <Clock size={9} /> {formatRelative(item.created_at)}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight leading-tight">
              {item.title}
            </h1>
            {item.user_prompt && (
              <div className="mt-3 text-xs text-white/50 italic flex items-start gap-1.5">
                <MessageCircle
                  size={11}
                  className="flex-shrink-0 mt-0.5 text-white/30"
                />
                <span>&ldquo;{item.user_prompt}&rdquo;</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content body card */}
      <div className="glass rounded-2xl p-6 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Generated content</h2>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={copyAll}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy all"}
          </Button>
        </div>

        {item.preview && (
          <p className="text-sm text-white/70 italic mb-5 leading-relaxed border-l-2 border-white/10 pl-3">
            {item.preview}
          </p>
        )}

        {item.body ? (
          <div className="text-sm text-white/85 whitespace-pre-wrap leading-relaxed font-light">
            {item.body}
          </div>
        ) : (
          <p className="text-xs text-white/40 italic">
            Body still being generated… reload in a moment.
          </p>
        )}

        {cta && (
          <div className="mt-6 pt-5 border-t border-white/5">
            <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold mb-1.5">
              Suggested CTA
            </p>
            <p className="text-sm text-white/75">{cta}</p>
          </div>
        )}

        {hashtags.length > 0 && (
          <div className="mt-6 pt-5 border-t border-white/5">
            <p className="text-3xs uppercase tracking-wider text-white/40 font-semibold mb-2 flex items-center gap-1.5">
              <Hash size={10} /> Hashtags
            </p>
            <div className="flex flex-wrap gap-1.5">
              {hashtags.map((h) => (
                <span
                  key={h}
                  className="text-xs px-2.5 py-1 rounded-full bg-white/5 text-white/65"
                >
                  #{h.replace(/^#/, "")}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between text-2xs text-white/30">
        <span>Content ID: {item.id}</span>
        <Link href="/content/generate">
          <Button variant="outline" size="sm" className="gap-1.5">
            Generate another →
          </Button>
        </Link>
      </div>
    </div>
  );
}
