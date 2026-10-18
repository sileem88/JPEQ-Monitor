# JPEQ Monitor

A lightweight, phone-first viewer for real-time strong-motion data from Japan,
designed for iPhone screens (430 × 932 CSS px) and hosted on GitHub Pages.

**All data comes from NIED.** JPEQ Monitor displays data published by
国立研究開発法人 防災科学技術研究所 (NIED) through
[強震モニタ (Kyoshin Monitor)](https://www.kmoni.bosai.go.jp/) and
長周期地震動モニタ. This is an unofficial personal viewer; it is not affiliated
with or endorsed by NIED, and it uses no NIED logos or branding.
For official information always refer to NIED and the Japan Meteorological Agency.

## What it does

- Live real-time map (updates every second), same layers as kmoni:
  計測震度 / PGA / PGV / PGD / 応答スペクトル, surface (地表) or borehole (地中)
- 緊急地震速報 (EEW) panel with region, expected max intensity, magnitude, depth
- EEW estimated-intensity and P/S-wave overlays on the map
- **Replay**: tap **−10 min / −5 min / −1 min** to replay from that point at 1×;
  pause/resume while replaying; **LIVE** returns to real time
- Automatic fallback from kmoni to the lmoni host when kmoni stops responding,
  and a retry back to kmoni every 2 minutes
- Keeps the last frame on screen and retries quietly instead of showing an error
- Stops all requests while the page is in the background
- Add to Home Screen for an app-like, full-screen view; the app and base map are
  cached so the page itself opens even on a congested network

## Publish on GitHub Pages

1. Upload every file in this folder to the root of the `JPEQ-Monitor` repository
   (keep the `icons/` and `proxy/` folders and the empty `.nojekyll` file).
2. In the repository: **Settings → Pages → Build and deployment → Source:
   Deploy from a branch → Branch: `main` / `(root)` → Save**.
3. After a minute the site is at `https://<your-username>.github.io/JPEQ-Monitor/`.
4. On iPhone, open it in Safari → Share → **Add to Home Screen**.

## The JPEQ relay (required on iPhone)

NIED's monitors serve plain http, and Safari blocks http requests from an
https page such as GitHub Pages. `proxy/worker.js` is a small Cloudflare
Worker (free plan) that fetches NIED's files over http and passes them to the
page over https. It only passes NIED `.gif`/`.json` files, and it caches each
timestamped frame so NIED is asked for it once.

1. Create a free Cloudflare account and open **Workers & Pages**.
2. **Create → Create Worker**, name it `jpeq-relay`, **Deploy**.
3. **Edit code**, replace everything with `proxy/worker.js`, **Deploy**.
4. Open `https://jpeq-relay.<your-subdomain>.workers.dev/test` to check NIED is reachable.
5. Put that address in `config.js` → `relay`, or open the site once with
   `?relay=https://jpeq-relay.<your-subdomain>.workers.dev` (remembered on that device).

## Files

| File | Purpose |
|---|---|
| `index.html`, `style.css` | Layout, sized for 430 px wide |
| `app.js` | Polling, fallback, EEW, replay |
| `config.js` | NIED URL patterns, proxy setting, replay buttons |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen app + offline shell |
| `proxy/worker.js` | JPEQ relay (Cloudflare Worker) |

## Notes

- The colour bar is an approximate guide to kmoni's colour scale; the map
  colours themselves are NIED's own.
- Data URL patterns live in `config.js`; if NIED changes a path, fix it there.
- Please keep request rates as they are (one frame per second, paused in the
  background) to avoid adding load to NIED's servers during events.
