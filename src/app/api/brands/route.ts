import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase";
import { brandResearchQueue } from "@/lib/queue";

export const runtime = "nodejs";

const CreateBrandSchema = z.object({
  name: z.string().min(1).max(200),
  website: z.string().url(),
  industry: z.string().min(1).max(120),
});

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateBrandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const admin = createAdminClient();

  // 1. Create brand row (user_id from Clerk, status pending until worker picks up)
  const { data: brand, error: brandErr } = await admin
    .from("brands")
    .insert({
      user_id: userId,
      name: input.name,
      website: input.website,
      industry: input.industry,
      status: "pending",
    })
    .select()
    .single();

  if (brandErr || !brand) {
    return NextResponse.json(
      { error: brandErr?.message ?? "Failed to create brand" },
      { status: 500 }
    );
  }

  // 2. Create research-job row
  const { data: job, error: jobErr } = await admin
    .from("brand_research_jobs")
    .insert({
      brand_id: brand.id,
      status: "queued",
      current_step: "queued",
      progress: 0,
    })
    .select()
    .single();

  if (jobErr || !job) {
    // Best effort cleanup
    await admin.from("brands").delete().eq("id", brand.id);
    return NextResponse.json(
      { error: jobErr?.message ?? "Failed to create research job" },
      { status: 500 }
    );
  }

  // 3. Enqueue BullMQ job
  try {
    const queue = brandResearchQueue();
    const bullJob = await queue.add(
      "research",
      {
        brandId: brand.id,
        researchJobId: job.id,
        name: brand.name,
        website: brand.website ?? input.website,
        industry: brand.industry ?? input.industry,
      },
      { jobId: job.id }
    );
    await admin
      .from("brand_research_jobs")
      .update({ bull_job_id: String(bullJob.id ?? job.id) })
      .eq("id", job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enqueue";
    await admin
      .from("brand_research_jobs")
      .update({ status: "failed", error_message: message })
      .eq("id", job.id);
    await admin.from("brands").update({ status: "failed" }).eq("id", brand.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ brandId: brand.id, researchJobId: job.id }, { status: 201 });
}
