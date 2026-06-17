/**
 * connected_accounts data + token layer (Phase 3 / P1).
 *
 * The ONLY module that reads/writes the secret-bearing connected_accounts
 * table. Always via the service-role client (the table is RLS-locked to
 * service-role; callers MUST pass the owning userId and we filter by it).
 * Tokens are encrypted at rest (encryption.ts, AAD = provider:userId) and
 * decrypted only here, server-side. Tokens never cross the BullMQ/Redis
 * boundary — workers call getValidDriveAccessToken() with a row they fetched
 * by connected_account_id.
 */
import { createAdminClient } from "@/lib/supabase";
import { encryptSecret, decryptSecret, secretAad } from "./encryption";
import { refreshAccessToken, revokeToken } from "./oauth";
import { getOAuthProvider } from "./providers/registry";

export interface ConnectedAccountRow {
  id: string;
  user_id: string;
  brand_id: string | null;
  workspace_id: string | null;
  provider: string;
  account_id: string;
  account_name: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expiry: string | null;
  scopes: string[];
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Token-free projection safe to return to the client. */
export interface ConnectedAccountSafe {
  id: string;
  brand_id: string | null;
  provider: string;
  account_id: string;
  account_name: string | null;
  token_expiry: string | null;
  scopes: string[];
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const SAFE_COLUMNS =
  "id, brand_id, provider, account_id, account_name, token_expiry, scopes, status, metadata, created_at, updated_at";

// Refresh a little before actual expiry to avoid edge-of-expiry failures.
const REFRESH_SKEW_MS = 120_000;

/** Append an audit row. Best-effort; never throws into the caller. */
export async function logIntegrationAudit(entry: {
  userId: string;
  provider?: string | null;
  action: string;
  target?: string | null;
  connectedAccountId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("integration_audit_log").insert({
      user_id: entry.userId,
      provider: entry.provider ?? null,
      action: entry.action,
      target: entry.target ?? null,
      connected_account_id: entry.connectedAccountId ?? null,
      detail: entry.detail ?? {},
      ip: entry.ip ?? null,
    });
  } catch {
    // audit is non-blocking
  }
}

/** Upsert a connection. Only overwrites the refresh token when a new one is
 * supplied (Google omits it on silent re-consent). */
export async function upsertConnectedAccount(opts: {
  userId: string;
  brandId?: string | null;
  provider: string;
  accountId: string;
  accountName: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number;
  scopes: string[];
}): Promise<ConnectedAccountRow> {
  const admin = createAdminClient();
  const aad = secretAad(opts.provider, opts.userId);
  const row: Record<string, unknown> = {
    user_id: opts.userId,
    brand_id: opts.brandId ?? null,
    provider: opts.provider,
    account_id: opts.accountId,
    account_name: opts.accountName,
    access_token_enc: encryptSecret(opts.accessToken, aad),
    token_expiry: new Date(Date.now() + opts.expiresInSec * 1000).toISOString(),
    scopes: opts.scopes,
    status: "active",
  };
  if (opts.refreshToken) {
    row.refresh_token_enc = encryptSecret(opts.refreshToken, aad);
  }
  const { data, error } = await admin
    .from("connected_accounts")
    .upsert(row, { onConflict: "user_id,provider,account_id" })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`connected_accounts upsert failed: ${error?.message ?? "no row"}`);
  }
  return data as ConnectedAccountRow;
}

/** Owner-scoped full row (incl. encrypted tokens) — server/worker use only. */
export async function getAccountForUser(
  id: string,
  userId: string,
): Promise<ConnectedAccountRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("connected_accounts")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as ConnectedAccountRow) ?? null;
}

/** Owner-scoped full row by id (worker path: it already trusts the job owner). */
export async function getAccountById(id: string): Promise<ConnectedAccountRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("connected_accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as ConnectedAccountRow) ?? null;
}

/** First (most recent) full row for a provider — server/worker use only. */
export async function getAccountByProviderForUser(
  userId: string,
  provider: string,
): Promise<ConnectedAccountRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("connected_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ConnectedAccountRow) ?? null;
}

/** Token-free list for the UI. */
export async function listAccountsForUser(userId: string): Promise<ConnectedAccountSafe[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("connected_accounts")
    .select(SAFE_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return (data as ConnectedAccountSafe[]) ?? [];
}

export async function setAccountStatus(id: string, status: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("connected_accounts").update({ status }).eq("id", id);
}

/** Persist a folder-id map (or any metadata patch) without clobbering siblings. */
export async function patchAccountMetadata(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("connected_accounts")
    .select("metadata")
    .eq("id", id)
    .maybeSingle();
  const current = ((data?.metadata as Record<string, unknown>) ?? {}) || {};
  await admin
    .from("connected_accounts")
    .update({ metadata: { ...current, ...patch } })
    .eq("id", id);
}

/**
 * Return a usable access token, refreshing (and persisting) if it's expired
 * or about to. Provider-generic: refresh uses the provider's OAuth config from
 * the registry. On refresh failure → status='reauth_required' + audit + throw.
 */
export async function getValidAccessToken(
  account: ConnectedAccountRow,
): Promise<string> {
  const aad = secretAad(account.provider, account.user_id);
  const notExpired =
    !!account.token_expiry &&
    Date.parse(account.token_expiry) - Date.now() > REFRESH_SKEW_MS;
  if (account.access_token_enc && notExpired) {
    return decryptSecret(account.access_token_enc, aad);
  }
  if (!account.refresh_token_enc) {
    await setAccountStatus(account.id, "reauth_required");
    throw new Error(`${account.provider} account has no refresh token — reconnect required.`);
  }
  const provider = getOAuthProvider(account.provider);
  const refreshToken = decryptSecret(account.refresh_token_enc, aad);
  try {
    const { accessToken, expiresInSec } = await refreshAccessToken(provider.oauth, refreshToken);
    const admin = createAdminClient();
    await admin
      .from("connected_accounts")
      .update({
        access_token_enc: encryptSecret(accessToken, aad),
        token_expiry: new Date(Date.now() + expiresInSec * 1000).toISOString(),
        status: "active",
      })
      .eq("id", account.id);
    return accessToken;
  } catch (err) {
    await setAccountStatus(account.id, "reauth_required");
    await logIntegrationAudit({
      userId: account.user_id,
      provider: account.provider,
      action: "reauth_required",
      connectedAccountId: account.id,
      detail: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

/**
 * Back-compat alias. Existing Drive callers (folders route, drive-sync,
 * ffmpeg-compose fallback) keep importing this name; it now delegates to the
 * generic, provider-agnostic implementation above.
 */
export const getValidDriveAccessToken = getValidAccessToken;

/** Disconnect: revoke at the provider (best-effort, via registry) then delete
 * the row. Provider-generic. */
export async function disconnectAccount(account: ConnectedAccountRow): Promise<void> {
  const aad = secretAad(account.provider, account.user_id);
  // Resolve the provider's OAuth config for revocation; tolerate unknown
  // providers (just delete the row).
  let oauthCfg: ReturnType<typeof getOAuthProvider>["oauth"] | null = null;
  try {
    oauthCfg = getOAuthProvider(account.provider).oauth;
  } catch {
    oauthCfg = null;
  }
  if (oauthCfg) {
    const enc = account.refresh_token_enc ?? account.access_token_enc;
    if (enc) {
      try {
        await revokeToken(oauthCfg, decryptSecret(enc, aad));
      } catch {
        // best-effort
      }
    }
  }
  const admin = createAdminClient();
  await admin.from("connected_accounts").delete().eq("id", account.id);
}
