"use client";

/**
 * Root-level error boundary — catches errors in the root layout itself
 * (the one place segment-level error.tsx can't reach because errors in
 * root layout break the very structure it's mounted into).
 *
 * MUST include its own <html> + <body> tags because at this point the
 * root layout has bailed out. We intentionally don't depend on Tailwind
 * here — if a CSS bundle failed to load, Tailwind classes might not
 * resolve. Inline styles only, so this always renders something readable.
 */
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      "[global-error]",
      error?.name ?? "Error",
      error?.message,
      "digest:",
      error?.digest ?? "(none)"
    );
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          background: "#0a0a18",
          color: "#e2e8f0",
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
        }}
      >
        <div
          style={{
            maxWidth: "28rem",
            width: "100%",
            textAlign: "center",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "1rem",
            padding: "2rem",
            backdropFilter: "blur(20px)",
          }}
        >
          <h1
            style={{
              fontSize: "1.25rem",
              fontWeight: 700,
              marginBottom: "0.5rem",
              color: "#fff",
            }}
          >
            Critical error
          </h1>
          <p
            style={{
              fontSize: "0.875rem",
              color: "rgba(255,255,255,0.55)",
              marginBottom: "1.25rem",
              lineHeight: 1.5,
            }}
          >
            The app crashed at the root level. This usually means a static
            asset failed to load — refreshing the page should recover.
          </p>
          {error?.digest && (
            <p
              style={{
                fontSize: "0.6875rem",
                color: "rgba(255,255,255,0.35)",
                marginBottom: "1.25rem",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              Digest: {error.digest}
            </p>
          )}
          <button
            onClick={() => reset()}
            style={{
              padding: "0.5rem 1.25rem",
              background:
                "linear-gradient(135deg, #E9863B, #F2A863)",
              color: "#fff",
              border: "none",
              borderRadius: "0.5rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
