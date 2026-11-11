# Pastoral — Sermon Studio APK

An Android app for pastors to **write, organize, and share sermons** — fully
offline, no permissions, no network.

- Package: `com.pastoral.app` — label **Pastoral** — version **1.0** (versionCode 1)
- minSdk 23 (Android 6.0) / targetSdk 34 (Android 14)
- APK artifact: `Pastoral-1.0.apk` (also copied to the repo root as `Pastoral.apk`)

## What a pastor can do

- **Sermons** — create/edit/duplicate/delete sermons with: title, series,
  date, scripture reference, key verse, theme, introduction, a dynamic
  **outline** (add / reorder up-down / remove points with notes),
  illustration, application, conclusion, target length, and delivery notes.
- **Scripture** — a full **KJV Bible** bundled inside the APK
  (repo `bibles/kjv/kjv.js`, ~31k verses): pick book + chapter, or
  keyword-search the whole Bible; tap a verse to **insert it into the
  sermon editor** (fills the scripture reference + key verse).
- **Auto-generate the whole sermon** — one tap in the editor (or from any
  verse in the Scripture view) and `web/generate.js` writes a complete,
  editable draft offline: title, scripture ref + key verse, theme,
  introduction, a 3-point outline whose notes quote the actual KJV verses,
  an illustration, application questions, a conclusion, and timed delivery
  notes. Give it a reference (e.g. `Psalm 23`) and/or topic keywords
  (e.g. `hope, shepherd`) — with only a topic it searches the whole Bible
  for the best-matching verses. The Home/Sermons **Auto-generate** buttons
  are a true one-tap generate: with no ref and no topic they use a rotating
  well-known text for the day (`defaultRef`, e.g. Psalm 23, John 3:16,
  Romans 8:28...). Everything it writes stays fully editable before you save.
- **Home dashboard** — sermon count, sermons this month, series count,
  latest sermon, recent list.
- **Series** — every series with its sermon count, tap to filter the list.
- **Search + filter** — search sermons by title/series/scripture/theme,
  filter by series.
- **Share** — export any sermon as formatted plain text through the Android
  share sheet (paste into email, notes, a church app, ...).
- **Backup** — export all sermons as JSON, import them back later.
- **Dark / light theme**, persisted.

## How it works

`MainActivity` hosts a WebView that loads
`file:///android_asset/www/index.html` (bundled at build time from `web/`).
A `window.Pastoral` bridge (`NativeBridge.java`) gives the page three native
capabilities:

| JS call | native side |
| --- | --- |
| `Pastoral.loadState()` / `Pastoral.saveState(json)` | state persisted as JSON in the app-private `filesDir/state.json` |
| `Pastoral.shareText(title, text)` | `ACTION_SEND` share sheet (text/plain) |
| `Pastoral.platform()` / `Pastoral.appVersion()` | info |

Everything else is plain HTML/CSS/JS in `web/` — when opened in a regular
browser (e.g. a dev preview) it falls back to `localStorage` and the share
buttons report that the native bridge is missing.

## Build

```bash
./android/fetch-tools.sh        # once: android.jar, ecj, d8, aapt2, apksigner (into android/tools/)
./android-pastoral/build.sh     # validate + stage + compile + dex + package + sign
```

`build.sh`:

1. runs `web/test_web.mjs` (static checks), stages `web/` + the KJV bible
   (`bibles/kjv/kjv.js` -> `assets/www/bibles/kjv.js`) and the app icon into
   `app/src/main/assets/www/`, then runs the repo-wide emoji gate
   (`scripts/check_no_emoji.py`);
2. compiles the Java sources with **ecj** against `android.jar` (API 34);
3. dexes with **d8** (min-api 23);
4. packages resources + manifest + assets with **aapt2** (versionCode 1,
   versionName 1.0);
5. aligns and adds `classes.dex` with `android/pack_apk.py`;
6. signs with **apksigner** (debug keystore, v1+v2) and verifies.

The app icon (`web/img/icon.png`) is generated art; the launcher PNGs
(`app/src/main/res/mipmap-*/ic_launcher.png`) are derived from it with PIL.

## CI

`.github/workflows/build-apk.yml` job `build-pastoral-apk` builds and signs
the APK on every push/PR touching `android-pastoral/**`, `android/**`,
`scripts/check_no_emoji.py`, `bibles/kjv/**` or the workflow itself, and
uploads the artifact.
