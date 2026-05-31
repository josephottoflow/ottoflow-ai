/**
 * Email-domain allowlist for sign-ups.
 *
 * Clerk's native Allowlist is a Pro-plan feature. On the free plan we enforce
 * this at the app layer: layout.tsx fetches the signed-in user, checks their
 * primary email domain against this list, and renders <UnauthorizedDomain />
 * instead of the app shell if the domain isn't on the allowlist.
 *
 * Configured via the ALLOWED_EMAIL_DOMAINS env var (comma-separated). Falls
 * back to "ottoflow.ai" so a misconfigured env doesn't accidentally open the
 * app to the public.
 */

const DEFAULT_DOMAINS = ["ottoflow.ai"];

function parseDomains(raw: string | undefined): string[] {
  if (!raw) return DEFAULT_DOMAINS;
  const parsed = raw
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_DOMAINS;
}

export const ALLOWED_EMAIL_DOMAINS = parseDomains(
  process.env.ALLOWED_EMAIL_DOMAINS
);

/**
 * True if the email's domain (case-insensitive) matches any entry in the
 * allowlist. Subdomains are NOT matched implicitly — `me@x.ottoflow.ai`
 * needs `x.ottoflow.ai` to be listed explicitly.
 */
export function isEmailDomainAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return ALLOWED_EMAIL_DOMAINS.includes(domain);
}
