import { listBrands } from "@/lib/db-brands";
import { ContentGenerateClient } from "./ContentGenerateClient";

export const dynamic = "force-dynamic";

export default async function ContentGeneratePage() {
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

  return <ContentGenerateClient readyBrands={ready} />;
}
