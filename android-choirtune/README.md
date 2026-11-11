# Choir Tune Finder 1.1 - Android APK

Upload a song to estimate its **main melody and Soprano, Alto, Tenor, and Bass
pitches**, entirely on-device. No account, server or network permission.

- Package: `com.choirtune.app`, label **Choir Tune Finder**
- Version **1.1** / versionCode **2** (updates version 1.0 with the same signing key)
- minSdk 23 / targetSdk 34; a recent Android System WebView is required
- Artifact: `android-choirtune/app/build/ChoirTune-1.1.apk`
- Root download copy: `ChoirTune.apk` (gitignored)

## Use

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

The build runs all three dependency-free Node test suites, stages web assets,
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
