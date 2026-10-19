# JPEQ Monitor

Two parts, kept separate so each stays within its data provider's terms:

| Part | Who can see it | Data |
|---|---|---|
| **Private live viewer** (`live/` + `proxy/worker.js`) | Only you, behind Cloudflare Access | NIED 強震モニタ リアルタイム震度 frames, shown unmodified; EEW text from P2P地震情報 |
| **Public JMA map** (`docs/`, coming next) | Anyone | JMA earthquake information via P2P地震情報, on GSI 地理院タイル |

## Private live viewer

A phone-first (430 × 932) viewer for NIED's 強震モニタ リアルタイム震度 map.

- Live frame every second; kmoni, with lmoni as automatic backup
- **−10 / −5 / −1 min** replay at 1×, pause, **LIVE** to return
- 緊急地震速報（警報） panel from P2P地震情報 (JMA, received through a licensed feed)
- NIED's own EEW map layers (estimated intensity, P/S waves) when present
- Add to Home Screen for an app-like view

### Why it is private

NIED's terms allow its 強震モニタ content to be copied only for 私的使用 (private use)
or quotation, and refuse 転載・改変・送信・再配布. So the viewer and the NIED relay
run on one Cloudflare Worker that only you can open (Cloudflare Access). The images
are displayed as NIED publishes them: no colour reading, no per-station values.
EEW text comes from P2P地震情報 rather than from 強震モニタ.

### Set-up

1. Cloudflare → **Workers & Pages** → `jpeq-relay` → **Edit code** → paste
   `proxy/worker.js` → **Deploy**.
2. **Settings → Domains & Routes** → on the `workers.dev` row, **Enable Cloudflare Access**,
   then **Manage Cloudflare Access** and allow only your email address(es).
3. Open `https://jpeq-relay.<subdomain>.workers.dev/`, sign in with the emailed code,
   then Safari → Share → **Add to Home Screen**.

The Worker reads the app's code from this repo's `live/` folder, so changes pushed
to GitHub appear within about a minute without re-pasting the Worker.
`/test` on the Worker checks that kmoni and lmoni are reachable.
`?source=lmoni` pins the viewer to the backup server for testing.

## Credits

- 地図・リアルタイム震度: 国立研究開発法人 防災科学技術研究所 (NIED) 強震モニタ / 長周期地震動モニタ
- 緊急地震速報・地震情報: P2P地震情報 (source: 気象庁)

JPEQ Monitor is an unofficial personal project, not affiliated with NIED, JMA or P2P地震情報.
For official information, refer to NIED and the Japan Meteorological Agency.
