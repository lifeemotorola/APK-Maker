# KeySense Studio — Android APK (MIDI + Bluetooth)

This directory turns the KeySense Studio web platform (React SPA + Python DSP
server in the repo root) into a **self-contained Android APK** that adds
**MIDI input over USB and over Bluetooth (BLE MIDI)**.

## What the APK does

- Runs the full KeySense Studio UI (bundled in `assets/www`) inside a WebView,
  fully offline — all 5 demo songs (WAV + precomputed chord/key analysis) are
  bundled in `assets/demos`.
- **MIDI / Bluetooth input**: a new **"MIDI / BT"** button opens a device
  panel that lists all MIDI devices known to Android's
  `android.media.midi.MidiManager` — **USB MIDI keyboards** and **Bluetooth
  LE MIDI controllers** (e.g. Yamaha MD-BT01, Roland WM-EC, QuiccoSound
  mi.1, CME Xkey Air, …). Connect to one and:
  - every Note On/Off, CC (sustain pedal), program change and pitch-bend is
    parsed from the raw MIDI byte stream (running status + SysEx aware) and
    pushed into the web app,
  - notes **play through the studio synth** and **light up on the 61-key
    piano**,
  - the **live chord is classified** in real time from the held notes
    (`classifyLiveChroma` on the 12-bin chroma of active MIDI notes),
  - you can **record the performance and export it as a `.mid` file**
    (Standard MIDI File written client-side) into `Downloads/KeySense/`.
- **Export MIDI** for any loaded demo song also works offline — the SMF
  Type-1, 3-track exporter (`buildMidiFromAnalysis`) is a direct port of
  `backend/dsp_engine.py::build_midi_from_analysis` and runs in JS.
- **Live Mic** chord detection still works (microphone permission is passed
  through to the WebView).
- **Chord Tracker** (Yamaha Chord Tracker-style progression tracking): a new
  bottom tab shows the song's **chord progression with full timing** — a big
  NOW chord synced to playback, an auto-scrolling progression strip (tap a
  chord to jump to it), a timed chord chart (#, chord, start–end, duration,
  beats, roman numeral, confidence) computed from the detected BPM, and a
  one-tap **text chart export** (saved to Downloads via the native bridge).
  Pure logic lives in `src/lib/chordTracker.ts` (unit-tested by
  `scripts/test_chord_tracker.ts` in build step 1).
- **Live Progression Track** in the Live Mic modal: every chord you play is
  appended to a timed progression log (auto-scrolling chips with timestamps,
  live elapsed clock), with flicker pruning, clear, and **text export** —
  so a live performance is tracked by progression and timing exactly like a
  Yamaha Chord Tracker session.
- **Song upload works fully offline in the APK**: the file picker is wired
  through `WebChromeClient.onShowFileChooser` (previously the upload button
  did nothing), the picked file is readable (`allowContentAccess`), and
  `POST /api/analyze` is answered in-page by a pure-JS DSP pipeline
  (`src/lib/offlineAnalyze.ts`: WebAudio decode -> FFT chroma -> chord
  classification, Krumhansl key estimation, onset-autocorrelation BPM,
  piano roll, waveform) producing the same analysis JSON as the desktop
  Python engine. Verified in CI by `scripts/test_offline_analyze.ts`.
  On desktop, `/api/analyze` still uses the Python server.

## Permissions

| Permission | Why |
|---|---|
| `BLUETOOTH_SCAN` (neverForLocation), `BLUETOOTH_CONNECT` (API 31+) | discover/connect BLE MIDI devices |
| `BLUETOOTH`, `BLUETOOTH_ADMIN`, `ACCESS_FINE_LOCATION` (API ≤ 30) | BLE MIDI discovery on older Android |
| `RECORD_AUDIO` | Live Mic feature |
| `INTERNET` | WebView |
| `WRITE_EXTERNAL_STORAGE` (API ≤ 28) | saving `.mid` exports on old devices (MediaStore on 29+) |

Declared features (all optional, app installs without them):
`android.software.midi`, `android.hardware.usb.host`,
`android.hardware.bluetooth_le`.

## Layout

```
android/
  build.sh                        # one-shot offline APK build (see below)
  fetch-tools.sh                  # downloads the toolchain into android/tools/
  tools/pack_apk.py               # zipalign-style packer (arsc stored + aligned)
  app/src/main/
    AndroidManifest.xml
    java/com/keysense/studio/
      MainActivity.java           # WebView shell, asset/API interceptor, permissions
      MidiController.java         # MidiManager: USB + BLE MIDI -> window.KeySenseMidi.*
      NativeBridge.java           # window.KeySenseNative JS bridge (devices, assets, saveFile)
    res/                          # app icon (vector), strings
    assets/www/                   # built web UI (generated)
    assets/demos/                 # demo WAVs + analyses (generated from ../demos)
```

## How the native <-> web bridge works

- The WebView loads `https://keysense.local/`; `MainActivity`'s
  `WebViewClient.shouldInterceptRequest` serves `index.html`/JS/CSS from
  `assets/www`, shims `GET /api/health`, `/api/demos`, `/api/demos/:id` from
  `assets/demos`, and serves `/demos/*.wav` with HTTP Range support (so the
  `<audio>` element can seek).
- `NativeBridge` is exposed as `window.KeySenseNative`
  (`listMidiDevices()`, `connectMidiDevice(i)`, `readAsset(path)`,
  `saveFile(name, base64, mime)`, …) — see `src/lib/nativeBridge.ts`.
- MIDI events flow the other way: `MidiController` calls
  `webView.evaluateJavascript("window.KeySenseMidi.noteOn(60, 100)")` etc.
  `src/lib/nativeBridge.ts` dispatches them to subscribers (`MidiPanel`,
  synth + piano highlight in `App.tsx`).

## Building the APK

### GitHub Actions (CI)

`.github/workflows/build-apk.yml` builds the APK on every push/PR
(`ubuntu-latest`, Node 22 + JDK 21 + Python 3.11) and uploads it as the
**`KeySense-Studio-APK`** workflow artifact. Trigger it manually from the
**Actions** tab via `workflow_dispatch`. No Android SDK needed — the
toolchain is fetched from npm/PyPI by `fetch-tools.sh`.

### Locally (offline toolchain)

```bash
./android/build.sh
# -> android/app/build/KeySense-Studio-1.1.0.apk  (copied to ./KeySense-Studio.apk)
```

The build needs only `node`, `npm`, `python3` and network access to the
sandbox-allowed hosts (npmjs/pypi/github). `fetch-tools.sh` pulls:

- a JRE (`jdk4py` from PyPI) to run the Java tools,
- `d8.jar` (R8/D8), `ecj` (Eclipse compiler), `apksigner.jar`,
  `android.jar` (API 34) and a debug keystore from the `@drxiaozhi/minapk`
  npm bundle,
- `aapt2` (linux x64) from the `aaptjs3` npm bundle.

Pipeline: `vite build` -> `ecj` (Java -> .class against android.jar) -> `d8`
(.class -> classes.dex, min-api 23) -> `aapt2 compile/link` (resources +
binary manifest + assets) -> `pack_apk.py` (align, add classes.dex) ->
`apksigner sign` (v1+v2+v3, debug key).

## Installing

```bash
adb install KeySense-Studio.apk
# or copy the file to the phone and open it (allow "install unknown apps")
```

minSdk 23 (Android 6.0), targetSdk 34. Signed with the standard Android
debug key (`android` / `androiddebugkey`) — fine for local installs and
testing; use your own release keystore for distribution.
