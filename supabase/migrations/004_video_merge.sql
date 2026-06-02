-- 004_video_merge.sql
-- Adds columns to render_jobs to track the post-pipeline ffmpeg merge that
-- combines the Pexels stock clip + ElevenLabs narration + Jamendo music
-- into a single downloadable MP4 with audio baked in.
--
-- Flow:
--   1. /api/generate finishes its SSE pipeline → emits done event with the
--      3 separate asset URLs (videoUrl, audioUrl, musicUrl)
--   2. API enqueues a `video-merge` BullMQ job
--   3. Railway worker runs ffmpeg merge → uploads result to Supabase Storage
--      bucket `merged-videos` → writes the URL + status back here
--   4. Client subscribes to this row via Realtime, swaps the Download button
--      to merged_video_url when merge_status='done'
--
-- Status lifecycle: pending → merging → done | failed
-- Null status means the row was created before merge was wired (legacy data).

ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS merged_video_url TEXT,
  ADD COLUMN IF NOT EXISTS merge_status TEXT
    CHECK (merge_status IS NULL OR merge_status IN ('pending','merging','done','failed')),
  ADD COLUMN IF NOT EXISTS merge_error TEXT;

-- Realtime publication so the page can react to status changes.
-- Safe to run multiple times — `add table` is idempotent in that
-- ALTER PUBLICATION ... ADD TABLE will error if already added, so
-- we wrap it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'render_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE render_jobs;
  END IF;
END $$;

-- ─── Storage bucket: merged-videos ─────────────────────────────────────────
-- Public-read bucket — merged MP4s are served directly via the public URL
-- so the page's <a download> works without auth. Worker writes via the
-- service-role key (bypasses RLS).
--
-- Running this insert idempotently:
INSERT INTO storage.buckets (id, name, public)
VALUES ('merged-videos', 'merged-videos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public SELECT policy so anyone with the URL can stream the file.
-- Worker writes use service_role which bypasses RLS, so no insert policy
-- for end users is needed.
DROP POLICY IF EXISTS "Public read on merged-videos" ON storage.objects;
CREATE POLICY "Public read on merged-videos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'merged-videos');
