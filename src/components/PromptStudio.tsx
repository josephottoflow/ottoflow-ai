"use client";

/**
 * Prompt Studio (Premium UX — Phase 2, Creative Studio).
 *
 * A premium prompt-editing surface for the "extra direction" that steers a
 * generation. Purely a UI/UX layer over the EXISTING `userPrompt` field that
 * /api/content/generate already accepts — no backend, no API, and no
 * generation-prompt changes. All history / versions / favorites live in
 * localStorage (same store strategy the generate workspace already uses).
 *
 * What it adds over a bare textarea:
 *   • A calmer, better-typeset editor with a live character meter.
 *   • Prompt history (auto-snapshot on meaningful edits) with one-click restore.
 *   • Saved / favorite prompts you can reuse across sessions and brands.
 *   • Quick-direction chips that compose common intents into the prompt.
 *   • Considered empty / focus states.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  History,
  Star,
  StarOff,
  Wand2,
  X,
  RotateCcw,
  Trash2,
  Plus,
  Check,
} from "lucide-react";

const HISTORY_KEY = "ottoflow.promptstudio.history.v1";
const FAVORITES_KEY = "ottoflow.promptstudio.favorites.v1";
const HISTORY_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const HISTORY_CAP = 25;
const FAVORITES_CAP = 40;

interface StoredPrompt {
  id: string;
  text: string;
  createdAt: number;
}

/** Quick-direction presets — pure client-side text helpers, not prompt logic. */
const QUICK_DIRECTIONS: Array<{ label: string; snippet: string }> = [
  { label: "Lead with a stat", snippet: "Open with a surprising, specific statistic." },
  { label: "Emphasize an offer", snippet: "Highlight the current offer and its deadline." },
  { label: "Punchy CTA", snippet: "End with one short, high-energy call to action." },
  { label: "Tell a mini-story", snippet: "Frame it as a short before/after story." },
  { label: "Address an objection", snippet: "Name and dismantle the top buyer objection." },
  { label: "Speak to founders", snippet: "Write for time-poor founders; keep it concrete." },
];

function readStore(key: string): StoredPrompt[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const now = Date.now();
    const all = (JSON.parse(raw) as StoredPrompt[])
      .filter((p) => p && p.id && typeof p.text === "string" && p.text.trim().length > 0)
      .filter((p) => key !== HISTORY_KEY || now - p.createdAt < HISTORY_TTL_MS)
      .sort((a, b) => b.createdAt - a.createdAt);
    return all;
  } catch {
    return [];
  }
}

