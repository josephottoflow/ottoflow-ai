/**
 * Small HTTP utilities shared across the app + worker.
 *
 * `fetchWithTimeout` — a drop-in `fetch` that aborts after `timeoutMs` via an
 * AbortController. The video pipeline talks to several external APIs
 * (ElevenLabs, Jamendo, Pexels, …); a plain `fetch` has NO client-side timeout,
 * so a hung remote (connection open, no bytes) blocks the awaiting worker slot
 * until the socket eventually dies — starving concurrency and, on the
 * attempts:1 render path, ultimately stalling/failing the job.
 *
 * This helper is behaviour-preserving on the happy path (a response that
 * arrives before the deadline is returned unchanged). On timeout it throws the
 * standard AbortError, which every current caller already treats like any other
 * fetch error (retry / fall through / degrade). It never swallows errors.
 *
 * Mirrors the inline AbortController pattern already proven in
 * seedance.getSeedanceBalanceUsd() and 11-ffmpeg-composer.downloadMusicWithRetry
 * — factored out so the same guard can be reused without copy-pasting the
 * setTimeout/clearTimeout bookkeeping (and getting the `finally` wrong).
 */
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}
