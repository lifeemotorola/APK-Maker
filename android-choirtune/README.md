# Choir Tune Finder 1.5.1 - Android APK

Upload a song to estimate its **main melody and Soprano, Alto, Tenor, and Bass
pitches** on-device, with an optional, explicitly consented server-assisted
vocal-isolation workflow. Version 1.4 also embeds real Demucs weights and an
ARM64 C++ runtime for offline blended-vocal isolation. Offline analysis and the live tuner still work
without an account or server.

- Package: `com.choirtune.app`, label **Choir Tune Finder**
- Version **1.5.1** / versionCode **7** (updates earlier versions with the same signing key)
- minSdk 23 / targetSdk 34; a recent Android System WebView is required
- Artifact: `android-choirtune/app/build/ChoirTune-1.5.1.apk`
- Root download copy: `ChoirTune.apk` (gitignored)

## Bundled offline Demucs (1.5 full-song processing)

The APK includes **htdemucs four-stem f16 weights** (83,994,361 bytes) and a
C++17/Eigen inference engine, not a model-download button or server dependency.
It is about **75 MiB** compressed. It installs on **64-bit ARM (arm64-v8a)**
Android 6+ devices; no 32-bit ARM or x86 native libraries are included.

1. In **Upload a song**, leave **Isolate blended vocals with bundled Demucs**
   checked (default when the native library loads).
2. Choose an audio file up to **15 minutes / 250 MB**, including 3-15 minute
   songs. Short test clips from 0.25 seconds still work; there is no three-minute
   minimum. Songs over 15 minutes are rejected, never silently cut. Confirm the
   long-job warning for songs over 30 seconds. Keep the app open and powered;
   the visible screen stays awake during native processing.
3. Listen to or export **Demucs blended vocals**, then inspect the estimated
   SATB pitches, synthesized part playback, transpose, MIDI/text and library.
4. **Cancel offline isolation** stops transfer or requests cooperative native
   cancellation. A current matrix operation may need to finish before memory
   is released. A new job is rejected until the worker has stopped.
5. Uncheck Demucs for faster ordinary pitch estimates, also up to 15 minutes.
   The separate optional server still has its own 5-minute / 40 MB limit;
   it is not automatically used as a fallback.

**Honest output contract:** standard Demucs estimates vocals/drums/instrumental
bass/other. Only **stem 3, blended vocals**, is passed to the existing SATB
estimator. Instrumental bass is never used as choir Bass. Four SATB tracks are
**pitch estimates/synthesized practice guides, NOT separated singers**. This
is not a SATB-trained neural model and does not promise all four voices will
be found correctly. Empty or ambiguous parts remain possible.

**How long songs are bounded:** the web layer resamples at most 30 seconds of
stereo at a time, transferring small PCM16 chunks to private disk. Native code
loads the model once per song and processes 20-second cores with up to two
seconds of surrounding context on each side (at most 24 seconds at once).
Context is trimmed when writing: every input frame has exactly one output
frame, including the last partial block. Silent sections keep their timestamps
and bypass unsafe zero-variance normalization. Entirely silent/DC/phase-cancelled
songs are rejected. Context reduces but does not eliminate audible seams or
estimation changes at joins. Output uses fixed gain with PCM16 clipping, not
per-block volume normalization.

Native code writes the stereo vocal WAV and a quarter-rate mono float analysis
stream (11025 Hz) sequentially. The web estimator fetches only the mono stream
(about 40 MB for 15 minutes), not the roughly 159 MB WAV. Vocal playback streams
from native storage, and WAV export uses Android's document picker with a
64 KiB copy buffer, not one huge base64 string. Ordinary analysis also avoids
allocating a full high-rate mono copy. **The original song is still decoded in
full by WebAudio**, so this is bounded neural inference, not a constant-memory
end-to-end audio decoder. File format, sample rate, channels, WebView heap and
Android memory pressure still affect whether a device can complete a long job.

