/*
 * JPEQ Monitor relay (Cloudflare Worker, free plan)
 *
 * Why: the GitHub Pages site is https, and iPhone Safari blocks the http-only
 * kmoni server from an https page. This relay fetches NIED's files and hands
 * them to the page over https.
 *
 *   https://<relay>/kmoni/<path>  ->  http://www.kmoni.bosai.go.jp/<path>
 *   https://<relay>/lmoni/<path>  ->  https://www.lmoni.bosai.go.jp/<path>
 *   https://<relay>/test          ->  checks kmoni and lmoni, and lists the
 *                                     data paths lmoni's own page uses
 *
 * Only NIED's .gif and .json files can pass through. Timestamped frames
 * are cached at Cloudflare, so each second is fetched from NIED once,
 * however many times the page asks for it.
 */

const HOSTS = {
  kmoni: 'www.kmoni.bosai.go.jp',
  lmoni: 'www.lmoni.bosai.go.jp'
};

// kmoni answers on http; lmoni is https-only (http just times out).
const SCHEMES = { kmoni: ['http', 'https'], lmoni: ['https'] };

const UA = 'Mozilla/5.0 (JPEQ Monitor relay; personal viewer; +https://sileem88.github.io/JPEQ-Monitor/)';

async function fetchNied(key, path, init = {}, timeoutMs = 4000) {
  let lastErr;
  for (const scheme of SCHEMES[key]) {
    try {
      const r = await fetch(`${scheme}://${HOSTS[key]}${path}`, {
        ...init,
        headers: { 'User-Agent': UA, ...(init.headers || {}) },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (r.status < 500) return r;
      lastErr = new Error('HTTP ' + r.status);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

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

/* ---------------- self-test ---------------- */

const pad = (n) => String(n).padStart(2, '0');
function jstStamp(ms) {
  const d = new Date(ms + 9 * 3600e3);
  const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  return { date, ts: `${date}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}` };
}
function parseLatest(text) {
  const m = /"latest_time"\s*:\s*"(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})"/.exec(text || '');
  return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - 9 * 3600e3 : null;
}

async function probe(key, path, asText) {
  const t0 = Date.now();
  try {
    const r = await fetchNied(key, path);
    const type = r.headers.get('Content-Type') || '';
    const body = asText ? (await r.text()) : (await r.arrayBuffer()).byteLength;
    const isHtml = type.includes('html') || (typeof body === 'string' && /^\s*<!doctype html/i.test(body));
    const wantHtml = path.endsWith('/');
    return { ok: r.status === 200 && (wantHtml || !isHtml), status: r.status + (isHtml && !wantHtml ? ' (HTML page, not data)' : ''), ms: Date.now() - t0, body };
  } catch (e) {
    return { ok: false, status: 'FAILED', ms: Date.now() - t0, body: e.message };
  }
}

function line(label, path, res) {
  const mark = res.ok ? 'OK ' : '-- ';
  const detail = typeof res.body === 'number' ? `${res.body} bytes` : String(res.body).slice(0, 90).replace(/\s+/g, ' ');
  return `${mark}${label}: ${res.status} in ${res.ms} ms  ${path}\n      ${detail}`;
}

// Read lmoni's page and scripts and list every data path they mention.
async function discoverLmoniPaths() {
  const out = [];
  const page = await probe('lmoni', '/monitor/', true);
  out.push(`lmoni page /monitor/: ${page.status} in ${page.ms} ms`);
  if (!page.ok) return out;
  const scripts = [...page.body.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]).slice(0, 12);
  const found = new Set();
  const grab = (txt) => {
    for (const m of txt.matchAll(/["'`]([^"'`\s]*(?:map_img|webservice|RealTimeImg|CommonImg|latest\.json)[^"'`\s]*)["'`]/g)) found.add(m[1]);
  };
  grab(page.body);
  for (const src of scripts) {
    if (/^https?:\/\//.test(src) && !src.includes(HOSTS.lmoni)) continue;
    const path = src.startsWith('http') ? new URL(src).pathname : src.startsWith('/') ? src : '/monitor/' + src.replace(/^\.\//, '');
    const js = await probe('lmoni', path, true);
    out.push(`  script ${path}: ${js.status}`);
    if (js.ok) grab(js.body);
  }
  out.push('  data paths mentioned by lmoni:');
  if (!found.size) out.push('    (none found)');
  for (const p of [...found].slice(0, 40)) out.push('    ' + p);
  return out;
}

async function selfTest() {
  const L = ['JPEQ relay self-test', ''];

  // kmoni
  L.push('== kmoni ==');
  const kt = await probe('kmoni', '/webservice/server/pros/latest.json', true);
  L.push(line('time', '/webservice/server/pros/latest.json', kt));
  const kLatest = parseLatest(kt.body) ?? Date.now() - 3000;
  const k = jstStamp(kLatest);
  const kmap = `/data/map_img/RealTimeImg/jma_s/${k.date}/${k.ts}.jma_s.gif`;
  L.push(line('map', kmap, await probe('kmoni', kmap)));
  L.push('');

  // lmoni: paths used by lmoni's own page (prism_longperiod.js)
  L.push('== lmoni (https) ==');
  const lt = await probe('lmoni', '/img_svr/webservice/server/pros/latest.json', true);
  L.push(line('time', '/img_svr/webservice/server/pros/latest.json', lt));
  const l = jstStamp(parseLatest(lt.body) ?? kLatest);
  const lmap = `/img_svr/data/map_img/RealTimeImg/jma_s/${l.date}/${l.ts}.jma_s.gif`;
  L.push(line('map', lmap, await probe('lmoni', lmap)));
  const lbase = '/monitor/data/data/map_img/CommonImg/base_map_w.gif';
  L.push(line('base map', lbase, await probe('lmoni', lbase)));
  const leew = `/monitor/webservice/hypo/eew/${l.ts}.json`;
  L.push(line('eew', leew, await probe('lmoni', leew, true)));
  L.push('');

  L.push('== lmoni page scan ==');
  try { L.push(...await discoverLmoniPaths()); } catch (e) { L.push('scan failed: ' + e.message); }

  return new Response(L.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/* ---------------- relay ---------------- */

export default {
  async fetch(request) {
    const cors = corsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === '/') return new Response('JPEQ relay is running. Open /test to check NIED.', { headers: cors });
    if (url.pathname === '/test') return selfTest();

    const m = /^\/(kmoni|lmoni)(\/.+)$/.exec(url.pathname);
    if (!m || !/\.(gif|json)$/.test(m[2]) || m[2].includes('..')) {
      return new Response('Not allowed', { status: 403, headers: cors });
    }

    // Frames named by timestamp never change; "latest" style files change every second.
    const timestamped = /\d{14}\.[a-z_0-9.]+$/.test(m[2]);
    const isBaseMap = m[2].includes('/CommonImg/');
    const ttl = timestamped || isBaseMap ? 86400 : 1;

    let upstream;
    try {
      upstream = await fetchNied(m[1], m[2], {
        cf: { cacheEverything: true, cacheTtl: ttl, cacheTtlByStatus: { '200-299': ttl, '404': 1, '500-599': 0 } }
      });
    } catch (e) {
      return new Response('Upstream unreachable', { status: 502, headers: cors });
    }

    const headers = new Headers(cors);
    headers.set('Content-Type', upstream.headers.get('Content-Type') || (m[2].endsWith('.json') ? 'application/json' : 'image/gif'));
    headers.set('Cache-Control', upstream.status === 200 && (timestamped || isBaseMap) ? 'public, max-age=86400, immutable' : 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers });
  }
};
