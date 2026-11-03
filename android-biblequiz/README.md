# Bible Quiz — Android APK

A fully offline **Bible quizzing app** packaged as a signed Android APK:
`com.biblequiz.app`, minSdk 23 / targetSdk 34.

## The question bank — 2,500+ questions

`web/gen_questions.js` (node, deterministic seed) builds the bank from two
sources and writes `questions.js` + `books.js` into the APK assets at build
time:

| Source | Count | What |
| --- | --- | --- |
| `web/curated.json` | ~470 | Hand-written Q&A: OT/NT events, people, places, quotes, numbers, parables, book facts |
| generated from `bibles/kjv/kjv.js` (31,102 verses) | ~2,100 | **Verse Hunt** (quote to reference), **Fill in the Blank** (masked word), book order, chapter/verse counts, "which book contains this verse" |

Every question has 4 shuffled options, exactly one correct answer, a category,
a difficulty, an optional verse reference and an explanation. The generator
**validates** the bank (≥ 2000 questions, unique ids/options, answer index,
verse refs resolvable in the KJV) and fails the build otherwise.

`node web/test_bank.js` re-validates a staged bank; `node web/test_engine.js`
unit-tests the quiz engine (see below).

## Features

- **4 game modes** — Sprint (15 Q / 15 s), Marathon (50 Q / 20 s),
  Daily Challenge (10 Q, seeded by date), Sudden Death (3 strikes)
- **11 categories** (Old/New Testament, People, Places, Events, Books of the
  Bible, Quotes & Sayings, Numbers & Facts, Parables & Miracles, Verse Hunt,
  Fill in the Blank) × 3 difficulties
- **XP & levels**, streaks, 12 achievements with toasts
- **Verse reader** — every question's reference opens the verse *and the whole
  chapter* in any of the **6 bundled translations** (KJV, NKJV, ESV, NIV,
  Amplified, Reina-Valera 1909 — the repo's `bibles/`)
- **Bible search** (full KJV text, in-app) and question search with
  "practice these" mode
- **Saved-for-review & missed-questions** lists
- Verse of the day, stats dashboard with per-category accuracy bars
- WebAudio sound effects, vibration, confetti, dark/light themes,
  Playfair Display + Barlow typography — all assets bundled, zero network
- **Inline SVG icon set** (`web/icons.js`, `I('bolt')` etc.) instead of emoji;
  `build.sh` fails if any emoji glyph survives in the staged assets

## How the APK serves the app

`MainActivity` starts `LocalServer`, a small HTTP/1.1 server bound to
`127.0.0.1` (random port), and loads the WebView at
`http://127.0.0.1:<port>/`. A real loopback socket is used instead of
`WebViewClient.shouldInterceptRequest` because intercepted frame-navigation
responses are not reliably honoured with their Content-Type on every WebView
version (the page then renders as raw text — the bug this design avoids).

Cleartext is permitted for `127.0.0.1`/`localhost` only
(`res/xml/network_security_config.xml`, `usesCleartextTraffic=false`) and
external navigations are blocked — the app is fully offline. All progress is
stored in the page's `localStorage`.

`LocalServer` is deliberately Android-light (`AssetStore`/`DeletedStore`
interfaces) so the exact request-handling code runs on a desktop JVM: 17/17
HTTP checks pass (/, /app.js, /questions.js 875 KB, /bibles/kjv/kjv.js 6.4 MB,
fonts, MIME types, 404/403 traversal, HEAD, no shim injection).

## Build

```
./android-biblequiz/build.sh     # -> Bible-Quiz.apk (repo root) + app/build/Bible-Quiz-1.0.apk
node web/test_bank.js            # validate the generated bank
node web/test_engine.js          # engine unit tests
```

CI builds and tests it too — see `.github/workflows/build-apk.yml` (job
`build-biblequiz-apk`, artifact `Bible-Quiz-APK`).

## Files

```
android-biblequiz/
  build.sh                     build pipeline (see header comment)
  web/
    index.html                 app shell
    styles.css                 theme (dark/light, orbs, glass cards)
    app.js                     SPA + pure quiz engine on window.BQ
    curated.json               hand-written questions
    gen_questions.js           bank generator (KJV + curated -> questions.js/books.js)
    test_bank.js               bank validation
    test_engine.js             engine unit tests
  app/src/main/
    AndroidManifest.xml        com.biblequiz.app
    java/com/biblequiz/app/
      LocalServer.java         loopback HTTP/1.1 server (routes, MIME, Range,
                               testable on a desktop JVM via AssetStore ifaces)
      MainActivity.java        starts LocalServer, loads WebView at
                               http://127.0.0.1:<port>/, blocks external URLs
    res/                       launcher icon (vector), app name, network
                               security config
```
