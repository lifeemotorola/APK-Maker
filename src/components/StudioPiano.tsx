import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Keyboard, Layers, Sparkles, Volume2 } from 'lucide-react';
import {
  ChordBlock,
  PianoRollSlice,
  SynthTone,
  VoicingMode,
} from '../types';
import {
  getActiveChordMidiNotes,
  intervalLabelForMidi,
  isBlackKey,
  midiToNoteName,
  mod12,
} from '../lib/musicTheory';
import { pianoSynth } from '../lib/pianoSynth';

interface StudioPianoProps {
  chords: ChordBlock[];
  pianoRoll: PianoRollSlice[];
  currentTime: number;
  activeChord: ChordBlock | null;
  transpose: number;
  useFlats: boolean;
  scalePitchClasses: number[];
  voicingMode: VoicingMode;
  onChangeVoicingMode: (mode: VoicingMode) => void;
  synthTone: SynthTone;
  onChangeSynthTone: (tone: SynthTone) => void;
  playAlongVolume: number;
  onChangePlayAlongVolume: (v: number) => void;
  liveDetectedMidi?: number[];
}

const START_MIDI = 36; // C2
const END_MIDI = 96;   // C7 (61 keys standard 5-octave studio controller)

interface KeyLayout {
  midi: number;
  isBlack: boolean;
  leftPct: number;  // 0..100
  widthPct: number; // 0..100
  centerPct: number;
}

function build61KeyGeometry(): {
  allKeys: KeyLayout[];
  whiteKeys: KeyLayout[];
  blackKeys: KeyLayout[];
  byMidi: Map<number, KeyLayout>;
} {
  const whites: number[] = [];
  for (let m = START_MIDI; m <= END_MIDI; m++) {
    if (!isBlackKey(m)) whites.push(m);
  }
  const nWhites = whites.length; // 36 white keys
  const whiteW = 100 / nWhites;
  const blackW = whiteW * 0.62;

  const whiteIndexMap = new Map<number, number>();
  whites.forEach((m, idx) => whiteIndexMap.set(m, idx));

  const allKeys: KeyLayout[] = [];
  const byMidi = new Map<number, KeyLayout>();

  // Acoustic piano asymmetric black-key offsets for realistic visual spacing
  const blackOffsetFromLeftWhite: Record<number, number> = {
    1: 0.64,  // C# slightly left of center
    3: 0.72,  // D# slightly right of center
    6: 0.62,  // F#
    8: 0.69,  // G# dead center
    10: 0.75, // A#
  };

  for (let m = START_MIDI; m <= END_MIDI; m++) {
    if (!isBlackKey(m)) {
      const wIdx = whiteIndexMap.get(m)!;
      const leftPct = wIdx * whiteW;
      const item: KeyLayout = {
        midi: m,
        isBlack: false,
        leftPct,
        widthPct: whiteW,
        centerPct: leftPct + whiteW * 0.5,
      };
      allKeys.push(item);
      byMidi.set(m, item);
    } else {
      const prevWhiteIdx = whiteIndexMap.get(m - 1) ?? 0;
      const pc = mod12(m);
      const frac = blackOffsetFromLeftWhite[pc] ?? 0.68;
      const centerPct = (prevWhiteIdx + frac + 0.31) * whiteW;
      const leftPct = centerPct - blackW * 0.5;
      const item: KeyLayout = {
        midi: m,
        isBlack: true,
        leftPct,
        widthPct: blackW,
        centerPct,
      };
      allKeys.push(item);
      byMidi.set(m, item);
    }
  }

  return {
    allKeys,
    whiteKeys: allKeys.filter((k) => !k.isBlack),
    blackKeys: allKeys.filter((k) => k.isBlack),
    byMidi,
  };
}

