import { SignOutButton } from "@clerk/nextjs";
import { ShieldX } from "lucide-react";
import { ALLOWED_EMAIL_DOMAINS } from "@/lib/domain-allowlist";
import { Button } from "@/components/ui/button";

export default function UnauthorizedDomainPage({
  email,
}: {
  email?: string;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="glass-strong rounded-2xl p-8 max-w-md text-center">
        <div
          className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
          style={{
            background:
              "linear-gradient(135deg, rgba(239,68,68,0.2), rgba(239,68,68,0.1))",
            border: "1px solid rgba(239,68,68,0.2)",
          }}
        >
          <ShieldX size={24} className="text-red-400" />
        </div>
        <h1 className="text-xl font-bold text-white mb-1">Access restricted</h1>
        <p className="text-sm text-white/55 mb-4 leading-relaxed">
          Ottoflow AI is currently invite-only — sign-ups are limited to
          authorized teammates.
        </p>

        {email && (
          <p className="text-xs text-white/40 mb-2">
            Signed in as{" "}
            <code className="text-white/70 bg-white/[0.04] px-1.5 py-0.5 rounded">
              {email}
            </code>
          </p>
        )}

        <p className="text-2xs text-white/35 mb-6">
          Allowed: {ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(", ")}
        </p>

        <SignOutButton redirectUrl="/sign-in">
          <Button variant="gradient" size="sm" className="w-full">
            Sign out
          </Button>
        </SignOutButton>
      </div>
    </div>
  );
}
