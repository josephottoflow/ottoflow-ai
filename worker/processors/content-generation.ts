/**
 * Content Generation processor.
 *
 * Mirrors the brand-research processor structure (steps + log appender +
 * report() callback for BullMQ progress). Three short steps:
 *
 *   preparing_prompt:  load brand + pillar from DB
 *   generating:        the Gemini call (heaviest)
 *   finalizing:        write title/preview/body + hashtags back to
 *                      content_items, flip job + item to done
 *
 * On failure: content_generation_jobs.status='failed' + error_message;
 * content_items stays in its 'draft' status with body=null so the user
 * can retry via /api/content/[id]/retry (future).
 */
import { createAdminClient } from "@/lib/supabase";
import { generateContentPiece, type GeneratedContent } from "@/lib/gemini";
import type { ContentGenerationJobData } from "@/lib/queue";
import type { BrandProfile } from "@/lib/types";

type Reporter = (step: string, progress: number) => void;

interface StepDef {
  key: string;
  label: string;
  progressAt: number;
}

const STEPS: Record<string, StepDef> = {
  preparing_prompt: { key: "preparing_prompt", label: "Loading brand context", progressAt: 15 },
  generating:       { key: "generating",       label: "Generating content",    progressAt: 85 },
  finalizing:       { key: "finalizing",       label: "Saving content",        progressAt: 100 },
};

interface LogEntry {
  ts: string;
  level: "info" | "success" | "error";
  step: string;
  message: string;
  meta?: Record<string, unknown>;
}

export async function processContentGeneration(
  data: ContentGenerationJobData,
  report: Reporter,
): Promise<{ ok: true }> {
  const admin = createAdminClient();
  const { contentJobId, contentItemId, brandId, platform, userPrompt, pillarId } = data;

  // ─── Helpers ──────────────────────────────────────────────────────────────
  async function startStep(step: StepDef) {
    await admin
      .from("content_generation_jobs")
      .update({ status: "running", current_step: step.key })
      .eq("id", contentJobId);
    report(step.key, Math.max(0, step.progressAt - 10));
    await appendLog({
      ts: new Date().toISOString(),
      level: "info",
      step: step.key,
      message: `Started: ${step.label}`,
    });
  }

  async function finishStep(step: StepDef, msg: string, meta?: Record<string, unknown>) {
    await admin
      .from("content_generation_jobs")
      .update({ progress: step.progressAt })
      .eq("id", contentJobId);
    report(step.key, step.progressAt);
    await appendLog({
      ts: new Date().toISOString(),
      level: "success",
      step: step.key,
      message: msg,
      meta,
    });
  }

  async function appendLog(entry: LogEntry) {
    await admin.rpc("append_content_log" as never, {
      job_id: contentJobId,
      entry: entry as unknown,
    } as never);
  }

  async function failJob(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("content_generation_jobs")
      .update({
        status: "failed",
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", contentJobId);
    await appendLog({
      ts: new Date().toISOString(),
      level: "error",
      step: "error",
      message,
    });
  }

  try {
    // ─── Step 1: preparing_prompt ───────────────────────────────────────────
    await startStep(STEPS.preparing_prompt);

    const { data: brand, error: brandErr } = await admin
      .from("brands")
      .select("id, name, website, industry, profile, status")
      .eq("id", brandId)
      .single();

    if (brandErr || !brand) {
      throw new Error(`Brand ${brandId} not found: ${brandErr?.message ?? "missing"}`);
    }
    if (!brand.profile) {
      throw new Error(
        `Brand ${brand.name} has no profile yet. Run brand research first.`,
      );
    }

    let pillar:
      | { name: string; description?: string | null; example_topics?: string[] }
      | null = null;
    if (pillarId) {
      const { data: p } = await admin
        .from("content_pillars")
        .select("name, description, example_topics")
        .eq("id", pillarId)
        .maybeSingle();
      if (p) {
        pillar = {
          name: p.name as string,
          description: (p.description as string | null) ?? null,
          example_topics: (p.example_topics as string[] | null) ?? [],
        };
      }
    }

    await finishStep(STEPS.preparing_prompt, "Brand context loaded", {
      hasPillar: !!pillar,
      promptProvided: !!userPrompt,
    });

    // ─── Step 2: generating ─────────────────────────────────────────────────
    await startStep(STEPS.generating);

    let generated: GeneratedContent;
    try {
      generated = await generateContentPiece({
        brand: {
          name: brand.name as string,
          website: (brand.website as string | null) ?? null,
          industry: (brand.industry as string | null) ?? null,
          profile: brand.profile as BrandProfile,
        },
        platform,
        userPrompt: userPrompt ?? null,
        pillar,
      });
    } catch (err) {
      throw new Error(
        `Gemini generation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await finishStep(STEPS.generating, `Generated ${generated.body.length}-char ${platform} content`, {
      titleLen: generated.title.length,
      bodyLen: generated.body.length,
      hashtagCount: generated.hashtags?.length ?? 0,
    });

    // ─── Step 3: finalizing — write content_items + flip job done ───────────
    await startStep(STEPS.finalizing);

    const { error: updItemErr } = await admin
      .from("content_items")
      .update({
        title: generated.title,
        preview: generated.preview,
        body: generated.body,
        // Persist hashtags + cta in engagement jsonb (no dedicated columns yet)
        engagement: {
          hashtags: generated.hashtags ?? [],
          cta: generated.cta ?? null,
        },
      })
      .eq("id", contentItemId);

    if (updItemErr) {
      throw new Error(`Failed to save content: ${updItemErr.message}`);
    }

    await admin
      .from("content_generation_jobs")
      .update({
        status: "done",
        completed_at: new Date().toISOString(),
      })
      .eq("id", contentJobId);

    await finishStep(STEPS.finalizing, "Content ready");

    return { ok: true };
  } catch (err) {
    await failJob(err);
    throw err;
  }
}
