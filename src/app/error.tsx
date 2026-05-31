"use client";

/**
 * Segment-level error boundary for the app shell.
 *
 * Next.js calls this when a server component or client component inside
 * the root layout throws an unhandled error. The root layout (and its
 * <Sidebar />) keeps rendering — only the segment's UI is replaced with
 * this fallback.
 *
 * Server-side throws from db/db-brands queries are already absorbed by
 * safe() wrappers, so this boundary mostly catches:
 *   - Client-side unhandled exceptions (Realtime payload with unexpected
 *     shape, dynamic import chunk failures, etc.)
 *   - Render-time React errors from third-party UI libs
 *
 * For root-level errors (e.g. layout itself crashes) see global-error.tsx.
 */
import { useEffect } from "react";
import { AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Loud log so Vercel runtime logs surface this for ops follow-up.
    // We don't include the full stack here (Next already does), just the
    // message + digest so it correlates with the "Application error: ..."
    // string the user would otherwise see.
    console.error(
      "[error-boundary]",
      error?.name ?? "Error",
      error?.message,
      "digest:",
      error?.digest ?? "(none)"
    );
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="glass-strong rounded-2xl p-8 max-w-md w-full text-center">
        <div
          className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
          style={{
            background:
              "linear-gradient(135deg, rgba(245,158,11,0.2), rgba(251,146,60,0.1))",
            border: "1px solid rgba(245,158,11,0.2)",
          }}
        >
          <AlertTriangle size={22} className="text-amber-400" />
        </div>

        <h1 className="text-xl font-bold text-white mb-1">
          Something went wrong
        </h1>
        <p className="text-sm text-white/55 mb-5 leading-relaxed">
          We hit an unexpected error rendering this page. The team has been
          notified via the runtime logs — try refreshing first; if it
          persists, go back to your brands.
        </p>

        {error?.digest && (
          <p className="text-[11px] text-white/35 mb-5 font-mono">
            Digest: <span className="text-white/55">{error.digest}</span>
          </p>
        )}

        <div className="flex gap-2 justify-center">
          <Button
            variant="gradient"
            size="sm"
            className="gap-1.5"
            onClick={() => reset()}
          >
            <RefreshCw size={13} />
            Try again
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => (window.location.href = "/brands")}
          >
            <ArrowLeft size={13} />
            Brands
          </Button>
        </div>
      </div>
    </div>
  );
}
