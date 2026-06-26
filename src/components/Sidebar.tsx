"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
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
  CreditCard,
  Bell,
  HelpCircle,
  BarChart3,
  Briefcase,
  Megaphone,
  Menu,
  X,
} from "lucide-react";

const navItems: {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  soon?: boolean;
}[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Brands", href: "/brands", icon: Briefcase },
  { label: "Campaigns", href: "/campaigns", icon: Megaphone },
  { label: "Content Pipeline", href: "/content", icon: FileText },
  { label: "Video Pipeline", href: "/video", icon: Video },
  // Projects isn't built yet (the page is an empty "New Project · Soon" stub) —
  // flag it so users don't hit a dead end expecting a working feature.
  { label: "Projects", href: "/projects", icon: FolderOpen, soon: true },
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

  // Mobile drawer state. On lg+ the sidebar is always docked; below lg it
  // slides in over a backdrop. Close it whenever the route changes so a tap
  // navigates AND dismisses.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const displayName =
    user?.firstName ?? user?.username ?? user?.emailAddresses[0]?.emailAddress ?? "You";

  return (
    <>
      {/* Mobile hamburger — opens the drawer (hidden on lg+) */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={open}
        className="lg:hidden fixed top-3 left-3 z-50 w-9 h-9 rounded-lg flex items-center justify-center border border-white/10"
        style={{ background: "rgba(5,5,20,0.85)", backdropFilter: "blur(12px)" }}
      >
        <Menu size={16} className="text-white/70" />
      </button>

      {/* Backdrop (mobile only, when open) */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 h-screen w-[220px] flex flex-col z-50 border-r border-white/[0.04] transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:translate-x-0",
        )}
        style={{ background: "rgba(5, 5, 20, 0.9)", backdropFilter: "blur(20px)" }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-5 border-b border-white/[0.04]">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-to-br from-violet-600 to-indigo-500">
            <Zap size={14} className="text-white" />
          </div>
          <div>
            <span className="text-sm font-bold text-white tracking-tight">Ottoflow</span>
            <span className="text-3xs text-violet-400 font-medium block -mt-0.5">
              AI Platform
            </span>
          </div>
          {/* Close (mobile only) */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation menu"
            className="lg:hidden ml-auto text-white/40 hover:text-white/70 transition-colors"
          >
            <X size={16} />
          </button>
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
                {item.soon && (
                  <span className="ml-auto text-3xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.06] text-white/35">
                    Soon
                  </span>
                )}
                {active && !item.soon && <ChevronRight size={12} className="ml-auto opacity-50" />}
              </Link>
            );
          })}

          {/* Quick actions */}
          <div className="pt-3 pb-1">
            <p className="px-3 text-3xs font-semibold uppercase tracking-widest text-white/25 mb-2">
              Quick Start
            </p>
            <Link
              href="/brands/new"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150 bg-violet-600/[0.08] border border-violet-600/15 text-violet-400"
            >
              <Briefcase size={13} />
              Research a Brand
            </Link>
            {/* Legacy "Generate Video" (Script→Voice→Footage) removed from primary
                nav. Canonical video path is Content → Creative brief → the gated
                "Generate Video" button on a content item. The legacy page remains
                reachable at /video/generate (labeled Legacy) but is de-emphasized. */}
            <Link
              href="/content/generate"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150 mt-1 bg-fuchsia-500/[0.08] border border-fuchsia-500/15 text-fuchsia-400"
            >
              <FileText size={13} />
              Generate Post
            </Link>
            {/* Canonical Video V1 path. Routes to the /video/start resolver →
                latest eligible content item's Generate Video section (NOT the
                legacy /video/generate stock-footage page). Discoverability only. */}
            <Link
              href="/video/start"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150 mt-1 bg-cyan-500/[0.08] border border-cyan-500/15 text-cyan-400"
            >
              <Video size={13} />
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
              <p className="text-3xs text-white/35 truncate">Pro Plan</p>
            </div>
            <Bell size={13} className="text-white/30 flex-shrink-0" aria-label="Notifications" />
          </div>
        </div>
      </aside>
    </>
  );
}
