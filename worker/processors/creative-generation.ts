/**
 * Creative Generation processor (Brand Creative Orchestrator Phase C).
 *
 * Consumes an APPROVED creative brief and produces the final composited image:
 *
 *   load        re-read the creative row + brief from Postgres (never trust the
 *               queue payload's view of the brief), assert status approved/
 *               generating, re-validate the brief against forbidden tokens
 *   background  Imagen generates the BACKGROUND ONLY (negative prompts) → a
 *               multimodal validator rejects any text/logo/face → up to 3
 *               total attempts before failing the job (no unsafe composite)
 *   assets      download LOCKED asset bytes from storage (logo/headshot) — these
 *               bytes NEVER touch an AI model; they're composited pixel-for-pixel
 *   composite   deterministic sharp compositor (resize/crop/mask/position +
 *               SVG typography) → final PNG
 *   upload      content-creatives storage bucket → public URL
 *   finalize    content_creatives.status='ready', image_url, generated_at
 *
 * Gate contract: this processor is the ONLY producer of generated images, and
 * it refuses any creative that isn't approved (or generating, on retry). Imagen
 * spend therefore cannot occur on an unapproved brief.
 *
 * On failure: status='failed' + generation_error so the UI offers regenerate.
 */
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase";
import {
  generateCreativeBackground,
  validateGeneratedBackground,
} from "@/lib/gemini";
import { compositeCreative } from "@/lib/creative/compositor";
import {
  creativeBriefSchema,
  findForbiddenBackgroundToken,
  type CreativeBrief,
} from "@/lib/creative/types";
import { founderNameFromLabel } from "@/lib/creative/brief";
import type { CreativeGenerationJobData } from "@/lib/queue";

type Reporter = (step: string, progress: number) => void;

const MAX_BACKGROUND_ATTEMPTS = 3;

