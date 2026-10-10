// Cloudflare Pages middleware: stop repo-only files leaking from the publish root.
//
// This site deploys the repository root as the static asset directory, so
// files such as .gitignore, .git-hooks/*, marketing-truths.json and tests/*
// were publicly downloadable (verified by read-only GET, 2026-10-10).
// Cloudflare Pages `_redirects` does not support 404 rewrites ("Rewrites
// (other status codes) ❌" in the Pages redirects docs), so a true 404 needs
// a Function. `_routes.json` limits this middleware to the blocked paths and
// /api/*, so normal static pages are still served without invoking Functions.
//
// Keep BLOCKED_* in sync with `_routes.json` (asserted by tests/smoke_site.mjs).

const BLOCKED_PREFIXES = [
  "/.git-hooks/",
  "/.git/",
  "/.github/",
  "/.claude/",
  "/.wrangler/",
  "/functions/",
  "/tests/",
  "/docs/",
  "/tools/",
];

const BLOCKED_EXACT = [
  "/.gitignore",
  "/.nojekyll",
  "/marketing-truths.json",
  "/_routes.json",
  "/DEPLOYMENT.md",
  "/README.md",
];

const isBlocked = (path: string): boolean =>
  BLOCKED_EXACT.includes(path) || BLOCKED_PREFIXES.some((p) => path.startsWith(p));

interface Env {
  ASSETS: { fetch: (input: Request | string) => Promise<Response> };
}

export const onRequest: PagesFunction<Env> = async ({ request, next, env }) => {
  const url = new URL(request.url);
  if (!isBlocked(url.pathname)) {
    return next();
  }
  let body = "Not Found";
  let type = "text/plain; charset=utf-8";
  try {
    const page = await env.ASSETS.fetch(new URL("/404", url).toString());
    if (page.ok) {
      body = await page.text();
      type = "text/html; charset=utf-8";
    }
  } catch {
    // fall through to the plain-text 404
  }
  return new Response(body, {
    status: 404,
    headers: { "Content-Type": type, "X-Robots-Tag": "noindex", "Cache-Control": "no-store" },
  });
};
