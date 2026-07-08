/**
 * ElevenLabs TTS helper.
 *
 * Returns an audio data URL (base64 mp3) so the SSE pipeline can hand it
 * straight to the page's <audio> / "Hear narration" UI without a separate
 * storage roundtrip. For long-form output we'd push to Vercel Blob, but
 * MVP scripts are 60-90 words so the inline payload is small.
 *
 * Free-tier ElevenLabs keys cap at ~10k chars/month. Scripts run ~600
 * chars, so a session of ~15 generations fits before throttling kicks in.
 *
 * Voice selection: `Rachel` (21m00Tcm4TlvDq8ikWAM) is the default — clean,
 * gender-neutral, energetic. Voice IDs can be swapped via the optional
 * voiceId arg (e.g. from script.voiceDirection mapping).
 */

import { fetchWithTimeout } from "@/lib/http";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

// Hard client-side timeout for a single TTS synthesis. Turbo output for a
// ~600-char script returns in a few seconds; 60s is generous headroom that
// still stops a hung request from blocking the worker slot indefinitely.
const SYNTHESIS_TIMEOUT_MS = 60_000;

// Default voice — Rachel. Stable, professional, works for most ad copy.
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

interface SynthesizeOpts {
  text: string;
  voiceId?: string;
  modelId?: string;
}

interface SynthesizeResult {
  audioDataUrl: string;     // "data:audio/mpeg;base64,..."
  byteLength: number;       // raw MP3 size before base64
  voiceId: string;
  modelId: string;
}

export class ElevenLabsNotConfiguredError extends Error {
  constructor() {
    super("ELEVENLABS_API_KEY not set");
  }
}

export async function synthesizeNarration(
  opts: SynthesizeOpts,
): Promise<SynthesizeResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new ElevenLabsNotConfiguredError();

  const voiceId = opts.voiceId ?? DEFAULT_VOICE_ID;
  // eleven_turbo_v2 is the cheap+fast model — fine for MVP scripts.
  const modelId = opts.modelId ?? "eleven_turbo_v2";

  const url = `${ELEVENLABS_BASE}/text-to-speech/${voiceId}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: opts.text,
        model_id: modelId,
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.75,
          style: 0.3,
          use_speaker_boost: true,
        },
      }),
    },
    SYNTHESIS_TIMEOUT_MS,
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      `ElevenLabs ${res.status}: ${errBody.slice(0, 200) || res.statusText}`,
    );
  }

  const arrayBuf = await res.arrayBuffer();
  const bytes = Buffer.from(arrayBuf);
  const audioDataUrl = `data:audio/mpeg;base64,${bytes.toString("base64")}`;

  return {
    audioDataUrl,
    byteLength: bytes.byteLength,
    voiceId,
    modelId,
  };
}
