# Choir Tune Finder 1.2 - Android APK

Upload a song to estimate its **main melody and Soprano, Alto, Tenor, and Bass
pitches**, entirely on-device. No account, server or network permission.

- Package: `com.choirtune.app`, label **Choir Tune Finder**
- Version **1.2** / versionCode **3** (updates versions 1.0 and 1.1 with the same signing key)
- minSdk 23 / targetSdk 34; a recent Android System WebView is required
- Artifact: `android-choirtune/app/build/ChoirTune-1.2.apk`
- Root download copy: `ChoirTune.apk` (gitignored)

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
  upload audio. No Internet permission is added.

The UI/analysis loop targets **25 Hz**, not zero latency: the 4,096-sample
capture window plus smoothing add response time, and device/OS scheduling
can slow updates. Latest-frame processing avoids a DSP backlog. Synthetic
pitch tests cover bass through soprano at 44.1/48 kHz, but real singers,
room acoustics, Bluetooth routing and end-to-end phone latency have not been
benchmarked. Multiple simultaneous singers can cause unstable readings or
harmonic/octave errors; use this mode for individual/dominant notes.

## Use uploaded-song analysis

1. Choose an audio file, up to **5 minutes / 40 MB**. MP3, WAV, M4A and other
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
| Soprano | C4-C6 | Highest part, often the melody |
| Alto | G3-D5 | Lower treble / middle harmony |
| Tenor | C3-A4 | Higher standard male part |
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

A bundled WebView loads `file:///android_asset/www/index.html`. The native
`window.ChoirTune` bridge provides private `state.json` persistence, text sharing,
and file saving. The system document picker supplies uploaded audio. Exports
use MediaStore on Android 10+; Android 6-9 requests legacy write permission.
Browser mode falls back to localStorage and text/MIDI downloads.

```bash
./android/fetch-tools.sh
./android-choirtune/build.sh
```

The build runs all four dependency-free Node test suites, stages web assets,
runs the emoji gate, compiles Java with ecj, dexes with d8, packages with aapt2,
aligns with `android/tools/pack_apk.py`, and signs with the debug keystore.
Build outputs, tools and staged assets stay outside Git. Launcher artwork is
programmatically drawn. `.github/workflows/build-apk.yml` uploads `ChoirTune-APK`.

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
