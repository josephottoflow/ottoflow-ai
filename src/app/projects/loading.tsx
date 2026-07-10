import { SkeletonHeader, SkeletonCard, SkeletonList } from "@/components/ui/skeleton";

export default function ProjectsLoading() {
  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <SkeletonHeader />
      <SkeletonCard>
        <SkeletonList rows={6} />
      </SkeletonCard>
    </div>
  );
}
