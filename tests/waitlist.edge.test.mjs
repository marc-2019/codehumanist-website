// Additional unit tests for the /api/waitlist Cloudflare Pages Function.
//
// Run with:   node --test tests/waitlist.edge.test.mjs
// (or `node --test tests/` to run the whole suite)
//
// Companion to waitlist.test.mjs. That file covers the happy path,
// validation basics, honeypot, missing-key and upstream-failure paths.
// This file extends coverage to branches that file does NOT exercise:
//   - the length-cap guard (email > 320, source > 50 → 400 "field too long")
//   - the onRequest method-rejection handler (405 + Allow header)
//   - WAITLIST_TO / WAITLIST_FROM env overrides
//   - the email body composition: header metadata (CF-Connecting-IP,
//     User-Agent slicing to 200 chars, Referer) and the `source` default
//   - whitespace-only email collapsing to "email is required"
//
// Same dependency-free loading strategy as waitlist.test.mjs: the real
// TS source is loaded via a narrow type-strip + data-URL import, so these
// tests exercise the shipped handler, not a shadow re-implementation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, '..', 'functions', 'api', 'waitlist.ts');
const tsSource = readFileSync(sourcePath, 'utf8');

const jsSource = tsSource
  .replace(/^interface\s+\w+\s*\{[\s\S]*?^\}/gm, '')
  .replace(/:\s*PagesFunction(?:<[^>]+>)?/g, '')
  .replace(/:\s*WaitlistPayload\b/g, '')
  .replace(/:\s*Response\b/g, '')
  .replace(/\)\s*:\s*\w+\s+is\s+\w+\s*=>/g, ') =>')
  .replace(/:\s*string\b/g, '')
  .replace(/:\s*number\b/g, '')
  .replace(/:\s*unknown\b/g, '')
  .replace(/:\s*Record<[^>]+>/g, '')
  .replace(/\s+as\s+WaitlistPayload\b/g, '');

const moduleUrl =
  'data:text/javascript;base64,' + Buffer.from(jsSource).toString('base64');
const mod = await import(moduleUrl);
const { onRequestPost, onRequest } = mod;

// Sanity: the strip must yield the symbols we test. If the source grows
// new TS syntax that breaks the strip, the import above throws and the
// whole file fails loudly — which is the intended early-warning signal.
assert.equal(typeof onRequestPost, 'function', 'onRequestPost must export');
assert.equal(typeof onRequest, 'function', 'onRequest must export');

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

// ── Length-cap guard ─────────────────────────────────────────────

test('email over 320 chars (but otherwise valid syntax) → 400 field too long, no fetch', async () => {
  const fetchMock = installFetchMock(okResendResponse);
  try {
    // local-part 320 chars keeps total > 320 while matching the email regex.
    const longEmail = 'a'.repeat(320) + '@example.com';
    const resp = await onRequestPost({
      request: makeRequest({ email: longEmail }),
      env: { RESEND_API_KEY: 'test-key' },
    });

    assert.equal(resp.status, 400);
    const body = await resp.json();
    assert.match(body.error, /field too long/i);
    assert.equal(fetchMock.calls.length, 0, 'over-long email must not be forwarded');
  } finally {
    fetchMock.restore();
  }
});

test('source over 50 chars → 400 field too long, no fetch', async () => {
  const fetchMock = installFetchMock(okResendResponse);
  try {
    const resp = await onRequestPost({
      request: makeRequest({ email: 'test@example.com', source: 's'.repeat(51) }),
      env: { RESEND_API_KEY: 'test-key' },
    });

    assert.equal(resp.status, 400);
    const body = await resp.json();
    assert.match(body.error, /field too long/i);
    assert.equal(fetchMock.calls.length, 0);
  } finally {
    fetchMock.restore();
  }
});

test('email exactly 320 chars total is accepted (boundary, length cap is > not >=)', async () => {
  const fetchMock = installFetchMock(okResendResponse);
  try {
    // Construct a syntactically valid email whose total length === 320.
    const suffix = '@example.com'; // 12 chars
    const localPart = 'a'.repeat(320 - suffix.length); // 308
    const email = localPart + suffix;
    assert.equal(email.length, 320, 'precondition: email length is exactly 320');

    const resp = await onRequestPost({
      request: makeRequest({ email }),
      env: { RESEND_API_KEY: 'test-key' },
    });

    assert.equal(resp.status, 200, '320 is the inclusive upper bound');
    assert.equal(fetchMock.calls.length, 1, 'boundary-length email is forwarded');
  } finally {
    fetchMock.restore();
  }
});

