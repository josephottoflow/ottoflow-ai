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
  reviewCreativeImage,
  planCreativeImprovement,
  type CreativeReview,
} from "@/lib/gemini";
import { compositeCreative, renderFallbackBackground } from "@/lib/creative/compositor";
import {
  creativeBriefSchema,
  brandPatternSchema,
  findForbiddenBackgroundToken,
  type CreativeBrief,
  type BrandPattern,
} from "@/lib/creative/types";
import { computeBRS } from "@/lib/creative/brs";
import { founderNameFromLabel } from "@/lib/creative/brief";
import { captureFallback } from "@/lib/observability";
import { recordAIUsage } from "@/lib/ai-usage";
import type { CreativeGenerationJobData } from "@/lib/queue";

/** Shared attribution for AI-usage telemetry across one creative's render. */
interface UsageCtx {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  creativeId: string;
  campaignId: string | null;
}

/**
 * Load a brand's ACTIVE brand pattern (P4 Phase 2A). Defensive: returns null on
 * any error — including the table not existing yet (migration 023 unapplied) —
 * so the compositor degrades to today's palette+logo behaviour.
 */
async function loadActiveBrandPattern(
  admin: ReturnType<typeof createAdminClient>,
  brandId: string,
): Promise<{ id: string; version: number; pattern: BrandPattern } | null> {
  try {
    const { data, error } = await admin
      .from("brand_patterns")
      .select("id, version, pattern")
      .eq("brand_id", brandId)
      .eq("is_active", true)
      .maybeSingle();
    if (error || !data?.pattern) return null;
    const parsed = brandPatternSchema.safeParse(data.pattern);
    if (!parsed.success) return null;
    return { id: data.id as string, version: (data.version as number) ?? 1, pattern: parsed.data };
  } catch {
    return null;
  }
}

type Reporter = (step: string, progress: number) => void;

const MAX_BACKGROUND_ATTEMPTS = 3;

/** Quality gate (override with CREATIVE_REVIEW_THRESHOLD). */
function reviewThresholdEnv(): number {
  const n = Number(process.env.CREATIVE_REVIEW_THRESHOLD);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 85;
}

/** Max improvement cycles after the first generation (override MAX_REVISIONS).
 *  0 → behaves like a single generate+review (Sprint 20). Clamped to [0,5]. */
function maxRevisionsEnv(): number {
  const n = Number(process.env.MAX_REVISIONS);
  if (!Number.isFinite(n) || n < 0) return 2;
  return Math.min(Math.floor(n), 5);
}