**Memory and time:** version 1.5.1 removes the preset RAM eligibility check.
No reported free-RAM, total-RAM or Android low-memory flag prevents a user
from attempting inference. This does **not** reduce the model's actual working
memory or guarantee that a low-memory phone can run it. Actual Java/native
allocation failures remain visible; Android can also kill the process before
an error can be shown. There is no automatic fallback to ordinary estimates.
Free disk space is still checked for the input PCM,
WAV, mono analysis, model and a safety margin; allow roughly **500 MB internal
storage for 15 minutes**. A one-second real-model host test uses roughly 1.7 GB
RSS; it is not a phone-speed benchmark. **Full-song isolation may take hours**,
heat the phone, consume substantial battery, or be killed by Android. There
is no longer a whole-job 20-minute cutoff: only 30 minutes with no progress
requests cancellation, or the user can cancel at any time. No background
service/resumption is implemented: keep the app visible and powered. Low-memory
and allocation errors are shown, not silently replaced by ordinary estimates.
Native CPU inference is single-job, single-threaded Eigen with no OpenMP/BLAS.

**Offline/privacy:** no network request is needed for the model or isolation.
The verified model is copied from APK assets into app-private files on first
use and verified by SHA-256 before each run. Input PCM, the vocal WAV and mono
analysis stream live in private cache; input is deleted on completion, and output is deleted
on cancellation, replacement or activity destruction. After a crash, Android
may retain cache until app storage is cleared. Saving notes does not save
vocal audio; explicitly export the WAV to retain it. App backup is disabled
so recordings and the large model copy are not included in Android backup.
The optional server section still uploads only with its separate consent.

The user-supplied eight archive parts are read at immutable repository commit
`b2b6ed2f48bcc9e432c8a4c9a0af3d78e475bb58`. The combined archive extracts to:

- Model: `ggml-model-htdemucs-4s-f16.bin`
- Size: `83,994,361` bytes
- SHA-256: `72b17c42d308982ddb5069bc3bf48b81a5aac4cb6516e4366c0fa7cef6df0064`

`native/fetch.py` obtains pinned sources and these actual Git blobs via GitHub
codeload, reconstructs the archive and verifies exact size/hash. No model
binaries or dependency trees are duplicated into Git. Source/tool/model caches
are ignored. The APK bundles Demucs MIT licenses, Eigen MPL2/compatible notices,
and corresponding pinned source locations, accessible through **Embedded model
and native runtime licenses**. This independently written JNI/Java bridge does
not copy the GPL Android example app. The engine changes only two upstream
process-exit invariant checks into exceptions; see `native/fetch.py`.

## Optional server vocal isolation (1.3)

A new panel accepts your **own deployed HTTPS server URL and access key**.
There is no bundled public endpoint, model weights, or ready-made SATB model.
The service code and deployment/limitations guide are in
[`choir-server/README.md`](../choir-server/README.md).

- Explicit per-recording consent; server uploads use a separate file picker.
  Offline file selection does not send audio. Keys and job tokens stay in
  memory; failed/interrupted deletion is reported, not claimed to have worked.
- The service integrates **Demucs vocal/accompaniment isolation**, then tracks
  pitches from the blended vocals. Actual inference needs operator-installed
  runtime/weights and has not been verified in this environment.
- A trusted external SATB model adapter can supply four actual audio stems.
  **No choir-trained model is included.** Without one, the four practice WAVs
  are clearly labelled **synthesized guides**, not separated singer audio.
  Missing/invalid configured-model outputs fail rather than falling back silently.
- A synchronized practice mixer supports solo and mute. Download model stems
  when available, neural-isolated blended vocals/accompaniment, synthesized
  guides, MIDI and a pitch report. View notes in the existing piano-roll/chart
  UI; save note data locally, not server audio.
- The supplied service uses a shared operator key, bounded private jobs,
  authenticated artifact downloads, cancellation, deletion and one-hour default
  expiry after completion. Review its operational/privacy guide before hosting.
  The server operator can access recordings. Only upload recordings you are
  authorized to share, to a server you trust.

The requested guide limits now apply consistently: Soprano C4-A5, Alto G3-D5,
Tenor C3-G4, Bass E2-E4. Overlapping ranges remain estimates, not singer IDs.
Production hosting, a validated SATB model, actual neural inference and physical
phone networking/memory/accuracy tests remain outstanding. Model-free contract
CI is not a substitute for those checks.

## Live choir tuner (1.2)

