/*
 * JPEQ Monitor — private live viewer
 *
 * Map frames: NIED 強震モニタ (kmoni), with lmoni as backup, fetched through
 * this site's own Worker (same origin). Shown unmodified, for private viewing.
 * EEW text: P2P地震情報 (緊急地震速報（警報）, from JMA via a licensed feed).
 */
(() => {
  'use strict';

  const CFG = window.JPEQ_CONFIG;
  for (const s of CFG.sources) s.base = location.origin + s.relayBase;

  const $ = (s) => document.querySelector(s);
  const JST = 9 * 3600e3;

  const IMG_TIMEOUT = 4000;
  const JSON_TIMEOUT = 3000;
  const FAILS_BEFORE_SWITCH = 4;
  const RETRY_PRIMARY_MS = 120e3;
  const SYNC_EVERY_MS = 30e3;
  const MAX_EXTRA_DELAY_MS = 12e3;
  const EEW_SHOW_MS = 180e3;      // keep an EEW on screen this long after origin time
  const CANCEL_SHOW_MS = 30e3;    // keep a cancellation on screen this long
  const OVERLAY_PROBE_MS = 5000;  // check NIED's EEW map overlays this often when no EEW

  const el = {
    status: $('#statusText'), dot: $('#statusDot'),
    mode: $('#modeBadge'), time: $('#frameTime'), date: $('#frameDate'),
    base: $('#baseMap'), rt: $('#rtLayer'), est: $('#estLayer'), ps: $('#psLayer'),
    note: $('#mapNote'), ticks: $('#ticks'),
    jumps: $('#jumps'), pause: $('#pauseBtn'), live: $('#liveBtn'), behind: $('#behind'),
    src: $('#srcLabel'), ver: $('#verLabel'), feed: $('#feedLabel'),
    eew: $('#eew'), eewKind: $('#eewKind'), eewNum: $('#eewNum'), eewRegion: $('#eewRegion'),
    eewInt: $('#eewInt'), eewMag: $('#eewMag'), eewDepth: $('#eewDepth'), eewTime: $('#eewTime'),
    eewAreas: $('#eewAreas')
  };

  const S = {
    mode: 'live', paused: false, behindMs: 0, pausedAt: null, replayMin: null,
    srcIdx: 0, forcedSrc: false, switchedAt: 0,
    offsetMs: -CFG.defaultDelayMs, synced: false, lastSync: 0,
    fails: 0, seq: 0, shownSeq: 0, timer: null,
    lastOverlayProbe: 0, overlayHits: 0
  };

  /* ---------- helpers ---------- */

  const pad = (n, w = 2) => String(n).padStart(w, '0');
  function jstParts(ms) {
    const d = new Date(ms + JST);
    const Y = d.getUTCFullYear(), M = pad(d.getUTCMonth() + 1), D = pad(d.getUTCDate());
    const h = pad(d.getUTCHours()), m = pad(d.getUTCMinutes()), s = pad(d.getUTCSeconds());
    return { date: `${Y}${M}${D}`, ts: `${Y}${M}${D}${h}${m}${s}`, hms: `${h}:${m}:${s}`, ymd: `${Y}/${M}/${D}` };
  }
  // "2026/10/19 04:40:12(.123)" (JST) -> epoch ms
  function parseJst(str) {
    const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(str || '');
    if (!m) return null;
    return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - JST;
  }

  const src = () => CFG.sources[S.srcIdx];
  function url(kind, t, s = src()) {
    const p = jstParts(t);
    return s.base + s.paths[kind]
      .replaceAll('{layer}', 'jma_s') // リアルタイム震度 (surface)
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

  async function getJSON(u, ms = JSON_TIMEOUT) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(u, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; } finally { clearTimeout(t); }
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
    const data = await getJSON(src().base + src().paths.latest);
    const t = data && parseJst(data.latest_time);
    if (t) { S.offsetMs = t - Date.now(); S.synced = true; }
  }

  /* ---------- sources ---------- */

  function sourceLabel() { return src().label + (S.forcedSrc ? ' (pinned)' : ''); }

  function switchSource(idx) {
    if (idx === S.srcIdx) return;
    S.srcIdx = idx; S.fails = 0; S.switchedAt = Date.now(); S.synced = false;
    el.src.textContent = sourceLabel();
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
    const wait = 1200 - (Date.now() % 1000); // ~200 ms after each second
    S.timer = setTimeout(tick, wait > 1000 ? wait - 1000 : wait);
  }

  function tick() {
    schedule();
    if (document.hidden) return;
    if (S.mode === 'live' && Date.now() - S.lastSync > SYNC_EVERY_MS) syncClock();
    if (!S.forcedSrc && S.srcIdx !== 0 && Date.now() - S.switchedAt > RETRY_PRIMARY_MS) switchSource(0);

    const t = frameTime();
    renderClock(t);
    renderEEW(EEW.activeAt(eewTime(t)));
    if (S.paused && el.rt.dataset.t === String(t)) return;
    loadFrame(t);
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
      if (S.mode === 'live' && !S.synced && S.offsetMs > -MAX_EXTRA_DELAY_MS) S.offsetMs -= 1000;
      if (!S.forcedSrc && S.fails >= FAILS_BEFORE_SWITCH && CFG.sources.length > 1) {
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
    loadOverlays(t, seq);
  }

  // NIED's own EEW map layers (estimated intensity, P/S wave circles).
  // Every second while an EEW is known or the layers were recently present;
  // otherwise a light check every few seconds (catches 予報-level EEWs too).
  function loadOverlays(t, seq) {
    const busy = EEW.activeAt(eewTime(t)) || S.overlayHits > 0;
    if (!busy && Date.now() - S.lastOverlayProbe < OVERLAY_PROBE_MS) return;
    S.lastOverlayProbe = Date.now();
    let hits = 0, done = 0;
    for (const [kind, node] of [['estShindo', el.est], ['psWave', el.ps]]) {
      const u = url(kind, t);
      loadImg(u)
        .then(() => { hits++; if (seq >= S.shownSeq) { node.src = u; node.hidden = false; } })
        .catch(() => { node.hidden = true; })
        .finally(() => { if (++done === 2) S.overlayHits = hits ? 10 : Math.max(0, S.overlayHits - 1); });
    }
  }

  function prefetch(t) {
    for (let i = 1; i <= 2; i++) { const img = new Image(); img.src = url('realtime', t + i * 1000); }
  }

  /* ---------- EEW from P2P地震情報 ---------- */

  // Live: EEWs show the moment they arrive (the map itself runs 2-3 s behind).
  // Replay: show what had been issued at the replayed moment.
  const eewTime = (t) => (S.mode === 'live' ? Math.max(t, Date.now() + 1000) : t);

  const SCALE = { 10: '1', 20: '2', 30: '3', 40: '4', 45: '5弱', 46: '5弱以上', 50: '5強', 55: '6弱', 60: '6強', 70: '7' };
  const scaleText = (n) => SCALE[Math.trunc(n)] || '—';

  const EEW = {
    events: new Map(), // eventId -> latest report
    ws: null, retryMs: 5000, retryTimer: null, lastHistory: 0,

    add(d) {
      if (!d || d.code !== 556 || !d.issue || d.test) return;
      const key = d.issue.eventId || d.id;
      const list = this.events.get(key) || [];
      if (list.some((x) => x.id === d.id && x.issue.serial === d.issue.serial)) return;
      list.push(d);
      list.sort((a, b) => (+a.issue.serial || 0) - (+b.issue.serial || 0));
      this.events.set(key, list);
      if (this.events.size > 50) this.events.delete(this.events.keys().next().value); // keep it small
    },

    // The most recent EEW that should be on screen at frame time t.
    activeAt(t) {
      let best = null, bestIssued = -Infinity;
      for (const list of this.events.values()) {
        // latest report of this event already issued at time t
        let d = null, issued = null;
        for (const x of list) {
          const it = parseJst(x.issue.time) ?? parseJst(x.time);
          if (it != null && it <= t) { d = x; issued = it; }
        }
        if (!d) continue;
        const origin = parseJst(d.earthquake && d.earthquake.originTime) ?? issued;
        if (t - (d.cancelled ? issued : origin) > (d.cancelled ? CANCEL_SHOW_MS : EEW_SHOW_MS)) continue;
        if (issued > bestIssued) { best = d; bestIssued = issued; }
      }
      return best;
    },

    async loadHistory() {
      if (Date.now() - this.lastHistory < 60e3) return;
      this.lastHistory = Date.now();
      const list = await getJSON(CFG.p2p.history, 6000);
      if (Array.isArray(list)) list.forEach((d) => this.add(d));
    },

    connect() {
      if (this.ws || document.hidden) return;
      clearTimeout(this.retryTimer);
      let ws;
      try { ws = new WebSocket(CFG.p2p.ws); } catch { return this.retry(); }
      this.ws = ws;
      ws.onopen = () => { this.retryMs = 5000; el.feed.textContent = 'EEW feed connected'; };
      ws.onmessage = (e) => {
        try { this.add(JSON.parse(e.data)); } catch { return; }
        renderEEW(this.activeAt(eewTime(frameTime())));
      };
      ws.onclose = () => { this.ws = null; el.feed.textContent = 'EEW feed reconnecting'; this.retry(); };
      ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
    },
    retry() {
      if (document.hidden) return;
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 60e3);
    },
    // Close while the page is hidden: P2P地震情報 allows only 2 connections per IP.
    pause() { clearTimeout(this.retryTimer); if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; } },
    resume() { this.loadHistory(); this.connect(); }
  };

  /* ---------- rendering ---------- */

  function setStatus(kind, text) { el.dot.className = 'dot ' + kind; el.status.textContent = text; }

  function fmtBehind(ms) { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${pad(s % 60)}`; }

  function renderClock(t) {
    const p = jstParts(t);
    el.time.textContent = p.hms;
    el.date.textContent = `${p.ymd} JST`;
    if (S.mode === 'live') {
      el.mode.textContent = 'LIVE'; el.mode.className = 'mode';
      el.behind.textContent = S.synced ? 'Showing live data' : 'Showing live data (clock syncing…)';
    } else {
      el.mode.textContent = S.paused ? 'PAUSED' : 'REPLAY';
      el.mode.className = 'mode ' + (S.paused ? 'paused' : 'replay');
      el.behind.textContent = `${fmtBehind(liveTime() - t)} behind live · tap LIVE to return`;
    }
  }

  let shownEEW = null;
  function renderEEW(d) {
    if (d === shownEEW) return;
    shownEEW = d;
    if (!d) { el.eew.hidden = true; return; }
    const q = d.earthquake || {}, h = q.hypocenter || {};
    const areas = (d.areas || []).slice().sort((a, b) => (b.scaleFrom || 0) - (a.scaleFrom || 0));
    const top = areas[0];
    const maxText = top ? (top.scaleTo === 99 ? `${scaleText(top.scaleFrom)}以上` : scaleText(top.scaleTo || top.scaleFrom)) : '—';
    const ot = parseJst(q.originTime);

    el.eew.hidden = false;
    el.eew.className = 'eew warning' + (d.cancelled ? ' cancel' : '');
    el.eewKind.textContent = d.cancelled ? '緊急地震速報 取消' : '緊急地震速報（警報）';
    el.eewNum.textContent = d.issue && d.issue.serial ? `第${d.issue.serial}報` : '';
    el.eewRegion.textContent = h.name || '—';
    el.eewInt.textContent = d.cancelled ? '—' : maxText;
    el.eewMag.textContent = h.magnitude > 0 ? `M${h.magnitude}` : '—';
    el.eewDepth.textContent = h.depth >= 0 ? `${Math.trunc(h.depth)}km` : '—';
    el.eewTime.textContent = ot ? jstParts(ot).hms : '—';
    const names = areas.slice(0, 3).map((a) => a.name).filter(Boolean);
    el.eewAreas.textContent = names.length
      ? `対象：${names.join('、')}${areas.length > 3 ? ` ほか${areas.length - 3}地域` : ''}`
      : (q.condition === '仮定震源要素' ? '仮定震源要素' : '');
  }

  function renderLegend() {
    el.ticks.innerHTML = ['-3', '-1', '1', '3', '5', '7'].map((x) => `<span>${x}</span>`).join('');
  }

  function renderControls() {
    el.live.setAttribute('aria-pressed', String(S.mode === 'live'));
    el.pause.hidden = S.mode !== 'replay';
    el.pause.textContent = S.paused ? '▶' : '❚❚';
    el.pause.setAttribute('aria-label', S.paused ? 'Resume' : 'Pause');
    el.jumps.querySelectorAll('button').forEach((b) =>
      b.setAttribute('aria-pressed', String(S.mode === 'replay' && +b.dataset.min === S.replayMin)));
  }

  /* ---------- actions ---------- */

  function refreshNow() { S.shownSeq = ++S.seq; S.overlayHits = 0; S.lastOverlayProbe = 0; renderControls(); tick(); }

  function goReplay(min) {
    S.mode = 'replay'; S.paused = false; S.pausedAt = null;
    S.behindMs = min * 60e3; S.replayMin = min;
    EEW.lastHistory = 0; EEW.loadHistory();
    refreshNow();
  }
  function goLive() { S.mode = 'live'; S.paused = false; S.behindMs = 0; S.replayMin = null; refreshNow(); }
  function togglePause() {
    if (S.mode !== 'replay') return;
    if (!S.paused) { S.pausedAt = frameTime(); S.paused = true; }
    else { S.behindMs = liveTime() - S.pausedAt; S.paused = false; S.pausedAt = null; }
    refreshNow();
  }

  /* ---------- init ---------- */

  function init() {
    try {
      const idx = CFG.sources.findIndex((x) => x.id === new URLSearchParams(location.search).get('source'));
      if (idx >= 0) { S.srcIdx = idx; S.forcedSrc = true; }
    } catch { /* ignore */ }

    el.jumps.innerHTML = CFG.replayMinutes
      .map((m) => `<button type="button" data-min="${m}" aria-pressed="false">−${m} min</button>`).join('');
    el.jumps.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) goReplay(+b.dataset.min); });
    el.live.addEventListener('click', goLive);
    el.pause.addEventListener('click', togglePause);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { EEW.pause(); return; }
      S.lastSync = 0; EEW.resume(); refreshNow();
    });

    el.src.textContent = sourceLabel();
    el.ver.textContent = CFG.version || '';
    renderLegend();
    renderControls();
    loadBaseMap();
    EEW.resume();
    syncClock().finally(tick);

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  init();
})();
