/**
 * Brand asset library (Creative Orchestrator Phase A).
 *
 *   GET  /api/brands/[id]/assets — list the brand's assets (newest first)
 *   POST /api/brands/[id]/assets — upload one asset (multipart/form-data)
 *
 * POST fields:
 *   file   File   required — png / jpeg / webp, ≤ 4 MB (Vercel body cap is 4.5)
 *   kind   string required — 'logo' | 'founder_headshot' | 'team_headshot'
 *   label  string optional — ≤ 120 chars; for headshots, the person's name
 *
 * SAFETY CONTRACT (migration 017 header): the uploaded bytes are stored
 * EXACTLY as received — sharp is used read-only to verify the file decodes
 * as a real image and to record width/height/has_alpha for layout math.
 * No re-encode, no resize, no metadata stripping. Asset bytes never go to
 * an AI model.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";
import { captureFallback } from "@/lib/observability";
import type { BrandAssetKind } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Magic-byte image sniffer. Returns our extension key ('png'|'jpg'|'webp') or
 * null. This is the AUTHORITATIVE type check — it never depends on the sharp
 * native binary (which doesn't always load on Vercel's lambda runtime). sharp
 * is used only as a best-effort dimension reader below.
 */
function sniffImageType(buf: Buffer): "png" | "jpg" | "webp" | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "jpg";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

const KINDS = new Set<BrandAssetKind>(["logo", "founder_headshot", "team_headshot"]);
const ALLOWED_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB
const MAX_ASSETS_PER_BRAND = 30;

/** Ownership gate shared by GET and POST. Returns null when not the owner. */
async function ownedBrand(brandId: string, userId: string) {
  const admin = createAdminClient();
  const { data: brand } = await admin
    .from("brands")
    .select("id, user_id, name")
    .eq("id", brandId)
    .maybeSingle();
  if (!brand || brand.user_id !== userId) return null;
  return { admin, brand };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: brandId } = await params;

  const owned = await ownedBrand(brandId, userId);
  if (!owned) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  const { data: assets, error } = await owned.admin
    .from("brand_assets")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });
  if (error) {
    captureFallback("brand_assets.list_failed", error, { brandId });
    return NextResponse.json({ error: "Failed to list assets" }, { status: 500 });
  }
  return NextResponse.json({ assets: assets ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: brandId } = await params;

  const rl = await rateLimit({
    key: `POST:/api/brands/[id]/assets:${userId}`,
    limit: 30,
    windowSeconds: 60 * 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many uploads. Slow down.", retryAfterSeconds: rl.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const owned = await ownedBrand(brandId, userId);
  if (!owned) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }
  const { admin } = owned;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const kind = String(form.get("kind") ?? "");
  if (!KINDS.has(kind as BrandAssetKind)) {
    return NextResponse.json(
      { error: "kind must be logo | founder_headshot | team_headshot" },
      { status: 400 },
    );
  }
  const labelRaw = form.get("label");
  const label =
    typeof labelRaw === "string" && labelRaw.trim()
      ? labelRaw.trim().slice(0, 120)
      : null;

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  const ext = ALLOWED_MIME[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Only PNG, JPEG, or WebP images are accepted" },
      { status: 400 },
    );
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File must be 1 byte – ${MAX_BYTES / 1024 / 1024} MB` },
      { status: 400 },
    );
  }

  // Per-brand cap so a runaway client can't fill the bucket.
  const { count } = await admin
    .from("brand_assets")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brandId);
  if ((count ?? 0) >= MAX_ASSETS_PER_BRAND) {
    return NextResponse.json(
      { error: `Asset limit reached (${MAX_ASSETS_PER_BRAND} per brand). Delete unused assets first.` },
      { status: 409 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Authoritative validation: the file's real magic bytes must match the type
  // it declared. Never depends on sharp (the native binary doesn't reliably
  // load on Vercel). The ORIGINAL buffer is what gets stored, untouched.
  const sniffed = sniffImageType(bytes);
  if (!sniffed) {
    return NextResponse.json(
      { error: "File could not be recognized as a PNG, JPEG, or WebP image" },
      { status: 400 },
    );
  }
  if (sniffed !== ext) {
    return NextResponse.json(
      { error: "File content doesn't match its declared image type" },
      { status: 400 },
    );
  }

  // Best-effort dimensions via sharp — lazily imported and NON-FATAL. If sharp
  // can't load in this runtime, we still store the asset (width/height are
  // nullable; the Phase C compositor reads dimensions from the bytes on the
  // worker, where sharp is always available).
  let width: number | null = null;
  let height: number | null = null;
  let hasAlpha: boolean | null = null;
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(bytes).metadata();
    width = meta.width ?? null;
    height = meta.height ?? null;
    hasAlpha = meta.hasAlpha ?? null;
  } catch (err) {
    captureFallback("brand_assets.sharp_metadata_unavailable", err, { brandId, kind });
  }

  const objectPath = `${brandId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from("brand-assets")
    .upload(objectPath, bytes, { contentType: file.type, upsert: false });
  if (upErr) {
    captureFallback("brand_assets.upload_failed", upErr, { brandId, kind });
    return NextResponse.json({ error: "Storage upload failed" }, { status: 500 });
  }

  const {
    data: { publicUrl },
  } = admin.storage.from("brand-assets").getPublicUrl(objectPath);

  const { data: asset, error: insErr } = await admin
    .from("brand_assets")
    .insert({
      brand_id: brandId,
      kind,
      label,
      storage_path: objectPath,
      public_url: publicUrl,
      mime_type: file.type,
      byte_size: file.size,
      // Locked on every insert and never flipped — the data-layer encoding of
      // the safety contract (uploaded bytes are immutable, never AI-modified).
      locked: true,
      width,
      height,
      has_alpha: hasAlpha,
    })
    .select("*")
    .single();
  if (insErr || !asset) {
    // Roll back the orphaned object so storage stays consistent with the table.
    await admin.storage.from("brand-assets").remove([objectPath]).catch(() => {});
    captureFallback("brand_assets.insert_failed", insErr, { brandId, kind });
    return NextResponse.json({ error: "Failed to save asset record" }, { status: 500 });
  }

  return NextResponse.json({ asset }, { status: 201 });
}