/** Merge a planner's new_direction over the current one — non-empty fields win. */
function mergeDirection(
  current: Record<string, string>,
  incoming: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...current };
  for (const [k, v] of Object.entries(incoming)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

/** Creative Memory recall — recent directions for this brand (exclude self). */
async function recallRecentDirections(
  admin: ReturnType<typeof createAdminClient>,
  brandId: string,
  selfId: string,
): Promise<string[]> {
  try {
    const { data: recent } = await admin
      .from("content_creatives")
      .select("creative_brief, created_at")
      .eq("brand_id", brandId)
      .neq("id", selfId)
      .order("created_at", { ascending: false })
      .limit(8);
    return (recent ?? [])
      .map((r) => {
        const cd = (r.creative_brief as { creative_direction?: Record<string, string> } | null)
          ?.creative_direction;
        return cd?.world ? [cd.world, cd.environment, cd.lighting, cd.lens].filter(Boolean).join(" · ") : null;
      })
      .filter((s): s is string => !!s)
      .slice(0, 6);
  } catch {
    return [];
  }
}

/**
 * Generate ONE background from a prompt: Imagen with the multimodal safety loop
 * (up to MAX_BACKGROUND_ATTEMPTS), falling back to the deterministic palette
 * gradient if Imagen can't produce a clean background. Never throws on safety —
 * always returns a usable buffer.
 */
async function produceBackground(
  prompt: string,
  briefForFallback: CreativeBrief,
  creativeId: string,
  report: Reporter,
  baseProgress: number,
  ctx: UsageCtx,
  revisionAttempt: number,
): Promise<{ background: Buffer; backgroundSource: "imagen" | "fallback" }> {
  let lastReason = "";
  for (let attempt = 1; attempt <= MAX_BACKGROUND_ATTEMPTS; attempt++) {
    // Imagen (telemetry: 1 image per call, retryCount = inner safety attempt).
    const ig0 = Date.now();
    let png: Buffer;
    try {
      png = await generateCreativeBackground({ prompt, aspectRatio: briefForFallback.aspect_ratio });
      await recordAIUsage(ctx.admin, {
        userId: ctx.userId, provider: "imagen", operation: "generateCreativeBackground", purpose: "creative",
        model: "imagen-4.0-fast-generate-001", creativeId: ctx.creativeId, campaignId: ctx.campaignId,
        startedAt: ig0, completedAt: Date.now(), success: true, images: 1, retryCount: attempt - 1, revisionAttempt,
      });
    } catch (err) {
      await recordAIUsage(ctx.admin, {
        userId: ctx.userId, provider: "imagen", operation: "generateCreativeBackground", purpose: "creative",
        model: "imagen-4.0-fast-generate-001", creativeId: ctx.creativeId, campaignId: ctx.campaignId,
        startedAt: ig0, completedAt: Date.now(), success: false, images: 0, retryCount: attempt - 1, revisionAttempt,
        failureReason: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    // Background safety validation (Gemini vision).
    const vg0 = Date.now();
    const { data: check, meta: vmeta } = await validateGeneratedBackground(png);
    await recordAIUsage(ctx.admin, {
      userId: ctx.userId, provider: "gemini", operation: "validateGeneratedBackground", purpose: "review",
      model: "gemini-vision", creativeId: ctx.creativeId, campaignId: ctx.campaignId,
      startedAt: vg0, completedAt: Date.now(), success: true, retryCount: attempt - 1, revisionAttempt,
      tokensInput: vmeta.tokensInput, tokensOutput: vmeta.tokensOutput,
    });
    if (!check.contains_text && !check.contains_logo && !check.contains_face) {
      return { background: png, backgroundSource: "imagen" };
    }
    lastReason = `text=${check.contains_text} logo=${check.contains_logo} face=${check.contains_face} (${check.description})`;
    report("background", Math.min(baseProgress + attempt * 2, 84));
  }
  console.warn(
    `[creative-generation] ${creativeId}: Imagen background failed safety validation after ${MAX_BACKGROUND_ATTEMPTS} attempts (${lastReason}); using deterministic fallback background.`,
  );
  return { background: await renderFallbackBackground(briefForFallback), backgroundSource: "fallback" };
}

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
    .select("id, brand_id, campaign_id, status, creative_brief, status_history, regen_count")
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
    // ─── Step 2: shared prep (constant across every attempt) ─────────────────
    // LOCKED asset bytes (never sent to any AI model), brand identity, pattern.
    report("assets", 12);
    const logoBuf = brief.logo_usage.use && brief.logo_usage.asset_id
      ? await downloadAssetBytes(admin, brief.logo_usage.asset_id)
      : null;
    const headshotBuf = brief.headshot_usage.use && brief.headshot_usage.asset_id
      ? await downloadAssetBytes(admin, brief.headshot_usage.asset_id)
      : null;

    const { data: brand } = await admin
      .from("brands")
      .select("name, industry, user_id")
      .eq("id", creative.brand_id)
      .single();
    const brandName = (brand?.name as string | undefined) ?? "";
    const brandIndustry = (brand?.industry as string | null | undefined) ?? null;
    // AI-usage telemetry attribution (Sprint 29).
    const usageCtx: UsageCtx = {
      admin,
      userId: (brand?.user_id as string | undefined) ?? "unknown",
      creativeId,
      campaignId: (creative.campaign_id as string | null) ?? null,
    };
    // Active Brand Pattern (P4 Phase 2A) — null until migration 023 + an
    // authored pattern exist; null → compositor renders exactly as before.
    const brandPattern = await loadActiveBrandPattern(admin, creative.brand_id as string);
    const founderName =
      brief.founder_name_usage.use && brief.founder_name_usage.name
        ? brief.founder_name_usage.name
        : founderNameFromLabel(null);

    // Creative Memory — recent directions for the review's originality axis AND
    // the planner's "avoid these worlds" guidance (exclude self).
    const recentDirections = await recallRecentDirections(admin, creative.brand_id as string, creativeId);

    const threshold = reviewThresholdEnv();
    const maxRevisions = maxRevisionsEnv();
    const totalAttempts = maxRevisions + 1;

    // ─── Step 3: AI Self-Improvement Loop (Sprint 21) ────────────────────────
    // generate → review → (if weak) plan → regenerate, up to totalAttempts.
    // We always DELIVER the best-scoring attempt: OttoFlow generates,
    // criticizes, improves, and only then delivers.
    type Candidate = {
      background: Buffer;
      backgroundSource: "imagen" | "fallback";
      finalPng: Buffer;
      review: CreativeReview | null;
      direction: Record<string, string>;
      prompt: string;
    };
    let currentPrompt = brief.background_prompt;
    let currentDirection: Record<string, string> = { ...(brief.creative_direction ?? {}) } as Record<string, string>;
    let pendingChanges: string[] = []; // planner notes that produced the NEXT attempt
    const revisionHistory: NonNullable<CreativeBrief["revision_history"]> = [];
    let best: Candidate | null = null;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      const span = 70 / totalAttempts;
      const base = 15 + (attempt - 1) * span;

      // (a) background from the current prompt (Imagen safety loop + fallback)
      report(attempt === 1 ? "background" : "regenerating", Math.round(base));
      const { background, backgroundSource } = await produceBackground(
        currentPrompt, brief, creativeId, report, Math.round(base), usageCtx, attempt - 1,
      );

      // (b) deterministic composite with this attempt's prompt + direction
      report("compositing", Math.round(base + span * 0.5));
      const attemptBrief: CreativeBrief = {
        ...brief,
        background_prompt: currentPrompt,
        creative_direction: currentDirection as CreativeBrief["creative_direction"],
      };
      const finalPng = await compositeCreative({
        brief: attemptBrief,
        background,
        logo: logoBuf,
        headshot: headshotBuf,
        brandName,
        founderName,
        pattern: brandPattern?.pattern ?? null,
      });

      // (c) AI Creative Review (vision QC) — best-effort, never fails the job
      report("reviewing", Math.round(base + span * 0.8));
      let verdict: CreativeReview | null = null;
      const rv0 = Date.now();
      try {
        const { data, meta } = await reviewCreativeImage({
          imageBase64: finalPng.toString("base64"),
          mimeType: "image/png",
          brand: { name: brandName, industry: brandIndustry },
          platform: brief.platform,
          headline: brief.headline,
          cta: brief.cta,
          creativeDirection: currentDirection,
          recentDirections,
        });
        verdict = data;
        await recordAIUsage(usageCtx.admin, {
          userId: usageCtx.userId, provider: "gemini", operation: "reviewCreativeImage", purpose: "review",
          model: "gemini-vision", creativeId, campaignId: usageCtx.campaignId,
          startedAt: rv0, completedAt: Date.now(), success: true,
          tokensInput: meta.tokensInput, tokensOutput: meta.tokensOutput, revisionAttempt: attempt - 1,
        });
        console.log(
          `[creative-generation] ${creativeId}: attempt ${attempt}/${totalAttempts} review overall=${data.overall_score} → ${data.recommendation} (${data.issues.length} issues)`,
        );
      } catch (err) {
        await recordAIUsage(usageCtx.admin, {
          userId: usageCtx.userId, provider: "gemini", operation: "reviewCreativeImage", purpose: "review",
          model: "gemini-vision", creativeId, campaignId: usageCtx.campaignId,
          startedAt: rv0, completedAt: Date.now(), success: false, revisionAttempt: attempt - 1,
          failureReason: err instanceof Error ? err.message : String(err),
        });
        captureFallback("creative-generation.review_failed", err, { creativeId, attempt });
      }

      // (d) record every attempt — future training data
      revisionHistory.push({
        attempt,
        overall_score: verdict?.overall_score ?? null,
        recommendation: verdict?.recommendation ?? null,
        scores: verdict
          ? {
              brand: verdict.brand_score,
              commercial: verdict.commercial_score,
              story: verdict.story_score,
              composition: verdict.composition_score,
              readability: verdict.readability_score,
              originality: verdict.originality_score,
              platform: verdict.platform_score,
            }
          : undefined,
        issues: verdict?.issues ?? [],
        applied_changes: pendingChanges,
        direction: currentDirection,
        background_source: backgroundSource,
        reviewed_at: new Date().toISOString(),
      });

      // (e) keep the strongest candidate so we always deliver the best version
      const score = verdict?.overall_score ?? -1;
      if (!best || score > (best.review?.overall_score ?? -1)) {
        best = { background, backgroundSource, finalPng, review: verdict, direction: currentDirection, prompt: currentPrompt };
      }

      // (f) stop conditions
      if (!verdict) break; // can't improve blind — deliver what we have
      if (verdict.overall_score >= threshold) break; // approved
      if (attempt === totalAttempts) break; // out of attempts — deliver best

      // (g) plan the next revision (what to change + revised direction + prompt)
      const im0 = Date.now();
      try {
        const { data: plan, meta } = await planCreativeImprovement({
          review: verdict,
          brand: { name: brandName, industry: brandIndustry },
          platform: brief.platform,
          objective: brief.visual_metaphor || brief.visual_concept || brief.topic_title || brief.headline,
          headline: brief.headline,
          cta: brief.cta,
          currentDirection,
          currentBackgroundPrompt: currentPrompt,
          recentDirections,
        });
        await recordAIUsage(usageCtx.admin, {
          userId: usageCtx.userId, provider: "gemini", operation: "planCreativeImprovement", purpose: "improvement",
          model: "gemini", creativeId, campaignId: usageCtx.campaignId,
          startedAt: im0, completedAt: Date.now(), success: true,
          tokensInput: meta.tokensInput, tokensOutput: meta.tokensOutput, revisionAttempt: attempt - 1,
        });
        pendingChanges = plan.changes;
        // The revision prompt becomes the new background prompt ONLY if it's
        // clean (background-only: no text/logo/face/geometry). Otherwise keep
        // the prior prompt — the direction shift + Imagen entropy still help.
        const violation = findForbiddenBackgroundToken(plan.revision_prompt);
        if (!violation && plan.revision_prompt.trim().length >= 10) {
          currentPrompt = plan.revision_prompt.trim();
        } else {
          captureFallback(
            "creative-generation.revision_prompt_unsafe",
            new Error(violation ?? "revision prompt too short"),
            { creativeId, attempt },
          );
        }
        currentDirection = mergeDirection(currentDirection, plan.new_direction);
        console.log(
          `[creative-generation] ${creativeId}: improving after attempt ${attempt} — ${plan.changes.length} change(s)`,
        );
      } catch (err) {
        captureFallback("creative-generation.planner_failed", err, { creativeId, attempt });
        break; // can't plan — deliver best
      }
    }

    // best is non-null (the loop always runs at least once).
    const delivered = best as Candidate;
    const deliveredScore = delivered.review?.overall_score ?? null;
    const needsHumanReview = deliveredScore === null || deliveredScore < threshold;
    const revisionCount = revisionHistory.length - 1;

    // ─── Step 4: upload the DELIVERED background + composite ──────────────────
    report("uploading", 88);
    const dir = `${creative.brand_id}/${creativeId}`;
    const bgPath = `${dir}/bg-${randomUUID()}.png`;
    const imgPath = `${dir}/creative-${randomUUID()}.png`;

    const { error: bgErr } = await admin.storage
      .from("content-creatives")
      .upload(bgPath, delivered.background, { contentType: "image/png", upsert: false });
    if (bgErr) throw new Error(`Background upload failed: ${bgErr.message}`);

    const { error: imgErr } = await admin.storage
      .from("content-creatives")
      .upload(imgPath, delivered.finalPng, { contentType: "image/png", upsert: false });
    if (imgErr) throw new Error(`Creative upload failed: ${imgErr.message}`);

    const {
      data: { publicUrl: backgroundUrl },
    } = admin.storage.from("content-creatives").getPublicUrl(bgPath);
    const {
      data: { publicUrl: imageUrl },
    } = admin.storage.from("content-creatives").getPublicUrl(imgPath);

    // ─── Step 5: finalize ────────────────────────────────────────────────────
    // Status stays 'ready' — the customer always receives the best version
    // OttoFlow could create. The brief jsonb carries the delivered review, the
    // full revision history (training data) and the needs_human_review flag
    // (operator-only; never exposed to the customer). The delivered direction
    // is what Creative Memory recalls next time — we vary off what we SHIPPED.
    report("finalizing", 95);
    const doneAt = new Date().toISOString();
    const finalHistory = [...history, { from: "generating", to: "ready", at: doneAt, by: "worker" }];
    const deliveredReview = delivered.review
      ? { ...delivered.review, threshold, reviewed_at: doneAt }
      : undefined;
    const updatedBrief: CreativeBrief = {
      ...brief,
      background_prompt: delivered.prompt,
      creative_direction: delivered.direction as CreativeBrief["creative_direction"],
      review: deliveredReview,
      revision_history: revisionHistory,
      needs_human_review: needsHumanReview,
      revision_count: revisionCount,
    };
    const { error: updErr } = await admin
      .from("content_creatives")
      .update({
        status: "ready",
        background_url: backgroundUrl,
        image_url: imageUrl,
        background_source: delivered.backgroundSource,
        generated_at: doneAt,
        generation_error: null,
        status_history: finalHistory,
        creative_brief: updatedBrief,
      })
      .eq("id", creativeId);
    if (updErr) throw new Error(`Failed to finalize creative: ${updErr.message}`);

    if (needsHumanReview) {
      console.warn(
        `[creative-generation] ${creativeId}: delivered best version (score=${deliveredScore ?? "n/a"}) after ${revisionCount} revision(s) — flagged needs_human_review.`,
      );
    }

    // BRS (P4 Phase 2A) — score the DELIVERED creative + snapshot the pattern
    // version. Best-effort: never fail the creative on a scoring error.
    if (brandPattern) {
      try {
        const brs = await computeBRS(delivered.finalPng, brandPattern.pattern, {
          primary: brief.palette.primary,
          secondary: brief.palette.secondary,
          accent: brief.palette.accent,
        });
        await admin
          .from("brand_patterns")
          .update({ recognition_score: brs.score })
          .eq("id", brandPattern.id);
        await admin
          .from("content_creatives")
          .update({ brand_pattern_version: brandPattern.version })
          .eq("id", creativeId);
      } catch (err) {
        captureFallback("creative-generation.brs_failed", err, { creativeId });
      }
    }

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
