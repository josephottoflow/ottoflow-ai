// IMPORTANT: env import must come first. It validates required environment
// variables at app boot and fails loudly if anything's missing — preferable
// to inscrutable 500s deep in a request handler. See src/lib/env.ts.
// (Named import still runs the module's validation side-effect.)
import { publicEnv } from "@/lib/env";

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
  // The root layout runs for *every* request — including static-asset paths
  // like `/favicon.ico` and `/robots.txt` that are intentionally excluded
  // from the Clerk middleware matcher (see middleware.ts). For those
  // requests Clerk's `auth()` throws "auth() was called but Clerk can't
  // detect usage of clerkMiddleware()", which then becomes an unhandled
  // server-side error per request.
  //
  // Verified in production via Sentry (issue JAVASCRIPT-NEXTJS-2): the
  // failing transaction was "Layout Server Component (/)" with the request
  // URL pointing at /favicon.ico, firing on essentially every favicon
  // fetch. Treating the throw as "no user" is correct — those requests
  // have no auth context and don't render the authenticated shell anyway.
  let userId: string | null = null;
  try {
    userId = (await auth()).userId;
  } catch (err) {
    console.error(
      "[layout] auth() threw — likely a static-asset request bypassing middleware:",
      err instanceof Error ? err.message : err,
    );
  }

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
    // Feed Clerk from our env module (not its implicit process.env read):
    // NEXT_PUBLIC_* are build-time inlined, so on a build environment without
    // the var (e.g. Preview scope) Clerk's implicit read is empty and it
    // throws "Missing publishableKey" while prerendering /_not-found. Our
    // env module supplies the build-phase placeholder there and the real
    // key at runtime — same value in Production (var present).
    <ClerkProvider
      publishableKey={publicEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
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
                {/* Sidebar is docked at lg+; below lg it's an off-canvas
                    drawer, so the content takes the full width there. */}
                <main className="flex-1 lg:ml-[220px] min-h-screen">{children}</main>
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
