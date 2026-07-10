import Link from "next/link";
import { Settings as SettingsIcon, User, Bell, Shield, Database, Plug, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const sections = [
  {
    icon: <User size={18} />,
    color: "#F2A863",
    bg: "rgba(233,134,59,0.12)",
    title: "Profile",
    description: "Name, email, avatar, timezone — managed via Clerk for now.",
  },
  {
    icon: <Bell size={18} />,
    color: "#67e8f9",
    bg: "rgba(6,182,212,0.12)",
    title: "Notifications",
    description: "Email + in-app alerts for completed renders, brand research, approvals.",
  },
  {
    icon: <Shield size={18} />,
    color: "#34d399",
    bg: "rgba(16,185,129,0.12)",
    title: "Security",
    description: "2FA, active sessions, API tokens — managed via Clerk dashboard.",
  },
  {
    icon: <Database size={18} />,
    color: "#fb923c",
    bg: "rgba(251,146,60,0.12)",
    title: "Integrations",
    description: "Supabase, Gemini, Redis (BullMQ), Veo, ElevenLabs — environment-managed.",
  },
];

export default function SettingsPage() {
  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="mb-8 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))",
              color: "rgba(255,255,255,0.6)",
            }}
          >
            <SettingsIcon size={17} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Settings</h1>
            <p className="text-white/40 text-sm mt-0.5">Workspace preferences and account</p>
          </div>
        </div>
        <Badge variant="purple" className="text-2xs">Coming soon</Badge>
      </div>

      <Link
        href="/settings/integrations"
        className="glass rounded-2xl p-5 mb-4 flex items-center justify-between hover:bg-white/[0.04] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[rgba(66,133,244,0.12)] text-[#8ab4f8]">
            <Plug size={18} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white mb-0.5">Integrations</h2>
            <p className="text-xs text-white/45">Connect Google Drive to save creatives & videos. More platforms coming soon.</p>
          </div>
        </div>
        <ChevronRight size={18} className="text-white/30" />
      </Link>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {sections.map((s) => (
          <div key={s.title} className="glass rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: s.bg, color: s.color }}
              >
                {s.icon}
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white mb-1">{s.title}</h2>
                <p className="text-xs text-white/45 leading-relaxed">{s.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-white/30 mt-6 text-center">
        Full settings UI lands with the v1 release. For now most controls are managed
        in their respective provider dashboards (Clerk, Supabase).
      </p>
    </div>
  );
}
