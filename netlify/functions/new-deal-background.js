// netlify/functions/new-deal-background.js
// Background version of new-deal to avoid request timeouts. The HTTP caller
// will immediately receive 202 Accepted while this function continues running
// in the background to forward the request to n8n.

export async function handler(event) {
  // Only accept POST; Netlify will still return 202 to the client for background
  if (event.httpMethod !== "POST" && event.httpMethod !== "OPTIONS") {
    // Background functions don't send custom bodies back; just stop.
    return;
  }

  try {
    const base = "https://primary-production-c8d0.up.railway.app";
    const path = "/webhook/newDeal";
    const url = base.replace(/\/$/, "") + path;
    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    const auth = process.env.N8N_AUTH;

    const body = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : (event.body || "");

    // Fire-and-forget forward to n8n. Do not await so the HTTP request returns 202 immediately.
    fetch(url, {
      method: "POST",
      headers: {
        ...(contentType ? { "Content-Type": contentType } : {}),
        ...(auth ? { Authorization: auth } : {}),
      },
      body,
    })
    .then(async (resp) => {
      // Optional: log status to console for local dev visibility
      const txt = await resp.text();
      console.log(`[new-deal background] n8n responded`, resp.status, resp.statusText, txt?.slice(0, 200));
    })
    .catch((err) => {
      console.warn('[new-deal background] forward failed:', err?.message || err);
    });

    // No return needed; background functions auto-respond 202 Accepted.
    return;
  } catch (err) {
    console.warn('[new-deal background] unexpected error:', err?.message || err);
    return;
  }
}
