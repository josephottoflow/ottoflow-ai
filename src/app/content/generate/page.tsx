import { listBrands } from "@/lib/db-brands";
import { ContentGenerateClient } from "./ContentGenerateClient";

export const dynamic = "force-dynamic";

export default async function ContentGeneratePage({
  searchParams,
}: {
  // One-click entry from an idea links here as
  // /content/generate?brandId=…&topicId=… to pre-select the brand + idea.
  searchParams: Promise<{ brandId?: string; topicId?: string }>;
}) {
  const brands = await listBrands();
  // Only brands with a populated profile can be used — content generation
  // depends on profile + voice + audience context. Send the trimmed list to
  // the client to avoid a wide brand snapshot in the wire payload.
  const ready = brands
    .filter((b) => b.status === "ready" && b.profile)
    .map((b) => ({
      id: b.id,
      name: b.name,
      industry: b.industry,
      website: b.website,
    }));

  const sp = await searchParams;

  return (
    <ContentGenerateClient
      readyBrands={ready}
      preselectBrandId={sp.brandId ?? null}
      preselectTopicId={sp.topicId ?? null}
    />
  );
}
