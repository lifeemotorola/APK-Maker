# NewsDesk Studio — Android APK

Packages the **NewsDesk Studio v1.5** broadcast lower-thirds kit (the web app
in `../obs-news-desk/`, originally `obs-news-desk.zip`) as a signed Android
APK: `com.newsdesk.studio`, minSdk 23 / targetSdk 34.

## What the APK does

The APK is a WebView shell around the *unmodified* web app, served from the
APK assets under the fake origin `https://newsdesk.local/` (every request is
intercepted by `MainActivity.AssetWebViewClient`):

| URL | Served from |
| --- | --- |
| `/shell` | `shim/shell.html` — app chrome with **Panel / Overlay** tabs (both frames stay alive so they stay live-synced) |
| `/`, `/control` | `control/index.html` — the control panel |
| `/overlay/overlay.html` | the 1920×1080 transparent broadcast overlay |
| `/demo`, `/cam` | their pages |
| `/assets/…`, `/scripture/…`, `/bible/…`, `/uploads/…` | bundled files (`/uploads/*` prefers user uploads in `filesDir/uploads`, with HTTP Range support for video) |

Every HTML page gets `__shim.js` injected right after `<head>`.
`shim/shim.js` re-implements the **entire `server.py` backend in JavaScript
inside the page**, so the app is fully functional offline:

- `window.fetch` is wrapped: all `/api/*` routes of `server.py` are answered
  in-page with the same payloads (state, presets, lyrics, playlist, countdown,
  live, sting, uploads, bible lookup/search/chapter/books/random/backgrounds,
  camera stubs, …). State and presets persist in `localStorage`; uploads go
  through the native `NewsDeskBridge` into `filesDir/uploads` (same naming +
  sha1-dedupe rules as `server.py`).
- `window.WebSocket` is replaced by a fake backed by `BroadcastChannel`,
  implementing the `/ws` protocol (`hello` / `patch` / `get` / `sting` /
  `reload` + the same broadcast-role semantics), so the panel and the overlay
  frames sync live exactly like over the real socket.
- Bibles: the repo's `bibles/` folder (one `var bible_data = [...]` JS file per
  translation — kjv, nkjv, esv, niv, amplified, es_rvr) is bundled as
  `assets/www/bibles/` with a generated `manifest.json`. `shim.js` loads a
  translation lazily, indexes it by `ari` book index + `name` chapter:verse,
  and parses references with `bible/kjv.json` aliases **plus the active
  translation's own book names** (so `Juan 3:16` works in Spanish). Every
  `/api/bible/*` endpoint takes `?t=<id>` (default: `state.verseTranslationId`,
  initially `kjv`), there is a new `GET /api/bible/translations`, and a small
  📖 picker is injected into the control panel page to switch translation —
  it just patches `verseTranslationId`/`verseTranslation` in the state, which
  the overlay shows as the on-air translation label.

Camera-over-wifi / WHEP need the desktop server (HTTPS listener + WebRTC
signalling) and return plain-language errors in the APK; the `obs/` C++ OBS
dock plugin is desktop-only and not part of the APK.

## Build

```bash
./android-newsdesk/build.sh
```

Fully offline: it reuses the toolchain in `../android/tools` (d8, ecj,
apksigner, android.jar API 34, aapt2, debug.keystore — fetched by
`../android/fetch-tools.sh` from npm if missing), unzips `obs-news-desk.zip`
if needed, stages the web app into `app/src/main/assets/www`, compiles the
Java shell, dexes, packages with aapt2, aligns with `pack_apk.py` and signs
with apksigner. Output: `NewsDesk-Studio.apk` in the repo root (also kept in
`android-newsdesk/app/build/`).

CI builds it too — see `.github/workflows/build-apk.yml` (job
`build-newsdesk-apk`, artifact `NewsDesk-Studio-APK`).

## Files

```
android-newsdesk/
  build.sh                     build pipeline (see header comment)
  shim/shim.js                 in-page backend: /api/* + /ws port of server.py
  shim/shell.html              app chrome (Panel/Overlay tabs)
  app/src/main/
    AndroidManifest.xml        com.newsdesk.studio
    java/com/newsdesk/studio/
      MainActivity.java        WebView + asset interceptor (routes, shim
                               injection, /uploads with Range, deleted-set)
      NewsDeskBridge.java      JS bridge: media library (list/save/delete)
    res/                       launcher icon + app name
```
