import { getContentItems, getKPISummary } from "@/lib/db";
import { ContentPageClient } from "./ContentPageClient";

export const revalidate = 30;

export default async function ContentPipelinePage() {
  const [items, kpis] = await Promise.all([
    getContentItems(),
    getKPISummary(),
  ]);

  return <ContentPageClient items={items} kpis={kpis} />;
}
