/*
 * JPEQ Map — public earthquake map configuration
 *
 * Data: 気象庁（JMA）の地震情報 JSON, reused under JMA's 公共データ利用規約（第1.0版）
 *       with attribution. No NIED (強震モニタ) data is used on this public map.
 * Map:  国土地理院 地理院タイル（淡色地図）, shown with attribution (no application needed
 *       for real-time tile display).
 */
window.JPEQ_MAP = {
  version: 'map v1',

  // Where to read JMA's earthquake files. Tried in order; the first that works is used.
  // 1) direct from JMA, 2) optional public Worker (proxy/public-worker.js) if JMA blocks
  //    cross-site reads. Add your Worker URL as the second entry if needed, e.g.
  //    'https://jpeq-public.<subdomain>.workers.dev/quake'
  jmaBases: [
    'https://www.jma.go.jp/bosai/quake/data'
  ],

  // Refresh the earthquake list this often while the page is open (ms).
  refreshMs: 15000,

  // How many recent earthquakes to list.
  listSize: 20,

  tiles: {
    url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
    maxNativeZoom: 18,
    attribution:
      '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>' +
      '（淡色地図）に震央・震度観測点を追記して掲載'
  }
};
