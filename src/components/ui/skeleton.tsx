/**
 * Skeleton kit (Premium UX — Phase 4).
 *
 * Route-level loading states rendered by App-Router `loading.tsx` files while
 * server components fetch. Purely presentational; the shimmer is defined by the
 * `.otto-skeleton` utility in globals.css and respects prefers-reduced-motion.
 */
import type { CSSProperties } from "react";

export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return <div className={`otto-skeleton ${className}`} style={style} aria-hidden="true" />;
}

/** A glass card wrapper matching the app's real cards, with children skeletons. */
export function SkeletonCard({
  className = "",
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return <div className={`glass rounded-2xl p-5 ${className}`}>{children}</div>;
}

/** Page header block — small eyebrow, title, subtitle. */
export function SkeletonHeader() {
  return (
    <div className="mb-8">
      <Skeleton className="h-3 w-28 mb-3" />
      <Skeleton className="h-7 w-64 mb-2.5" />
      <Skeleton className="h-4 w-80" />
    </div>
  );
}

/** A responsive row of KPI-style stat cards. */
export function SkeletonKPIGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i}>
          <div className="flex items-center justify-between mb-4">
            <Skeleton className="w-10 h-10 rounded-xl" />
            <Skeleton className="h-3 w-10" />
          </div>
          <Skeleton className="h-7 w-20 mb-2" />
          <Skeleton className="h-3 w-24" />
        </SkeletonCard>
      ))}
    </div>
  );
}

/** A vertical list of rows (projects, activity, queue…). */
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-xl"
          style={{ border: "1px solid rgba(255,255,255,0.04)" }}
        >
          <Skeleton className="w-8 h-8 rounded-lg flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <Skeleton className="h-3.5 w-2/3 mb-2" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
          <Skeleton className="h-5 w-12 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** A grid of larger content/brand cards. */
export function SkeletonCardGrid({
  count = 6,
  cols = "sm:grid-cols-2 xl:grid-cols-3",
}: {
  count?: number;
  cols?: string;
}) {
  return (
    <div className={`grid grid-cols-1 ${cols} gap-4`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i}>
          <div className="flex items-center gap-3 mb-4">
            <Skeleton className="w-10 h-10 rounded-xl" />
            <div className="flex-1">
              <Skeleton className="h-3.5 w-3/4 mb-2" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-3 w-full mb-2" />
          <Skeleton className="h-3 w-5/6 mb-4" />
          <div className="flex gap-2">
            <Skeleton className="h-6 w-16 rounded-md" />
            <Skeleton className="h-6 w-16 rounded-md" />
          </div>
        </SkeletonCard>
      ))}
    </div>
  );
}