Tap **Start microphone**, grant permission, then sing one note at a time.
Large **Soprano / Alto / Tenor / Bass** buttons choose the same overlapping
vocal guide ranges as the uploaded-song analyzer. They do not classify a
singer's identity or perform simultaneous live SATB separation.

- **Capture**: Android `AudioRecord` captures mono 16-bit PCM at 44,100 samples
  per second (48,000 fallback when the initial buffer-size query is unsupported).
  A rolling 4,096-sample window is sent every sampleRate/25 samples, about
  40 ms. Native capture avoids WebView `file://` microphone-origin restrictions.
  Secure browsers use getUserMedia with a preferred 44.1 kHz rate and a
  4,096-sample WebAudio analyser. The actual device rate is shown on screen.
- **Pitch**: `web/tunerPitch.js` averages down to about 11 kHz, removes DC,
  applies the selected RMS noise gate, and runs YIN's cumulative-mean normalized
  difference. A voiced-confidence threshold rejects aperiodic room noise.
  A small original-sample-rate period refinement avoids high-note decimation
  bias. Fundamental search covers 65-1,200 Hz; out-of-preset notes are shown
  as outside the guide range instead of forced to another octave.
- **Display**: A4=440 logarithmic note mapping, measured Hz and signed cents.
  A three-reading median steadies the display. The needle moves left for flat
  and right for sharp; green requires three consecutive readings within
  **5 cents**. The default target is the nearest semitone. Choose **Selected
  reference note** for tuning against a fixed target. Needle travel is clamped
  to -50/+50 cents while the numeric readout retains the full error.
- **Noise gate**: Quiet/Normal/Noisy room presets use RMS floors of
  0.004/0.008/0.02 on normalized audio. Silence clears stale pitch and lock.
- **Reference tones**: Pick a note within the current voice range and play a
  low-volume sine-wave drone. Drone and microphone capture are mutually
  exclusive, so the app does not mistake its own speaker for singing.
- **Lifecycle/privacy**: Capture starts only on request and stops on Stop,
  background/page hide, original/estimated-song playback, upload or reference
  playback. Streams, timers and native recording resources are released.
  Permission denial, unsupported capture, and read failures produce visible
  errors. Cancelled permission requests cannot restart the tuner later.
  Microphone frames are analyzed in memory; the live tuner does not store or
  upload audio. Version 1.3 adds Internet permission only for the optional
  server workflow; the live tuner never uploads microphone frames.

The UI/analysis loop targets **25 Hz**, not zero latency: the 4,096-sample
capture window plus smoothing add response time, and device/OS scheduling
can slow updates. Latest-frame processing avoids a DSP backlog. Synthetic
pitch tests cover bass through soprano at 44.1/48 kHz, but real singers,
room acoustics, Bluetooth routing and end-to-end phone latency have not been
benchmarked. Multiple simultaneous singers can cause unstable readings or
harmonic/octave errors; use this mode for individual/dominant notes.

## Use uploaded-song analysis

1. Choose an audio file, up to **15 minutes / 250 MB**. MP3, WAV, M4A and other
   device-supported formats work; codec availability depends on the device.
2. The app decodes and analyzes the recording locally. Progress updates while
   the analysis yields to the UI; selecting another song supersedes old work.
3. Select **Main melody**, **Soprano**, **Alto**, **Tenor**, or **Bass**. Each
   part has its own estimated notes, a piano roll, and a timed pitch sheet:
   note name, measured **pitch in Hz**, start in fractional seconds, duration
   and beats. The summary shows note counts and guide ranges for all parts.
4. **Play estimated part** synthesizes the selected pitch track (not isolated
   vocal audio). **Play original** plays the uploaded recording. Transposition
   adjusts note labels, Hz values, synth playback and exports by -6 to +6
   semitones. Switching parts stops playback.
5. **Save to library** keeps all estimated parts, the main melody, current
   part and transpose setting; reopen/share/delete later. The library holds
   the most recent 50 saves. It stores note data, not the source recording.
   Version 1.0 saves still open; re-upload their original audio to obtain SATB.
6. **Share tune sheet** exports the selected part with Hz values.
   **Share all SATB pitches** includes all four parts in one text report.
   **Export part .mid** exports the selected part as a Standard MIDI File to
   `Downloads/ChoirTune/`. MIDI uses semitone note numbers (no tuning bends);
   the text report preserves measured Hz. Browser mode downloads files instead.

