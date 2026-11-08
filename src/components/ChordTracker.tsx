import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ListMusic, Play } from 'lucide-react';
import { ChordBlock, NotationMode, SongAnalysis } from '../types';
import { formatPrimaryChordLabel, formatTime } from '../lib/musicTheory';
import { downloadBytes } from '../lib/midiExport';
import {
  TrackEntry,
  beatSeconds,
  buildChartText,
  buildProgressionTrack,
  findActiveEntry,
} from '../lib/chordTracker';

interface ChordTrackerProps {
  analysis: SongAnalysis;
  title: string;
  keyName: string;
  currentTime: number;
  isPlaying: boolean;
  activeChordId: number | null;
  transpose: number;
  useFlats: boolean;
  notation: NotationMode;
  onSeek: (timeSec: number) => void;
  onSelectChord: (chord: ChordBlock) => void;
}

/**
 * ChordTracker — Yamaha Chord Tracker-style view: the song's chord progression
 * tracked with timing. Big NOW chord, a synced auto-scrolling progression
 * strip (tap a chord to jump there), a full timed chord chart, and a
 * plain-text chart export.
 */
export const ChordTracker: React.FC<ChordTrackerProps> = ({
  analysis,
  title,
  keyName,
  currentTime,
  isPlaying,
  activeChordId,
  transpose,
  useFlats,
  notation,
  onSeek,
  onSelectChord,
}) => {
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const track = useMemo(
    () => buildProgressionTrack(analysis.chords, analysis.bpm),
    [analysis]
  );
  const activeIdx = useMemo(
    () => findActiveEntry(track, currentTime),
    [track, currentTime]
  );
  const activeEntry: TrackEntry | null = activeIdx >= 0 ? track[activeIdx] : null;
  const nextEntry: TrackEntry | null = activeIdx >= 0 ? track[activeIdx + 1] || null : null;

  const activeBlock = useMemo(() => {
    if (activeChordId != null) {
      const b = analysis.chords.find((c) => c.id === activeChordId);
      if (b) return b;
    }
    return analysis.chords.find((c) => c.id === activeEntry?.blockId) || null;
  }, [analysis, activeChordId, activeEntry]);

  const activeLabel = useMemo(
    () => (activeBlock ? formatPrimaryChordLabel(activeBlock, transpose, useFlats, notation) : null),
    [activeBlock, transpose, useFlats, notation]
  );
  const nextLabel = useMemo(() => {
    if (!nextEntry) return null;
    const b = analysis.chords.find((c) => c.id === nextEntry.blockId);
    return b ? formatPrimaryChordLabel(b, transpose, useFlats, notation) : null;
  }, [nextEntry, analysis, transpose, useFlats, notation]);

  const entryProgressPct = useMemo(() => {
    if (!activeEntry) return 0;
    const span = Math.max(0.05, activeEntry.end - activeEntry.start);
    return Math.max(0, Math.min(100, ((currentTime - activeEntry.start) / span) * 100));
  }, [activeEntry, currentTime]);

  // Auto-scroll the progression strip so the active chord stays centered
  const stripRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    const el = chipRefs.current[activeIdx];
    if (el && stripRef.current) {
      stripRef.current.scrollTo({
        left: el.offsetLeft - stripRef.current.clientWidth / 2 + el.clientWidth / 2,
        behavior: 'smooth',
      });
    }
  }, [activeIdx]);

  const labelOf = (e: TrackEntry): string => {
    const b = analysis.chords.find((c) => c.id === e.blockId);
    return b ? formatPrimaryChordLabel(b, transpose, useFlats, notation).primary : e.symbol;
  };

  const handleExport = () => {
    const text = buildChartText({
      title,
      bpm: analysis.bpm,
      keyName,
      duration: analysis.duration,
      track,
      chords: analysis.chords,
      transpose,
      useFlats,
      notation,
    });
    const clean = title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'song';
    const path = downloadBytes(
      `${clean}_chordchart.txt`,
      new TextEncoder().encode(text),
      'text/plain'
    );
    setExportMsg(path ? `Saved to ${path}` : 'Chart downloaded');
    setTimeout(() => setExportMsg(null), 3500);
  };

  return (
    <div className="rounded-2xl border border-slate-800/90 bg-[#0D1320]/95 shadow-xl overflow-hidden">
      {/* Tracker header: song, tempo, key, position */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-800/80 bg-[#0A0F1A]">
        <div className="flex items-center gap-2.5 min-w-0">
          <ListMusic className="w-4 h-4 text-sky-400 shrink-0" />
          <span className="text-sm font-bold text-white truncate">{title}</span>
          <span className="text-[11px] font-mono text-amber-300 shrink-0">
            {Math.round(analysis.bpm)} BPM
          </span>
          <span className="text-[11px] font-mono text-emerald-300 shrink-0">{keyName}</span>
          <span className="text-[11px] text-slate-500 hidden sm:inline">
            {beatSeconds(analysis.bpm).toFixed(2)}s/beat
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-sky-400">
            {formatTime(currentTime)}
            <span className="text-slate-600"> / </span>
            <span className="text-slate-400">{formatTime(analysis.duration)}</span>
          </span>
          <span className="text-[11px] text-slate-500 hidden md:inline">
            {track.length} chords tracked
          </span>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-sky-500/15 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 transition cursor-pointer"
            title="Export the timed chord chart as a text file (Downloads on Android)"
          >
            <Download className="w-3.5 h-3.5" />
            Export chart
          </button>
        </div>
      </div>

      {exportMsg && (
        <div className="px-4 py-1.5 text-[11px] text-emerald-300 bg-emerald-500/10 border-b border-emerald-500/30">
          {exportMsg}
        </div>
      )}

      {/* NOW bar: big current chord + next chord + progress */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-slate-800/70 bg-gradient-to-r from-sky-500/10 via-transparent to-amber-500/10">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-400">
            Now {isPlaying ? 'playing' : 'paused'}
          </div>
          <div className="text-3xl sm:text-4xl font-black font-mono text-white truncate">
            {activeLabel ? activeLabel.primary : '—'}
          </div>
          {activeLabel && (
            <div className="text-[11px] font-mono text-slate-400 truncate">
              {activeLabel.secondary}
              {activeEntry ? ` · ${activeEntry.beats} beats · ${formatTime(activeEntry.start)}–${formatTime(activeEntry.end)}` : ''}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-[120px]">
          <div className="h-1.5 w-full rounded-full bg-slate-900 overflow-hidden">
            <div
              className="h-full bg-sky-400 transition-all duration-100"
              style={{ width: `${entryProgressPct}%` }}
            />
          </div>
          <div className="mt-1 text-[11px] text-slate-400 font-mono truncate">
            {nextEntry && nextLabel
              ? `Next: ${nextLabel.primary} in ${Math.max(0, nextEntry.start - currentTime).toFixed(1)}s`
              : 'End of progression'}
          </div>
        </div>
      </div>

      {/* Synced progression strip — tap a chord to jump to it */}
      <div ref={stripRef} className="flex gap-1.5 overflow-x-auto px-3 py-2.5 border-b border-slate-800/70 bg-[#0B101C]">
        {track.map((e, i) => {
          const isActive = i === activeIdx;
          return (
            <button
              key={`${e.blockId}-${i}`}
              ref={(el) => {
                chipRefs.current[i] = el;
              }}
              onClick={() => onSeek(e.start + 0.01)}
              title={`${labelOf(e)} · ${formatTime(e.start)}–${formatTime(e.end)} · ${e.beats} beats · tap to jump`}
              className={`shrink-0 px-3 py-2 rounded-xl border font-mono transition-all cursor-pointer ${
                isActive
                  ? 'bg-sky-500/30 border-sky-400 text-white scale-105 shadow-[0_0_16px_rgba(56,189,248,0.35)]'
                  : 'bg-slate-800/70 border-slate-700/80 text-slate-300 hover:bg-slate-800 hover:border-slate-500'
              }`}
            >
              <div className="text-sm font-bold leading-none">{labelOf(e)}</div>
              <div className="mt-1 text-[10px] text-slate-400 leading-none">
                {formatTime(e.start)} · {e.beats} bt
              </div>
            </button>
          );
        })}
        {track.length === 0 && (
          <span className="text-xs text-slate-500">No chords detected yet.</span>
        )}
      </div>

      {/* Full timed chord chart */}
      <div className="max-h-64 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[#0A0F1A] text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">#</th>
              <th className="px-2 py-2 font-semibold">Chord</th>
              <th className="px-2 py-2 font-semibold">Time</th>
              <th className="px-2 py-2 font-semibold">Dur</th>
              <th className="px-2 py-2 font-semibold">Beats</th>
              <th className="px-2 py-2 font-semibold hidden sm:table-cell">Roman/No.</th>
              <th className="px-3 py-2 font-semibold text-right">Conf</th>
            </tr>
          </thead>
          <tbody>
            {track.map((e, i) => {
              const isActive = i === activeIdx;
              const alt = e.roman && e.roman !== '—' ? e.roman : e.nashville;
              return (
                <tr
                  key={`${e.blockId}-${i}`}
                  onClick={() => {
                    onSeek(e.start + 0.01);
                    const b = analysis.chords.find((c) => c.id === e.blockId);
                    if (b) onSelectChord(b);
                  }}
                  className={`cursor-pointer border-t border-slate-800/60 transition-colors ${
                    isActive ? 'bg-sky-500/15' : 'hover:bg-slate-800/50'
                  }`}
                  title={`Jump to ${formatTime(e.start)} and hear ${labelOf(e)}`}
                >
                  <td className="px-3 py-1.5 font-mono text-slate-500">{i + 1}</td>
                  <td className="px-2 py-1.5 font-mono font-bold text-slate-100">
                    {labelOf(e)}
                    {isActive && <Play className="inline w-3 h-3 ml-1 text-sky-400" />}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-slate-400">
                    {formatTime(e.start)}–{formatTime(e.end)}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-slate-400">{e.duration.toFixed(1)}s</td>
                  <td className="px-2 py-1.5 font-mono text-amber-200/90">{e.beats}</td>
                  <td className="px-2 py-1.5 font-mono text-slate-400 hidden sm:table-cell">{alt}</td>
                  <td className="px-3 py-1.5 font-mono text-right text-slate-500">
                    {Math.round(e.confidence * 100)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
