# Music Downloader (Android APK)

An APK that **downloads any type of music over the internet**. It searches the
Internet Archive's free audio catalog (live concerts, public-domain recordings,
CC-licensed tracks — mp3, ogg, flac, wav, m4a, wma, aac...) and saves the files
straight into the device's public **Music/MusicDownloader** folder, where every
system music app can see them.

## Features

- Cover-art result cards (archive.org item thumbnails), quick-search chips
  (live concerts, jazz, gospel, classical, afrobeat, public-domain 78s),
  recent-search history, and a **Surprise me** button that finds and
  auto-plays a random free track.
- **Download all** files of an item at once; per-file Preview + Download;
  live progress bars, cancel, and a persisted My-downloads list with
  cover art, local Play and Delete.
- Animated equalizer player bar, online/offline indicator, saved to the
  public **Music/MusicDownloader** folder.

## How it works

- **Search (JS, in the WebView)**: `https://archive.org/advancedsearch.php`
  with `mediatype:audio AND (<query>)`; per-item `https://archive.org/metadata/<id>`
  lists the downloadable audio files (best format first: mp3 -> ogg -> flac -> ...).
- **Download (Java, native bridge `MusicDLNative.startDownload`)**: streams the
  file with `HttpURLConnection` on a background thread and writes it via
  `MediaStore.Audio` (`RELATIVE_PATH = Music/MusicDownloader`) on API 29+, or
  legacy external storage + `MediaScanner` on API 23–28 (runtime
  `WRITE_EXTERNAL_STORAGE`, requested automatically). Progress/cancel/done
  events are pushed to the page as `window.MusicDL.onEvent(...)` via
  `evaluateJavascript`. Downloads are tracked in a SharedPreferences registry,
  so the "My downloads" list survives restarts.
- **Playback**: finished downloads are streamed back to the page by the
  loopback `LocalServer` at `/dl/<id>`; previews stream directly from
  archive.org. A bottom player bar plays either source.
- **Shell**: WebView served from `LocalServer` on `http://127.0.0.1:<port>/`;
  external navigation restricted to archive.org + loopback; cleartext only for
  localhost (`res/xml/network_security_config.xml`); requires the `INTERNET`
  permission.

## Build

```bash
./android-musicdl/build.sh
# -> android-musicdl/app/build/MusicDownloader-1.0.apk
#    (also copied to ./MusicDownloader.apk)
```

`build.sh` validates the web shell (`web/test_web.mjs`), runs the emoji gate,
then ecj -> d8 -> aapt2 -> `pack_apk.py` -> apksigner (v1+v2). Toolchain shared
from `../android/tools` (`../android/fetch-tools.sh`).

## Layout

```
android-musicdl/
  build.sh                 # 6-step offline build pipeline
  app/
    AndroidManifest.xml    # com.musicdownloader.app, INTERNET, WRITE_EXTERNAL_STORAGE (maxSdk 28)
    src/main/java/com/musicdownloader/app/
      MainActivity.java    # WebView + LocalServer + pushJs + storage permission flow
      LocalServer.java     # loopback server: assets/www + /dl/<id> song streaming
      NativeBridge.java    # download engine (HttpURLConnection + MediaStore) + registry
    src/main/res/          # PNG launcher icon (mipmap-*), strings, net-sec config
  web/
    index.html styles.css app.js   # search UI, results, downloads, player bar
    img/icon.png                   # generated launcher icon
    test_web.mjs                   # static shell checks (build.sh + CI)
```
