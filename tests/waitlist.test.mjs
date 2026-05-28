// Unit tests for the /api/waitlist Cloudflare Pages Function.
//
// Run with:   node --test tests/waitlist.test.mjs
//
// Why this is dependency-free:
//   This repo is a static site with no Node toolchain (no package.json,
//   no test runner, no TS compiler). To keep the test honest — exercising
//   the real source rather than a hand-rolled shadow — we load
//   functions/api/waitlist.ts via a targeted type-strip + data-URL
//   import. The strip is intentionally narrow to this file's syntax;
//   if the source grows new TS features, this stripper must grow too
//   (the test will fail loudly, which is the point).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, '..', 'functions', 'api', 'waitlist.ts');
const tsSource = readFileSync(sourcePath, 'utf8');

const jsSource = tsSource
  // Drop `interface Foo { ... }` blocks (shallow braces only — fine for this file).
  .replace(/^interface\s+\w+\s*\{[\s\S]*?^\}/gm, '')
  // Drop `: PagesFunction` / `: PagesFunction<Env>` annotations.
  .replace(/:\s*PagesFunction(?:<[^>]+>)?/g, '')
  // Drop named-type annotations specific to this file.
  .replace(/:\s*WaitlistPayload\b/g, '')
  .replace(/:\s*Response\b/g, '')
  // Drop `: v is string` (type predicate) on the isString arrow.
  .replace(/\)\s*:\s*\w+\s+is\s+\w+\s*=>/g, ') =>')
  // Drop primitive parameter / return annotations.
  .replace(/:\s*string\b/g, '')
  .replace(/:\s*number\b/g, '')
  .replace(/:\s*unknown\b/g, '')
  // Drop `: Record<...>` annotations.
  .replace(/:\s*Record<[^>]+>/g, '')
  // Drop `as WaitlistPayload` casts.
  .replace(/\s+as\s+WaitlistPayload\b/g, '');

const moduleUrl =
  'data:text/javascript;base64,' + Buffer.from(jsSource).toString('base64');
const mod = await import(moduleUrl);
const { onRequestPost, onRequestOptions } = mod;

function makeRequest(body, { method = 'POST', headers = {} } = {}) {
  return new Request('https://codehumanist.com/api/waitlist', {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function installFetchMock(impl) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return impl(...args);
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const okResendResponse = () =>
  new Response(JSON.stringify({ id: 're_test_123' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

test('valid email → 200 with { ok: true } and Resend called exactly once', async () => {
  const fetchMock = installFetchMock(okResendResponse);
  try {
    const request = makeRequest({ email: 'test@example.com', source: 'hero' });
    const env = { RESEND_API_KEY: 'test-key' };

    const resp = await onRequestPost({ request, env });

    assert.equal(resp.status, 200);
    assert.deepEqual(await resp.json(), { ok: true });
    assert.equal(fetchMock.calls.length, 1, 'Resend should be hit exactly once');

    const [url, init] = fetchMock.calls[0];
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer test-key');

    const sentBody = JSON.parse(init.body);
    assert.deepEqual(sentBody.to, ['marc@instilligent.com']);
    assert.equal(sentBody.reply_to, 'test@example.com');
    assert.match(sentBody.subject, /test@example\.com/);
  } finally {
    fetchMock.restore();
  }
});

test('missing email → 400 with error message and no fetch call', async () => {
  const fetchMock = installFetchMock(okResendResponse);
  try {
    const resp = await onRequestPost({
      request: makeRequest({ source: 'cta' }),
      env: { RESEND_API_KEY: 'test-key' },
    });

    assert.equal(resp.status, 400);
    const body = await resp.json();
    assert.match(body.error, /email is required/i);
    assert.equal(fetchMock.calls.length, 0);
  } finally {
    fetchMock.restore();
  }
});

test('invalid email syntax → 400 and no fetch call', async () => {
  const fetchMock = installFetchMock(okResendResponse);
  try {
    const resp = await onRequestPost({
      request: makeRequest({ email: 'not-an-email' }),
      env: { RESEND_API_KEY: 'test-key' },
    });

    assert.equal(resp.status, 400);
    const body = await resp.json();
    assert.match(body.error, /invalid email/i);
    assert.equal(fetchMock.calls.length, 0);
  } finally {
    fetchMock.restore();
  }
});

test('invalid JSON body → 400', async () => {
  const fetchMock = installFetchMock(okResendResponse);
  try {
    const resp = await onRequestPost({
      request: makeRequest('{not json', { headers: { 'Content-Type': 'application/json' } }),
      env: { RESEND_API_KEY: 'test-key' },
    });

    assert.equal(resp.status, 400);
    const body = await resp.json();
    assert.match(body.error, /invalid json/i);
    assert.equal(fetchMock.calls.length, 0);
  } finally {
    fetchMock.restore();
  }
});

test('honeypot filled → 200 ok and silently dropped (no fetch)', async () => {
  const fetchMock = installFetchMock(okResendResponse);
  try {
    const resp = await onRequestPost({
      request: makeRequest({ email: 'test@example.com', website: 'https://spam.example' }),
      env: { RESEND_API_KEY: 'test-key' },
    });

    assert.equal(resp.status, 200);
    assert.deepEqual(await resp.json(), { ok: true });
    assert.equal(fetchMock.calls.length, 0, 'honeypot should suppress send');
  } finally {
    fetchMock.restore();
  }
});

test('missing RESEND_API_KEY → 503 service not configured', async () => {
  const fetchMock = installFetchMock(okResendResponse);
  try {
    const resp = await onRequestPost({
      request: makeRequest({ email: 'test@example.com' }),
      env: {},
    });

    assert.equal(resp.status, 503);
    const body = await resp.json();
    assert.match(body.error, /not configured/i);
    assert.equal(fetchMock.calls.length, 0);
  } finally {
    fetchMock.restore();
  }
});

test('Resend upstream non-2xx → 502 with status surfaced', async () => {
  const fetchMock = installFetchMock(
    async () => new Response('upstream boom', { status: 500 }),
  );
  try {
    const resp = await onRequestPost({
      request: makeRequest({ email: 'test@example.com' }),
      env: { RESEND_API_KEY: 'test-key' },
    });

    assert.equal(resp.status, 502);
    const body = await resp.json();
    assert.equal(body.status, 500);
  } finally {
    fetchMock.restore();
  }
});

test('Resend fetch throws → 502 upstream send failed', async () => {
  const fetchMock = installFetchMock(async () => {
    throw new Error('network down');
  });
  try {
    const resp = await onRequestPost({
      request: makeRequest({ email: 'test@example.com' }),
      env: { RESEND_API_KEY: 'test-key' },
    });

    assert.equal(resp.status, 502);
    const body = await resp.json();
    assert.match(body.error, /upstream send failed/i);
  } finally {
    fetchMock.restore();
  }
});

test('CORS preflight → 204 with allow headers', async () => {
  const resp = await onRequestOptions({});
  assert.equal(resp.status, 204);
  assert.equal(resp.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
});
