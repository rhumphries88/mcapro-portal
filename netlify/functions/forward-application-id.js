// Netlify Function: forward-application-id
// Forwards application IDs to the external webhook to avoid browser CORS and allow richer payloads.

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const {
      applicationId,
      applicationFormId = null,
      userId = null,
      context = {},
    } = payload || {};

    if (!applicationId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'applicationId is required' }) };
    }

    const url = 'https://primary-production-c8d0.up.railway.app/webhook/application-id';

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationId, applicationFormId, userId, context }),
    });

    const text = await res.text();

    return {
      statusCode: res.status,
      body: JSON.stringify({ ok: res.ok, status: res.status, body: text }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: String(err) }),
    };
  }
};
