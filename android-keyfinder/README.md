# KeyFinder Player (Android APK)

An **advanced multimedia song player** that **finds the musical key of any
song**, fully offline inside a single APK (`com.keyfinder.player`).

## Features

- **Song library**: 5 bundled demo songs (`demos/*.wav` staged into the APK)
  plus **your own audio files** (mp3 / wav / ogg / m4a / flac) via the system
  file picker (`WebChromeClient.onShowFileChooser`).
- **Advanced playback** (WebAudio): play/pause, prev/next, click-to-seek
  **waveform**, playback speed (0.5x–2x), volume, and an **A–B loop**.
- **Key finder** (the core feature): every song is decoded and analyzed
  **on-device** with the KeySense DSP pipeline (bundled from `../src/lib` via
  esbuild into `assets/www/keyfinder.js`, exposed as `window.KeyFinder`):
  - detected **key** (e.g. "Ab Major") with **confidence**, **Camelot wheel**
    position, relative/alternate key,
  - **chroma profile** bar chart (in-scale notes highlighted),
  - **scale** pills, **BPM**, tuning reference (Hz), and the song's
    **in-key chord progression** (roman numerals).
- Fully offline: the WebView is served from a loopback `LocalServer`
  (`http://127.0.0.1:<port>/`), external navigation is blocked, cleartext is
  only allowed for localhost (`res/xml/network_security_config.xml`).

## Build

```bash
./android-keyfinder/build.sh
# -> android-keyfinder/app/build/KeyFinder-Player-1.0.apk
#    (also copied to ./KeyFinder-Player.apk)
```

The build validates the web shell (`web/test_web.mjs`), bundles the analyzer
with esbuild, runs the emoji gate, then compiles Java with ecj, dexes with
d8, packages with aapt2 + `pack_apk.py`, and signs with apksigner (v1+v2).
The Java toolchain is shared from `../android/tools` (`../android/fetch-tools.sh`).

## Layout

```
android-keyfinder/
  build.sh                     # 6-step offline build pipeline
  app/
    AndroidManifest.xml        # com.keyfinder.player, minSdk 23 / target 34
    src/main/java/com/keyfinder/player/
      MainActivity.java        # WebView + LocalServer + file chooser + bridge
      LocalServer.java         # loopback static server for assets/www
      NativeBridge.java        # @JavascriptInterface (log/appVersion)
    src/main/res/              # launcher icon (vector), strings, net-sec config
  web/
    index.html  styles.css  app.js   # player UI + transport logic
    keyfinder.ts             # bundles ../src/lib analysis -> window.KeyFinder
    test_web.mjs             # static shell checks (run in build.sh + CI)
```
