import React, { useMemo } from 'react';
import { Compass, Sparkles, Volume2 } from 'lucide-react';
import { KeyInfo } from '../types';
import {
  getDiatonicChordsForKey,
  mod12,
  spellPitchClass,
  transposeKeyInfo,
} from '../lib/musicTheory';
import { pianoSynth } from '../lib/pianoSynth';

interface KeyHarmonyPanelProps {
  keyInfo: KeyInfo;
  transpose: number;
  tuningHz: number;
}

export const KeyHarmonyPanel: React.FC<KeyHarmonyPanelProps> = ({
  keyInfo,
  transpose,
  tuningHz,
}) => {
  const shiftedKey = useMemo(
    () => transposeKeyInfo(keyInfo, transpose),
    [keyInfo, transpose]
  );

  const diatonicChords = useMemo(
    () =>
      getDiatonicChordsForKey(
        shiftedKey.rootPc,
        keyInfo.mode,
        shiftedKey.useFlats
      ),
    [keyInfo.mode, shiftedKey.rootPc, shiftedKey.useFlats]
  );

  const scaleSet = useMemo(
    () => new Set(shiftedKey.scalePitchClasses),
    [shiftedKey.scalePitchClasses]
  );

  // Rotate chromaProfile to match transposed pitch classes
  const transposedProfile = useMemo(() => {
    const out = new Array<number>(12).fill(0);
    for (let pc = 0; pc < 12; pc++) {
      const targetPc = mod12(pc + transpose);
      out[targetPc] = keyInfo.chromaProfile[pc] ?? 0;
    }
    return out;
  }, [keyInfo.chromaProfile, transpose]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Left 5 cols: 12-Pitch-Class Harmonic Energy Profile */}
      <div className="lg:col-span-5 rounded-2xl border border-slate-800/90 bg-[#0D1320] p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Compass className="w-4 h-4 text-emerald-400" />
              Harmonic Pitch-Class Profile
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Energy across all 12 piano keys · Tuning A4 = {tuningHz} Hz
            </p>
          </div>
          <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            Camelot {keyInfo.camelot}
          </span>
        </div>

        <div className="grid grid-cols-12 gap-1.5 items-end h-36 pt-4 pb-1 px-1 bg-[#080C15] rounded-xl border border-slate-800/80">
          {transposedProfile.map((val, pc) => {
            const isTonic = pc === shiftedKey.rootPc;
            const inScale = scaleSet.has(pc);
            const pct = Math.max(8, Math.round(val * 100));
            const label = spellPitchClass(pc, shiftedKey.useFlats);

            return (
              <button
                key={pc}
                onClick={() => pianoSynth.noteOn(60 + pc, 0.8, 1.2)}
                title={`${label}: ${Math.round(val * 100)}% harmonic energy (Click to play note)`}
                className="flex flex-col items-center justify-end h-full group cursor-pointer"
              >
                <div className="w-full flex-1 flex items-end justify-center px-0.5">
                  <div
                    style={{ height: `${pct}%` }}
                    className={`w-full rounded-t transition-all ${
                      isTonic
                        ? 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]'
                        : inScale
                          ? 'bg-sky-400/85 group-hover:bg-sky-300'
                          : 'bg-slate-700/75 group-hover:bg-slate-600'
                    }`}
                  />
                </div>
                <span
                  className={`mt-1.5 text-[10px] font-mono ${
                    isTonic
                      ? 'font-bold text-amber-300'
                      : inScale
                        ? 'font-semibold text-slate-200'
                        : 'text-slate-500'
                  }`}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span>
            Relative Key: <strong className="text-slate-200">{shiftedKey.relativeKey}</strong>
          </span>
          <span>
            Key Confidence:{' '}
            <strong className="text-emerald-300">
              {Math.round(keyInfo.confidence * 100)}%
            </strong>
          </span>
        </div>
      </div>

      {/* Right 7 cols: Scale Notes & 7 Diatonic Family Chords */}
      <div className="lg:col-span-7 rounded-2xl border border-slate-800/90 bg-[#0D1320] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              {shiftedKey.name} Scale &amp; Number System Family
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              The 7 natural scale notes &amp; diatonic chords for playing by ear in {shiftedKey.name}
            </p>
          </div>

          <button
            onClick={() => {
              shiftedKey.scalePitchClasses.forEach((pc, idx) => {
                let m = 60 + pc;
                if (idx > 0 && pc < shiftedKey.scalePitchClasses[0]) m += 12;
                setTimeout(() => pianoSynth.noteOn(m, 0.76, 0.65), idx * 140);
              });
              setTimeout(
                () => pianoSynth.noteOn(72 + shiftedKey.rootPc, 0.82, 1.0),
                7 * 140
              );
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/35 hover:bg-amber-500/25 transition cursor-pointer"
          >
            <Volume2 className="w-3.5 h-3.5" />
            Play {shiftedKey.name} Scale
          </button>
        </div>

        {/* 7 Scale Notes Strip */}
        <div className="grid grid-cols-7 gap-2 mb-4">
          {shiftedKey.scaleNotes.map((n, idx) => (
            <button
              key={idx}
              onClick={() => {
                const base = 60 + shiftedKey.scalePitchClasses[idx];
                pianoSynth.noteOn(base, 0.82, 1.1);
              }}
              className="rounded-xl bg-[#080C15] border border-slate-800 hover:border-amber-400/60 py-2 text-center transition cursor-pointer"
            >
              <div className="text-[10px] font-mono text-slate-500">Deg {idx + 1}</div>
              <div className="text-sm font-bold text-white mt-0.5">{n}</div>
            </button>
          ))}
        </div>

        {/* 7 Diatonic Chords */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
          {diatonicChords.map((dc) => (
            <button
              key={dc.degree}
              onClick={() => pianoSynth.auditionChord(dc.lhMidi, dc.rhMidi, 1.35)}
              className="group rounded-xl bg-[#080C15] border border-slate-800 hover:border-sky-400/70 hover:bg-[#0F172A] p-2.5 text-left transition cursor-pointer"
            >
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                <span>{dc.degree}</span>
                <span className="text-sky-400">#{dc.nashville}</span>
              </div>
              <div className="text-sm font-bold text-white group-hover:text-sky-300 mt-1">
                {dc.symbol}
              </div>
              <div className="text-[10px] text-slate-500 truncate mt-0.5">{dc.role}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
