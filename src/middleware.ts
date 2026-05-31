import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public routes (no auth required).
// - sign-in/sign-up: obviously
// - /api/webhooks: external POSTs from Clerk/Supabase
// - favicon files: browsers fetch these unauthenticated; calling auth.protect()
//   on them just logs noisy 404s with "Clerk: auth() was called" warnings
const isPublic = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/favicon.ico",
  "/favicon.png",
  "/favicon(.*)",
  "/robots.txt",
  "/sitemap.xml",
  "/_next(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) {
    await auth.protect();
  }
});

export const config = {
  // Match all routes except static files + Next internals. The negative
  // lookahead skips /_next, common image/font/asset extensions, and the
  // explicit favicon patterns we still allow through above as a backstop.
  matcher: [
    "/((?!_next|favicon|robots\\.txt|sitemap\\.xml|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
