"use client";

import { formatRelative } from "@/lib/utils";
import type { DbActivityItem } from "@/lib/types";
import {
  Video,
  FileText,
  FolderPlus,
  CheckCircle2,
  Send,
  AlertCircle,
  Briefcase,
} from "lucide-react";

const typeConfig = {
  video_rendered: {
    icon: Video,
    color: "#7c3aed",
    bg: "rgba(124, 58, 237, 0.12)",
    label: "Rendered",
  },
  content_generated: {
    icon: FileText,
    color: "#6366f1",
    bg: "rgba(99, 102, 241, 0.12)",
    label: "Generated",
  },
  project_created: {
    icon: FolderPlus,
    color: "#3b82f6",
    bg: "rgba(59, 130, 246, 0.12)",
    label: "Project",
  },
  approval: {
    icon: CheckCircle2,
    color: "#10b981",
    bg: "rgba(16, 185, 129, 0.12)",
    label: "Approved",
  },
  published: {
    icon: Send,
    color: "#06b6d4",
    bg: "rgba(6, 182, 212, 0.12)",
    label: "Published",
  },
  error: {
    icon: AlertCircle,
    color: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.12)",
    label: "Warning",
  },
  brand_researched: {
    icon: Briefcase,
    color: "#a78bfa",
    bg: "rgba(167, 139, 250, 0.12)",
    label: "Brand",
  },
} as const;

interface Props {
  items: DbActivityItem[];
  className?: string;
}

export function ActivityFeed({ items, className }: Props) {
  return (
    <div className={className}>
      <div className="space-y-0">
        {items.map((item, i) => {
          const cfg = typeConfig[item.type];
          const Icon = cfg.icon;
          return (
            <div
              key={item.id}
              className="flex items-start gap-3 py-3 group"
              style={{
                borderBottom: i < items.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined,
              }}
            >
              {/* Icon */}
              <div
                className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center mt-0.5"
                style={{ background: cfg.bg }}
              >
                <Icon size={13} style={{ color: cfg.color }} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white/75 leading-snug">{item.message}</p>
                {item.project_name && (
                  <p className="text-xs text-white/35 mt-0.5 truncate">{item.project_name}</p>
                )}
              </div>

              {/* Time */}
              <span className="text-xs text-white/25 flex-shrink-0 pt-0.5">
                {formatRelative(item.created_at)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
