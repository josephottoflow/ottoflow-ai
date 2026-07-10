"use client";

import Link from "next/link";
import { useClerk } from "@clerk/nextjs";
import {
  Settings as SettingsIcon,
  User,
  Bell,
  Shield,
  Database,
  Plug,
  ChevronRight,
  ExternalLink,
} from "lucide-react";

type Section = {
  icon: React.ReactNode;
  color: string;
  bg: string;
  title: string;
  description: string;
  action?: () => void;
  actionLabel?: string;
  note?: string;
};

export default function SettingsPage() {
  const { openUserProfile } = useClerk();

  // Profile + Security are managed by Clerk's hosted account portal — wire the
  // cards straight to it so Settings is a working destination, not a dead stub.
  const sections: Section[] = [
    {
      icon: <User size={18} />,
      color: "#F2A863",
      bg: "rgba(233,134,59,0.12)",
      title: "Profile",
      description: "Name, email, avatar and connected accounts.",
      action: () => openUserProfile(),
      actionLabel: "Manage profile",
    },
    {
      icon: <Shield size={18} />,
      color: "#34d399",
      bg: "rgba(16,185,129,0.12)",
      title: "Security",
      description: "Password, two-factor authentication and active sessions.",
      action: () => openUserProfile(),
      actionLabel: "Manage security",
    },
    {
      icon: <Bell size={18} />,
      color: "#67e8f9",
      bg: "rgba(6,182,212,0.12)",
      title: "Notifications",
      description: "Email + in-app alerts for completed renders, research and approvals.",
      note: "Configurable in the v1 release",
    },
    {
      icon: <Database size={18} />,
      color: "#fb923c",
      bg: "rgba(251,146,60,0.12)",
      title: "Providers",
      description: "Gemini, Supabase, Redis, ElevenLabs — environment-managed for now.",
      note: "Environment-managed",
    },
  ];

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="mb-8 flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))",
            color: "rgba(244,237,226,0.65)",
          }}
        >
          <SettingsIcon size={17} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Settings</h1>
          <p className="text-white/40 text-sm mt-0.5">Workspace preferences and account</p>
        </div>
      </div>

      <Link
        href="/settings/integrations"
        className="glass rounded-2xl p-5 mb-4 flex items-center justify-between hover:bg-white/[0.04] transition-colors group"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[rgba(66,133,244,0.12)] text-[#8ab4f8]">
            <Plug size={18} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white mb-0.5">Integrations</h2>
            <p className="text-xs text-white/45">
              Connect Google Drive to save creatives &amp; videos. More platforms coming soon.
            </p>
          </div>
        </div>
        <ChevronRight size={18} className="text-white/30 group-hover:text-[#F2A863] transition-colors" />
      </Link>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {sections.map((s) => {
          const actionable = !!s.action;
          const Wrapper = actionable ? "button" : "div";
          return (
            <Wrapper
              key={s.title}
              {...(actionable
                ? { type: "button" as const, onClick: s.action }
                : {})}
              className={`glass rounded-2xl p-5 text-left w-full transition-colors group ${
                actionable ? "hover:bg-white/[0.04] cursor-pointer" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: s.bg, color: s.color }}
                >
                  {s.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-white mb-1">{s.title}</h2>
                    {s.note && (
                      <span className="text-3xs text-white/30 ml-auto flex-shrink-0">{s.note}</span>
                    )}
                  </div>
                  <p className="text-xs text-white/45 leading-relaxed">{s.description}</p>
                  {actionable && (
                    <span className="inline-flex items-center gap-1 text-2xs text-[#F2A863] mt-2 group-hover:gap-1.5 transition-all">
                      {s.actionLabel} <ExternalLink size={10} />
                    </span>
                  )}
                </div>
              </div>
            </Wrapper>
          );
        })}
      </div>

      <p className="text-xs text-white/30 mt-6 text-center">
        Profile &amp; security open your account portal. Notification and provider controls
        arrive with the v1 release.
      </p>
    </div>
  );
}
