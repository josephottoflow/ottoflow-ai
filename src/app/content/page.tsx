import { getContentItems, getKPISummary } from "@/lib/db";
import { ContentPageClient } from "./ContentPageClient";

export const revalidate = 30;

export default async function ContentPipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ needsVideoContent?: string }>;
}) {
  const { needsVideoContent } = await searchParams;
  const [items, kpis] = await Promise.all([
    getContentItems(),
    getKPISummary(),
  ]);

  return (
    <>
      {needsVideoContent === "1" && (
        <div className="px-6 pt-4">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.08] px-4 py-2.5 text-xs text-amber-300">
            Create a content item first, then generate a video.
          </div>
        </div>
      )}
      <ContentPageClient items={items} kpis={kpis} />
    </>
  );
}
