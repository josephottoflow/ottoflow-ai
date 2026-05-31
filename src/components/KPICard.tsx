"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { ReactNode } from "react";

interface KPICardProps {
  title: string;
  value: string | number;
  change?: number;
  changePct?: number;
  subtitle?: string;
  /**
   * Pre-rendered icon JSX. NOTE: previously this was `LucideIcon` (a function
   * reference), which Next.js 15 RSC refused to serialize across the server
   * → client boundary ("Functions cannot be passed directly to Client
   * Components"). Caller now renders the JSX element themselves and passes
   * the node; we just position it.
   */
  icon: ReactNode;
  iconColor?: string;
  iconBg?: string;
  gradient?: string;
  className?: string;
  loading?: boolean;
}

export function KPICard({
  title,
  value,
  change,
  changePct,
  subtitle,
  icon,
  iconColor = "#a78bfa",
  iconBg = "rgba(124, 58, 237, 0.12)",
  gradient,
  className,
  loading,
}: KPICardProps) {
  const positive = (changePct ?? 0) > 0;
  const neutral = changePct === 0 || changePct === undefined;

  return (
    <div
      className={cn(
        "glass card-hover relative overflow-hidden rounded-2xl p-5",
        className
      )}
      style={gradient ? { background: gradient } : undefined}
    >
      {/* Icon */}
      <div className="flex items-start justify-between mb-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: iconBg, color: iconColor }}
        >
          {icon}
        </div>

        {/* Trend badge */}
        {changePct !== undefined && (
          <div
            className={cn(
              "flex items-center gap-1 text-xs font-semibold rounded-full px-2 py-0.5",
              positive
                ? "bg-emerald-500/10 text-emerald-400"
                : neutral
                ? "bg-white/5 text-white/40"
                : "bg-red-500/10 text-red-400"
            )}
          >
            {positive ? (
              <TrendingUp size={11} />
            ) : neutral ? (
              <Minus size={11} />
            ) : (
              <TrendingDown size={11} />
            )}
            {Math.abs(changePct).toFixed(1)}%
          </div>
        )}
      </div>

      {/* Value */}
      {loading ? (
        <div className="h-8 w-24 rounded-lg bg-white/5 animate-pulse mb-1" />
      ) : (
        <div className="text-3xl font-bold text-white tracking-tight mb-1">
          {value}
        </div>
      )}

      {/* Title */}
      <div className="text-sm text-white/50 font-medium">{title}</div>

      {/* Subtitle */}
      {subtitle && (
        <div className="text-xs text-white/30 mt-1">{subtitle}</div>
      )}

      {/* Decorative gradient blob */}
      <div
        className="absolute -right-4 -bottom-4 w-20 h-20 rounded-full blur-2xl opacity-20"
        style={{ background: iconColor }}
      />
    </div>
  );
}
