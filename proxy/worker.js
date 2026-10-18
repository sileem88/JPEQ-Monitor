/*
 * Optional CORS proxy for JPEQ Monitor (Cloudflare Workers, free plan).
 *
 * Only needed if the browser blocks the JSON files (time sync + EEW text)
 * from kmoni/lmoni. Map images never need this.
 *
 * Deploy: Cloudflare dashboard → Workers & Pages → Create → "Hello World"
 * → paste this file → Deploy. Then set `proxy` in config.js to
 *   'https://<your-worker>.workers.dev/?url='
 */

// Change to your GitHub Pages origin, e.g. 'https://yourname.github.io'
const ALLOWED_ORIGIN = 'https://YOUR-GITHUB-USERNAME.github.io';

// Only these NIED hosts and JSON paths can be fetched through this proxy.
const ALLOWED_HOSTS = ['www.kmoni.bosai.go.jp', 'www.lmoni.bosai.go.jp'];

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

    let target;
    try { target = new URL(new URL(request.url).searchParams.get('url')); }
    catch { return new Response('Bad url', { status: 400, headers: cors }); }

    if (!ALLOWED_HOSTS.includes(target.hostname) || !target.pathname.endsWith('.json')) {
      return new Response('Not allowed', { status: 403, headers: cors });
    }

    // Short edge cache: many viewers asking for the same second share one upstream request.
    const upstream = await fetch(target.toString(), { cf: { cacheTtl: 1, cacheEverything: true } });
    const headers = new Headers(cors);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers });
  }
};
