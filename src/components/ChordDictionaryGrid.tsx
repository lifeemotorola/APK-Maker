import React, { useMemo, useState } from 'react';
import { Check, Copy, Music2, Volume2 } from 'lucide-react';
import { ChordBlock, NotationMode, VoicingMode } from '../types';
import {
  formatPrimaryChordLabel,
  formatTime,
  getActiveChordMidiNotes,
  isBlackKey,
  mod12,
  transposeChordSymbol,
} from '../lib/musicTheory';
import { pianoSynth } from '../lib/pianoSynth';

interface MiniPianoDiagramProps {
  pitchClasses: number[];
  bassPc: number;
}

const MiniPianoDiagram: React.FC<MiniPianoDiagramProps> = ({ pitchClasses, bassPc }) => {
  // Render a crisp 17-key (C..E, 1.4 octaves) SVG diagram so any chord inversion fits cleanly
  const keys = useMemo(() => {
    const start = 60; // C4
    // Normalize chord pitch classes into compact 17-semitone span starting from bass/root
    const activeMidis = new Set<number>();
    const rootMidi = start + mod12(bassPc);
    activeMidis.add(rootMidi <= 67 ? rootMidi : rootMidi - 12);

    for (const pc of pitchClasses) {
      let m = start + mod12(pc);
      while (m < rootMidi - 5) m += 12;
      if (m > start + 16) m -= 12;
      activeMidis.add(m);
    }

    const whites: Array<{ midi: number; x: number }> = [];
    const blacks: Array<{ midi: number; x: number }> = [];
    let wIdx = 0;
    const wWidth = 14;
    for (let m = start - 5; m <= start + 16; m++) {
      if (!isBlackKey(m)) {
        whites.push({ midi: m, x: wIdx * wWidth });
        wIdx++;
      } else {
        blacks.push({ midi: m, x: wIdx * wWidth - 4.5 });
      }
    }
    return { whites, blacks, totalW: wIdx * wWidth, activeMidis, bassMod: mod12(bassPc) };
  }, [pitchClasses, bassPc]);

  return (
    <svg
      viewBox={`0 0 ${keys.totalW} 48`}
      className="w-full h-12 rounded-md overflow-hidden border border-slate-800 bg-slate-950"
    >
      {keys.whites.map((wk) => {
        const active = keys.activeMidis.has(wk.midi);
        const isBass = active && mod12(wk.midi) === keys.bassMod;
        return (
          <rect
            key={wk.midi}
            x={wk.x + 0.5}
            y={0}
            width={13}
            height={48}
            rx={1.5}
            fill={isBass ? '#FBBF24' : active ? '#38BDF8' : '#E2E8F0'}
            stroke="#0F172A"
            strokeWidth={0.8}
          />
        );
      })}
      {keys.blacks.map((bk) => {
        const active = keys.activeMidis.has(bk.midi);
        const isBass = active && mod12(bk.midi) === keys.bassMod;
        return (
          <rect
            key={bk.midi}
            x={bk.x}
            y={0}
            width={9}
            height={29}
            rx={1.5}
            fill={isBass ? '#F59E0B' : active ? '#0284C7' : '#0F172A'}
            stroke="#020617"
            strokeWidth={0.8}
          />
        );
      })}
    </svg>
  );
};

interface ChordDictionaryGridProps {
  chords: ChordBlock[];
  songKeyName: string;
  bpm: number;
  transpose: number;
  useFlats: boolean;
  notation: NotationMode;
  voicingMode: VoicingMode;
  activeChordId: number | null;
  onSelectChord: (chord: ChordBlock) => void;
}

