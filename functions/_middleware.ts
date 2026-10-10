// Cloudflare Pages middleware: stop repo-only files leaking from the publish root.
//
// Preferred fix is scripts/stage-publish.mjs (allow-listed dist/). Until the
// Pages project build output directory is dist/, this site still publishes
// the repository root, so this middleware stays the active layer.
//
// `_routes.json` includes `/*` and excludes only real static assets, so
// encoded and slash-variant paths reach this function. /api/* is not
// blocked and falls through to the waitlist function via next().

import { isBlockedPath } from "./block_path.js";

interface Env {
  ASSETS: { fetch: (input: Request | string) => Promise<Response> };
}

export const onRequest: PagesFunction<Env> = async ({ request, next, env }) => {
  const url = new URL(request.url);
  if (!isBlockedPath(url.pathname)) {
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
