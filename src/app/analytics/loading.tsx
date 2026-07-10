import { Skeleton, SkeletonHeader, SkeletonKPIGrid, SkeletonCard } from "@/components/ui/skeleton";

export default function AnalyticsLoading() {
  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <SkeletonHeader />
      <SkeletonKPIGrid />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <SkeletonCard key={i}>
            <Skeleton className="h-4 w-32 mb-4" />
            <Skeleton className="h-52 w-full rounded-lg" />
          </SkeletonCard>
        ))}
      </div>
    </div>
  );
}
