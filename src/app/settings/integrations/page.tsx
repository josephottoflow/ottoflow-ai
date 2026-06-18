/**
 * /settings/integrations — Phase 3 / P1 Integrations hub (Google Drive).
 * Server wrapper: reads the connect/error query params (Next 15 async
 * searchParams) and hands them to the client component.
 */
import IntegrationsClient from "./IntegrationsClient";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const sp = await searchParams;
  return (
    <IntegrationsClient connected={sp.connected ?? null} error={sp.error ?? null} />
  );
}
