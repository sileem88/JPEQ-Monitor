/*
 * JPEQ Map — optional public Worker for JMA earthquake files.
 *
 * Only needed if the browser can't read JMA's files directly (cross-site
 * blocking). Create a separate Worker (e.g. "jpeq-public", NOT behind Cloudflare
 * Access), paste this file, Deploy, then add
 *   'https://jpeq-public.<subdomain>.workers.dev/quake'
 * as the second entry of jmaBases in docs/config.js.
 *
 * Passes through only JMA's earthquake list and report files, with a short
 * cache so many viewers share one request to JMA.
 * Data: 気象庁ホームページ（地震情報）, reused under JMA's 公共データ利用規約 with attribution.
 */
const ALLOWED_ORIGINS = ['https://sileem88.github.io'];
const JMA = 'https://www.jma.go.jp/bosai/quake/data';

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    const cors = { 'Vary': 'Origin' };
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      cors['Access-Control-Allow-Origin'] = origin;
      cors['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    }
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

    const m = /^\/quake\/(list\.json|[0-9A-Za-z_]+\.json)$/.exec(new URL(request.url).pathname);
    if (!m) return new Response('Not allowed', { status: 403, headers: cors });

    const isList = m[1] === 'list.json';
    let r;
    try {
      r = await fetch(`${JMA}/${m[1]}`, {
        signal: AbortSignal.timeout(8000),
        cf: { cacheEverything: true, cacheTtl: isList ? 10 : 86400 }
      });
    } catch {
      return new Response('JMA unreachable', { status: 502, headers: cors });
    }
    const headers = new Headers(cors);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', isList ? 'no-store' : 'public, max-age=86400');
    return new Response(r.body, { status: r.status, headers });
  }
};
