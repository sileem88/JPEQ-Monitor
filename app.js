/*
 * JPEQ Monitor
 * Unofficial viewer for NIED 強震モニタ data. All data © NIED.
 */
(() => {
  'use strict';

  const CFG = window.JPEQ_CONFIG;

  // Relay: config.js, or ?relay=<url> once (remembered on this device; ?relay=off clears it).
  (() => {
    let relay = CFG.relay || '';
    try {
      const q = new URLSearchParams(location.search).get('relay');
      if (q === 'off') localStorage.removeItem('jpeq.relay');
      else if (q) localStorage.setItem('jpeq.relay', q.replace(/\/+$/, ''));
      relay = localStorage.getItem('jpeq.relay') || relay;
    } catch { /* ignore */ }
    if (relay) {
      CFG.relayActive = relay;
      CFG.proxy = '';
      for (const s of CFG.sources) s.base = relay.replace(/\/+$/, '') + s.relayBase;
    }
  })();
  const $ = (s) => document.querySelector(s);
  const JST = 9 * 3600e3;

  const IMG_TIMEOUT = 4000;
  const JSON_TIMEOUT = 3000;
  const FAILS_BEFORE_SWITCH = 4;
  const RETRY_PRIMARY_MS = 120e3;
  const SYNC_EVERY_MS = 30e3;
  const MAX_EXTRA_DELAY_MS = 12e3;

  const el = {
    status: $('#statusText'), dot: $('#statusDot'),
    mode: $('#modeBadge'), time: $('#frameTime'), date: $('#frameDate'),
    base: $('#baseMap'), rt: $('#rtLayer'), est: $('#estLayer'), ps: $('#psLayer'),
    note: $('#mapNote'), ticks: $('#ticks'),
    measure: $('#measure'), seg: document.querySelectorAll('.seg button'),
    jumps: $('#jumps'), pause: $('#pauseBtn'), live: $('#liveBtn'), behind: $('#behind'),
    src: $('#srcLabel'),
    eew: $('#eew'), eewKind: $('#eewKind'), eewNum: $('#eewNum'), eewRegion: $('#eewRegion'),
    eewInt: $('#eewInt'), eewMag: $('#eewMag'), eewDepth: $('#eewDepth'), eewTime: $('#eewTime')
  };

  const S = {
    mode: 'live',          // 'live' | 'replay'
    paused: false,
    behindMs: 0,           // replay distance behind live
    pausedAt: null,        // frame time held while paused
    replayMin: null,
    srcIdx: 0,
    switchedAt: 0,
    offsetMs: -CFG.defaultDelayMs, // server-latest minus device clock
    synced: false,
    lastSync: 0,
    fails: 0,
    measure: load('measure', 'jma'),
    site: load('site', 's'),
    seq: 0,
    shownSeq: 0,
    timer: null,
    eewActive: false,
    eewBusy: false,
    json: { mode: CFG.proxy ? 'unknown' : 'direct', directFails: 0, lastProbe: 0 }
  };

  /* ---------- helpers ---------- */

  function load(k, d) { try { return localStorage.getItem('jpeq.' + k) || d; } catch { return d; } }
  function save(k, v) { try { localStorage.setItem('jpeq.' + k, v); } catch { /* ignore */ } }
  const pad = (n, w = 2) => String(n).padStart(w, '0');

  function jstParts(ms) {
    const d = new Date(ms + JST);
    const Y = d.getUTCFullYear(), M = pad(d.getUTCMonth() + 1), D = pad(d.getUTCDate());
    const h = pad(d.getUTCHours()), m = pad(d.getUTCMinutes()), s = pad(d.getUTCSeconds());
    return { date: `${Y}${M}${D}`, ts: `${Y}${M}${D}${h}${m}${s}`, hms: `${h}:${m}:${s}`, ymd: `${Y}/${M}/${D}` };
  }

  // "2026/10/19 04:40:12" (JST) -> epoch ms
  function parseJst(str) {
    const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(str || '');
    if (!m) return null;
    return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - JST;
  }

  const src = () => CFG.sources[S.srcIdx];
  function url(kind, t, s = src()) {
    const p = jstParts(t);
    return s.base + s.paths[kind]
      .replaceAll('{layer}', `${S.measure}_${S.site}`)
      .replaceAll('{date}', p.date)
      .replaceAll('{ts}', p.ts);
  }

  function loadImg(u, timeout = IMG_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => { img.src = ''; reject(new Error('timeout')); }, timeout);
      img.onload = () => { clearTimeout(timer); resolve(u); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('error')); };
      img.decoding = 'async';
      img.src = u;
    });
  }

  async function fetchWithTimeout(u, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(u, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw Object.assign(new Error('http ' + r.status), { http: true });
      return await r.json();
    } finally { clearTimeout(t); }
  }

  // JSON needs CORS. Try direct; fall back to the optional proxy.
  async function getJSON(u) {
    const J = S.json;
    if (J.mode === 'none' && Date.now() - J.lastProbe > 300e3) { J.mode = 'direct'; J.directFails = 0; }
    if (J.mode === 'none') return null;

    if (J.mode === 'direct' || J.mode === 'unknown') {
      try {
        const data = await fetchWithTimeout(u, JSON_TIMEOUT);
        J.mode = 'direct'; J.directFails = 0;
        return data;
      } catch (e) {
        if (e.http) return null; // server answered; nothing to do with CORS
        J.directFails++;
        if (CFG.proxy) J.mode = 'proxy';
        else if (J.directFails >= 5) { J.mode = 'none'; J.lastProbe = Date.now(); }
        if (!CFG.proxy) return null;
      }
    }
    try {
      return await fetchWithTimeout(CFG.proxy + encodeURIComponent(u), JSON_TIMEOUT);
    } catch { return null; }
  }

  /* ---------- time ---------- */

  const liveTime = () => Math.floor((Date.now() + S.offsetMs) / 1000) * 1000;
  function frameTime() {
    if (S.mode === 'live') return liveTime();
    if (S.paused) return S.pausedAt;
    return Math.floor((Date.now() + S.offsetMs - S.behindMs) / 1000) * 1000;
  }

  async function syncClock() {
    S.lastSync = Date.now();
    const s = src();
    const data = await getJSON(s.base + s.paths.latest);
    const t = data && parseJst(data.latest_time);
    if (t) {
      S.offsetMs = t - Date.now();
      S.synced = true;
    }
  }

  /* ---------- sources ---------- */

  function switchSource(idx) {
    if (idx === S.srcIdx) return;
    S.srcIdx = idx;
    S.fails = 0;
    S.switchedAt = Date.now();
    S.synced = false;
    el.src.textContent = src().label + (CFG.relayActive ? ' via JPEQ relay' : '');
    loadBaseMap();
    syncClock();
  }

  function loadBaseMap(i = 0) {
    const order = [S.srcIdx, ...CFG.sources.map((_, k) => k).filter((k) => k !== S.srcIdx)];
    if (i >= order.length) return;
    const s = CFG.sources[order[i]];
    el.base.onerror = () => loadBaseMap(i + 1);
    el.base.src = s.base + s.paths.baseMap;
  }

  /* ---------- main loop ---------- */

  function schedule() {
    clearTimeout(S.timer);
    // Fire ~200 ms after each device-clock second.
    const wait = 1200 - (Date.now() % 1000);
    S.timer = setTimeout(tick, wait > 1000 ? wait - 1000 : wait);
  }

  function tick() {
    schedule();
    if (document.hidden) return;

    if (S.mode === 'live' && Date.now() - S.lastSync > SYNC_EVERY_MS) syncClock();
    if (S.srcIdx !== 0 && Date.now() - S.switchedAt > RETRY_PRIMARY_MS) switchSource(0);

    const t = frameTime();
    renderClock(t);
    if (S.paused && el.rt.dataset.t === String(t)) return;
    loadFrame(t);
    loadEEW(t);
  }

  async function loadFrame(t) {
    const seq = ++S.seq;
    const rtUrl = url('realtime', t);
    try {
      await loadImg(rtUrl);
      if (seq < S.shownSeq) return;
      S.shownSeq = seq;
      el.rt.src = rtUrl;
      el.rt.dataset.t = String(t);
      S.fails = 0;
      setStatus('ok', `${src().label} · ${jstParts(t).hms}`);
      el.note.hidden = true;
      if (S.mode === 'replay' && !S.paused) prefetch(t);
    } catch {
      S.fails++;
      // Before the clock is synced, the newest second may not exist yet: lean back.
      if (S.mode === 'live' && !S.synced && S.offsetMs > -MAX_EXTRA_DELAY_MS) S.offsetMs -= 1000;
      if (S.fails >= FAILS_BEFORE_SWITCH && CFG.sources.length > 1) {
        switchSource((S.srcIdx + 1) % CFG.sources.length);
        setStatus('warn', `Switching to ${src().label}…`);
      } else {
        setStatus(S.fails > 1 ? 'bad' : 'warn', 'Retrying…');
      }
      if (S.fails >= 3) {
        el.note.textContent = 'NIED servers are slow to respond. Holding the last frame and retrying.';
        el.note.hidden = false;
      }
    }

    // EEW map overlays: shown only while an EEW is active (or when the
    // EEW text feed is unavailable and an overlay image exists).
    const wantOverlays = S.eewActive || S.json.mode === 'none';
    if (!wantOverlays) { el.est.hidden = el.ps.hidden = true; return; }
    for (const [kind, node] of [['estShindo', el.est], ['psWave', el.ps]]) {
      const u = url(kind, t);
      loadImg(u).then(() => { if (seq >= S.shownSeq) { node.src = u; node.hidden = false; } })
                 .catch(() => { node.hidden = true; });
    }
  }

  function prefetch(t) {
    for (let i = 1; i <= 2; i++) { const img = new Image(); img.src = url('realtime', t + i * 1000); }
  }

  async function loadEEW(t) {
    if (S.eewBusy) return;
    S.eewBusy = true;
    try {
      const data = await getJSON(url('eew', t));
      if (data) renderEEW(data); // keep last state on a failed request
    } finally { S.eewBusy = false; }
  }

  /* ---------- rendering ---------- */

  function setStatus(kind, text) {
    el.dot.className = 'dot ' + kind;
    el.status.textContent = text;
  }

  function fmtBehind(ms) {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${pad(s % 60)}`;
  }

  function renderClock(t) {
    const p = jstParts(t);
    el.time.textContent = p.hms;
    el.date.textContent = `${p.ymd} JST`;
    if (S.mode === 'live') {
      el.mode.textContent = 'LIVE'; el.mode.className = 'mode';
      el.behind.textContent = S.synced ? 'Showing live data'
        : S.json.mode === 'none' ? 'Showing live data (device clock)' : 'Showing live data (clock syncing…)';
    } else {
      el.mode.textContent = S.paused ? 'PAUSED' : 'REPLAY';
      el.mode.className = 'mode ' + (S.paused ? 'paused' : 'replay');
      el.behind.textContent = `${fmtBehind(liveTime() - t)} behind live · tap LIVE to return`;
    }
  }

  function renderEEW(d) {
    const active = d && d.report_id && d.report_id !== '';
    S.eewActive = !!active;
    if (!active) { el.eew.hidden = true; return; }

    const cancel = d.is_cancel === true || d.is_cancel === 'true';
    const final = d.is_final === true || d.is_final === 'true';
    const training = d.is_training === true || d.is_training === 'true';
    const warning = d.alertflg === '警報';

    el.eew.hidden = false;
    el.eew.className = 'eew' + (warning ? ' warning' : '') + (cancel ? ' cancel' : '');
    el.eewKind.textContent = (training ? '［訓練］' : '') +
      (cancel ? '緊急地震速報 取消' : `緊急地震速報（${d.alertflg || '予報'}）`);
    el.eewNum.textContent = `第${d.report_num || '?'}報${final ? '（最終）' : ''}`;
    el.eewRegion.textContent = d.region_name || '—';
    el.eewInt.textContent = d.calcintensity || '—';
    el.eewMag.textContent = d.magunitude ? `M${d.magunitude}` : '—';
    el.eewDepth.textContent = d.depth || '—';
    const o = String(d.origin_time || '');
    el.eewTime.textContent = o.length === 14 ? `${o.slice(8, 10)}:${o.slice(10, 12)}:${o.slice(12, 14)}` : '—';
  }

  function renderLegend() {
    const ticks = S.measure === 'jma'
      ? ['-3', '-1', '1', '3', '5', '7']
      : ['弱', '', '', '', '', '強'];
    el.ticks.innerHTML = ticks.map((x) => `<span>${x}</span>`).join('');
  }

  function renderControls() {
    el.measure.value = S.measure;
    el.seg.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.site === S.site)));
    el.live.setAttribute('aria-pressed', String(S.mode === 'live'));
    el.pause.hidden = S.mode !== 'replay';
    el.pause.textContent = S.paused ? '▶' : '❚❚';
    el.pause.setAttribute('aria-label', S.paused ? 'Resume' : 'Pause');
    el.jumps.querySelectorAll('button').forEach((b) =>
      b.setAttribute('aria-pressed', String(S.mode === 'replay' && +b.dataset.min === S.replayMin)));
  }

  /* ---------- actions ---------- */

  function refreshNow() { S.shownSeq = ++S.seq; S.eewActive = false; el.eew.hidden = true; renderControls(); tick(); }

  function goReplay(min) {
    S.mode = 'replay'; S.paused = false; S.pausedAt = null;
    S.behindMs = min * 60e3; S.replayMin = min;
    refreshNow();
  }

  function goLive() {
    S.mode = 'live'; S.paused = false; S.behindMs = 0; S.replayMin = null;
    refreshNow();
  }

  function togglePause() {
    if (S.mode !== 'replay') return;
    if (!S.paused) { S.pausedAt = frameTime(); S.paused = true; }
    else { S.behindMs = liveTime() - S.pausedAt; S.paused = false; S.pausedAt = null; }
    refreshNow();
  }

  /* ---------- init ---------- */

  function init() {
    el.jumps.innerHTML = CFG.replayMinutes
      .map((m) => `<button type="button" data-min="${m}" aria-pressed="false">−${m} min</button>`).join('');
    el.jumps.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (b) goReplay(+b.dataset.min);
    });
    el.live.addEventListener('click', goLive);
    el.pause.addEventListener('click', togglePause);
    el.measure.addEventListener('change', () => { S.measure = el.measure.value; save('measure', S.measure); renderLegend(); refreshNow(); });
    el.seg.forEach((b) => b.addEventListener('click', () => { S.site = b.dataset.site; save('site', S.site); refreshNow(); }));

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { S.lastSync = 0; refreshNow(); }
    });

    el.src.textContent = src().label + (CFG.relayActive ? ' via JPEQ relay' : '');
    renderLegend();
    renderControls();
    loadBaseMap();
    syncClock().finally(tick);

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  init();
})();
