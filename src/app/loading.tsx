import {
  Skeleton,
  SkeletonCard,
  SkeletonHeader,
  SkeletonKPIGrid,
  SkeletonList,
} from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <SkeletonHeader />
      <SkeletonKPIGrid />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
        {[0, 1].map((i) => (
          <SkeletonCard key={i}>
            <div className="flex items-center gap-3 mb-4">
              <Skeleton className="w-10 h-10 rounded-xl" />
              <div className="flex-1">
                <Skeleton className="h-3.5 w-32 mb-2" />
                <Skeleton className="h-2.5 w-20" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[0, 1, 2].map((j) => (
                <Skeleton key={j} className="h-14 rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-8 w-full rounded-lg" />
          </SkeletonCard>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px_280px] gap-4">
        <SkeletonCard>
          <Skeleton className="h-4 w-32 mb-4" />
          <SkeletonList rows={4} />
        </SkeletonCard>
        <SkeletonCard>
          <Skeleton className="h-4 w-24 mb-4" />
          <SkeletonList rows={3} />
        </SkeletonCard>
        <div className="space-y-4">
          <SkeletonCard>
            <Skeleton className="h-4 w-20 mb-4" />
            <Skeleton className="h-28 w-full rounded-lg" />
          </SkeletonCard>
          <SkeletonCard>
            <Skeleton className="h-4 w-24 mb-4" />
            <SkeletonList rows={2} />
          </SkeletonCard>
        </div>
      </div>
    </div>
  );
}
