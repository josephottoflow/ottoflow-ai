import {
  HelpCircle,
  BookOpen,
  MessageSquare,
  Mail,
  ExternalLink,
  Zap,
  Briefcase,
  Video,
} from "lucide-react";

const guides = [
  {
    icon: <Briefcase size={16} />,
    color: "#a78bfa",
    title: "Researching your first brand",
    description:
      "Drop a name + website. Ottoflow fetches the homepage, extracts positioning, finds competitors, and generates SEO keywords + content pillars.",
    href: "/brands/new",
    label: "Start →",
  },
  {
    icon: <Zap size={16} />,
    color: "#fbbf24",
    title: "Understanding credits",
    description:
      "Each brand-research run uses ~50 credits (Gemini Flash + Google Search grounding). Video generation costs vary by length.",
    href: "/billing",
    label: "View plan →",
  },
  {
    icon: <Video size={16} />,
    color: "#67e8f9",
    title: "Generating videos",
    description:
      "Once Content Strategy and Veo integration land, you'll generate from a brand's pillars directly. Currently in development.",
    href: null,
    label: "Coming soon",
  },
];

export default function HelpPage() {
  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="mb-8 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, rgba(124,58,237,0.2), rgba(99,102,241,0.1))",
              color: "#a78bfa",
            }}
          >
            <HelpCircle size={17} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Help</h1>
            <p className="text-white/40 text-sm mt-0.5">Quick guides and how to reach us</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-8">
        {guides.map((g) => (
          <div key={g.title} className="glass rounded-2xl p-5 flex flex-col">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center mb-3"
              style={{ background: `${g.color}22`, color: g.color }}
            >
              {g.icon}
            </div>
            <h2 className="text-sm font-semibold text-white mb-2">{g.title}</h2>
            <p className="text-xs text-white/50 leading-relaxed mb-4 flex-1">
              {g.description}
            </p>
            {g.href ? (
              <a
                href={g.href}
                className="text-xs font-medium hover:opacity-80 transition-opacity"
                style={{ color: g.color }}
              >
                {g.label}
              </a>
            ) : (
              <span className="text-xs text-white/30">{g.label}</span>
            )}
          </div>
        ))}
      </div>

      <div className="glass rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-white mb-4">Get in touch</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <a
            href="https://docs.ottoflow.ai"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.03] transition-colors border border-white/[0.04]"
          >
            <BookOpen size={16} className="text-violet-400" />
            <div className="flex-1">
              <div className="text-xs font-medium text-white">Docs</div>
              <div className="text-2xs text-white/35">docs.ottoflow.ai</div>
            </div>
            <ExternalLink size={11} className="text-white/30" />
          </a>
          <a
            href="https://discord.gg/ottoflow"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.03] transition-colors border border-white/[0.04]"
          >
            <MessageSquare size={16} className="text-cyan-400" />
            <div className="flex-1">
              <div className="text-xs font-medium text-white">Community</div>
              <div className="text-2xs text-white/35">Discord</div>
            </div>
            <ExternalLink size={11} className="text-white/30" />
          </a>
          <a
            href="mailto:support@ottoflow.ai"
            className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.03] transition-colors border border-white/[0.04]"
          >
            <Mail size={16} className="text-emerald-400" />
            <div className="flex-1">
              <div className="text-xs font-medium text-white">Email support</div>
              <div className="text-2xs text-white/35">support@ottoflow.ai</div>
            </div>
            <ExternalLink size={11} className="text-white/30" />
          </a>
        </div>
      </div>
    </div>
  );
}
