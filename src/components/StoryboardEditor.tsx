"use client";

/**
 * StoryboardEditor — interactive pre-render storyboard (Sprint 38).
 *
 * Operates entirely on the existing `VideoStrategyScene[]` that /api/video/generate
 * already returns from a `dryRun` (no spend) and already accepts back on
 * `approve` as a `strategy` override. So scene TEXT editing + reorder/add/delete +
 * the approval gate reuse the engine end-to-end with ZERO backend change:
 *
 *   dryRun → strategy.scenes → [edit here] → approve(strategy) → render edited video
 *
 * Out of scope here (needs backend — visuals are selected in the worker, and
 * candidates aren't persisted): showing/replacing the real stock clip + candidate
 * picker (P4) and per-scene visual regeneration (P6). Those are increment 2.
 *
 * `caption` is the on-screen line AND the narration source (the FFmpeg composer
 * burns it in and ElevenLabs speaks it — see scene-generation narration fix), so
 * editing it updates both. `prompt` is the visual direction for the scene.
 *
 * Locking is a UI guard that freezes a scene's fields and is surfaced via
 * `lockedIds` so a future partial-regen step can skip locked scenes.
 */
import { useCallback } from "react";
import { GripVertical, Lock, Unlock, Copy, Trash2, Plus, ChevronUp, ChevronDown } from "lucide-react";
import type { VideoStrategyScene } from "@/lib/ffmpeg-pipeline/types";

interface Props {
  scenes: VideoStrategyScene[];
  onChange: (scenes: VideoStrategyScene[]) => void;
  /** Scene ids the user has locked (frozen). Lifted to the parent so an
   *  approve/partial-regen call can honor them. */
  lockedIds: Set<number>;
  onToggleLock: (sceneId: number) => void;
  /** Optional platform duration window [min,max] for a gentle fit hint. */
  durationWindowSec?: [number, number];
  disabled?: boolean;
}

const MIN_SCENE_SEC = 1;
const MAX_SCENE_SEC = 8; // matches MAX_SCENE_DURATION_SEC hard cap

/** Renumber sceneId to 1..n in array order after any structural change. */
function renumber(scenes: VideoStrategyScene[]): VideoStrategyScene[] {
  return scenes.map((s, i) => ({ ...s, sceneId: i + 1 }));
}

