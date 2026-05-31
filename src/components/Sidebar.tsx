"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { UserButton, useUser } from "@clerk/nextjs";
import {
  LayoutDashboard,
  FileText,
  Video,
  FolderOpen,
  Settings,
  Zap,
  ChevronRight,
  Sparkles,
  CreditCard,
  Bell,
  HelpCircle,
  BarChart3,
  Briefcase,
} from "lucide-react";

const navItems = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Brands", href: "/brands", icon: Briefcase },
  { label: "Content Pipeline", href: "/content", icon: FileText },
  { label: "Video Pipeline", href: "/video", icon: Video },
  { label: "Projects", href: "/projects", icon: FolderOpen },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
];

const bottomItems = [
  { label: "Billing", href: "/billing", icon: CreditCard },
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "Help", href: "/help", icon: HelpCircle },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useUser();

  const displayName =
    user?.firstName ?? user?.username ?? user?.emailAddresses[0]?.emailAddress ?? "You";

  return (
    <aside
      className="fixed left-0 top-0 h-screen w-[220px] flex flex-col z-40 border-r border-white/[0.04]"
      style={{ background: "rgba(5, 5, 20, 0.9)", backdropFilter: "blur(20px)" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-5 border-b border-white/[0.04]">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #7c3aed, #6366f1)" }}
        >
          <Zap size={14} className="text-white" />
        </div>
        <div>
          <span className="text-sm font-bold text-white tracking-tight">Ottoflow</span>
          <span className="text-[10px] text-violet-400 font-medium block -mt-0.5">
            AI Platform
          </span>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-2.5 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn("nav-item", active && "active")}
            >
              <Icon size={15} />
              {item.label}
              {active && <ChevronRight size={12} className="ml-auto opacity-50" />}
            </Link>
          );
        })}

        {/* Quick actions */}
        <div className="pt-3 pb-1">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-white/25 mb-2">
            Quick Start
          </p>
          <Link
            href="/brands/new"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150"
            style={{
              background: "rgba(124, 58, 237, 0.08)",
              border: "1px solid rgba(124, 58, 237, 0.15)",
              color: "#a78bfa",
            }}
          >
            <Briefcase size={13} />
            Research a Brand
          </Link>
          <Link
            href="/video/generate"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150 mt-1"
            style={{
              background: "rgba(6, 182, 212, 0.08)",
              border: "1px solid rgba(6, 182, 212, 0.15)",
              color: "#67e8f9",
            }}
          >
            <Sparkles size={13} />
            Generate Video
          </Link>
        </div>
      </nav>

      {/* Bottom nav */}
      <nav className="px-2.5 py-2 border-t border-white/[0.04] space-y-0.5">
        {bottomItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="nav-item">
              <Icon size={14} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-3 py-3 border-t border-white/[0.04]">
        <div className="flex items-center gap-2.5">
          <UserButton
            afterSignOutUrl="/sign-in"
            appearance={{
              elements: {
                avatarBox: "w-7 h-7",
              },
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-white/80 truncate">{displayName}</p>
            <p className="text-[10px] text-white/35 truncate">Pro Plan</p>
          </div>
          <Bell size={13} className="text-white/30 flex-shrink-0" />
        </div>
      </div>
    </aside>
  );
}