// Computer keyboard -> MIDI mapping (2 octaves: C3..B3 on bottom row, C4..E5 on top QWERTY row)
const KEYBOARD_TO_MIDI: Record<string, number> = {
  z: 48, s: 49, x: 50, d: 51, c: 52, v: 53, g: 54, b: 55, h: 56, n: 57, j: 58, m: 59,
  q: 60, '2': 61, w: 62, '3': 63, e: 64, r: 65, '5': 66, t: 67, '6': 68, y: 69, '7': 70, u: 71,
  i: 72, '9': 73, o: 74, '0': 75, p: 76,
};

export const StudioPiano: React.FC<StudioPianoProps> = ({
  chords,
  pianoRoll,
  currentTime,
  activeChord,
  transpose,
  useFlats,
  scalePitchClasses,
  voicingMode,
  onChangeVoicingMode,
  synthTone,
  onChangeSynthTone,
  playAlongVolume,
  onChangePlayAlongVolume,
  liveDetectedMidi,
}) => {
  const [showWaterfall, setShowWaterfall] = useState(true);
  const [showScaleGuide, setShowScaleGuide] = useState(true);
  const [showDetectedOverlay, setShowDetectedOverlay] = useState(true);
  const [userPressedMidi, setUserPressedMidi] = useState<Set<number>>(new Set());
  const isPointerDownRef = useRef(false);
  const lastPointerMidiRef = useRef<number | null>(null);
  const waterfallCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const geometry = useMemo(() => build61KeyGeometry(), []);

  // Active chord LH & RH MIDI sets
  const chordVoicing = useMemo(
    () => getActiveChordMidiNotes(activeChord, voicingMode, transpose),
    [activeChord, voicingMode, transpose]
  );

  // Instant CQT detected song notes at `currentTime` (+/- 65ms window)
  const currentDetectedSongMidi = useMemo(() => {
    if (liveDetectedMidi && liveDetectedMidi.length > 0) {
      return new Set(liveDetectedMidi);
    }
    if (!pianoRoll.length) return new Set<number>();
    // Binary search nearest slice
    let lo = 0;
    let hi = pianoRoll.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pianoRoll[mid].t < currentTime) lo = mid + 1;
      else hi = mid;
    }
    const candidates = [pianoRoll[lo], pianoRoll[Math.max(0, lo - 1)]].filter(Boolean);
    const out = new Set<number>();
    for (const sl of candidates) {
      if (Math.abs(sl.t - currentTime) <= 0.11) {
        for (const n of sl.notes) {
          const shifted = n.midi + transpose;
          if (shifted >= START_MIDI && shifted <= END_MIDI) {
            out.add(shifted);
          }
        }
      }
    }
    return out;
  }, [currentTime, liveDetectedMidi, pianoRoll, transpose]);

  const lhSet = useMemo(() => new Set(chordVoicing.lh), [chordVoicing.lh]);
  const rhSet = useMemo(() => new Set(chordVoicing.rh), [chordVoicing.rh]);
  const scalePcSet = useMemo(() => new Set(scalePitchClasses), [scalePitchClasses]);

  const triggerKeyDown = useCallback((midi: number) => {
    pianoSynth.noteOn(midi, 0.82, 2.4);
    setUserPressedMidi((prev) => {
      const next = new Set(prev);
      next.add(midi);
      return next;
    });
  }, []);

  const triggerKeyUp = useCallback((midi: number) => {
    pianoSynth.noteOff(midi);
    setUserPressedMidi((prev) => {
      if (!prev.has(midi)) return prev;
      const next = new Set(prev);
      next.delete(midi);
      return next;
    });
  }, []);

  // Computer Keyboard playing support
  useEffect(() => {
    const downKeys = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)
      ) {
        return;
      }
      const k = e.key.toLowerCase();
      const midi = KEYBOARD_TO_MIDI[k];
      if (midi !== undefined && !downKeys.has(k)) {
        downKeys.add(k);
        triggerKeyDown(midi);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const midi = KEYBOARD_TO_MIDI[k];
      if (midi !== undefined) {
        downKeys.delete(k);
        triggerKeyUp(midi);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [triggerKeyDown, triggerKeyUp]);

  // Release any stuck pointer note on global pointerup
  useEffect(() => {
    const handleGlobalUp = () => {
      if (isPointerDownRef.current && lastPointerMidiRef.current !== null) {
        triggerKeyUp(lastPointerMidiRef.current);
      }
      isPointerDownRef.current = false;
      lastPointerMidiRef.current = null;
    };
    window.addEventListener('pointerup', handleGlobalUp);
    return () => window.removeEventListener('pointerup', handleGlobalUp);
  }, [triggerKeyUp]);

  // Draw Falling-Note & Harmonic CQT Waterfall Canvas (aligned pixel-for-pixel with keys!)
  useEffect(() => {
    if (!showWaterfall) return;
    const canvas = waterfallCanvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(300, rect.width);
      const h = 144;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.scale(dpr, dpr);

      // Studio dark gradient background
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#070A11');
      bg.addColorStop(1, '#0E1525');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Octave guide lines aligned with C keys (C2, C3, C4, C5, C6, C7)
      for (const k of geometry.whiteKeys) {
        if (mod12(k.midi) === 0) {
          const x = (k.leftPct / 100) * w;
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
      }

      const lookaheadSec = 3.0; // 3 seconds of upcoming notes flowing down to bottom edge (y = h)
      const timeToY = (tSec: number) => h - ((tSec - currentTime) / lookaheadSec) * h;

      // 1. Upcoming Chord Voicing Falling Bars
      for (const ch of chords) {
        if (ch.end < currentTime || ch.start > currentTime + lookaheadSec) continue;
        const notes = getActiveChordMidiNotes(ch, voicingMode, transpose);
        const yBottom = Math.min(h, timeToY(Math.max(currentTime, ch.start)));
        const yTop = Math.max(0, timeToY(Math.min(currentTime + lookaheadSec, ch.end)));
        const barH = Math.max(4, yBottom - yTop - 2);

        const drawGroup = (midis: number[], fill: string, glow: string) => {
          for (const m of midis) {
            const kl = geometry.byMidi.get(m);
            if (!kl) continue;
            const kx = (kl.leftPct / 100) * w + 1.5;
            const kw = Math.max(4, (kl.widthPct / 100) * w - 3);
            ctx.save();
            ctx.shadowColor = glow;
            ctx.shadowBlur = ch.id === activeChord?.id ? 10 : 4;
            ctx.fillStyle = fill;
            ctx.beginPath();
            ctx.roundRect(kx, yTop, kw, barH, 4);
            ctx.fill();
            ctx.restore();
          }
        };

        drawGroup(notes.lh, 'rgba(245, 158, 11, 0.86)', 'rgba(245, 158, 11, 0.65)');
        drawGroup(notes.rh, 'rgba(56, 189, 248, 0.86)', 'rgba(56, 189, 248, 0.65)');
      }

      // 2. Detected Polyphonic Song Notes Overlay (Emerald capsules)
      if (showDetectedOverlay && voicingMode !== 'detected') {
        for (const sl of pianoRoll) {
          if (sl.t + 0.09 < currentTime || sl.t > currentTime + lookaheadSec) continue;
          const yBottom = Math.min(h, timeToY(Math.max(currentTime, sl.t)));
          const yTop = Math.max(0, timeToY(sl.t + 0.085));
          const capH = Math.max(3.5, yBottom - yTop);
          for (const n of sl.notes) {
            const kl = geometry.byMidi.get(n.midi + transpose);
            if (!kl) continue;
            const cw = Math.max(3, (kl.widthPct / 100) * w * 0.46);
            const cx = (kl.centerPct / 100) * w - cw * 0.5;
            ctx.fillStyle = `rgba(52, 211, 153, ${Math.min(0.95, 0.4 + n.vel * 0.6)})`;
            ctx.beginPath();
            ctx.roundRect(cx, yTop, cw, capH, 2);
            ctx.fill();
          }
        }
      }

      // Bottom strike-line glow
      const strikeGrad = ctx.createLinearGradient(0, h - 3, 0, h);
      strikeGrad.addColorStop(0, 'rgba(56, 189, 248, 0)');
      strikeGrad.addColorStop(1, 'rgba(56, 189, 248, 0.55)');
      ctx.fillStyle = strikeGrad;
      ctx.fillRect(0, h - 3, w, 3);

      ctx.restore();
    };

    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [
    activeChord?.id,
    chords,
    currentTime,
    geometry,
    pianoRoll,
    showDetectedOverlay,
    showWaterfall,
    transpose,
    voicingMode,
  ]);

  const activeRootPc = activeChord ? mod12(activeChord.rootPc + transpose) : null;

  return (
    <div className="rounded-2xl border border-slate-800/90 bg-[#0B101B] shadow-2xl overflow-hidden">
      {/* Studio Piano Control Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-800/90 bg-[#0E1525]">
        {/* Left: Voicing Selector */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-sky-400" />
            Piano Keys Mode:
          </span>
          <div className="inline-flex rounded-xl bg-[#080C15] p-0.5 border border-slate-800">
            {(
              [
                { id: 'smooth', label: 'Smooth Voicing' },
                { id: 'root', label: 'Easy Triad' },
                { id: 'pro', label: 'Pro 7th/9th' },
                { id: 'detected', label: 'Detected Song Notes' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => onChangeVoicingMode(opt.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                  voicingMode === opt.id
                    ? 'bg-sky-500 text-slate-950 font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Synth Tone, Play-Along Level & Visual Overlays */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Tone toggle */}
          <div className="inline-flex items-center rounded-xl bg-[#080C15] p-0.5 border border-slate-800 text-xs">
            <button
              onClick={() => onChangeSynthTone('grand')}
              className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                synthTone === 'grand'
                  ? 'bg-slate-800 text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Grand Piano
            </button>
            <button
              onClick={() => onChangeSynthTone('rhodes')}
              className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                synthTone === 'rhodes'
                  ? 'bg-slate-800 text-amber-300 font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Warm Rhodes
            </button>
          </div>

          {/* Auto-Accompany Chord Synth Volume */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#080C15] border border-slate-800 text-xs"
            title="Blend studio piano chords automatically in sync with song playback"
          >
            <Volume2 className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-slate-400 hidden md:inline">Chord Guide Vol:</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={playAlongVolume}
              onChange={(e) => onChangePlayAlongVolume(parseFloat(e.target.value))}
              className="w-16 accent-sky-400 cursor-pointer"
            />
          </div>

          {/* Toggle Scale Dots */}
          <button
            onClick={() => setShowScaleGuide((s) => !s)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border text-xs transition cursor-pointer ${
              showScaleGuide
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-[#080C15] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="Highlight all piano keys belonging to the detected song key scale"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Scale Keys
          </button>

          {/* Toggle Waterfall */}
          <button
            onClick={() => setShowWaterfall((w) => !w)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border text-xs transition cursor-pointer ${
              showWaterfall
                ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                : 'bg-[#080C15] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="Show/Hide Falling Note Waterfall"
          >
            <Eye className="w-3.5 h-3.5" />
            Note Roll
          </button>
        </div>
      </div>

      {/* Color Legend Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-1.5 bg-[#080C15] border-b border-slate-800/70 text-[11px] text-slate-400">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_6px_#F59E0B]" />
            Left-Hand Bass Keys
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-400 shadow-[0_0_6px_#38BDF8]" />
            Right-Hand Chord Keys
          </span>
          <button
            onClick={() => setShowDetectedOverlay((d) => !d)}
            className={`inline-flex items-center gap-1.5 cursor-pointer transition ${
              showDetectedOverlay ? 'text-emerald-300' : 'text-slate-500 line-through'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34D399]" />
            Detected Song Audio Notes
          </button>
        </div>

        <div className="hidden lg:flex items-center gap-1.5 text-slate-500">
          <Keyboard className="w-3.5 h-3.5" />
          <span>Play along with mouse or keyboard (Z–M &amp; Q–P)</span>
        </div>
      </div>

      {/* Horizontal Scroll Container on very narrow mobile screens so keys stay playable */}
      <div className="overflow-x-auto">
        <div className="min-w-[740px]">
          {/* Falling-Note Waterfall Canvas */}
          {showWaterfall && (
            <canvas ref={waterfallCanvasRef} className="block w-full h-[144px]" />
          )}

          {/* Realistic 61-Key Studio Piano (C2..C7) */}
          <div
            className="relative h-44 sm:h-48 bg-[#05070C] border-t-4 border-[#161F33] select-none touch-none"
            onPointerLeave={() => {
              if (isPointerDownRef.current && lastPointerMidiRef.current !== null) {
                triggerKeyUp(lastPointerMidiRef.current);
                lastPointerMidiRef.current = null;
              }
            }}
          >
            {/* White Keys */}
            {geometry.whiteKeys.map((kl) => {
              const m = kl.midi;
              const isLH = lhSet.has(m);
              const isRH = rhSet.has(m);
              const isDet = showDetectedOverlay && currentDetectedSongMidi.has(m);
              const isUser = userPressedMidi.has(m);
              const inScale = showScaleGuide && scalePcSet.has(mod12(m));
              const isC = mod12(m) === 0;
              const noteLabel = midiToNoteName(m, useFlats);
              const roleLabel =
                activeRootPc !== null && (isLH || isRH)
                  ? isLH
                    ? 'LH'
                    : intervalLabelForMidi(m, activeRootPc)
                  : '';

              let bgClass =
                'bg-gradient-to-b from-slate-100 via-slate-50 to-slate-200 text-slate-700 hover:from-white hover:to-slate-100';
              if (isUser) {
                bgClass =
                  'bg-gradient-to-b from-fuchsia-300 via-fuchsia-400 to-fuchsia-500 text-slate-950 translate-y-[2px] shadow-inner';
              } else if (isLH) {
                bgClass =
                  'bg-gradient-to-b from-amber-200 via-amber-300 to-amber-400 text-slate-950 translate-y-[1.5px] shadow-[inset_0_-4px_8px_rgba(0,0,0,0.2)]';
              } else if (isRH) {
                bgClass =
                  'bg-gradient-to-b from-sky-200 via-sky-300 to-sky-400 text-slate-950 translate-y-[1.5px] shadow-[inset_0_-4px_8px_rgba(0,0,0,0.2)]';
              } else if (isDet) {
                bgClass =
                  'bg-gradient-to-b from-emerald-100 via-emerald-200 to-emerald-300 text-slate-950';
              }

              return (
                <div
                  key={m}
                  style={{ left: `${kl.leftPct}%`, width: `${kl.widthPct}%` }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    isPointerDownRef.current = true;
                    lastPointerMidiRef.current = m;
                    triggerKeyDown(m);
                  }}
                  onPointerEnter={() => {
                    if (isPointerDownRef.current && lastPointerMidiRef.current !== m) {
                      if (lastPointerMidiRef.current !== null) {
                        triggerKeyUp(lastPointerMidiRef.current);
                      }
                      lastPointerMidiRef.current = m;
                      triggerKeyDown(m);
                    }
                  }}
                  className={`absolute top-0 bottom-0 border-r border-slate-400/70 rounded-b-md flex flex-col justify-end items-center pb-2 transition-transform duration-75 cursor-pointer ${bgClass}`}
                >
                  {/* Top LED Light Guide Indicator */}
                  {(isLH || isRH || isDet || isUser) && (
                    <span
                      className={`absolute top-1 w-3/5 h-1.5 rounded-full ${
                        isUser
                          ? 'bg-fuchsia-600'
                          : isLH
                            ? 'bg-amber-600'
                            : isRH
                              ? 'bg-sky-600'
                              : 'bg-emerald-600'
                      }`}
                    />
                  )}

                  {/* Detected Audio Note Ring if chord is also pressed */}
                  {isDet && (isLH || isRH) && (
                    <span className="mb-1 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-slate-900/40" />
                  )}

                  {/* Scale Degree Guide Dot */}
                  {inScale && !isLH && !isRH && !isDet && (
                    <span className="mb-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500/55" />
                  )}

                  {/* Role badge (LH / R / 3 / 5 / 7) */}
                  {roleLabel && (
                    <span className="mb-0.5 px-1 rounded text-[9px] font-bold bg-slate-950/80 text-white leading-tight">
                      {roleLabel}
                    </span>
                  )}

                  {/* Key Note Name */}
                  {(isC || isLH || isRH || isDet || isUser) && (
                    <span
                      className={`text-[10px] font-mono leading-none ${
                        isLH || isRH || isDet || isUser
                          ? 'font-bold text-slate-950'
                          : 'font-medium text-slate-400'
                      }`}
                    >
                      {noteLabel}
                    </span>
                  )}
                </div>
              );
            })}

            {/* Black Keys */}
            {geometry.blackKeys.map((kl) => {
              const m = kl.midi;
              const isLH = lhSet.has(m);
              const isRH = rhSet.has(m);
              const isDet = showDetectedOverlay && currentDetectedSongMidi.has(m);
              const isUser = userPressedMidi.has(m);
              const inScale = showScaleGuide && scalePcSet.has(mod12(m));
              const noteLabel = midiToNoteName(m, useFlats).replace(/\d+$/, '');
              const roleLabel =
                activeRootPc !== null && (isLH || isRH)
                  ? isLH
                    ? 'LH'
                    : intervalLabelForMidi(m, activeRootPc)
                  : '';

              let bgClass =
                'bg-gradient-to-b from-slate-800 via-slate-900 to-black border-slate-700 text-slate-200 shadow-[0_5px_10px_rgba(0,0,0,0.65)] hover:from-slate-700';
              if (isUser) {
                bgClass =
                  'bg-gradient-to-b from-fuchsia-400 via-fuchsia-500 to-fuchsia-700 border-fuchsia-300 text-white translate-y-[2px]';
              } else if (isLH) {
                bgClass =
                  'bg-gradient-to-b from-amber-400 via-amber-500 to-amber-600 border-amber-200 text-slate-950 translate-y-[1.5px] shadow-[0_0_14px_rgba(245,158,11,0.6)]';
              } else if (isRH) {
                bgClass =
                  'bg-gradient-to-b from-sky-400 via-sky-500 to-sky-600 border-sky-200 text-slate-950 translate-y-[1.5px] shadow-[0_0_14px_rgba(56,189,248,0.6)]';
              } else if (isDet) {
                bgClass =
                  'bg-gradient-to-b from-emerald-400 via-emerald-500 to-emerald-700 border-emerald-200 text-slate-950 shadow-[0_0_10px_rgba(52,211,153,0.5)]';
              }

              return (
                <div
                  key={m}
                  style={{ left: `${kl.leftPct}%`, width: `${kl.widthPct}%` }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    isPointerDownRef.current = true;
                    lastPointerMidiRef.current = m;
                    triggerKeyDown(m);
                  }}
                  onPointerEnter={(e) => {
                    e.stopPropagation();
                    if (isPointerDownRef.current && lastPointerMidiRef.current !== m) {
                      if (lastPointerMidiRef.current !== null) {
                        triggerKeyUp(lastPointerMidiRef.current);
                      }
                      lastPointerMidiRef.current = m;
                      triggerKeyDown(m);
                    }
                  }}
                  className={`absolute top-0 h-[62%] z-10 border rounded-b-md flex flex-col justify-end items-center pb-1.5 transition-transform duration-75 cursor-pointer ${bgClass}`}
                >
                  {inScale && !isLH && !isRH && !isDet && (
                    <span className="mb-1 w-1.5 h-1.5 rounded-full bg-emerald-400/70" />
                  )}

                  {roleLabel && (
                    <span className="mb-0.5 px-1 rounded text-[8px] font-bold bg-slate-950/85 text-white leading-tight">
                      {roleLabel}
                    </span>
                  )}

                  {(isLH || isRH || isDet || isUser) && (
                    <span className="text-[9px] font-mono font-bold leading-none">
                      {noteLabel}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