export function StoryboardEditor({
  scenes,
  onChange,
  lockedIds,
  onToggleLock,
  durationWindowSec,
  disabled = false,
}: Props) {
  const patch = useCallback(
    (sceneId: number, fields: Partial<VideoStrategyScene>) => {
      onChange(scenes.map((s) => (s.sceneId === sceneId ? { ...s, ...fields } : s)));
    },
    [scenes, onChange],
  );

  const move = useCallback(
    (index: number, dir: -1 | 1) => {
      const j = index + dir;
      if (j < 0 || j >= scenes.length) return;
      const next = [...scenes];
      [next[index], next[j]] = [next[j], next[index]];
      onChange(renumber(next));
    },
    [scenes, onChange],
  );

  const duplicate = useCallback(
    (index: number) => {
      const src = scenes[index];
      const copy: VideoStrategyScene = { ...src, seed: Math.floor(Math.random() * 1e9) };
      const next = [...scenes.slice(0, index + 1), copy, ...scenes.slice(index + 1)];
      onChange(renumber(next));
    },
    [scenes, onChange],
  );

  const remove = useCallback(
    (sceneId: number) => {
      if (scenes.length <= 1) return; // never empty the storyboard
      onChange(renumber(scenes.filter((s) => s.sceneId !== sceneId)));
    },
    [scenes, onChange],
  );

  const add = useCallback(() => {
    const last = scenes[scenes.length - 1];
    const blank: VideoStrategyScene = {
      role: last?.role ?? ("outcome" as VideoStrategyScene["role"]),
      sceneId: scenes.length + 1,
      prompt: "",
      caption: "",
      seed: Math.floor(Math.random() * 1e9),
      durationSec: last?.durationSec ?? 4,
    };
    onChange(renumber([...scenes, blank]));
  }, [scenes, onChange]);

  const total = scenes.reduce((a, s) => a + (s.durationSec ?? 0), 0);
  const [lo, hi] = durationWindowSec ?? [0, 0];
  const fitOff = durationWindowSec ? total < lo * 0.8 || total > hi * 1.2 : false;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-2xs uppercase tracking-wider text-white/40">
          Storyboard · {scenes.length} {scenes.length === 1 ? "scene" : "scenes"}
        </p>
        <p className={`text-2xs ${fitOff ? "text-amber-400" : "text-white/40"}`}>
          {total}s total{durationWindowSec ? ` · target ${lo}–${hi}s` : ""}
        </p>
      </div>

      {scenes.map((s, i) => {
        const locked = lockedIds.has(s.sceneId);
        const fieldDisabled = disabled || locked;
        return (
          <div
            key={s.sceneId}
            className="rounded-xl border border-white/[0.07] p-3 space-y-2.5"
            style={{ background: locked ? "rgba(34,211,238,0.04)" : "rgba(255,255,255,0.02)" }}
          >
            {/* Header row */}
            <div className="flex items-center gap-2">
              <GripVertical size={13} className="text-white/20" />
              <span className="text-2xs font-semibold text-white/70">Scene {s.sceneId}</span>
              {s.role && (
                <span className="text-3xs uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.06] text-white/40">
                  {s.role}
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button type="button" aria-label="Move up" disabled={disabled || i === 0}
                  onClick={() => move(i, -1)}
                  className="w-6 h-6 rounded flex items-center justify-center text-white/40 hover:text-white disabled:opacity-20">
                  <ChevronUp size={13} />
                </button>
                <button type="button" aria-label="Move down" disabled={disabled || i === scenes.length - 1}
                  onClick={() => move(i, 1)}
                  className="w-6 h-6 rounded flex items-center justify-center text-white/40 hover:text-white disabled:opacity-20">
                  <ChevronDown size={13} />
                </button>
                <button type="button" aria-label={locked ? "Unlock scene" : "Lock scene"} disabled={disabled}
                  onClick={() => onToggleLock(s.sceneId)}
                  className={`w-6 h-6 rounded flex items-center justify-center ${locked ? "text-cyan-400" : "text-white/40 hover:text-white"}`}>
                  {locked ? <Lock size={12} /> : <Unlock size={12} />}
                </button>
                <button type="button" aria-label="Duplicate scene" disabled={disabled}
                  onClick={() => duplicate(i)}
                  className="w-6 h-6 rounded flex items-center justify-center text-white/40 hover:text-white disabled:opacity-20">
                  <Copy size={12} />
                </button>
                <button type="button" aria-label="Delete scene" disabled={disabled || scenes.length <= 1}
                  onClick={() => remove(s.sceneId)}
                  className="w-6 h-6 rounded flex items-center justify-center text-white/40 hover:text-red-400 disabled:opacity-20">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            {/* Caption / narration */}
            <div>
              <label className="text-3xs text-white/35 block mb-1">Caption / narration</label>
              <textarea
                value={s.caption}
                disabled={fieldDisabled}
                onChange={(e) => patch(s.sceneId, { caption: e.target.value.slice(0, 120) })}
                rows={2}
                placeholder="Short on-screen line (also spoken)"
                className="w-full text-xs rounded-lg bg-white/[0.03] border border-white/[0.07] px-2.5 py-1.5 text-white/90 resize-none focus:outline-none focus:border-cyan-500/40 disabled:opacity-50"
              />
            </div>

            {/* Visual prompt + duration */}
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-3xs text-white/35 block mb-1">Visual direction</label>
                <textarea
                  value={s.prompt}
                  disabled={fieldDisabled}
                  onChange={(e) => patch(s.sceneId, { prompt: e.target.value.slice(0, 400) })}
                  rows={2}
                  placeholder="What this scene shows"
                  className="w-full text-xs rounded-lg bg-white/[0.03] border border-white/[0.07] px-2.5 py-1.5 text-white/80 resize-none focus:outline-none focus:border-cyan-500/40 disabled:opacity-50"
                />
              </div>
              <div className="w-20">
                <label className="text-3xs text-white/35 block mb-1">Secs</label>
                <input
                  type="number"
                  min={MIN_SCENE_SEC}
                  max={MAX_SCENE_SEC}
                  value={s.durationSec}
                  disabled={fieldDisabled}
                  onChange={(e) => {
                    const v = Math.max(MIN_SCENE_SEC, Math.min(MAX_SCENE_SEC, Number(e.target.value) || MIN_SCENE_SEC));
                    patch(s.sceneId, { durationSec: v });
                  }}
                  className="w-full text-xs rounded-lg bg-white/[0.03] border border-white/[0.07] px-2.5 py-1.5 text-white/90 focus:outline-none focus:border-cyan-500/40 disabled:opacity-50"
                />
              </div>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={add}
        disabled={disabled}
        className="w-full flex items-center justify-center gap-1.5 text-2xs text-white/50 hover:text-white border border-dashed border-white/15 rounded-xl py-2.5 transition-colors disabled:opacity-30"
      >
        <Plus size={13} /> Add scene
      </button>
    </div>
  );
}