function writeStore(key: string, entries: StoredPrompt[]): void {
  if (typeof window === "undefined") return;
  try {
    const cap = key === HISTORY_KEY ? HISTORY_CAP : FAVORITES_CAP;
    window.localStorage.setItem(key, JSON.stringify(entries.slice(0, cap)));
  } catch {
    /* quota / disabled — non-fatal */
  }
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

type Drawer = null | "history" | "favorites";

export function PromptStudio({
  value,
  onChange,
  maxLength = 500,
  brandName,
}: {
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  brandName?: string | null;
}) {
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [history, setHistory] = useState<StoredPrompt[]>([]);
  const [favorites, setFavorites] = useState<StoredPrompt[]>([]);
  const [justSaved, setJustSaved] = useState(false);
  const [focused, setFocused] = useState(false);
  const lastSnapshot = useRef<string>("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Hydrate stores on mount.
  useEffect(() => {
    setHistory(readStore(HISTORY_KEY));
    setFavorites(readStore(FAVORITES_KEY));
  }, []);

  const trimmed = value.trim();
  const isFavorited = favorites.some((f) => f.text.trim() === trimmed && trimmed.length > 0);
  const count = value.length;
  const nearLimit = count > maxLength * 0.9;

  // Snapshot the current prompt into history on blur, if it's non-trivial and
  // meaningfully different from the last snapshot. Keeps history clean (no
  // keystroke spam), yet nothing the user typed is silently lost.
  const snapshot = useCallback(() => {
    const t = value.trim();
    if (t.length < 8) return;
    if (t === lastSnapshot.current) return;
    lastSnapshot.current = t;
    setHistory((prev) => {
      const deduped = prev.filter((p) => p.text.trim() !== t);
      const next = [{ id: newId(), text: value, createdAt: Date.now() }, ...deduped];
      writeStore(HISTORY_KEY, next);
      return next;
    });
  }, [value]);

  const applyText = useCallback(
    (text: string) => {
      onChange(text.slice(0, maxLength));
      setDrawer(null);
      // Focus + move caret to end for immediate editing.
      requestAnimationFrame(() => {
        const el = taRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    },
    [onChange, maxLength],
  );

  const appendSnippet = useCallback(
    (snippet: string) => {
      const base = value.trim();
      const joined = base ? `${base} ${snippet}` : snippet;
      onChange(joined.slice(0, maxLength));
      requestAnimationFrame(() => taRef.current?.focus());
    },
    [value, onChange, maxLength],
  );

  const toggleFavorite = useCallback(() => {
    const t = value.trim();
    if (!t) return;
    setFavorites((prev) => {
      const exists = prev.find((f) => f.text.trim() === t);
      let next: StoredPrompt[];
      if (exists) {
        next = prev.filter((f) => f.id !== exists.id);
      } else {
        next = [{ id: newId(), text: value, createdAt: Date.now() }, ...prev];
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1400);
      }
      writeStore(FAVORITES_KEY, next);
      return next;
    });
  }, [value]);

  const removeFrom = useCallback((key: string, id: string) => {
    const setter = key === HISTORY_KEY ? setHistory : setFavorites;
    setter((prev) => {
      const next = prev.filter((p) => p.id !== id);
      writeStore(key, next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    writeStore(HISTORY_KEY, []);
  }, []);

  const activeList = drawer === "history" ? history : favorites;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-semibold text-white/70 uppercase tracking-wider flex items-center gap-1.5">
          <Wand2 size={12} className="text-[#F2A863]" />
          Prompt Studio
          <span className="text-white/30 font-normal normal-case">— steer the generation (optional)</span>
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDrawer((d) => (d === "history" ? null : "history"))}
            className={`flex items-center gap-1 text-2xs px-2 py-1 rounded-md transition-colors ${
              drawer === "history"
                ? "bg-[#E9863B]/12 text-[#F2A863]"
                : "text-white/45 hover:text-white/70 hover:bg-white/[0.04]"
            }`}
            aria-pressed={drawer === "history"}
          >
            <History size={11} /> History
            {history.length > 0 && <span className="text-white/30">({history.length})</span>}
          </button>
          <button
            type="button"
            onClick={() => setDrawer((d) => (d === "favorites" ? null : "favorites"))}
            className={`flex items-center gap-1 text-2xs px-2 py-1 rounded-md transition-colors ${
              drawer === "favorites"
                ? "bg-[#E9863B]/12 text-[#F2A863]"
                : "text-white/45 hover:text-white/70 hover:bg-white/[0.04]"
            }`}
            aria-pressed={drawer === "favorites"}
          >
            <Star size={11} /> Saved
            {favorites.length > 0 && <span className="text-white/30">({favorites.length})</span>}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div
        className="rounded-xl transition-colors"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${focused ? "rgba(233,134,59,0.40)" : "rgba(255,255,255,0.10)"}`,
        }}
      >
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            snapshot();
          }}
          placeholder={
            brandName
              ? `Anything to emphasize for ${brandName} — a stat, an offer, a specific angle. Leave blank to let the idea + brand voice drive it.`
              : "Anything to emphasize — a stat, an offer, a specific angle. Leave blank to let the idea + brand voice drive it."
          }
          rows={3}
          className="w-full bg-transparent px-4 pt-3 pb-2 text-sm text-white placeholder:text-white/25 focus:outline-none resize-none leading-relaxed"
        />
        <div className="flex items-center justify-between px-3 pb-2.5 pt-0.5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleFavorite}
              disabled={!trimmed}
              title={isFavorited ? "Remove from saved" : "Save this prompt"}
              className={`flex items-center gap-1 text-2xs px-2 py-1 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                isFavorited
                  ? "text-[#F2A863] hover:bg-[#E9863B]/10"
                  : "text-white/45 hover:text-white/75 hover:bg-white/[0.04]"
              }`}
            >
              {justSaved ? (
                <Check size={11} />
              ) : isFavorited ? (
                <Star size={11} className="fill-current" />
              ) : (
                <StarOff size={11} />
              )}
              {justSaved ? "Saved" : isFavorited ? "Saved" : "Save"}
            </button>
            {trimmed && (
              <button
                type="button"
                onClick={() => applyText("")}
                title="Clear"
                className="flex items-center gap-1 text-2xs px-2 py-1 rounded-md text-white/45 hover:text-white/75 hover:bg-white/[0.04] transition-colors"
              >
                <X size={11} /> Clear
              </button>
            )}
          </div>
          <span className={`text-2xs tabular-nums ${nearLimit ? "text-[#F2A863]" : "text-white/30"}`}>
            {count}/{maxLength}
          </span>
        </div>
      </div>

      {/* Quick directions */}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {QUICK_DIRECTIONS.map((d) => (
          <button
            key={d.label}
            type="button"
            onClick={() => appendSnippet(d.snippet)}
            className="flex items-center gap-1 text-2xs px-2 py-1 rounded-full text-white/55 hover:text-[#F2A863] transition-colors"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
            title={d.snippet}
          >
            <Plus size={9} /> {d.label}
          </button>
        ))}
      </div>

      {/* History / Favorites drawer */}
      {drawer && (
        <div
          className="mt-2 rounded-xl overflow-hidden"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.05]">
            <p className="text-2xs uppercase tracking-wider text-white/40 font-semibold flex items-center gap-1.5">
              {drawer === "history" ? <History size={11} /> : <Star size={11} />}
              {drawer === "history" ? "Recent prompts" : "Saved prompts"}
            </p>
            <div className="flex items-center gap-2">
              {drawer === "history" && history.length > 0 && (
                <button
                  type="button"
                  onClick={clearHistory}
                  className="text-2xs text-white/40 hover:text-rose-300 transition-colors"
                >
                  Clear all
                </button>
              )}
              <button
                type="button"
                onClick={() => setDrawer(null)}
                className="text-white/40 hover:text-white/70 transition-colors"
                aria-label="Close"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {activeList.length === 0 ? (
            <div className="px-3 py-5 text-center">
              <p className="text-2xs text-white/40">
                {drawer === "history"
                  ? "No prompt history yet — what you write here is remembered as you iterate."
                  : "No saved prompts yet — hit Save to keep a prompt for reuse across brands."}
              </p>
            </div>
          ) : (
            <ul className="max-h-56 overflow-y-auto divide-y divide-white/[0.04]">
              {activeList.map((p) => (
                <li key={p.id} className="group flex items-start gap-2 px-3 py-2.5 hover:bg-white/[0.02] transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-2xs text-white/75 leading-relaxed line-clamp-2">{p.text}</p>
                    <p className="text-3xs text-white/30 mt-0.5">{relTime(p.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => applyText(p.text)}
                      title="Use this prompt"
                      className="p-1 rounded-md text-white/45 hover:text-[#F2A863] hover:bg-[#E9863B]/10 transition-colors"
                    >
                      <RotateCcw size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFrom(drawer === "history" ? HISTORY_KEY : FAVORITES_KEY, p.id)}
                      title="Remove"
                      className="p-1 rounded-md text-white/40 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