export async function processCreativeGeneration(
  data: CreativeGenerationJobData,
  report: Reporter,
): Promise<{ ok: true; imageUrl: string }> {
  const admin = createAdminClient();
  const { creativeId } = data;

  async function fail(err: unknown): Promise<never> {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("content_creatives")
      .update({ status: "failed", generation_error: message })
      .eq("id", creativeId);
    throw err instanceof Error ? err : new Error(message);
  }

  // ─── Step 1: load + assert gate + re-validate brief ───────────────────────
  report("loading", 5);
  const { data: creative, error: loadErr } = await admin
    .from("content_creatives")
    .select("id, brand_id, status, creative_brief, status_history, regen_count")
    .eq("id", creativeId)
    .single();
  if (loadErr || !creative) {
    throw new Error(`Creative ${creativeId} not found: ${loadErr?.message ?? "missing"}`);
  }
  // Gate: only an approved brief (or one already generating, on retry) may run.
  if (creative.status !== "approved" && creative.status !== "generating") {
    throw new Error(
      `Refusing to generate: creative ${creativeId} is '${creative.status}', not approved.`,
    );
  }

  const parsed = creativeBriefSchema.safeParse(creative.creative_brief);
  if (!parsed.success) {
    return fail(
      new Error(
        `Stored brief failed re-validation: ${parsed.error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ")}`,
      ),
    );
  }
  const brief: CreativeBrief = parsed.data;

  // Belt-and-suspenders: the background prompt must still be clean.
  const promptViolation = findForbiddenBackgroundToken(brief.background_prompt);
  if (promptViolation) {
    return fail(
      new Error(`Background prompt contains forbidden token "${promptViolation}" — refusing`),
    );
  }

  // Flip to generating + audit trail.
  const now = new Date().toISOString();
  const history = Array.isArray(creative.status_history) ? creative.status_history : [];
  history.push({ from: creative.status, to: "generating", at: now, by: "worker" });
  await admin
    .from("content_creatives")
    .update({ status: "generating", status_history: history, generation_error: null })
    .eq("id", creativeId);

  try {
    // ─── Step 2: Imagen background + multimodal validation loop ──────────────
    report("background", 20);
    let background: Buffer | null = null;
    let lastReason = "";
    for (let attempt = 1; attempt <= MAX_BACKGROUND_ATTEMPTS; attempt++) {
      const png = await generateCreativeBackground({
        prompt: brief.background_prompt,
        aspectRatio: brief.aspect_ratio,
      });
      const check = await validateGeneratedBackground(png);
      if (!check.contains_text && !check.contains_logo && !check.contains_face) {
        background = png;
        break;
      }
      lastReason = `text=${check.contains_text} logo=${check.contains_logo} face=${check.contains_face} (${check.description})`;
      report("background", 20 + attempt * 8);
    }
    if (!background) {
      return fail(
        new Error(
          `Imagen produced an unsafe background after ${MAX_BACKGROUND_ATTEMPTS} attempts: ${lastReason}`,
        ),
      );
    }

    // ─── Step 3: download LOCKED asset bytes (never sent to any AI model) ─────
    report("assets", 55);
    const logoBuf = brief.logo_usage.use && brief.logo_usage.asset_id
      ? await downloadAssetBytes(admin, brief.logo_usage.asset_id)
      : null;
    const headshotBuf = brief.headshot_usage.use && brief.headshot_usage.asset_id
      ? await downloadAssetBytes(admin, brief.headshot_usage.asset_id)
      : null;

    // Brand name for the wordmark fallback.
    const { data: brand } = await admin
      .from("brands")
      .select("name")
      .eq("id", creative.brand_id)
      .single();
    const brandName = (brand?.name as string | undefined) ?? "";
    const founderName =
      brief.founder_name_usage.use && brief.founder_name_usage.name
        ? brief.founder_name_usage.name
        : founderNameFromLabel(null);

    // ─── Step 4: deterministic composite (resize/crop/mask/position + type) ──
    report("compositing", 70);
    const finalPng = await compositeCreative({
      brief,
      background,
      logo: logoBuf,
      headshot: headshotBuf,
      brandName,
      founderName,
    });

    // ─── Step 5: upload background (provenance) + final composite ────────────
    report("uploading", 85);
    const dir = `${creative.brand_id}/${creativeId}`;
    const bgPath = `${dir}/bg-${randomUUID()}.png`;
    const imgPath = `${dir}/creative-${randomUUID()}.png`;

    const { error: bgErr } = await admin.storage
      .from("content-creatives")
      .upload(bgPath, background, { contentType: "image/png", upsert: false });
    if (bgErr) throw new Error(`Background upload failed: ${bgErr.message}`);

    const { error: imgErr } = await admin.storage
      .from("content-creatives")
      .upload(imgPath, finalPng, { contentType: "image/png", upsert: false });
    if (imgErr) throw new Error(`Creative upload failed: ${imgErr.message}`);

    const {
      data: { publicUrl: backgroundUrl },
    } = admin.storage.from("content-creatives").getPublicUrl(bgPath);
    const {
      data: { publicUrl: imageUrl },
    } = admin.storage.from("content-creatives").getPublicUrl(imgPath);

    // ─── Step 6: finalize ────────────────────────────────────────────────────
    report("finalizing", 95);
    const doneAt = new Date().toISOString();
    const finalHistory = [...history, { from: "generating", to: "ready", at: doneAt, by: "worker" }];
    const { error: updErr } = await admin
      .from("content_creatives")
      .update({
        status: "ready",
        background_url: backgroundUrl,
        image_url: imageUrl,
        generated_at: doneAt,
        generation_error: null,
        status_history: finalHistory,
      })
      .eq("id", creativeId);
    if (updErr) throw new Error(`Failed to finalize creative: ${updErr.message}`);

    report("done", 100);
    return { ok: true, imageUrl };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Download a locked asset's raw bytes from the brand-assets bucket. These
 * bytes are composited pixel-for-pixel and NEVER sent to any AI model.
 */
async function downloadAssetBytes(
  admin: ReturnType<typeof createAdminClient>,
  assetId: string,
): Promise<Buffer | null> {
  const { data: asset } = await admin
    .from("brand_assets")
    .select("storage_path")
    .eq("id", assetId)
    .maybeSingle();
  if (!asset?.storage_path) return null;
  const { data: blob, error } = await admin.storage
    .from("brand-assets")
    .download(asset.storage_path as string);
  if (error || !blob) return null;
  return Buffer.from(await blob.arrayBuffer());
}
