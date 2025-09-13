const https = require('https');

// Very small proxy for Vercel serverless functions. It fetches OpenSky and returns raw JSON.
// NOTE: Rate limits still apply; use responsibly. If you deploy to Vercel, this file will be
// available under /.netlify/functions/... or /api/opensky depending on the provider. Vercel
// will map this to /api/opensky automatically when placed in the /api folder.

module.exports = (req, res) => {
  const query = req.url.split('?')[1] || '';
  const url = `https://opensky-network.org/api/states/all?${query}`;
  https.get(url, (r) => {
    let data = '';
    r.on('data', (chunk) => data += chunk);
    r.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(data);
    });
  }).on('error', (err) => {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'Proxy failed', details: err.message }));
  });
};
