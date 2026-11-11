# Choir Tune Finder — Android APK

Upload a song and estimate **the choir's tune** — one main melody —
entirely on-device. Fully offline, no account, nothing leaves the phone.

- Package: `com.choirtune.app` — label **Choir Tune Finder** — version **1.0** (versionCode 1)
- minSdk 23 (Android 6.0) / targetSdk 34 (Android 14)
- APK artifact: `ChoirTune-1.0.apk` (also copied to the repo root as `ChoirTune.apk`)

## What it does

1. **Upload a song** (up to 5 minutes and 40 MB) — tap "Choose song" (system file picker, wired through
   `WebChromeClient.onShowFileChooser`) or drag & drop. Any audio format the
   device can decode works (mp3, wav, m4a, ogg, flac, webm, aac).
2. **On-device melody extraction** (`web/melody.js`, pure JS, no network):
   the file is decoded with WebAudio, mixed to mono, resampled to 11.025 kHz,
   then analyzed frame-by-frame (Hann window 2048 / hop 256): an FFT
   harmonic-sum salience picks the lead pitch per frame (parabolically
   refined), an RMS gate marks voiced/unvoiced frames, the pitch track is
   median-smoothed and segmented into notes (same-pitch runs >= 70 ms).
   From the voiced frames it also estimates the **key** (Krumhansl-Kessler on
   the chroma) and the **BPM** (onset-envelope autocorrelation).
3. **The tune, presented for a choir**:
   - song card: name, length, detected key, BPM, note count
   - **piano roll** of the extracted melody with a playhead
   - **timed tune sheet**: #, note name, start (m:s), duration, beats
   - **Play tune** — the extracted melody is played back through a WebAudio
     synth (triangle wave); **Play original** plays the source song
   - **Transpose** -6..+6 (re-renders sheet/roll and affects playback/exports)
4. **Keep & share**: **Save to library** (persisted in the app-private
   `state.json` via the `window.ChoirTune` bridge; reopen/share/delete later; keeps the 50 most recent saves),
   **Share tune sheet** (plain-text chart through the Android share sheet),
   **Export .mid** (Standard MIDI File of the tune, saved to
   `Downloads/ChoirTune/` via MediaStore on API 29+, legacy storage on older
   devices with a runtime permission request).

## How it works

`MainActivity` hosts a WebView loading `file:///android_asset/www/index.html`
(bundled at build time from `web/`). The `window.ChoirTune` bridge
(`NativeBridge.java`) provides `loadState`/`saveState` (JSON in `filesDir/state.json`),
`shareText` (ACTION_SEND), and `saveFile` (base64 -> Downloads/ChoirTune).
In a plain browser the page falls back to `localStorage`, text and MIDI download links.

## Build

```bash
./android/fetch-tools.sh           # once: android.jar, ecj, d8, aapt2, apksigner -> android/tools/
./android-choirtune/build.sh       # validate + stage + compile + dex + package + sign
```

`build.sh` step 1 runs `web/test_web.mjs`, which — besides static shell
checks — **synthesizes a known melody (C4 E4 G4 C5 at 120 BPM) as PCM and
verifies the extractor recovers the notes, key (C Major) and BPM**, and
checks silence, note timing, async cancellation and the text/.mid exporters.
`web/test_app.mjs` also exercises upload, playback, stop, transposition, saved
library reopen/delete, decode errors and native export calls with DOM/audio
test doubles (no external dependencies). Then the repo-wide emoji gate runs, the web
app + icon are staged into `assets/www`, Java is compiled with ecj, dexed
with d8 (min-api 23), packaged with aapt2 (versionCode 1 / versionName 1.0),
aligned with `android/tools/pack_apk.py`, and signed with apksigner (v1+v2).

The app icon (`web/img/icon.png`) is programmatically drawn artwork; the launcher PNGs
(`app/src/main/res/mipmap-*/ic_launcher.png`) are derived from it with PIL.

## CI

`.github/workflows/build-apk.yml` job `build-choirtune-apk` builds and signs
the APK on pushes and PRs, and uploads the artifact.

## Accuracy and device limitations

This is a lightweight **single-melody estimator**, not vocal source separation
or a SATB transcription engine. It can follow an instrument instead of the
singer in a dense mix, and harmonies, percussion, vibrato or quiet recordings
can cause wrong/missing notes. Key and tempo are estimates; a short or
unpitched clip can have no useful estimate. Use clear solo singing for best
results and check the tune against the original before rehearsal. No real-song
accuracy benchmark or physical-device playback test has been run yet.

Analysis yields to the UI in batches with progress updates. Choosing another
song supersedes an unfinished analysis. Saved entries contain note data, not
the source recording; original playback is unavailable after reopening a saved
tune. Use a recent Android System WebView (WebAudio, async functions and
File.arrayBuffer are required). Supported codecs depend on the device.