// ── Whitespace-only email collapses to "required" ────────────────

test('whitespace-only email trims to empty → 400 email is required', async () => {
  const fetchMock = installFetchMock(okResendResponse);
  try {
    const resp = await onRequestPost({
      request: makeRequest({ email: '   \t  ' }),
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

// ── Email body composition + header metadata ─────────────────────

test('source defaults to "unknown" and request headers are embedded in the email body', async () => {
  const fetchMock = installFetchMock(okResendResponse);
  try {
    const request = makeRequest(
      { email: 'meta@example.com' }, // no source → should default
      {
        headers: {
          'CF-Connecting-IP': '203.0.113.9',
          'User-Agent': 'TestAgent/1.0',
          Referer: 'https://referrer.example/page',
        },
      },
    );

    const resp = await onRequestPost({ request, env: { RESEND_API_KEY: 'test-key' } });

    assert.equal(resp.status, 200);
    assert.equal(fetchMock.calls.length, 1);

    const sentBody = JSON.parse(fetchMock.calls[0][1].body);
    // reply_to is the signup email; recipient defaults to marc@instilligent.com.
    assert.equal(sentBody.reply_to, 'meta@example.com');
    assert.deepEqual(sentBody.to, ['marc@instilligent.com']);

    const text = sentBody.text;
    assert.match(text, /Source: unknown/, 'absent source defaults to "unknown"');
    assert.match(text, /IP:\s+203\.0\.113\.9/, 'CF-Connecting-IP is recorded');
    assert.match(text, /UA:\s+TestAgent\/1\.0/, 'User-Agent is recorded');
    assert.match(text, /Ref:\s+https:\/\/referrer\.example\/page/, 'Referer is recorded');
  } finally {
    fetchMock.restore();
  }
});

test('missing CF-Connecting-IP / Referer fall back to "unknown" / "(none)"', async () => {
  const fetchMock = installFetchMock(okResendResponse);
  try {
    // No CF-Connecting-IP, no Referer headers supplied.
    const resp = await onRequestPost({
      request: makeRequest({ email: 'meta@example.com' }),
      env: { RESEND_API_KEY: 'test-key' },
    });

    assert.equal(resp.status, 200);
    const text = JSON.parse(fetchMock.calls[0][1].body).text;
    assert.match(text, /IP:\s+unknown/, 'absent IP → "unknown"');
    assert.match(text, /Ref:\s+\(none\)/, 'absent Referer → "(none)"');
  } finally {
    fetchMock.restore();
  }
});

test('over-long User-Agent is sliced to 200 chars in the email body', async () => {
  const fetchMock = installFetchMock(okResendResponse);
  try {
    const longUA = 'U'.repeat(500);
    const resp = await onRequestPost({
      request: makeRequest(
        { email: 'meta@example.com' },
        { headers: { 'User-Agent': longUA } },
      ),
      env: { RESEND_API_KEY: 'test-key' },
    });

    assert.equal(resp.status, 200);
    const text = JSON.parse(fetchMock.calls[0][1].body).text;
    // The body should contain exactly 200 'U's on the UA line, not 500.
    assert.match(text, /UA:\s+U{200}\n/, 'UA is capped at 200 chars');
    assert.doesNotMatch(text, /U{201}/, 'UA must not exceed 200 chars');
  } finally {
    fetchMock.restore();
  }
});

// ── Env overrides ────────────────────────────────────────────────

test('WAITLIST_TO and WAITLIST_FROM env vars override the defaults', async () => {
  const fetchMock = installFetchMock(okResendResponse);
  try {
    const resp = await onRequestPost({
      request: makeRequest({ email: 'test@example.com' }),
      env: {
        RESEND_API_KEY: 'test-key',
        WAITLIST_TO: 'ops@example.com',
        WAITLIST_FROM: 'Custom From <hello@example.com>',
      },
    });

    assert.equal(resp.status, 200);
    const sentBody = JSON.parse(fetchMock.calls[0][1].body);
    assert.deepEqual(sentBody.to, ['ops@example.com'], 'WAITLIST_TO overrides recipient');
    assert.equal(sentBody.from, 'Custom From <hello@example.com>', 'WAITLIST_FROM overrides sender');
  } finally {
    fetchMock.restore();
  }
});

// ── Method-rejection handler ─────────────────────────────────────

test('onRequest rejects other methods with 405 + Allow header', async () => {
  const resp = await onRequest({});
  assert.equal(resp.status, 405);
  assert.equal(resp.headers.get('Allow'), 'POST, OPTIONS');
  const text = await resp.text();
  assert.match(text, /method not allowed/i);
});
