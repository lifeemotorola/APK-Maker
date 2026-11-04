# Community Market — offline-first marketplace & services directory (Android APK)

A single signed Android APK, `com.marketplace.app` (minSdk 23 / targetSdk 34),
**by Emmanuel Suah**, built for Monrovia, Liberia where connectivity
fluctuates and data costs matter:

- **Local businesses & services** — 74 seeded listings across 10 categories
  (food, markets, pharmacies, clinics, repair, money, education, tailors,
  hardware, salons) and 24 Monrovia areas, each with phone, hours, landmark
  directions and services. Filter by category/area, live search, detail page
  with a `tel:` call button and copy-number.
- **Kehkeh & transport schedules** — 12 shared-taxi routes with endpoints,
  LRD fares, first/last departure, frequency and a numbered stop-by-stop
  timeline, plus okada notes.
- **Community board** — announcements, events, lost & found, jobs, safety
  notices and sales; your own posts are stored **offline** and deletable.
- **Truly offline** — all directory data ships inside the APK
  (`assets/www/data/*.json`, validated by `web/test_data.js` at build time)
  and is mirrored to localStorage; favorites and your posts live in the
  WebView's **local SQLite database** (WebSQL `communitymarket`, with a
  localStorage fallback). External network access is blocked by the
  network-security config — only the app's own loopback server is allowed.

## UI
Market-day theme by default (warm ivory, market green `#14532d`, gold
`#d9a441`, Playfair Display headings) with a "night market" dark toggle.
Animated boot splash, Ken Burns hero artwork (`web/img/hero.jpg`), staggered
screen entrances, SVG icon set (`web/icons.js`) — **no emoji anywhere**
(enforced by `scripts/check_no_emoji.py` in `build.sh`). Toasts fully hide
and are tap-to-dismiss; modals and the error box always close (close button, backdrop
tap, auto-dismiss).

## Layout
```
android-marketplace/
  build.sh                     offline build pipeline (see header)
  web/
    index.html                 app shell + splash
    styles.css                 themes + motion
    icons.js                   inline SVG icon library (I('store') etc.)
    app.js                     router, screens, WebSQL cache layer
    test_data.js               data validator (runs in build + CI)
    data/                      businesses.json, routes.json, posts.json, meta.json
    img/hero.jpg               bundled market artwork
  app/
    src/main/AndroidManifest.xml
    src/main/java/com/marketplace/app/{MainActivity,LocalServer}.java
    src/main/res/...           launcher icon (vector), strings, security config
```

The shell runs a real loopback HTTP server (`LocalServer` on
`http://127.0.0.1:<port>/`) and points the WebView at it — see
`MainActivity.java` for why a socket is used instead of
`shouldInterceptRequest`.

## Build
```bash
./android-marketplace/build.sh     # -> app/build/Marketplace-1.0.apk + ./Marketplace.apk
```
Requires only Node 22 + Python 3.11 + a JDK (the Android toolchain — d8, ecj,
aapt2, apksigner, android.jar — is fetched into the shared `android/tools/`
by `android/fetch-tools.sh`).

> The listings/routes/posts are realistic **seed data** (fictional phone
> numbers in the `+231 … 555 …` range) — edit `web/data/*.json` to load real
> directory data; `test_data.js` will validate it.
