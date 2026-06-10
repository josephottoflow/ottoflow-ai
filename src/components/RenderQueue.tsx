"use client";

import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import type { DbRenderJob } from "@/lib/types";
import { Video, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";

const statusConfig = {
  rendering: { label: "Rendering", variant: "info" as const, icon: Loader2, spin: true },
  queued: { label: "Queued", variant: "warning" as const, icon: Clock, spin: false },
  done: { label: "Done", variant: "success" as const, icon: CheckCircle2, spin: false },
  failed: { label: "Failed", variant: "destructive" as const, icon: XCircle, spin: false },
};

interface Props {
  jobs: DbRenderJob[];
  className?: string;
}

export function RenderQueue({ jobs, className }: Props) {
  if (jobs.length === 0) {
    return (
      <p className="text-xs text-white/30 text-center py-4">No jobs in queue.</p>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {jobs.map((job) => {
        const cfg = statusConfig[job.status] ?? statusConfig.queued;
        const Icon = cfg.icon;
        return (
          <div
            key={job.id}
            className="flex items-center gap-3 p-3 rounded-xl"
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <div
              className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center"
              style={{ background: "rgba(124, 58, 237, 0.1)" }}
            >
              <Video size={14} className="text-violet-400" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-xs font-medium text-white/70 truncate">{job.name}</p>
                <Badge variant={cfg.variant} className="text-3xs px-1.5 py-0 flex-shrink-0">
                  <Icon size={9} className={cn("mr-1", cfg.spin && "animate-spin")} />
                  {cfg.label}
                </Badge>
              </div>
              <p className="text-3xs text-white/30 mb-1.5">{job.template}</p>
              {job.status === "rendering" && (
                <Progress value={job.progress} className="h-1" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