## What the estimates mean

This is **range-guided polyphonic pitch estimation, not vocal source separation
or verified SATB transcription**. It never constructs harmonies by transposing
a single melody. Instead, the multi-pitch estimator analyzes the input spectrum
for several simultaneous fundamentals and assigns them to ordered guide ranges:

| Part | Guide range | Description |
| --- | --- | --- |
| Soprano | C4-A5 | Highest part, often the melody |
| Alto | G3-D5 | Lower treble / middle harmony |
| Tenor | C3-G4 | Higher standard male part |
| Bass | E2-E4 | Low foundation |

These overlapping ranges are guides, not rules about gender or proof of voice
type. Voice crossing, unison, instruments, octaves, vibrato, weak fundamentals
and loud accompaniment make the assignments ambiguous or wrong. A guitar or
piano pitch can be labeled as a voice. Unison cannot reveal how many singers
are present: one detected pitch is not duplicated into multiple tracks. Empty
tracks mean no stable estimate, **not proof a singer is absent**. Clear,
unaccompanied singing works best. Listen and check before rehearsal. Accurate
isolation of actual singers would require a different source-separation system.
No real-choir accuracy benchmark or physical-phone test has been run yet.

## DSP

- `web/melody.js`: mono PCM resampled to 11,025 Hz; 2,048-sample Hann FFT
  with hop 256, harmonic salience, voiced gating, smoothing and note runs.
  Supplies main melody, source key/tempo estimates, text and MIDI exporters.
- `web/satb.js`: a separate **4,096-sample Hann FFT / hop 512** analysis of
  the same PCM. A shared sparse dictionary of pure and six-harmonic templates
  (with small tuning offsets) explains up to four candidate fundamentals by
  nonnegative residual cancellation. Energy and fundamental-evidence gates
  reject weak candidates. Ordered, continuity-biased assignment handles the
  overlapping voice ranges without assigning the same candidate twice.
  Stable runs need at least three voiced frames. Parabolic peak interpolation
  measures Hz; note entries also retain cents deviation from equal temperament.
- Templates and continuity are assumptions, not a trained singer-identification
  model. Spectral windowing introduces roughly 0.2-second boundary uncertainty
  in SATB estimates; very short notes may be missed. Source key/BPM are estimates
  inherited from the main analysis, not independently estimated per voice.

## Android shell and build

A bundled WebView loads `https://appassets.androidplatform.net/www/index.html`
through a restricted local asset interceptor (no external page hosting and no
universal file-origin access). File access is disabled and cleartext network
traffic is disallowed. The native
`window.ChoirTune` bridge provides private `state.json` persistence, text sharing,
and file saving. The system document picker supplies uploaded audio. Exports
use MediaStore on Android 10+; Android 6-9 requests legacy write permission.
Browser mode falls back to localStorage and text/MIDI downloads.

```bash
# Linux x86_64: Python 3.11+, Node, a JDK, CMake/Ninja and Android NDK.
# Official NDK r27 is recommended (CI installs 27.2.12479018).
export ANDROID_NDK_HOME=/path/to/android-sdk/ndk/27.2.12479018
python3 -m venv "$HOME/apk-venv"
"$HOME/apk-venv/bin/pip" install -r android-choirtune/native/requirements-build.txt
./android/fetch-tools.sh
./android-choirtune/build.sh
```

The build runs all six dependency-free Node test suites, stages web assets,
verifies the model checksum, compiles/statically links/strips the native runtime,
runs the emoji gate, compiles Java with ecj, dexes with d8, packages with aapt2,
aligns with `android/tools/pack_apk.py`, and signs with the debug keystore.
Build outputs, tools and staged assets stay outside Git. Launcher artwork is
programmatically drawn. The build refuses to produce a model-free placeholder
if native setup fails. `native/verify_apk.py` checks the exact embedded model,
ARM64 ELF machine/JNI exports and 16 KiB LOAD alignment. Native libraries are
installer-extracted (`extractNativeLibs=true`); C++ is statically linked.
`.github/workflows/build-apk.yml` uploads `ChoirTune-APK`.

## Tests

