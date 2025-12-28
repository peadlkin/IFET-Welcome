function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, origin, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
  });
}

function safeStr(v, max = 4000) {
  const s = (v == null ? "" : String(v)).trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function formatMessage(payload) {
  const lines = [];
  lines.push(`📝 IFET feedback: ${safeStr(payload.type || "unknown", 40)}`);

  if (payload.lang) lines.push(`🌐 lang: ${safeStr(payload.lang, 20)}`);
  if (payload.email) lines.push(`✉️ email: ${safeStr(payload.email, 200)}`);
  if (payload.message) lines.push(`\n${safeStr(payload.message, 3500)}`);
  if (payload.timestamp) lines.push(`\n⏱ ${safeStr(payload.timestamp, 80)}`);

  return lines.join("\n");
}

async function tgSendMessage(env, text) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.CHAT_ID,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
}

async function tgSendDocument(env, file, caption) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`;
  const fd = new FormData();
  fd.append("chat_id", env.CHAT_ID);
  fd.append("caption", caption);
  fd.append("disable_web_page_preview", "true");
  fd.append("document", file, file.name || "attachment");

  const res = await fetch(url, { method: "POST", body: fd });
  if (!res.ok) throw new Error(`Telegram sendDocument failed: ${res.status} ${await res.text()}`);
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, origin, 405);
    }

    if (!env.BOT_TOKEN || !env.CHAT_ID) {
      return json({ ok: false, error: "Server not configured (missing BOT_TOKEN/CHAT_ID)" }, origin, 500);
    }

    try {
      const ct = request.headers.get("content-type") || "";

      /** @type {{type?:string,lang?:string,email?:string,message?:string,timestamp?:string}} */
      let payload = {};
      /** @type {File|null} */
      let attachment = null;

      if (ct.includes("multipart/form-data")) {
        const fd = await request.formData();
        payload = {
          type: fd.get("type") || "",
          lang: fd.get("lang") || "",
          email: fd.get("email") || "",
          message: fd.get("message") || "",
          timestamp: fd.get("timestamp") || "",
        };
        const maybeFile = fd.get("attachment");
        if (maybeFile && typeof maybeFile === "object" && "arrayBuffer" in maybeFile) {
          attachment = /** @type {File} */ (maybeFile);
        }
      } else {
        payload = await request.json();
      }

      const text = formatMessage(payload);

      if (attachment) {
        await tgSendDocument(env, attachment, text);
      } else {
        await tgSendMessage(env, text);
      }

      return json({ ok: true }, origin, 200);
    } catch (e) {
      return json({ ok: false, error: String(e && e.message ? e.message : e) }, origin, 500);
    }
  },
};





