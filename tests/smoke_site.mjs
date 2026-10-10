// CodeHumanist site smoke checks (no dependencies): `node --test tests/smoke_site.mjs`
// Optional live check (read-only GETs): LIVE=1 node --test tests/smoke_site.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isBlockedPath, normalizePath } from '../functions/block_path.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const SURFACES = ['index.html', 'llms.txt', 'pages/privacy.html', '404.html', '500.html'];

const BANNED = [
  ['compliance-ready', /compliance[- ]ready/i],
  ['audit-ready', /audit[- ]ready/i],
  ['executive-ready', /executive[- ]ready/i],
  ['without developer involvement', /without developer involvement/i],
  ['certified / certification claim', /\bcertified\b|\bcertification\b/i],
  ['guaranteed', /\bguarantee(d)?\b/i],
  ['AI-powered', /AI[- ]powered/i],
  ['enterprise-grade', /enterprise[- ]grade/i],
  ['invented 73% stat', /\b73\s*(<[^>]*>)?\s*%/],
  ['invented 4x onboarding stat', /\b4\s*(<[^>]*>)?\s*×/],
  ['testimonial', /testimonial|trusted by/i],
  ['Southeast Asia', /Southeast Asia/i],
  ['never modifies (unaudited absolute)', /never<\/strong> modifies|No code changes\. Ever/i],
];

for (const f of SURFACES) {
  test(`${f}: banned claims absent`, () => {
    const t = read(f);
    const hits = BANNED.filter(([, re]) => re.test(t)).map(([n]) => n);
    assert.deepEqual(hits, [], `${f} contains: ${hits.join(', ')}`);
  });
}

test('waitlist framing kept on homepage and llms.txt', () => {
  assert.match(read('index.html'), /Join the Waitlist/);
  assert.match(read('index.html'), /early access/i);
  assert.match(read('llms.txt'), /waitlist/i);
});

test('no prices presented on public surfaces (product not on sale)', () => {
  for (const f of ['index.html', 'llms.txt']) {
    assert.doesNotMatch(read(f), /NZ\$\s?\d|\$\s?(29|59|149|9|2\.50)\b|\/mo\b|per month|subscribe/i, f);
  }
});

const BLOCKED = [
  '/.git-hooks/README.md', '/.git-hooks/marketing-truth-lint.sh', '/.gitignore', '/.nojekyll',
  '/marketing-truths.json', '/tests/smoke_site.mjs', '/functions/api/waitlist.ts', '/_routes.json',
];

const ENCODED_BLOCKED = [
  '/%2egitignore',
  '/%2Enojekyll',
  '/%6Darketing-truths.json',
  '/.git-hooks%2FREADME.md',
  '/.GIT-HOOKS/README.md',
  '/marketing-truths.json.',
  '/marketing-truths.json%2e',
  '/.gitignore%3b',
];

const SLASH_VARIANTS = [
  '//.gitignore',
  '///.gitignore',
  '/.git-hooks//README.md',
  '//tests/smoke_site.mjs',
  '/tests//smoke_site.mjs',
];

const TESTS_PATHS = [
  '/tests/smoke_site.mjs',
  '/tests/',
  '/tests',
  '//tests/smoke_site.mjs',
  '/%74ests/smoke_site.mjs',
];

const FUNCTION_PATHS = [
  '/functions/block_path.js',
  '/functions/_middleware.ts',
  '/functions/api/waitlist.ts',
];

const PUBLIC_EXACT = [
  '/',
  '/index.html',
  '/404.html',
  '/500.html',
  '/pages/privacy.html',
  '/css/style.css',
  '/js/main.js',
  '/llms.txt',
  '/robots.txt',
  '/sitemap.xml',
];

const INDEX_PRESENT_TENSE = [
  ['never modified', /never modified/i],
  ['we connect', /\bwe connect\b/i],
  ['is built to be', /is built to be/i],
  ['tokens are requested', /tokens are requested/i],
  ['audit pending', /audit pending/i],
  ['static analysis (by design)', /static analysis \(by design\)/i],
  ['security audit has not', /security audit has not/i],
  ['it reads your code', /it reads your code/i],
];

test('index.html: present-tense live-product claims absent', () => {
  const t = read('index.html');
  const hits = INDEX_PRESENT_TENSE.filter(([, re]) => re.test(t)).map(([n]) => n);
  assert.deepEqual(hits, [], `index.html contains: ${hits.join(', ')}`);
  assert.match(t, /Planned read-only analysis/);
  assert.match(t, /Designed to be read-only/);
  assert.match(t, /is planned as a read-only platform/);
  assert.match(t, /we intend to connect/);
});

test('privacy banner matches the waitlist fields (email, not name)', () => {
  const t = read('pages/privacy.html');
  assert.match(t, /CodeHumanist is not yet available\. Today the waitlist sign-up collects an email address/);
  assert.match(t, /Summary — planned product, at launch/);
  assert.match(t, /Planned, at launch:/);
  assert.match(t, /we intend to connect to your code repositories/);
  assert.match(t, /We intend to add encryption at rest/);
  assert.match(t, /when CodeHumanist launches/);
  assert.doesNotMatch(t, /unsubscribe/i);
  assert.doesNotMatch(t, /prose\.css/);
  assert.doesNotMatch(t, /we connect to your code/i);
  assert.doesNotMatch(t, /We do not modify your code\. Ever/);
});

