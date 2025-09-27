// ESM / Fetch-based Vercel-friendly API route for proxying OpenSky
// This file is placed in the /api directory and will be served by Vercel at /api/opensky.
export default async function handler(req, res) {
  const OPENSKY_URL = 'https://opensky-network.org/api/states/all';

  try {
    const fetchResponse = await fetch(OPENSKY_URL);

    if (!fetchResponse.ok) {
      res.status(fetchResponse.status).json({ error: 'Upstream error from OpenSky Network' });
      return;
    }

    const data = await fetchResponse.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(502).json({ error: 'Proxy failed', details: error.message });
  }
}


