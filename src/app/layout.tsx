// IMPORTANT: env import must come first. It validates required environment
// variables at app boot and fails loudly if anything's missing — preferable
// to inscrutable 500s deep in a request handler. See src/lib/env.ts.
import "@/lib/env";

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { Sidebar } from "@/components/Sidebar";
import { SupabaseProvider } from "@/components/SupabaseProvider";
import { auth, currentUser } from "@clerk/nextjs/server";
import { isEmailDomainAllowed } from "@/lib/domain-allowlist";
import UnauthorizedDomainPage from "./unauthorized/page";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ottoflow AI — The AI Content Operating System",
  description:
    "AI-powered content command center: brand research, content strategy, video generation, publishing, and analytics.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();

  // Domain allowlist (audit standing order: ottoflow.ai-only access on free
  // Clerk plan). If signed in with a non-allowed domain, render the
  // unauthorized page in place of the app shell — they can sign out from
  // there. Public routes (sign-in/sign-up) are gated by middleware and never
  // hit a signed-in user here, so this check is safe to run unconditionally.
  let signedInEmail: string | null = null;
  let domainAllowed = true;
  if (userId) {
    try {
      const user = await currentUser();
      signedInEmail =
        user?.primaryEmailAddress?.emailAddress ??
        user?.emailAddresses?.[0]?.emailAddress ??
        null;
      domainAllowed = isEmailDomainAllowed(signedInEmail);
    } catch (err) {
      // Don't lock people out of the app if Clerk's API is having a moment —
      // log loudly so we notice, then allow through.
      console.error(
        "[layout] currentUser() failed during domain check, allowing:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#7c3aed",
          colorBackground: "#0a0a18",
          colorInputBackground: "rgba(255,255,255,0.04)",
          colorInputText: "#e2e8f0",
          colorText: "#e2e8f0",
          colorTextSecondary: "rgba(255,255,255,0.5)",
          borderRadius: "0.75rem",
        },
      }}
    >
      <html lang="en" className="dark">
        <body className={`${inter.variable} font-sans`}>
          <SupabaseProvider>
            {userId && !domainAllowed ? (
              <UnauthorizedDomainPage email={signedInEmail ?? undefined} />
            ) : userId ? (
              <div className="flex min-h-screen">
                <Sidebar />
                <main className="flex-1 ml-[220px] min-h-screen">{children}</main>
              </div>
            ) : (
              <main className="min-h-screen">{children}</main>
            )}
          </SupabaseProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
