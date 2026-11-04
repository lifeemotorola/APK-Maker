/**
 * keyfinder.ts — the offline music-analysis module bundled into the APK
 * (esbuild -> assets/www/keyfinder.js, exposes window.KeyFinder).
 *
 * Reuses the KeySense Studio DSP pipeline (src/lib/offlineAnalyze.ts +
 * src/lib/musicTheory.ts): decode any audio file with WebAudio, then run the
 * full analysis (key signature, BPM, chords, chroma profile, waveform) entirely
 * on-device — no network.
 */
import { analyzePcm, decodeAudioBytes } from '../../src/lib/offlineAnalyze';
import { chordIsInKey, getSongProgression } from '../../src/lib/musicTheory';
import type { SongAnalysis } from '../../src/types';

/** Decode the raw bytes of a song and return its full analysis (incl. detected key). */
export async function findKeyInSong(bytes: Uint8Array, filename: string): Promise<SongAnalysis> {
  const { samples, sampleRate } = await decodeAudioBytes(bytes);
  return analyzePcm(samples, sampleRate, filename);
}

declare global {
  interface Window {
    KeyFinder: {
      findKeyInSong: typeof findKeyInSong;
      getSongProgression: typeof getSongProgression;
      chordIsInKey: typeof chordIsInKey;
    };
  }
}

window.KeyFinder = { findKeyInSong, getSongProgression, chordIsInKey };
