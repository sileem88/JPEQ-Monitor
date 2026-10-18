/*
 * JPEQ Monitor relay (Cloudflare Worker, free plan)
 *
 * Why: the GitHub Pages site is https, NIED's monitors serve plain http,
 * and iPhone Safari blocks http requests from an https page. This relay
 * fetches NIED's files over http and hands them to the page over https.
 *
 *   https://<relay>/kmoni/<path>  ->  http://www.kmoni.bosai.go.jp/<path>
 *   https://<relay>/lmoni/<path>  ->  http://www.lmoni.bosai.go.jp/<path>
 *   https://<relay>/test          ->  quick check that NIED is reachable
 *
 * Only NIED's .gif and .json files can pass through. Timestamped frames
 * are cached at Cloudflare, so each second is fetched from NIED once,
 * however many times the page asks for it.
 */

const HOSTS = {
  kmoni: 'www.kmoni.bosai.go.jp',
  lmoni: 'www.lmoni.bosai.go.jp'
};

// Sites allowed to read data through this relay.
const ALLOWED_ORIGINS = ['https://sileem88.github.io'];

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const h = { 'Vary': 'Origin' };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
  }
  return h;
}

async function selfTest() {
  const now = new Date(Date.now() + 9 * 3600e3 - 3000); // JST, 3 s ago
  const p = (n) => String(n).padStart(2, '0');
  const date = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}`;
  const ts = `${date}${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  const checks = {
    'kmoni time':  `http://${HOSTS.kmoni}/webservice/server/pros/latest.json`,
    'kmoni map':   `http://${HOSTS.kmoni}/data/map_img/RealTimeImg/jma_s/${date}/${ts}.jma_s.gif`,
    'lmoni time':  `http://${HOSTS.lmoni}/monitor/webservice/server/pros/latest.json`,
    'lmoni map':   `http://${HOSTS.lmoni}/monitor/data/data/map_img/RealTimeImg/jma_s/${date}/${ts}.jma_s.gif`
  };
  const lines = ['JPEQ relay self-test', ''];
  for (const [name, url] of Object.entries(checks)) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const body = name.endsWith('time') ? (await r.text()).slice(0, 120) : `${(await r.arrayBuffer()).byteLength} bytes`;
      lines.push(`${name}: HTTP ${r.status} in ${Date.now() - t0} ms — ${body}`);
    } catch (e) {
      lines.push(`${name}: FAILED after ${Date.now() - t0} ms — ${e.message}`);
    }
  }
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request) {
    const cors = corsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === '/' ) return new Response('JPEQ relay is running. Open /test to check NIED.', { headers: cors });
    if (url.pathname === '/test') return selfTest();

    const m = /^\/(kmoni|lmoni)(\/.+)$/.exec(url.pathname);
    if (!m || !/\.(gif|json)$/.test(m[2]) || m[2].includes('..')) {
      return new Response('Not allowed', { status: 403, headers: cors });
    }
    const target = `http://${HOSTS[m[1]]}${m[2]}`;

    // Frames named by timestamp never change; "latest" style files change every second.
    const timestamped = /\d{14}\.[a-z_0-9.]+$/.test(m[2]);
    const isBaseMap = m[2].includes('/CommonImg/');
    const ttl = timestamped ? 86400 : isBaseMap ? 86400 : 1;

    let upstream;
    try {
      upstream = await fetch(target, {
        signal: AbortSignal.timeout(6000),
        cf: { cacheEverything: true, cacheTtl: ttl, cacheTtlByStatus: { '200-299': ttl, '404': 1, '500-599': 0 } }
      });
    } catch (e) {
      return new Response('Upstream unreachable', { status: 502, headers: cors });
    }

    const headers = new Headers(cors);
    headers.set('Content-Type', upstream.headers.get('Content-Type') || (m[2].endsWith('.json') ? 'application/json' : 'image/gif'));
    headers.set('Cache-Control', timestamped || isBaseMap ? 'public, max-age=86400, immutable' : 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers });
  }
};