- `node android-choirtune/web/test_web.mjs`: main melody, key/tempo, timing,
  silence, MIDI structure and tempo, async parity/cancellation, shell checks.
- `node android-choirtune/web/test_satb.mjs`: simultaneous synthetic SATB notes
  and independent changes, measured Hz, detuning, missing parts, solo harmonics,
  ambiguous unison, pure tones, silence, timing, async parity/cancellation,
  range assignment and exports. Synthetic tones are not a real-choir benchmark.
- `node android-choirtune/web/test_app.mjs`: DOM/audio test doubles cover upload,
  part switching, empty parts, synth/original/stop, transpose, per-part export,
  all-part sharing, saving/reopening SATB, old-save compatibility and decode
  errors. This harness does not replace device/browser integration testing.

- `node android-choirtune/web/test_tuner.mjs`: synthetic YIN/Hz/cents accuracy
  across SATB and two sample rates, harmonic-rich signals, silence/DC/noise,
  gauge locking and directions, range presets, fixed targets, drone/capture
  exclusion, permission errors/cancellation and lifecycle release with test
  doubles; native permission/buffering/release wiring checks.

- `node android-choirtune/web/test_server.mjs`: consent and HTTPS/key handling,
  capability/output labels, misleading-stem rejection, synchronized mixer,
  solo/mute, authenticated downloads and deletion using test doubles.
- `python -m unittest discover -s choir-server -p 'test_*.py' -v`: service privacy,
  bounded jobs, CORS/retention, cancellation, FFmpeg/adapter contracts and guide
  exports, using injected fixtures rather than learned separation. See service
  requirements before running. This has its own model-free CI job.

### Native validation and remaining device testing

```bash
export PATH="$HOME/apk-venv/bin:$PATH"
python android-choirtune/native/fetch.py
cmake -S android-choirtune/native -B .cache/demucs-native/host -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build .cache/demucs-native/host -j 2
.cache/demucs-native/host/streaming_test .cache/demucs-native/stream-test
python android-choirtune/native/test_inference.py
python android-choirtune/native/verify_apk.py ChoirTune.apk
node android-choirtune/web/test_local.mjs
```

The native smoke test loads all 533 actual checkpoint tensors, performs learned
inference, checks a non-passthrough stereo 44.1 kHz WAV of the exact duration,
and rejects malformed/oversized/silent input. Synthetic tones do **not** assess
choir separation quality. The local JS harness covers PCM stereo interleaving,
15-minute limits, bounded resampling and multi-chunk transfer, native startup/allocation errors,
polling/stall watchdog, cancellation, stale work, mono analysis retrieval and
native streaming export. App tests verify that the **vocal output**, not original
PCM, feeds pitch extraction and that native failures never silently fall back.
The model-free C++ streaming test processes **3-minute (plus a partial final
block) and 15-minute files**, verifies every output sample including joins,
silence and end-of-song, bounds the predictor input, checks progress and
analysis length, tests cancellation, and rejects input over 15 minutes.
Its predictor is a simple gain fixture, not learned Demucs. The real-weight
smoke test separately validates the actual model/engine path on a short input.
A separate 20.25-second real-weight host run crossed two contextual blocks,
loaded the model once, preserved WAV/analysis duration, took about 219 seconds
and peaked around 1.9 GB RSS; that still is not a phone-speed benchmark.
A 15-minute learned run has NOT been completed on a phone or host. These tests
do not replace Android WebView/JNI/device integration testing.

This sandbox's ARM64 APK was built with the NDK r22 mirror at
`denoland/android_ndk@401019bf85744311b26c88ced255cd53401af8b7` because official
Google downloads and GitHub release-asset hosts are blocked here. CI uses
Google's official r27 installation instead. The artifact's actual ELF LOAD
alignment is checked in either case, not inferred from the NDK version.

Before claiming phone readiness, install on a physical ARM64 phone, turn off
Wi-Fi/mobile data, run a short licensed choir-with-accompaniment clip, listen
to the blended vocals, verify SATB labels/exports, cancel mid-run and retry,
exercise background/rotation/destruction, then test complete 3-15 minute songs
and streamed WAV export, and check low-memory/storage errors.
No physical-device execution or real-choir quality benchmark has been completed
in this environment. The optional server tests remain model-free as before.