test('waitlist error responses do not echo the upstream body', () => {
  const src = read('functions/api/waitlist.ts');
  assert.match(src, /Could not save your signup/);
  assert.doesNotMatch(src, /detail:/);
  assert.match(src, /email\?:/);
  assert.doesNotMatch(src, /name\?:/);
});

test('waitlist notification body keeps email and source, not IP, user agent, or referrer', () => {
  const src = read('functions/api/waitlist.ts');
  assert.match(src, /Email:  \$\{email\}/);
  assert.match(src, /Source: \$\{source\}/);
  assert.doesNotMatch(src, /CF-Connecting-IP|User-Agent|Referer|`IP:|`UA:|`Ref:/);
});

test('normaliser blocks encoded paths, slash variants, tests/*, and trailing-dot or semicolon aliases', () => {
  assert.equal(normalizePath('/marketing-truths.json.'), '/marketing-truths.json');
  assert.equal(normalizePath('/marketing-truths.json%2e'), '/marketing-truths.json');
  assert.equal(normalizePath('/.gitignore%3b'), '/.gitignore');
  assert.equal(normalizePath('//.GITIGNORE'), '/.gitignore');
  assert.equal(normalizePath('///tests//smoke_site.mjs'), '/tests/smoke_site.mjs');
  assert.equal(normalizePath('/%252egitignore'), '/.gitignore');

  const blocked = [...BLOCKED, ...ENCODED_BLOCKED, ...SLASH_VARIANTS, ...TESTS_PATHS, ...FUNCTION_PATHS, '/marketing-truths.bak'];
  for (const p of blocked) {
    assert.equal(isBlockedPath(p), true, p);
  }
  for (const p of ['/', '/llms.txt', '/pages/privacy.html', '/css/style.css', '/api/waitlist', '/index.html', '/robots.txt']) {
    assert.equal(isBlockedPath(p), false, p);
  }
});

test('publish routes invoke the middleware for everything except real static assets', () => {
  const routes = JSON.parse(read('_routes.json'));
  assert.deepEqual(routes.include, ['/*']);
  assert.deepEqual(routes.exclude, PUBLIC_EXACT);
  assert.equal(routes.exclude.some((rule) => rule.includes('*')), false);
  assert.equal(existsSync(new URL('../wrangler.toml', import.meta.url)), false);
  for (const p of FUNCTION_PATHS) {
    assert.equal(routes.exclude.includes(p), false, p);
    assert.equal(isBlockedPath(p), true, p);
  }
  const mw = read('functions/_middleware.ts');
  assert.match(mw, /isBlockedPath/);
  assert.match(read('functions/block_path.js'), /decodeURIComponent/);
  assert.match(read('functions/block_path.js'), /marketing-truths/);
});

test('stage-publish copies only the public allow-list', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const r = spawnSync(process.execPath, ['scripts/stage-publish.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const dist = new URL('../dist/', import.meta.url);
  for (const rel of ['index.html', 'css/style.css', 'js/main.js', 'pages/privacy.html', 'llms.txt', 'robots.txt', 'sitemap.xml', '_routes.json']) {
    assert.equal(existsSync(new URL(rel, dist)), true, rel);
  }
  for (const rel of ['marketing-truths.json', '.gitignore', 'tests/smoke_site.mjs', 'functions/api/waitlist.ts', '.git-hooks/README.md', 'scripts/stage-publish.mjs']) {
    assert.equal(existsSync(new URL(rel, dist)), false, rel);
  }
  rmSync(dist, { recursive: true, force: true });
});

test('live: blocked, encoded, slash, and tests paths return 404; public pages 200', { skip: process.env.LIVE !== '1' }, async () => {
  const base = process.env.BASE_URL || 'https://codehumanist.com';
  const blocked = [...new Set([...BLOCKED, ...ENCODED_BLOCKED, ...SLASH_VARIANTS, ...TESTS_PATHS, ...FUNCTION_PATHS])];
  for (const p of blocked) {
    const r = await fetch(base + p, { redirect: 'manual' });
    assert.equal(r.status, 404, `${p} -> ${r.status}`);
  }
  for (const p of ['/', '/llms.txt', '/css/style.css']) {
    const r = await fetch(base + p, { redirect: 'manual' });
    assert.equal(r.status, 200, `${p} -> ${r.status}`);
  }
  const privacy = await fetch(base + '/pages/privacy.html', { redirect: 'manual' });
  assert.ok(privacy.status === 200 || privacy.status === 308, `/pages/privacy.html -> ${privacy.status}`);
  const opt = await fetch(base + '/api/waitlist', { method: 'OPTIONS', redirect: 'manual' });
  assert.equal(opt.status, 204, `OPTIONS /api/waitlist -> ${opt.status}`);
  const get = await fetch(base + '/api/waitlist', { method: 'GET', redirect: 'manual' });
  assert.equal(get.status, 405, `GET /api/waitlist -> ${get.status}`);
});
