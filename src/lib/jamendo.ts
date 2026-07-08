/**
 * Jamendo Music API helper — finds a Creative-Commons-licensed track that
 * matches the user's musicVibe pick and returns its preview/download URL.
 *
 * Jamendo offers two auth modes:
 *   - client_id only (read tracks, free)
 *   - client_id + client_secret OAuth (uploads, premium features)
 *
 * For our use-case (search + read URL) the client_id is enough — we send
 * it as ?client_id=... on the /tracks endpoint. The secret is reserved for
 * any future write operations.
 *
 * API docs: https://developer.jamendo.com/v3.0/tracks
 */

import { fetchWithTimeout } from "@/lib/http";

const JAMENDO_BASE = "https://api.jamendo.com/v3.0";

// Track search is a lightweight JSON call (<1s normally); 15s bounds a hung
// request so background-music resolution can't stall a render.
const SEARCH_TIMEOUT_MS = 15_000;

export interface JamendoTrack {
  id: string;
  name: string;
  artist_name: string;
  duration: number;        // seconds
  audio: string;           // streaming MP3 URL
  audiodownload?: string;  // download URL (premium tracks only)
  album_name?: string;
  license_ccurl?: string;  // Creative Commons license URL
}

export class JamendoNotConfiguredError extends Error {
  constructor() {
    super("JAMENDO_CLIENT_ID not set");
  }
}

/** Map our musicVibe vocabulary to Jamendo tag queries. */
const VIBE_TAG_MAP: Record<string, string> = {
  energetic: "energetic+upbeat+positive",
  calm: "calm+ambient+chill",
  dramatic: "dramatic+epic+cinematic",
  playful: "playful+fun+happy",
  inspirational: "inspirational+motivational+uplifting",
};

interface FindTrackOpts {
  vibe: string;
  targetSeconds?: number;  // hint, used to bias min/max duration
  limit?: number;
}

export async function findTrackByVibe(
  opts: FindTrackOpts,
): Promise<JamendoTrack | null> {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) throw new JamendoNotConfiguredError();

  const tags = VIBE_TAG_MAP[opts.vibe] ?? "instrumental";
  // Jamendo's `tags` parameter ANDs together (use `+` separator).
  // We bias to shorter tracks for ad-length content.
  const minDur = Math.max(15, (opts.targetSeconds ?? 30) - 15);
  const maxDur = Math.min(120, (opts.targetSeconds ?? 30) + 30);
  const limit = opts.limit ?? 5;

  const url = new URL(`${JAMENDO_BASE}/tracks`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("tags", tags);
  url.searchParams.set("durationbetween", `${minDur}_${maxDur}`);
  url.searchParams.set("audioformat", "mp32");
  url.searchParams.set("include", "musicinfo+licenses");
  url.searchParams.set("vocalinstrumental", "instrumental");
  url.searchParams.set("order", "popularity_total");
  url.searchParams.set("boost", "popularity_total");

  const res = await fetchWithTimeout(url.toString(), {}, SEARCH_TIMEOUT_MS);
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      `Jamendo ${res.status}: ${errBody.slice(0, 200) || res.statusText}`,
    );
  }

  const data = (await res.json()) as {
    headers: { status: string };
    results: JamendoTrack[];
  };

  if (data.headers?.status !== "success") {
    throw new Error(`Jamendo non-success header: ${data.headers?.status}`);
  }
  if (!Array.isArray(data.results) || data.results.length === 0) {
    return null;
  }

  // Pick one at random from top results for variety across reruns.
  return data.results[Math.floor(Math.random() * data.results.length)];
}
