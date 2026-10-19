/*
 * JPEQ Monitor — data source configuration
 *
 * All earthquake data is provided by NIED (防災科学技術研究所) through
 * 強震モニタ (kmoni) and 長周期地震動モニタ (lmoni). JPEQ Monitor only displays it.
 *
 * {layer} = e.g. jma_s, {date} = YYYYMMDD (JST), {ts} = YYYYMMDDHHmmss (JST)
 */
window.JPEQ_CONFIG = {
  sources: [
    {
      id: 'kmoni',
      label: 'kmoni',
      base: 'https://www.kmoni.bosai.go.jp',
      relayBase: '/kmoni',
      paths: {
        latest:    '/webservice/server/pros/latest.json',
        baseMap:   '/data/map_img/CommonImg/base_map_w.gif',
        realtime:  '/data/map_img/RealTimeImg/{layer}/{date}/{ts}.{layer}.gif',
        estShindo: '/data/map_img/EstShindoImg/eew/{date}/{ts}.eew.gif',
        psWave:    '/data/map_img/PSWaveImg/eew/{date}/{ts}.eew.gif',
        eew:       '/webservice/hypo/eew/{ts}.json'
      }
    },
    {
      // Backup: NIED's 長周期地震動モニタ host (https only) serves the same
      // リアルタイム震度 frames. Used automatically when kmoni stops answering.
      id: 'lmoni',
      label: 'lmoni (backup)',
      base: 'https://www.lmoni.bosai.go.jp/monitor',
      relayBase: '/lmoni/monitor',
      paths: {
        latest:    '/webservice/server/pros/latest.json',
        baseMap:   '/data/data/map_img/CommonImg/base_map_w.gif',
        realtime:  '/data/data/map_img/RealTimeImg/{layer}/{date}/{ts}.{layer}.gif',
        estShindo: '/data/data/map_img/EstShindoImg/eew/{date}/{ts}.eew.gif',
        psWave:    '/data/data/map_img/PSWaveImg/eew/{date}/{ts}.eew.gif',
        eew:       '/webservice/hypo/eew/{ts}.json'
      }
    }
  ],

  // JPEQ relay (proxy/worker.js on Cloudflare). When set, ALL NIED data goes
  // through it, which fixes iPhone Safari blocking NIED's http-only servers.
  // Example: relay: 'https://jpeq-relay.YOUR-NAME.workers.dev'
  // (Can also be set from the phone by opening the site with ?relay=<url>.)
  relay: 'https://jpeq-relay.sileemamr.workers.dev',

  // Legacy: CORS proxy for the JSON files only (not needed when relay is set).
  // Leave empty to try direct access first. Example after deploying proxy/worker.js:
  //   proxy: 'https://jpeq-proxy.YOUR-NAME.workers.dev/?url='
  proxy: '',

  // Assumed delay behind real time until the server clock is synced (ms).
  defaultDelayMs: 3000,

  // Replay buttons, in minutes.
  replayMinutes: [10, 5, 1]
};
