# R2 Storage Setup — ADR-002 FFmpeg Pipeline

Deploy/config reference for the Cloudflare R2 backend that the
`ffmpeg-compose` worker uploads rendered videos to. R2 is the **primary**
storage tier (Google Drive is the fallback) — see `worker/processors/ffmpeg-compose.ts` `uploadResult()`.

> **No secrets in this file.** The two R2 token secrets live only in the
> Railway worker's environment variables.

## What was provisioned (Cloudflare, account "Joseph@ottoflow.ai")

| Item | Value |
|---|---|
| R2 account id | `4b53de9208a4ecc628a9bad59b2272e4` |
| Bucket | `ottoflow-renders` (Standard class, APAC location) |
| Public Development URL | `https://pub-fc14ec36052b4881afdb3537def24720.r2.dev` |
| S3 API endpoint | `https://4b53de9208a4ecc628a9bad59b2272e4.r2.cloudflarestorage.com` |
| API token | `ottoflow-renders-worker` — **Object Read & Write**, scoped to `ottoflow-renders`, TTL Forever |

> The Public Development URL is rate-limited and not recommended for high-scale
> production. For production, attach a custom domain (R2 → bucket → Settings →
> Custom Domains, e.g. `cdn.ottoflow.ai`) and set `R2_PUBLIC_BASE_URL` to it.

## Environment variables — set on the Railway **worker** service

Only the worker uploads to R2; Vercel does **not** need these.

```
R2_ACCOUNT_ID=4b53de9208a4ecc628a9bad59b2272e4
R2_BUCKET=ottoflow-renders
R2_PUBLIC_BASE_URL=https://pub-fc14ec36052b4881afdb3537def24720.r2.dev
R2_ACCESS_KEY_ID=<from the ottoflow-renders-worker token — Access Key ID>
R2_SECRET_ACCESS_KEY=<from the ottoflow-renders-worker token — Secret, shown once>
```

`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` come from creating the
`ottoflow-renders-worker` R2 API token (R2 → Manage R2 API Tokens →
Create Account API token). The secret is displayed only once at creation —
paste it straight into Railway. If lost, roll a new token and update Railway.

All five are registered (optional) in `src/lib/worker-env.ts:136-152`.
`R2_PUBLIC_BASE_URL` is validated as a URL — no trailing slash, no bucket name
(the uploader appends the object key: see `src/lib/ffmpeg-pipeline/r2.ts`).

## How the URL is built

`r2.ts uploadToR2()` writes objects at key
`{userId}/{renderJobId}/ffmpeg-v2.mp4` and returns
`${R2_PUBLIC_BASE_URL}/{objectKey}` as the public URL stored in
`render_jobs.merged_video_url` (and `render_jobs.r2_object_key`).

## Remaining steps for an end-to-end run

1. Set the 5 worker env vars above on Railway → redeploy the worker.
2. Deploy `feat/ffmpeg-multi-agent-pipeline` to **both** Railway (worker) and
   Vercel (route). `main` has neither the `ffmpeg-compose` processor nor the
   `USE_FFMPEG_PIPELINE` branch.
3. Set `USE_FFMPEG_PIPELINE=1` on **Vercel** (gates the route to the new path;
   default off keeps the legacy Remotion path).
4. Trigger one `/video/generate` and watch the worker log for
   `compose 55 → qc 65 → upload 90 → done 100`, then confirm
   `render_jobs.merged_video_url` is a `pub-…r2.dev` URL that plays.

## Verify the upload manually (optional)

After the first successful render, the object is browsable at:
`https://pub-fc14ec36052b4881afdb3537def24720.r2.dev/<userId>/<renderJobId>/ffmpeg-v2.mp4`
and listed in R2 → `ottoflow-renders` → Objects.
