import { SkeletonHeader, SkeletonCardGrid } from "@/components/ui/skeleton";

export default function ContentLoading() {
  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <SkeletonHeader />
      <SkeletonCardGrid count={6} />
    </div>
  );
}
