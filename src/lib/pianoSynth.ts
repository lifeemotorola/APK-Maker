import { SynthTone } from '../types';

class StudioPianoEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private activeVoices = new Map<number, { stop: () => void }>();
  private tone: SynthTone = 'grand';
  private volume = 0.78;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;

      // Build subtle warm studio room impulse response (1.1s)
      const rate = this.ctx.sampleRate;
      const len = Math.floor(rate * 1.1);
      const impulse = this.ctx.createBuffer(2, len, rate);
      for (let ch = 0; ch < 2; ch++) {
        const data = impulse.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const decay = Math.pow(1 - i / len, 2.8);
          data[i] = (Math.random() * 2 - 1) * decay * 0.16;
        }
      }
      this.reverbNode = this.ctx.createConvolver();
      this.reverbNode.buffer = impulse;

      const dryGain = this.ctx.createGain();
      dryGain.gain.value = 0.84;
      const wetGain = this.ctx.createGain();
      wetGain.gain.value = 0.24;

      this.masterGain.connect(dryGain);
      this.masterGain.connect(this.reverbNode);
      this.reverbNode.connect(wetGain);
      dryGain.connect(this.ctx.destination);
      wetGain.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setTone(tone: SynthTone) {
    this.tone = tone;
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.015);
    }
  }

  public midiToFreq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  public noteOn(midi: number, velocity = 0.78, maxDuration = 2.6) {
    if (this.volume <= 0.005) return;
    const ctx = this.ensureContext();
    if (!this.masterGain) return;

    // Stop previous voice on same key cleanly
    this.noteOff(midi);

    const now = ctx.currentTime;
    const freq = this.midiToFreq(midi);

    const voiceGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(
      this.tone === 'grand' ? Math.min(9500, freq * (5.5 + velocity * 4)) : Math.min(5200, freq * 4.2),
      now
    );
    filter.frequency.exponentialRampToValueAtTime(Math.max(420, freq * 1.9), now + 1.5);

    // Subtle stereo panning across the keyboard (low = slightly left, high = slightly right)
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.55, Math.min(0.55, ((midi - 60) / 36) * 0.5));

    const amp = velocity * 0.24;
    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(amp, now + (this.tone === 'grand' ? 0.007 : 0.012));
    const naturalDecay = Math.max(0.75, 2.8 - (midi - 36) * 0.025);
    voiceGain.gain.exponentialRampToValueAtTime(0.0008, now + Math.min(maxDuration, naturalDecay));

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const osc3 = ctx.createOscillator();
    const g1 = ctx.createGain();
    const g2 = ctx.createGain();
    const g3 = ctx.createGain();

    if (this.tone === 'grand') {
      osc1.type = 'triangle';
      osc1.frequency.value = freq;
      g1.gain.value = 0.72;

      osc2.type = 'sine';
      osc2.frequency.value = freq * 2.0007;
      g2.gain.value = 0.28;

      osc3.type = 'sawtooth';
      osc3.frequency.value = freq * 1.0012;
      g3.gain.value = 0.11;
    } else {
      // Warm Electric Rhodes tine + fundamental
      osc1.type = 'sine';
      osc1.frequency.value = freq;
      g1.gain.value = 0.78;

      osc2.type = 'triangle';
      osc2.frequency.value = freq * 2.0;
      g2.gain.value = 0.22;

      // Bell overtone transient
      osc3.type = 'sine';
      osc3.frequency.value = freq * 6.0;
      g3.gain.setValueAtTime(0.12 * velocity, now);
      g3.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    }

    osc1.connect(g1);
    osc2.connect(g2);
    osc3.connect(g3);
    g1.connect(filter);
    g2.connect(filter);
    g3.connect(filter);
    filter.connect(voiceGain);
    voiceGain.connect(panner);
    panner.connect(this.masterGain);

    osc1.start(now);
    osc2.start(now);
    osc3.start(now);

    const autoStopTime = now + maxDuration + 0.15;
    osc1.stop(autoStopTime);
    osc2.stop(autoStopTime);
    osc3.stop(autoStopTime);

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      const t = ctx.currentTime;
      try {
        voiceGain.gain.cancelScheduledValues(t);
        voiceGain.gain.setValueAtTime(Math.max(0.0002, voiceGain.gain.value), t);
        voiceGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
        osc1.stop(t + 0.13);
        osc2.stop(t + 0.13);
        osc3.stop(t + 0.13);
      } catch {
        // Ignore already-stopped oscillator
      }
      this.activeVoices.delete(midi);
    };

    this.activeVoices.set(midi, { stop });
  }

  public noteOff(midi: number) {
    const existing = this.activeVoices.get(midi);
    if (existing) {
      existing.stop();
    }
  }

  public auditionChord(lhMidi: number[], rhMidi: number[], duration = 1.35, velocityScale = 1.0) {
    if (this.volume <= 0.005) return;
    this.ensureContext();
    const allNotes = [
      ...lhMidi.map((m) => ({ midi: m, vel: 0.82 * velocityScale })),
      ...rhMidi.map((m) => ({ midi: m, vel: 0.72 * velocityScale })),
    ];
    allNotes.forEach((item, idx) => {
      window.setTimeout(() => {
        this.noteOn(item.midi, item.vel, duration);
      }, idx * 14);
    });
  }

  public stopAll() {
    for (const voice of this.activeVoices.values()) {
      voice.stop();
    }
    this.activeVoices.clear();
  }
}

export const pianoSynth = new StudioPianoEngine();

/**
 * Decodes ANY browser-playable audio/video file (.mp3, .wav, .m4a, .mp4, .aac, .ogg, .flac, .webm)
 * into a compact 22,050 Hz 16-bit mono WAV Blob so the Python DSP analyzer handles 100% of formats!
 */
export async function transcodeFileToMonoWav(file: File | Blob): Promise<Blob> {
  const arrayBuf = await file.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const tempCtx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await tempCtx.decodeAudioData(arrayBuf.slice(0));
  } finally {
    await tempCtx.close().catch(() => {});
  }

  const targetSr = 22050;
  const maxSeconds = 360;
  const duration = Math.min(decoded.duration, maxSeconds);
  const outLength = Math.max(1, Math.floor(duration * targetSr));

  const offline = new OfflineAudioContext(1, outLength, targetSr);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);

  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);
  return encodeFloat32ToWavBlob(samples, targetSr);
}

export function encodeFloat32ToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // 16-bit
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
