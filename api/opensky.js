// ESM / Fetch-based Vercel-friendly API route for proxying OpenSky
// Place this file in /api and Vercel will serve it at /api/opensky
// NOTE: This is a simple proxy and does not implement caching or strict rate limiting.
// Use responsibly and add server-side caching if you rely on it in production.

const OPENSKY_URL = 'https://opensky-network.org/api/states/all';

export default async function handler(req, res) {
  try {
    const r = await fetch(OPENSKY_URL, { method: 'GET' });
    if (!r.ok) {
      res.statusCode = r.status || 502;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Upstream error', status: r.status }));
      return;
    }
    const text = await r.text();
    res.setHeader('content-type', 'application/json');
    res.statusCode = 200;
    res.end(text);
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Proxy failed', details: String(err && err.message ? err.message : err) }));
  }
}
