# Sentry Source-Map Upload — Activation Runbook

Wires production stack traces in Sentry to readable source code instead
of `0x9c.js:1:48211`. Required ONE-TIME setup. After this, every Vercel
deploy uploads source maps automatically and deletes them from the CDN.

---

## Why this isn't done yet

The Sentry webpack plugin is wired in `next.config.ts` and reads three
env vars at **build time**. Vercel's "Sensitive" env vars are
**runtime-only** — the webpack plugin can't see them. The vars must be
provisioned as **non-Sensitive**, which is why this stayed pending.

The token was generated earlier from the "Vercel Source Maps" internal
integration with the correct scopes (`project:read`, `project:write`,
`release:admin`, `ci:read`). It needs to land on Vercel as
non-Sensitive.

---

## Step 1 · Vercel env vars (3 vars, non-Sensitive)

Open https://vercel.com/joseph-ottoflow-s-projects/ottoflow-ai/settings/environment-variables

For each variable below: click "Add Environment Variable", paste, **set
Sensitive toggle OFF**, target Production + Preview, Save.

| Key | Value | Sensitive | Environments |
|---|---|---|---|
| `SENTRY_ORG` | `ottoflow` | OFF | Production, Preview |
| `SENTRY_PROJECT` | `javascript-nextjs` | OFF | Production, Preview |
| `SENTRY_AUTH_TOKEN` | (paste your existing internal-integration token) | OFF | Production, Preview |

⚠️ **Sensitive=OFF is mandatory.** Sensitive vars are encrypted at rest
and only injected at function runtime — the webpack build can't read
them. With Sensitive=ON the build succeeds but Sentry sees zero source
maps and stack traces stay minified.

If `SENTRY_AUTH_TOKEN` got mistakenly created as Sensitive earlier,
delete + recreate (Vercel's Sensitive toggle is one-way per-creation).

---

## Step 2 · Redeploy

After the three vars are saved, trigger a redeploy:

1. Go to https://vercel.com/joseph-ottoflow-s-projects/ottoflow-ai/deployments
2. Click ••• on the latest Production deployment → Redeploy
3. Confirm with "Use existing Build Cache" UNCHECKED (forces source-map regeneration)
4. Wait for build to complete (~3-5 min — source-map upload adds ~30s)

---

## Step 3 · Verify the upload

Look in the Vercel build logs for these lines:

```
[sentry] uploading sourcemaps...
[sentry] uploaded N artifacts
```

Or check via Sentry UI:

1. Visit https://ottoflow.sentry.io/settings/projects/javascript-nextjs/source-maps/
2. The latest commit SHA should appear as a release with attached artifacts

---

## Step 4 · Test by triggering a real error

Visit https://ottoflow-ai.vercel.app/api/debug/sentry-test (auth-gated,
sign in as `joseph@ottoflow.ai` first).

Then check the new Sentry issue at
https://ottoflow.sentry.io/issues/?project=4511491204907008 — the stack
trace should show:

```
✓ Function name: throwTestError
✓ File: src/app/api/debug/sentry-test/route.ts
✓ Line: 23
```

Instead of the previous:

```
✗ Function name: anonymous
✗ File: /var/task/.next/server/app/api/debug/sentry-test/route.js
✗ Line: 1:48211
```

If you still see minified output, check the **Activity** tab on the
Sentry issue — there's usually a "Unminify Code" CTA banner that
explains what's missing.

---

## Step 5 · Confirm CDN doesn't expose .map files

After deploy, run:

```bash
curl -I https://ottoflow-ai.vercel.app/_next/static/chunks/main.js.map
```

Expected: `HTTP/2 404`. The `deleteSourcemapsAfterUpload: true` config
removes maps from the build output AFTER upload, so they exist in
Sentry but not on the public CDN. If you see `200 OK` — the
`sourcemaps.deleteSourcemapsAfterUpload` option didn't apply; double-
check `next.config.ts` matches the version in this repo.

---

## Why this can fail safely

`next.config.ts` includes an `errorHandler` that swallows Sentry
upload errors with a `console.warn` instead of failing the build. A
broken Sentry token won't break a customer-facing deploy — it just
means new source maps don't reach Sentry until you fix the token.

You'll see this in the Vercel build logs:

```
[sentry] source-map upload failed (non-fatal): <reason>
```

---

## Rollback

If something goes wrong:

1. Delete `SENTRY_AUTH_TOKEN` in Vercel
2. Redeploy — source-map upload silently skips, builds keep working
3. Stack traces stay minified but app keeps running

You can also revert `next.config.ts` to remove `widenClientFileUpload`
+ `sourcemaps.deleteSourcemapsAfterUpload` and redeploy. The Sentry
plugin's defaults are conservative.

---

## What this does NOT cover

- **Worker source maps.** The Railway worker bundle is built by esbuild
  via `worker/build.mjs`. It does NOT currently upload source maps to
  Sentry. Worker stack traces will stay minified. Defer until needed.
- **Local dev maps.** `next dev` doesn't upload anything; you don't
  need the token in `.env.local`.
- **Preview deploy maps.** They upload but are tagged with the PR
  commit SHA, not the merged main commit. Sentry releases will reflect
  the deploy that's actually serving.
