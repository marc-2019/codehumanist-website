#!/usr/bin/env node
// Allow-listed publish directory for Cloudflare Pages.
//
// The same idea as a stage-publish step: copy only public pages and assets
// into dist/. Functions stay at the repository root (Pages compiles
// /functions from the project, not from the output directory).
//
// instilligent-website does not currently contain scripts/stage-publish.mjs
// (checked main and cpo/company-site-claims-1010). This script follows that
// described pattern for this site.
//
// Do not commit a wrangler.toml with pages_build_output_dir. Pages treats
// that key as the project source of truth and the preview build fails
// while dist/ is produced only by this script. Needs Marc, in the dashboard:
//   Build command: node scripts/stage-publish.mjs
//   Build output directory: dist
// Confirm dashboard env vars (RESEND_API_KEY) still reach the waitlist
// function before switching. Until then, functions/_middleware.ts is the
// active leak block and the publish directory stays the repository root.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

const ROOT_FILES = [
  "index.html",
  "404.html",
  "500.html",
  "llms.txt",
  "robots.txt",
  "sitemap.xml",
  "_headers",
  "_redirects",
  "_routes.json",
  "favicon.ico",
  "favicon.png",
  "favicon.svg",
];

const REQUIRED = [
  "index.html",
  "404.html",
  "500.html",
  "llms.txt",
  "robots.txt",
  "sitemap.xml",
  "_headers",
  "_redirects",
  "_routes.json",
  "css/style.css",
  "js/main.js",
  "pages/privacy.html",
];

const ASSET_EXT = new Set([
  ".css", ".js", ".map",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".avif",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
]);

const COPY_DIRS = ["css", "js", "pages", "images", "img", "fonts"];

const extname = (name) => {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
};

const allowFile = (dir, name) => {
  if (dir === "pages") return name.toLowerCase().endsWith(".html");
  return ASSET_EXT.has(extname(name));
};

const copyTree = (srcDir, destDir, dirKey) => {
  if (!existsSync(srcDir)) return;
  for (const name of readdirSync(srcDir)) {
    if (name.startsWith(".")) continue;
    const from = join(srcDir, name);
    const to = join(destDir, name);
    if (statSync(from).isDirectory()) {
      copyTree(from, to, dirKey);
      continue;
    }
    if (!allowFile(dirKey, name)) continue;
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const file of ROOT_FILES) {
  const src = join(root, file);
  if (!existsSync(src) || !statSync(src).isFile()) continue;
  cpSync(src, join(dist, file));
}

for (const dir of COPY_DIRS) {
  copyTree(join(root, dir), join(dist, dir), dir);
}

const missing = REQUIRED.filter((rel) => !existsSync(join(dist, rel)));
if (missing.length) {
  console.error(`stage-publish: required public files missing from dist: ${missing.join(", ")}`);
  process.exit(1);
}

const forbidden = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(dist, full).split("\\").join("/");
    if (statSync(full).isDirectory()) {
      if (name.startsWith(".") || ["tests", "functions", "docs", "tools", "e2e", "scripts"].includes(name)) {
        forbidden.push(rel);
      }
      walk(full);
      continue;
    }
    if (
      name.startsWith(".") ||
      name === "marketing-truths.json" ||
      name.toLowerCase().endsWith(".md") ||
      name.endsWith(".ts") ||
      name.endsWith(".mjs")
    ) {
      forbidden.push(rel);
    }
  }
};
walk(dist);
if (forbidden.length) {
  console.error(`stage-publish: allow-list leaked internal files: ${forbidden.join(", ")}`);
  process.exit(1);
}

console.log(`stage-publish: wrote ${dist}`);