export const ChordDictionaryGrid: React.FC<ChordDictionaryGridProps> = ({
  chords,
  songKeyName,
  bpm,
  transpose,
  useFlats,
  notation,
  voicingMode,
  activeChordId,
  onSelectChord,
}) => {
  const [copied, setCopied] = useState(false);

  // Deduplicate unique chords in order of prominence/appearance
  const uniqueChords = useMemo(() => {
    const map = new Map<string, { rep: ChordBlock; totalSec: number; count: number }>();
    for (const ch of chords) {
      const { symbol } = transposeChordSymbol(ch, transpose, useFlats);
      const existing = map.get(symbol);
      if (existing) {
        existing.totalSec += ch.duration;
        existing.count += 1;
      } else {
        map.set(symbol, { rep: ch, totalSec: ch.duration, count: 1 });
      }
    }
    return Array.from(map.entries()).map(([sym, data]) => ({
      symbol: sym,
      ...data,
    }));
  }, [chords, transpose, useFlats]);

  // Group timeline chords into 4-chord musical phrases for easy reading
  const phrases = useMemo(() => {
    const rows: ChordBlock[][] = [];
    for (let i = 0; i < chords.length; i += 4) {
      rows.push(chords.slice(i, i + 4));
    }
    return rows;
  }, [chords]);

  const handleCopyChart = () => {
    const header = `KeySense Studio Chord Chart\nKey: ${songKeyName} | Tempo: ${Math.round(bpm)} BPM\n${'-'.repeat(46)}\n`;
    const body = phrases
      .map((row) => {
        const tStamp = `[${formatTime(row[0].start)}]`.padEnd(8, ' ');
        const cells = row
          .map((c) => {
            const { primary } = formatPrimaryChordLabel(c, transpose, useFlats, notation);
            return primary.padEnd(9, ' ');
          })
          .join('| ');
        return `${tStamp} | ${cells}|`;
      })
      .join('\n');
    navigator.clipboard.writeText(header + body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
      {/* Left 7 cols: Unique Piano Chord Shapes in This Song */}
      <div className="xl:col-span-7 rounded-2xl border border-slate-800/90 bg-[#0D1320] p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Music2 className="w-4 h-4 text-sky-400" />
              Piano Chord Shapes in This Song ({uniqueChords.length})
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Click any diagram to hear its studio piano voicing and see the exact keys
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-3 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-400" /> Root/Bass
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-sky-400" /> Chord Tones
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {uniqueChords.map(({ symbol, rep, count }) => {
            const { noteNames } = transposeChordSymbol(rep, transpose, useFlats);
            const shiftedPcs = rep.pitchClasses.map((pc) => mod12(pc + transpose));
            const shiftedBass = mod12(rep.bassPc + transpose);
            return (
              <button
                key={symbol}
                onClick={() => {
                  const notes = getActiveChordMidiNotes(rep, voicingMode, transpose);
                  pianoSynth.auditionChord(notes.lh, notes.rh, 1.35);
                }}
                className="group text-left rounded-xl border border-slate-800 bg-[#080C15] hover:border-sky-500/60 hover:bg-[#0E1628] p-3 transition cursor-pointer"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-base font-bold text-white group-hover:text-sky-300 transition">
                      {symbol}
                    </span>
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-300">
                      {rep.nashville}
                    </span>
                  </div>
                  <Volume2 className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 transition" />
                </div>

                <MiniPianoDiagram pitchClasses={shiftedPcs} bassPc={shiftedBass} />

                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <span className="font-mono text-slate-300 truncate">
                    {noteNames.join(' · ')}
                  </span>
                  <span className="text-slate-500 shrink-0">{count}×</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right 5 cols: Phrase-by-Phrase Song Chord Sheet */}
      <div className="xl:col-span-5 rounded-2xl border border-slate-800/90 bg-[#0D1320] p-4 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Song Progression Sheet</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Key of {songKeyName} · Click any bar to jump to timestamp
            </p>
          </div>
          <button
            onClick={handleCopyChart}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy Chart
              </>
            )}
          </button>
        </div>

        <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
          {phrases.map((row, rIdx) => (
            <div
              key={rIdx}
              className="grid grid-cols-12 items-center gap-1.5 rounded-xl bg-[#080C15] border border-slate-800/80 p-2"
            >
              <span className="col-span-2 text-[11px] font-mono text-slate-500 pl-1">
                {formatTime(row[0].start)}
              </span>
              <div className="col-span-10 grid grid-cols-4 gap-1.5">
                {row.map((ch) => {
                  const { primary, secondary } = formatPrimaryChordLabel(
                    ch,
                    transpose,
                    useFlats,
                    notation
                  );
                  const isActive = ch.id === activeChordId;
                  return (
                    <button
                      key={ch.id}
                      onClick={() => onSelectChord(ch)}
                      className={`px-2 py-1.5 rounded-lg border text-left transition cursor-pointer ${
                        isActive
                          ? 'bg-sky-500/25 border-sky-400 text-white font-bold'
                          : 'bg-slate-900/80 border-slate-800 text-slate-200 hover:border-slate-600'
                      }`}
                    >
                      <div className="text-xs font-bold truncate">{primary}</div>
                      <div className="text-[10px] font-mono text-slate-400 truncate">
                        {secondary}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
