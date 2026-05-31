/**
 * POST /api/generate
 *
 * SSE proxy — forwards the request to the parent pipeline app
 * (default: http://localhost:3000/api/generate) and streams
 * the Server-Sent Events back to the browser.
 *
 * Set PIPELINE_API_URL in .env.local to point at the parent app.
 * When deployed to the same origin, it calls itself — which means
 * the parent and Ottoflow AI are on the same Next.js instance.
 */

import { NextRequest } from "next/server";
import { actionCreateRenderJob, actionCompleteRenderJob } from "@/app/actions";

export const runtime = "nodejs";
export const maxDuration = 600; // 10 min

const PIPELINE_URL =
  process.env.PIPELINE_API_URL ?? "http://localhost:3000/api/generate";

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Create a DB record for this job right away so the render queue shows it
  let jobId: string | null = null;
  try {
    const job = await actionCreateRenderJob({
      name: `${(body.prompt as string).slice(0, 40)}...`,
      status: "queued",
      progress: 0,
      completed_at: null,
      duration_ms: null,
      template: body.renderVariant ?? "ugc-v2",
      output_path: null,
      output_url: null,
      error_message: null,
      prompt: body.prompt,
      project_id: body.projectId ?? null,
      meta: { provider: body.provider, style: body.style },
    });
    jobId = job?.id ?? null;
  } catch {
    // Non-fatal — continue even if DB isn't set up yet
  }

  // Stream from parent pipeline
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const upstream = await fetch(PIPELINE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, _jobId: jobId }),
        });

        if (!upstream.ok || !upstream.body) {
          sendEvent({
            type: "error",
            error: `Pipeline returned ${upstream.status}`,
          });
          controller.close();
          return;
        }

        // Forward SSE events and intercept "done" to update DB
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw) continue;

            try {
              const event = JSON.parse(raw);

              // Intercept done event to persist output URL
              if (event.type === "done" && event.videoUrl && jobId) {
                try {
                  await actionCompleteRenderJob(
                    jobId,
                    event.videoUrl,
                    body.projectId
                  );
                } catch {
                  // Non-fatal
                }
                sendEvent({ ...event, jobId });
              } else {
                sendEvent(event);
              }
            } catch {
              // Malformed SSE line — skip
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        sendEvent({ type: "error", error: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
