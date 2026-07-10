import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center px-6">
      <div className="text-6xl font-bold text-gradient">404</div>
      <h2 className="text-xl font-semibold text-white">Page not found</h2>
      <p className="text-white/40 text-sm max-w-xs">This page doesn&apos;t exist yet. Head back to the dashboard.</p>
      <Link href="/"
        className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white transition-all"
        style={{ background: "linear-gradient(135deg, #E9863B, #F2A863)", boxShadow: "0 4px 14px rgba(233,134,59,0.3)" }}>
        Back to Dashboard
      </Link>
    </div>
  );
}
