// CodeHumanist site smoke checks (no dependencies): `node --test tests/smoke_site.mjs`
// Optional live check (read-only GETs): LIVE=1 node --test tests/smoke_site.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

test('publish-root leak: _routes.json + middleware cover every blocked path', () => {
  const routes = JSON.parse(read('_routes.json'));
  const mw = read('functions/_middleware.ts');
  assert.ok(routes.include.includes('/api/*'), 'waitlist Function route must stay included');
  const covered = (p) => routes.include.some((r) => (r.endsWith('/*') ? p.startsWith(r.slice(0, -1)) : r === p));
  for (const p of BLOCKED) {
    assert.ok(covered(p), `_routes.json does not include ${p}`);
    const inMw = p.split('/').length > 2
      ? mw.includes(`"/${p.split('/')[1]}/"`)
      : mw.includes(`"${p}"`);
    assert.ok(inMw, `functions/_middleware.ts does not block ${p}`);
  }
});

test('live: blocked paths return 404, homepage and llms.txt 200', { skip: process.env.LIVE !== '1' }, async () => {
  const base = process.env.BASE_URL || 'https://codehumanist.com';
  for (const p of BLOCKED) {
    const r = await fetch(base + p, { redirect: 'manual' });
    assert.equal(r.status, 404, `${p} -> ${r.status}`);
  }
  for (const p of ['/', '/llms.txt']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, `${p} -> ${r.status}`);
  }
});
