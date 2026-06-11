"use client";

/**
 * Ask Research (V2 Phase 2A) — grounded Q&A over the brand's evidence store.
 *
 * Brand page panel: ask a question → POST /api/brands/[id]/ask → markdown
 * answer with [n] citations + expandable source evidence viewer. Stateless
 * by design (no conversation persistence in 2A) — each question stands alone.
 */
import { useRef, useState } from "react";
import { Loader2, Search, ChevronDown, ChevronUp, ExternalLink, BookOpenText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface AskSource {
  n: number;
  id: string;
  sourceType: string;
  url: string | null;
  domain: string | null;
  title: string | null;
  capturedAt: string;
  content: string;
  cited: boolean;
}

interface AskResponse {
  answer: string;
  insufficient: boolean;
  sources: AskSource[];
  evidenceCount: number;
}

const SUGGESTED = [
  "What pain points appear most frequently?",
  "What differentiates us from competitors?",
  "What topics should we write about next?",
  "What themes are emerging in our industry?",
];

const SOURCE_TYPE_LABEL: Record<string, string> = {
  website: "Website",
  search_result: "Google Search",
  competitor: "Competitor",
  industry: "Industry",
  keyword: "Keyword",
  social: "Social",
  news: "News",
  manual: "Manual",
};

/** Minimal markdown-ish renderer: paragraphs, bullets, **bold**, [n] chips. */
function AnswerBody({ text, onCitationClick }: { text: string; onCitationClick: (n: number) => void }) {
  const lines = text.split(/\n/);
  return (
    <div className="space-y-2 text-sm text-white/80 leading-relaxed">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        const isBullet = /^[-•*]\s+/.test(trimmed);
        const body = isBullet ? trimmed.replace(/^[-•*]\s+/, "") : trimmed;
        return (
          <p key={i} className={isBullet ? "pl-4 relative before:content-['•'] before:absolute before:left-1 before:text-white/40" : ""}>
            <InlineRich text={body} onCitationClick={onCitationClick} />
          </p>
        );
      })}
    </div>
  );
}

function InlineRich({ text, onCitationClick }: { text: string; onCitationClick: (n: number) => void }) {
  // Tokenize on **bold** and [n] citations.
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const bold = part.match(/^\*\*([^*]+)\*\*$/);
        if (bold) return <strong key={i} className="text-white font-semibold">{bold[1]}</strong>;
        const cite = part.match(/^\[(\d+)\]$/);
        if (cite) {
          const n = Number(cite[1]);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onCitationClick(n)}
              className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 mx-0.5 rounded text-3xs font-semibold align-text-top bg-violet-600/30 text-violet-300 hover:bg-violet-600/50 transition-colors"
              aria-label={`View source ${n}`}
            >
              {n}
            </button>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function SourceCard({ source, highlighted }: { source: AskSource; highlighted: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      id={`ask-source-${source.n}`}
      className={`rounded-xl border p-3 transition-colors ${
        highlighted
          ? "border-violet-500/60 bg-violet-600/10"
          : source.cited
            ? "border-white/10 bg-white/[0.03]"
            : "border-white/5 bg-transparent opacity-60"
      }`}
    >
      <button
        type="button"
        className="w-full flex items-center gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Toggle source ${source.n} evidence`}
      >
        <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-violet-600/30 text-violet-300 text-3xs font-semibold shrink-0">
          {source.n}
        </span>
        <span className="text-xs text-white/80 font-medium truncate flex-1">
          {source.title || source.domain || source.url || "Untitled source"}
        </span>
        <Badge variant="outline" className="text-3xs shrink-0">
          {SOURCE_TYPE_LABEL[source.sourceType] ?? source.sourceType}
        </Badge>
        <span className="text-3xs text-white/30 shrink-0">{source.capturedAt.slice(0, 10)}</span>
        {open ? <ChevronUp size={14} className="text-white/40 shrink-0" /> : <ChevronDown size={14} className="text-white/40 shrink-0" />}
      </button>
      {open && (
        <div className="mt-2 pl-7">
          <p className="text-xs text-white/60 whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
            {source.content}
          </p>
          {source.url && (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-3xs text-cyan-300 hover:text-cyan-200"
            >
              <ExternalLink size={10} />
              {source.domain ?? "Open original"}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function AskResearch({ brandId, brandReady }: { brandId: string; brandReady: boolean }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [askedQuestion, setAskedQuestion] = useState<string | null>(null);
  const [highlightN, setHighlightN] = useState<number | null>(null);
  const sourcesRef = useRef<HTMLDivElement>(null);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (trimmed.length < 3 || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setAskedQuestion(trimmed);
    setHighlightN(null);
    try {
      const res = await fetch(`/api/brands/${brandId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Something went wrong — try again.");
        return;
      }
      setResult(data as AskResponse);
    } catch {
      setError("Network error — try again.");
    } finally {
      setLoading(false);
    }
  }

  function onCitationClick(n: number) {
    setHighlightN(n);
    document.getElementById(`ask-source-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const citedSources = result?.sources.filter((s) => s.cited) ?? [];
  const uncitedSources = result?.sources.filter((s) => !s.cited) ?? [];

  return (
    <section className="glass rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <BookOpenText size={16} className="text-violet-400" />
        <h2 className="text-base font-semibold text-white">Ask the research</h2>
      </div>
      <p className="text-xs text-white/40 mb-4">
        Answers come only from this brand&apos;s stored research evidence — every claim is cited.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={brandReady ? "Ask anything about this brand's market…" : "Available once research completes…"}
          disabled={!brandReady || loading}
          maxLength={500}
          className="flex-1 rounded-xl bg-white/[0.04] border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500/50 disabled:opacity-50"
          aria-label="Ask a question about this brand's research"
        />
        <Button type="submit" disabled={!brandReady || loading || question.trim().length < 3} className="gap-1.5">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Ask
        </Button>
      </form>

      {!result && !loading && brandReady && (
        <div className="flex flex-wrap gap-2 mt-3">
          {SUGGESTED.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setQuestion(s);
                void ask(s);
              }}
              className="text-2xs text-white/50 hover:text-white/80 border border-white/10 hover:border-violet-500/40 rounded-full px-3 py-1 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 mt-4 text-xs text-white/40">
          <Loader2 size={14} className="animate-spin" />
          Searching evidence and composing a grounded answer…
        </div>
      )}

      {error && (
        <p className="mt-4 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-5 space-y-4">
          {askedQuestion && (
            <p className="text-xs text-white/40 italic">&ldquo;{askedQuestion}&rdquo;</p>
          )}

          <AnswerBody text={result.answer} onCitationClick={onCitationClick} />

          {result.insufficient && result.evidenceCount > 0 && (
            <p className="text-2xs text-amber-400/80">
              The stored evidence only partially covers this — re-running research will deepen future answers.
            </p>
          )}

          {result.sources.length > 0 && (
            <div ref={sourcesRef}>
              <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wide mb-2">
                Sources ({citedSources.length} cited
                {uncitedSources.length > 0 ? ` · ${uncitedSources.length} also retrieved` : ""})
              </h3>
              <div className="space-y-2">
                {result.sources.map((s) => (
                  <SourceCard key={s.id} source={s} highlighted={highlightN === s.n} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
