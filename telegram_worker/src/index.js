function jsonResponse(obj, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });
}

function getCorsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || "").trim();

  // If Origin is absent (e.g. file:// or some privacy modes), don't block it here.
  // If Origin is present, only allow the configured origin.
  const allowOrigin = !origin || !allowed || origin === allowed ? (origin || allowed || "*") : "";

  const cors = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
  if (allowOrigin) cors["Access-Control-Allow-Origin"] = allowOrigin;
  return cors;
}

function parseDataUrl(dataUrl) {
  const m = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mime: m[1], b64: m[2] };
}

function truncate(str, max = 3500) {
  const s = String(str || "");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function buildText(payload) {
  const type = payload.type || "-";
  const lang = payload.lang || "-";
  const email = payload.email || "-";
  const firstName = payload.firstName || "-";
  const message = payload.message || payload.details || "-";
  const ua = payload.userAgent || "-";
  const ts = payload.timestamp || "-";

  return truncate(
    `IFET feedback: ${type}\n` +
      `name: ${firstName}\n` +
      `email: ${email}\n` +
      `lang: ${lang}\n` +
      `time: ${ts}\n` +
      `ua: ${ua}\n\n` +
      `${message}`
  );
}

async function tgSendMessage(env, text) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.CHAT_ID,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Telegram sendMessage failed (${resp.status}): ${body}`);
  }
}

async function tgSendDocument(env, fileName, mime, bytes, caption) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`;
  const form = new FormData();
  form.append("chat_id", String(env.CHAT_ID));
  form.append("caption", truncate(caption, 900));
  form.append("disable_web_page_preview", "true");
  form.append("document", new Blob([bytes], { type: mime || "application/octet-stream" }), fileName || "attachment");

  const resp = await fetch(url, { method: "POST", body: form });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Telegram sendDocument failed (${resp.status}): ${body}`);
  }
}

export default {
  async fetch(request, env) {
    const cors = getCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405, cors);
    }

    // Enforce Origin if configured
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGIN || "").trim();
    if (origin && allowed && origin !== allowed) {
      return jsonResponse({ ok: false, error: "Origin not allowed" }, 403, cors);
    }

    if (!env.BOT_TOKEN || !env.CHAT_ID) {
      return jsonResponse({ ok: false, error: "Server not configured" }, 500, cors);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, 400, cors);
    }

    const text = buildText(payload);

    try {
      const att = payload.attachment || null;
      if (att && att.dataUrl) {
        const parsed = parseDataUrl(att.dataUrl);
        if (!parsed) {
          // Fallback to text only if dataUrl is malformed
          await tgSendMessage(env, text);
          return jsonResponse({ ok: true, delivered: "message" }, 200, cors);
        }

        // Basic size limit to avoid worker memory blowups
        // (base64 is ~4/3 of bytes)
        const approxBytes = Math.floor((parsed.b64.length * 3) / 4);
        const maxBytes = 8 * 1024 * 1024; // 8MB
        if (approxBytes > maxBytes) {
          // Send text and mention that attachment was too large
          await tgSendMessage(env, truncate(text + `\n\n(Attachment skipped: too large ${approxBytes} bytes)`, 3900));
          return jsonResponse({ ok: true, delivered: "message", attachment: "skipped_too_large" }, 200, cors);
        }

        const bytes = Uint8Array.from(atob(parsed.b64), (c) => c.charCodeAt(0));
        await tgSendDocument(env, att.name || "attachment", parsed.mime, bytes, text);
        return jsonResponse({ ok: true, delivered: "document" }, 200, cors);
      }

      await tgSendMessage(env, text);
      return jsonResponse({ ok: true, delivered: "message" }, 200, cors);
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e && e.message ? e.message : e) }, 500, cors);
    }
  },
};


