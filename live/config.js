/*
 * JPEQ Monitor — private live viewer configuration
 *
 * Served by the JPEQ Worker behind Cloudflare Access, so only you can open it.
 * Map frames come from NIED (防災科学技術研究所) 強震モニタ / 長周期地震動モニタ
 * through the same Worker; they are shown unmodified for private viewing.
 *
 * {layer} = jma_s, {date} = YYYYMMDD (JST), {ts} = YYYYMMDDHHmmss (JST)
 */
window.JPEQ_CONFIG = {
  // Shown in the footer so you can tell when your phone has the latest site.
  version: 'v4',

  sources: [
    {
      id: 'kmoni',
      label: 'kmoni',
      relayBase: '/kmoni',
      paths: {
        latest:    '/webservice/server/pros/latest.json',
        baseMap:   '/data/map_img/CommonImg/base_map_w.gif',
        realtime:  '/data/map_img/RealTimeImg/{layer}/{date}/{ts}.{layer}.gif',
        estShindo: '/data/map_img/EstShindoImg/eew/{date}/{ts}.eew.gif',
        psWave:    '/data/map_img/PSWaveImg/eew/{date}/{ts}.eew.gif'
      }
    },
    {
      // Backup: 長周期地震動モニタ (https only). Paths from lmoni's own page script.
      id: 'lmoni',
      label: 'lmoni (backup)',
      relayBase: '/lmoni',
      paths: {
        latest:    '/img_svr/webservice/server/pros/latest.json',
        baseMap:   '/monitor/data/data/map_img/CommonImg/base_map_w.gif',
        realtime:  '/img_svr/data/map_img/RealTimeImg/{layer}/{date}/{ts}.{layer}.gif',
        estShindo: '/img_svr/data/map_img/EstShindoImg/eew/{date}/{ts}.eew.gif',
        psWave:    '/img_svr/data/map_img/PSWaveImg/eew/{date}/{ts}.eew.gif'
      }
    }
  ],

  // EEW text: P2P地震情報 (緊急地震速報（警報）, received from JMA via a licensed feed).
  p2p: {
    ws: 'wss://api.p2pquake.net/v2/ws',
    history: 'https://api.p2pquake.net/v2/history?codes=556&limit=20'
  },

  // Assumed delay behind real time until the server clock is synced (ms).
  defaultDelayMs: 3000,

  // Replay buttons, in minutes.
  replayMinutes: [10, 5, 1]
};
