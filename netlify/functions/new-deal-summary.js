// netlify/functions/new-deal-summary.js
// Forwards summary extraction requests to n8n: /webhook/newDealSummary
// Preserves headers/body, maps non-OK responses to 202 to avoid breaking the UI.

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
      body: JSON.stringify({ ok: true }),
    };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    const base = "https://primary-production-c8d0.up.railway.app";
    const path = "/webhook/newDealSummary";
    const url = base.replace(/\/$/, "") + path;
    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    const auth = process.env.N8N_AUTH;

    const body = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : (event.body || "");

    // Wait up to ~28 seconds for a response to pass through; otherwise return 202
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 28000);

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          ...(contentType ? { "Content-Type": contentType } : {}),
          ...(auth ? { Authorization: auth } : {}),
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const text = await resp.text();
      let payload; try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }

      if (!resp.ok) {
        console.warn("[new-deal-summary] n8n non-OK status, returning 202 instead:", resp.status, resp.statusText, typeof text === 'string' ? text.slice(0,200) : '');
        return {
          statusCode: 202,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
          body: JSON.stringify({ accepted: true, note: `n8n responded ${resp.status}`, data: payload })
        };
      }

      return {
        statusCode: resp.status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
        body: JSON.stringify(payload == null ? {} : payload),
      };
    } catch (e) {
      console.warn("[new-deal-summary] early return (background continue):", e?.name || e?.message || e);
      return {
        statusCode: 202,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
        body: JSON.stringify({ accepted: true, note: "forward continuing in background", error: String(e?.message || e) })
      };
    }
  } catch (err) {
    console.warn("[new-deal-summary] outer error:", err?.message || err);
    return {
      statusCode: 202,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
      body: JSON.stringify({ accepted: true, note: "unhandled error; continue in background", error: String(err?.message || err) })
    };
  }
}
