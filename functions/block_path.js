// Normalise a request path before the publish-root blocklist.
//
// Cloudflare Pages matches `_routes.json` and static files on the raw
// request path, so `%2e`, mixed case, and `//` can address the same asset
// the literal blocklist misses. Decode until the string stops changing
// (malformed escapes stop the loop), then lower-case and collapse a
// leading `//` plus any repeated slashes. Each segment then loses
// trailing dots, trailing spaces, and `;` parameters, so `file.json.`,
// `file.json%2e`, and `file%3b` match `file`. A basename prefix blocks
// anything starting with `marketing-truths`.

export const DECODE_LIMIT = 8;

const BASENAME_PREFIXES = ["marketing-truths"];

// No markdown file is a public page. llms.txt is the public text file.
export const ALLOWED_PUBLIC_MD = new Set();

const BLOCKED_DIRS = new Set([
  ".git-hooks",
  "docs",
  "tools",
  "e2e",
  "tests",
  "scripts",
  "functions",
]);

const BLOCKED_BASENAMES = new Set([
  "_routes.json",
]);

function cleanSegment(segment) {
  let s = segment;
  for (let i = 0; i < DECODE_LIMIT; i++) {
    const cut = s.split(";")[0].replace(/[.\s]+$/g, "");
    if (cut === s) return cut;
    s = cut;
  }
  return s;
}

export function normalizePath(pathname) {
  let p = String(pathname ?? "");
  for (let i = 0; i < DECODE_LIMIT; i++) {
    let decoded;
    try {
      decoded = decodeURIComponent(p);
    } catch {
      break;
    }
    if (decoded === p) break;
    p = decoded;
  }
  p = p.toLowerCase().replace(/\/{2,}/g, "/");
  const segments = p.split("/").map(cleanSegment).filter(Boolean);
  return `/${segments.join("/")}`;
}

export function isBlockedPath(pathname) {
  const p = normalizePath(pathname);
  if (p === "/api" || p.startsWith("/api/")) return false;

  const segments = p.split("/").filter(Boolean);
  for (const seg of segments) {
    if (seg.startsWith(".")) return true;
    if (BLOCKED_DIRS.has(seg)) return true;
    if (BLOCKED_BASENAMES.has(seg)) return true;
    if (BASENAME_PREFIXES.some((prefix) => seg.startsWith(prefix))) return true;
  }

  const base = segments[segments.length - 1] || "";
  if (base.endsWith(".md") && !ALLOWED_PUBLIC_MD.has(p)) return true;
  return false;
}
