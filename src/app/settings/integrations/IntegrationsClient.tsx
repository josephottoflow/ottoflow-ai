"use client";

/**
 * Integrations settings (Phase 3 / P1). Client-side: lists connected accounts
 * via /api/integrations, drives the Drive connect/disconnect flow, and shows
 * the Drive folder mapping. Tokens are never exposed — the list endpoint is
 * token-free and connect/callback happen via server redirects.
 */
import { useCallback, useEffect, useState } from "react";
import {
  HardDrive,
  Check,
  AlertTriangle,
  Loader2,
  Plug,
  FolderTree,
  Linkedin,
  Building2,
} from "lucide-react";

interface SafeAccount {
  id: string;
  provider: string;
  account_id: string;
  account_name: string | null;
  status: string;
  metadata: { folders?: Record<string, string> } & Record<string, unknown>;
  created_at: string;
}

interface DestinationLite {
  id: string;
  name: string;
  type: string;
}

const FOLDER_LABELS: Record<string, string> = {
  brand_assets: "Brand Assets",
  creatives: "Generated Creatives",
  videos: "Generated Videos",
  reports: "Reports",
};

export default function IntegrationsClient({
  connected,
  error,
}: {
  connected: string | null;
  error: string | null;
}) {
  const [accounts, setAccounts] = useState<SafeAccount[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [folders, setFolders] = useState<Record<string, string> | null>(null);
  const [destinations, setDestinations] = useState<DestinationLite[] | null>(null);
  const [notice, setNotice] = useState<string | null>(
    connected ? `Connected ${connected.replace("_", " ")}.` : null,
  );
  const [problem, setProblem] = useState<string | null>(
    error ? `Connection failed: ${error.replace(/_/g, " ")}.` : null,
  );

  const load = useCallback(async () => {
    const res = await fetch("/api/integrations");
    if (res.ok) {
      const j = (await res.json()) as { accounts: SafeAccount[] };
      setAccounts(j.accounts);
    } else {
      setAccounts([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const drive = accounts?.find((a) => a.provider === "google_drive") ?? null;
  const linkedin = accounts?.find((a) => a.provider === "linkedin") ?? null;

  useEffect(() => {
    if (drive?.metadata?.folders) setFolders(drive.metadata.folders);
  }, [drive]);

  const discoverDestinations = async (id: string) => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/integrations/${id}/destinations`);
      if (!res.ok) throw new Error((await res.json()).error ?? "Destination discovery failed");
      const j = (await res.json()) as { destinations: DestinationLite[] };
      setDestinations(j.destinations);
      setNotice(`Found ${j.destinations.length} destination(s).`);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Destination discovery failed");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (id: string) => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/integrations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Disconnect failed");
      setFolders(null);
      setNotice("Disconnected.");
      await load();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  };

  const setupFolders = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/integrations/google_drive/folders");
      if (!res.ok) throw new Error((await res.json()).error ?? "Folder setup failed");
      const j = (await res.json()) as { folders: Record<string, string> };
      setFolders(j.folders);
      setNotice("Drive folders ready.");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Folder setup failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-[900px] mx-auto">
      <div className="mb-8 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-white/[0.06] text-white/60">
          <Plug size={17} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Integrations</h1>
          <p className="text-white/40 text-sm mt-0.5">
            Connect external accounts to save and (soon) publish your content.
          </p>
        </div>
      </div>

      {notice && (
        <div className="mb-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20">
          <Check size={15} /> {notice}
        </div>
      )}
      {problem && (
        <div className="mb-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle size={15} /> {problem}
        </div>
      )}

      {/* ── Google Drive ─────────────────────────────────────────────── */}
      <div className="glass rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[rgba(66,133,244,0.12)] text-[#8ab4f8]">
              <HardDrive size={18} />
            </div>
            <div>
              <div className="text-white font-semibold">Google Drive</div>
              <div className="text-white/40 text-sm mt-0.5">
                Save generated creatives & videos to your Drive (scope:{" "}
                <code className="text-white/55">drive.file</code> — only files Ottoflow creates).
              </div>
            </div>
          </div>

          {accounts === null ? (
            <Loader2 className="animate-spin text-white/40" size={18} />
          ) : drive ? (
            <StatusPill status={drive.status} />
          ) : null}
        </div>

        {accounts !== null && (
          <div className="mt-4 pt-4 border-t border-white/[0.06]">
            {drive ? (
              <div className="space-y-4">
                <div className="text-sm text-white/60">
                  Connected as{" "}
                  <span className="text-white/90">{drive.account_name ?? drive.account_id}</span>
                </div>

                <div>
                  <div className="flex items-center gap-2 text-white/50 text-xs uppercase tracking-wide mb-2">
                    <FolderTree size={13} /> Folder mapping
                  </div>
                  {folders ? (
                    <div className="grid grid-cols-2 gap-2">
                      {Object.keys(FOLDER_LABELS).map((k) => (
                        <div
                          key={k}
                          className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2"
                        >
                          <div className="text-white/80 text-sm">{FOLDER_LABELS[k]}</div>
                          <div className="text-white/30 text-2xs truncate">
                            {folders[k] ? `id: ${folders[k]}` : "not set"}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <button
                      onClick={setupFolders}
                      disabled={busy}
                      className="text-sm px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white/80 disabled:opacity-50"
                    >
                      {busy ? "Setting up…" : "Set up Ottoflow folders"}
                    </button>
                  )}
                </div>

                <button
                  onClick={() => disconnect(drive.id)}
                  disabled={busy}
                  className="text-sm px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/20 disabled:opacity-50"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <a
                href="/api/integrations/google_drive/connect"
                className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-white font-medium"
              >
                <Plug size={15} /> Connect Google Drive
              </a>
            )}
          </div>
        )}
      </div>

      {/* ── LinkedIn ──────────────────────────────────────────────────── */}
      <div className="glass rounded-2xl p-5 mt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[rgba(10,102,194,0.14)] text-[#70b5f9]">
              <Linkedin size={18} />
            </div>
            <div>
              <div className="text-white font-semibold">LinkedIn</div>
              <div className="text-white/40 text-sm mt-0.5">
                Connect your profile and company pages. Publishing arrives in a later phase.
              </div>
            </div>
          </div>
          {accounts === null ? (
            <Loader2 className="animate-spin text-white/40" size={18} />
          ) : linkedin ? (
            <StatusPill status={linkedin.status} />
          ) : null}
        </div>

        {accounts !== null && (
          <div className="mt-4 pt-4 border-t border-white/[0.06]">
            {linkedin ? (
              <div className="space-y-4">
                <div className="text-sm text-white/60">
                  Connected as{" "}
                  <span className="text-white/90">
                    {linkedin.account_name ?? linkedin.account_id}
                  </span>
                </div>

                <div>
                  <div className="flex items-center gap-2 text-white/50 text-xs uppercase tracking-wide mb-2">
                    <Building2 size={13} /> Destinations
                  </div>
                  {destinations ? (
                    destinations.length > 0 ? (
                      <div className="space-y-1.5">
                        {destinations.map((d) => (
                          <div
                            key={d.id}
                            className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2 flex items-center justify-between"
                          >
                            <span className="text-white/80 text-sm">{d.name}</span>
                            <span className="text-white/30 text-2xs">{d.type}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-white/40 text-sm">No destinations found.</div>
                    )
                  ) : (
                    <button
                      onClick={() => discoverDestinations(linkedin.id)}
                      disabled={busy}
                      className="text-sm px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white/80 disabled:opacity-50"
                    >
                      {busy ? "Discovering…" : "Discover destinations"}
                    </button>
                  )}
                </div>

                <button
                  onClick={() => disconnect(linkedin.id)}
                  disabled={busy}
                  className="text-sm px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/20 disabled:opacity-50"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <a
                href="/api/integrations/linkedin/connect"
                className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-white font-medium"
              >
                <Plug size={15} /> Connect LinkedIn
              </a>
            )}
          </div>
        )}
      </div>

      <p className="text-white/30 text-xs mt-6">
        More integrations (Facebook, Instagram, X, YouTube, Gmail) are coming in later phases.
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    active: { cls: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20", label: "Connected" },
    reauth_required: {
      cls: "text-amber-300 bg-amber-500/10 border-amber-500/20",
      label: "Reconnect needed",
    },
    revoked: { cls: "text-white/50 bg-white/[0.05] border-white/10", label: "Revoked" },
    error: { cls: "text-red-300 bg-red-500/10 border-red-500/20", label: "Error" },
  };
  const s = map[status] ?? map.error;
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full border ${s.cls}`}>{s.label}</span>
  );
}
