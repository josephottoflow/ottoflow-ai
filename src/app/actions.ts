"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  createProject,
  updateProject,
  upsertContentItem,
  createRenderJob,
  updateRenderJob,
  logActivity,
} from "@/lib/db";
import type { DbProject, DbContentItem, DbRenderJob } from "@/lib/types";

/**
 * Helper: assert there's a Clerk session in context. Server actions are
 * gated by middleware too, but a defense-in-depth check here means callers
 * can rely on userId being non-null.
 */
async function requireUser(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

/**
 * Create a project for the current user. user_id is injected from Clerk
 * (see db.ts → createProject), so callers cannot spoof ownership.
 */
export async function actionCreateProject(
  data: Omit<DbProject, "id" | "created_at" | "updated_at" | "user_id">
) {
  await requireUser();
  const project = await createProject(data);

  if (project) {
    await logActivity({
      type: "project_created",
      message: `Project "${project.name}" created`,
      project_id: project.id,
      project_name: project.name,
      meta: null,
    });
    revalidatePath("/projects");
    revalidatePath("/");
  }

  return project;
}

export async function actionUpdateProjectStatus(
  id: string,
  status: DbProject["status"]
) {
  await requireUser();
  await updateProject(id, { status });
  revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
}

// ─── Content ──────────────────────────────────────────────────────────────────

export async function actionSaveContentItem(
  item: Omit<DbContentItem, "id" | "created_at">
) {
  await requireUser();
  const saved = await upsertContentItem(item);

  if (saved) {
    await logActivity({
      type: "content_generated",
      message: `Content generated for ${item.platform}`,
      project_id: item.project_id,
      project_name: null,
      meta: { platform: item.platform },
    });
    revalidatePath("/content");
    if (item.project_id) revalidatePath(`/projects/${item.project_id}`);
    revalidatePath("/");
  }

  return saved;
}

/**
 * Mark a content item as published. RLS chains ownership through the
 * parent project, so a user can only publish content they own — there's
 * no need to filter by user_id here, but we still take the auth() check
 * for an explicit 401 if the session is missing.
 */
export async function actionPublishContent(id: string, projectId?: string) {
  await requireUser();
  const sb = await createServerSupabaseClient();
  const { error } = await sb
    .from("content_items")
    .update({ status: "published" })
    .eq("id", id);

  if (!error) {
    await logActivity({
      type: "published",
      message: "Content published",
      project_id: projectId ?? null,
      project_name: null,
      meta: { content_id: id },
    });
    revalidatePath("/content");
    if (projectId) revalidatePath(`/projects/${projectId}`);
  }
}

// ─── Render Jobs ──────────────────────────────────────────────────────────────

export async function actionCreateRenderJob(
  payload: Omit<DbRenderJob, "id" | "started_at">
) {
  await requireUser();
  const job = await createRenderJob(payload);

  if (job) {
    await logActivity({
      type: "video_rendered",
      message: `Render started: ${job.name}`,
      project_id: job.project_id,
      project_name: null,
      meta: { template: job.template },
    });
    revalidatePath("/video");
    revalidatePath("/");
  }

  return job;
}

export async function actionUpdateRenderJobProgress(
  id: string,
  progress: number,
  status?: DbRenderJob["status"]
) {
  await requireUser();
  const payload: Partial<DbRenderJob> = { progress };
  if (status) payload.status = status;
  if (status === "done") {
    payload.completed_at = new Date().toISOString();
  }
  await updateRenderJob(id, payload);
  revalidatePath("/video");
  revalidatePath("/");
}

export async function actionCompleteRenderJob(
  id: string,
  outputUrl: string,
  projectId?: string
) {
  await requireUser();
  await updateRenderJob(id, {
    status: "done",
    progress: 100,
    output_url: outputUrl,
    completed_at: new Date().toISOString(),
  });

  await logActivity({
    type: "video_rendered",
    message: "Video rendered successfully",
    project_id: projectId ?? null,
    project_name: null,
    meta: { job_id: id, output_url: outputUrl },
  });

  revalidatePath("/video");
  revalidatePath("/");
}
