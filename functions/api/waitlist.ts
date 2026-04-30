// Cloudflare Pages Function — POST /api/waitlist
//
// Replaces the localStorage-only waitlist form (js/main.js initWaitlist)
// with a real backend. Receives the email + optional metadata, validates,
// and forwards to marc@instilligent.com via the Resend API.
//
// 2026-05-01 — Stage 4 P2 build, closes CF task mtr-2026-04-30-ch-waitlist.
// Per the 2026-04-30 audit, the form previously stored emails to
// localStorage only — submissions never left the user's browser. This
// matches the same UX-deception class as the old ProofOnce form
// (already recalled). Same Pages Function + Resend pattern as
// instilligent-website#3 (the contact form fix).
//
// REQUIRED CLOUDFLARE PAGES ENV VARS:
//   RESEND_API_KEY  — same Resend key as Modular Compliance + instilligent.com.
//                     Configure in Pages dashboard:
//                     codehumanist-website → Settings → Environment
//                     variables → Production. (Encrypted)
//
// OPTIONAL ENV VARS:
//   WAITLIST_TO     — recipient address (default: marc@instilligent.com)
//   WAITLIST_FROM   — from header        (default: CodeHumanist Waitlist
//                                          <noreply@instilligent.com>)
//                     The from address must be on a domain verified in
//                     the Resend account. instilligent.com is already
//                     verified there.

interface Env {
  RESEND_API_KEY?: string;
  WAITLIST_TO?: string;
  WAITLIST_FROM?: string;
}

interface WaitlistPayload {
  email?: unknown;
  source?: unknown;        // 'hero' | 'cta' | unknown — for analytics
  // Honeypot — bots fill it, humans don't see it.
  website?: unknown;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const isString = (v: unknown): v is string => typeof v === "string";
const trim = (v: unknown): string => (isString(v) ? v.trim() : "");

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: WaitlistPayload;
  try {
    payload = (await request.json()) as WaitlistPayload;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  // Honeypot — silently succeed on bot submissions.
  if (trim(payload.website)) {
    return json(200, { ok: true });
  }

  const email = trim(payload.email);
  const source = trim(payload.source) || "unknown";

  if (!email) {
    return json(400, { error: "email is required" });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json(400, { error: "invalid email" });
  }
  if (email.length > 320 || source.length > 50) {
    return json(400, { error: "field too long" });
  }

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    // Service not configured — be explicit so the site owner notices in logs.
    return json(503, { error: "waitlist service is not configured" });
  }

  const to = env.WAITLIST_TO || "marc@instilligent.com";
  const from = env.WAITLIST_FROM || "CodeHumanist Waitlist <noreply@instilligent.com>";

  const subject = `CodeHumanist waitlist signup: ${email}`;
  const body =
    `New CodeHumanist waitlist signup\n` +
    `\n` +
    `Email:  ${email}\n` +
    `Source: ${source} (form id on the site)\n` +
    `IP:     ${request.headers.get("CF-Connecting-IP") || "unknown"}\n` +
    `UA:     ${(request.headers.get("User-Agent") || "").slice(0, 200)}\n` +
    `Ref:    ${request.headers.get("Referer") || "(none)"}\n` +
    `\n` +
    `--\n` +
    `Sent from codehumanist.com /api/waitlist Pages Function.\n` +
    `Reply directly to add this person to your waitlist record.\n`;

  let resendResp: Response;
  try {
    resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject,
        text: body,
      }),
    });
  } catch (err) {
    return json(502, { error: "upstream send failed", detail: String(err).slice(0, 200) });
  }

  if (!resendResp.ok) {
    const detail = await resendResp.text().catch(() => "");
    return json(502, {
      error: "send failed",
      status: resendResp.status,
      detail: detail.slice(0, 300),
    });
  }

  return json(200, { ok: true });
};

// CORS preflight (in case the form ever submits cross-origin).
export const onRequestOptions: PagesFunction = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });

// Reject other methods so this endpoint can't be probed for info.
export const onRequest: PagesFunction = async () =>
  new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST, OPTIONS" } });
