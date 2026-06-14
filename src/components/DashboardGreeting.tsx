"use client";

import { useEffect, useState } from "react";

/**
 * Time-of-day-aware dashboard greeting. The name comes from the Clerk user
 * (passed by the server component, so there's no auth flash); the greeting
 * word is computed from the BROWSER's local hour on mount — server time is
 * UTC and would be wrong for the user's timezone. Starts at the neutral
 * "Welcome back" to avoid an SSR/client hydration mismatch, then refines.
 */
export function DashboardGreeting({ firstName }: { firstName: string }) {
  const [greeting, setGreeting] = useState("Welcome back");

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);

  return (
    <h1 className="text-2xl font-bold text-white tracking-tight">
      {greeting}
      {firstName ? `, ${firstName}` : ""} 👋
    </h1>
  );
}
