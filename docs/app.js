/*
 * JPEQ Map — official JMA seismic intensity by station, on GSI's pale map.
 * Data: 気象庁ホームページ（地震情報）. Map: 地理院タイル（淡色地図）.
 */
(() => {
  'use strict';

  const CFG = window.JPEQ_MAP;
  const $ = (s) => document.querySelector(s);
  const el = {
    dot: $('#dot'), status: $('#status'), toast: $('#toast'), list: $('#list'), ver: $('#ver'),
    cMax: $('#cMax'), cTitle: $('#cTitle'), cRegion: $('#cRegion'), cMeta: $('#cMeta'),
    cComment: $('#cComment'), cNote: $('#cNote')
  };

  /* ---------- intensity helpers ---------- */

  const INT = {
    '1': { cls: 'i1', label: '1', rank: 1 }, '2': { cls: 'i2', label: '2', rank: 2 },
    '3': { cls: 'i3', label: '3', rank: 3 }, '4': { cls: 'i4', label: '4', rank: 4 },
    '5-': { cls: 'i5m', label: '5弱', rank: 5 }, '5+': { cls: 'i5p', label: '5強', rank: 6 },
    '6-': { cls: 'i6m', label: '6弱', rank: 7 }, '6+': { cls: 'i6p', label: '6強', rank: 8 },
    '7': { cls: 'i7', label: '7', rank: 9 }
  };
  const COLORS = getComputedStyle(document.documentElement);
  const color = (cls) => COLORS.getPropertyValue('--' + cls).trim();
  // "!5-" = 震度5弱以上未入電 (estimated 5弱 or more, not yet received)
  function intInfo(v) {
    if (!v) return null;
    const unconfirmed = String(v).startsWith('!');
    const base = INT[String(v).replace('!', '')];
    return base ? { ...base, unconfirmed, label: base.label + (unconfirmed ? '以上未入電' : '') } : null;
  }

  /* ---------- formatting ---------- */

  const pad = (n) => String(n).padStart(2, '0');
  function fmtTime(iso, withDate = true) {
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const j = new Date(d.getTime() + 9 * 3600e3);
    const hm = `${pad(j.getUTCHours())}:${pad(j.getUTCMinutes())}`;
    return withDate ? `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${hm}` : hm;
  }
  // "+37.2+140.6-80000/" -> { lat, lon, depthKm }
  function parseCoord(s) {
    const m = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+)?\//.exec(s || '');
    if (!m) return null;
    return { lat: +m[1], lon: +m[2], depthKm: m[3] != null ? Math.round(-m[3] / 1000) : null };
  }
  const depthText = (km) => (km == null ? '不明' : km === 0 ? 'ごく浅い' : `${km}km`);
  const magText = (m) => (m && !isNaN(+m) ? `M${(+m).toFixed(1)}` : 'M不明');

  /* ---------- data ---------- */

  let baseIdx = 0;
  async function getJSON(name) {
    for (let k = 0; k < CFG.jmaBases.length; k++) {
      const i = (baseIdx + k) % CFG.jmaBases.length;
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      try {
        const r = await fetch(`${CFG.jmaBases[i]}/${name}`, { signal: ctl.signal, cache: 'no-store' });
        if (r.ok) { baseIdx = i; return await r.json(); }
      } catch { /* try next */ } finally { clearTimeout(t); }
    }
    throw new Error('unreachable');
  }

  const detailCache = new Map();
  async function getDetail(json) {
    if (!detailCache.has(json)) detailCache.set(json, getJSON(json).catch((e) => { detailCache.delete(json); throw e; }));
    return detailCache.get(json);
  }

  // Group list.json entries by event; pick the most useful report for each.
  function groupEvents(list) {
    const byEid = new Map();
    for (const e of list) {
      if (!e.eid || !e.json) continue;
      if (!byEid.has(e.eid)) byEid.set(e.eid, []);
      byEid.get(e.eid).push(e);
    }
    const events = [];
    for (const [eid, items] of byEid) {
      items.sort((a, b) => String(b.rdt).localeCompare(String(a.rdt)) || String(b.ctt).localeCompare(String(a.ctt)));
      const latest = items[0];
      // Prefer the newest report that carries station data (震源・震度情報).
      const detailed = items.find((x) => x.ttl === '震源・震度情報') || items.find((x) => x.ttl === '震度速報') || latest;
      const withHypo = items.find((x) => x.cod) || {};
      const withMax = items.find((x) => x.maxi) || {};
      events.push({
        eid, json: detailed.json, ttl: detailed.ttl, at: latest.at || withHypo.at, rdt: latest.rdt,
        anm: withHypo.anm || latest.anm || '', mag: withHypo.mag || latest.mag, cod: withHypo.cod,
        maxi: withMax.maxi || '', cancelled: latest.ift === '取消'
      });
    }
    events.sort((a, b) => String(b.eid).localeCompare(String(a.eid)));
    return events.slice(0, CFG.listSize);
  }

  /* ---------- map ---------- */

  const map = L.map('map', { zoomControl: false, preferCanvas: true, attributionControl: true })
    .setView([37.5, 137.5], 5);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.attributionControl.setPrefix(false);
  L.tileLayer(CFG.tiles.url, {
    maxZoom: 18, maxNativeZoom: CFG.tiles.maxNativeZoom, minZoom: 4, attribution: CFG.tiles.attribution
  }).addTo(map);

  const layer = L.layerGroup().addTo(map);
  const canvas = L.canvas({ padding: 0.3 });
  let markers = [];

  function radiusFor(z) { return z <= 5 ? 3.5 : z <= 7 ? 5 : z <= 9 ? 7 : 9; }
  map.on('zoomend', () => { const r = radiusFor(map.getZoom()); markers.forEach((m) => m.setRadius(r)); });

  function drawEvent(ev, detail) {
    layer.clearLayers(); markers = [];
    const pts = [];
    const r = radiusFor(map.getZoom());

    // Stations, weakest first so the strongest are drawn on top.
    const stations = [];
    const obs = detail && detail.Body && detail.Body.Intensity && detail.Body.Intensity.Observation;
    for (const p of (obs && obs.Pref) || []) for (const a of p.Area || []) for (const c of a.City || []) {
      for (const s of c.IntensityStation || []) {
        const info = intInfo(s.Int);
        if (!info || !s.latlon) continue;
        stations.push({ s, info, pref: p.Name });
      }
    }
    stations.sort((x, y) => x.info.rank - y.info.rank);
    for (const { s, info, pref } of stations) {
      const ll = [s.latlon.lat, s.latlon.lon];
      const m = L.circleMarker(ll, {
        renderer: canvas, radius: r, weight: 1, color: '#333', fillColor: color(info.cls), fillOpacity: 1
      }).bindPopup(`<b>震度${info.label}</b><br>${s.Name}<br><small>${pref}</small>`);
      m.addTo(layer); markers.push(m);
      if (info.rank >= 2) pts.push(ll);
    }

    // Epicentre
    const q = (detail && detail.Body && detail.Body.Earthquake) || {};
    const hypo = parseCoord((q.Hypocenter && q.Hypocenter.Area && q.Hypocenter.Area.Coordinate) || ev.cod);
    if (hypo) {
      L.marker([hypo.lat, hypo.lon], {
        icon: L.divIcon({ className: '', html: '<div class="epi">×</div>', iconSize: [30, 30], iconAnchor: [15, 17] }),
        interactive: false, zIndexOffset: 1000
      }).addTo(layer);
      pts.push([hypo.lat, hypo.lon]);
    }

    if (!pts.length && stations.length) stations.forEach(({ s }) => pts.push([s.latlon.lat, s.latlon.lon]));
    if (pts.length >= 2) map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 9 });
    else if (pts.length === 1) map.setView(pts[0], 7);
    return stations.length;
  }

  /* ---------- UI ---------- */

  function chip(maxi) {
    const info = intInfo(maxi);
    return info ? { cls: info.cls, text: info.label.replace('以上未入電', '+') } : { cls: 'inone', text: '-' };
  }

  function renderList(events, selected) {
    el.list.innerHTML = '';
    for (const ev of events) {
      const c = chip(ev.maxi);
      const li = document.createElement('li');
      li.setAttribute('aria-current', String(ev.eid === selected));
      li.innerHTML = `<div class="chip ${c.cls}">${c.text}</div>
        <div class="l-text"><div class="l-region"></div><div class="l-meta"></div></div>`;
      li.querySelector('.l-region').textContent = ev.anm || (ev.ttl === '震度速報' ? '震度速報（震源調査中）' : ev.ttl);
      li.querySelector('.l-meta').textContent =
        `${fmtTime(ev.at)}頃${ev.anm ? ' · ' + magText(ev.mag) : ''}${ev.cancelled ? ' · 取消' : ''}`;
      li.addEventListener('click', () => { userPicked = ev.eid !== events[0].eid; select(ev); });
      el.list.appendChild(li);
    }
  }

  function renderCard(ev, detail, stationCount) {
    const c = chip(ev.maxi);
    el.cMax.className = 'maxint ' + c.cls;
    el.cMax.innerHTML = c.text === '-' ? '-' : `<span>${c.text}</span>`;
    const q = (detail && detail.Body && detail.Body.Earthquake) || {};
    const hypo = parseCoord((q.Hypocenter && q.Hypocenter.Area && q.Hypocenter.Area.Coordinate) || ev.cod);
    el.cTitle.textContent = `${ev.ttl}　${fmtTime(q.OriginTime || ev.at)}頃発生`;
    const region = (q.Hypocenter && q.Hypocenter.Area && q.Hypocenter.Area.Name) || ev.anm;
    el.cRegion.textContent = region || (ev.ttl === '震度速報' ? '震源は調査中' : '—');
    el.cMeta.textContent = region || hypo
      ? `${magText(q.Magnitude || ev.mag)} · 深さ ${depthText(hypo && hypo.depthKm)} · 最大震度 ${intInfo(ev.maxi)?.label || '—'}`
      : `最大震度 ${intInfo(ev.maxi)?.label || '—'} · 震源・規模は続報で発表`;
    const fc = detail && detail.Body && detail.Body.Comments && detail.Body.Comments.ForecastComment;
    el.cComment.textContent = fc && fc.Text ? fc.Text.replace(/\s+/g, ' ') : '';
    if (stationCount) {
      el.cNote.textContent = `震度観測点 ${stationCount}地点を表示（名称の＊は地方公共団体・防災科研の観測点）。点をタップで詳細。`;
    } else if (detail && detail.Body && detail.Body.Intensity) {
      // 震度速報: area-level only, stations follow in the next report
      const areas = [];
      for (const p of detail.Body.Intensity.Observation.Pref || []) for (const a of p.Area || []) areas.push(a);
      areas.sort((x, y) => (intInfo(y.MaxInt)?.rank || 0) - (intInfo(x.MaxInt)?.rank || 0));
      el.cNote.textContent = '震度速報（地域ごと）：' + areas.slice(0, 6).map((a) => `${a.Name} ${intInfo(a.MaxInt)?.label || ''}`).join('、') +
        (areas.length > 6 ? ` ほか${areas.length - 6}地域` : '') + '。観測点ごとの震度は続報で表示されます。';
    } else {
      el.cNote.textContent = '';
    }
  }

  let events = [], selectedEid = null, userPicked = false, shownJson = null;

  async function select(ev) {
    selectedEid = ev.eid;
    renderList(events, selectedEid);
    renderCard(ev, null, 0);
    try {
      const d = await getDetail(ev.json);
      if (selectedEid !== ev.eid) return;
      shownJson = ev.json;
      const n = drawEvent(ev, d);
      renderCard(ev, d, n);
    } catch {
      drawEvent(ev, null);
      el.cNote.textContent = '詳細を読み込めませんでした。';
    }
  }

  function toast(text) {
    el.toast.textContent = text; el.toast.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { el.toast.hidden = true; }, 5000);
  }
  function setStatus(kind, text) { el.dot.className = 'dot ' + kind; el.status.textContent = text; }

  async function refresh() {
    try {
      const list = await getJSON('list.json');
      const next = groupEvents(Array.isArray(list) ? list : []);
      const newest = next[0];
      const prevNewest = events[0];
      events = next;
      const now = new Date();
      setStatus('ok', `更新 ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`);
      if (!newest) { renderList(events, null); return; }

      const isNew = prevNewest && newest.eid !== prevNewest.eid;
      if (isNew) toast(`新しい地震情報：${newest.anm || newest.ttl}${newest.maxi ? ' 最大震度' + (intInfo(newest.maxi)?.label || '') : ''}`);
      if (!selectedEid || (isNew && !userPicked)) return select(newest);

      // Refresh the shown event if a newer report replaced it.
      const cur = events.find((e) => e.eid === selectedEid);
      renderList(events, selectedEid);
      if (cur && cur.json !== shownJson) select(cur);
    } catch {
      setStatus('bad', '気象庁に接続できません（再試行中）');
    }
  }

  let timer = null;
  function start() { clearInterval(timer); refresh(); timer = setInterval(() => { if (!document.hidden) refresh(); }, CFG.refreshMs); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  el.ver.textContent = CFG.version;
  start();
})();
