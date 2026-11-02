import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Repeat, ZoomIn, ZoomOut } from 'lucide-react';
import { ChordBlock, NotationMode, SongAnalysis } from '../types';
import { formatPrimaryChordLabel, formatTime } from '../lib/musicTheory';

interface WaveformTimelineProps {
  analysis: SongAnalysis;
  currentTime: number;
  isPlaying: boolean;
  transpose: number;
  useFlats: boolean;
  notation: NotationMode;
  activeChordId: number | null;
  loopRange: { start: number; end: number; label?: string } | null;
  onSeek: (timeSec: number) => void;
  onSelectChord: (chord: ChordBlock) => void;
  onToggleLoopChord: (chord: ChordBlock) => void;
  onClearLoop: () => void;
}

export const WaveformTimeline: React.FC<WaveformTimelineProps> = ({
  analysis,
  currentTime,
  isPlaying,
  transpose,
  useFlats,
  notation,
  activeChordId,
  loopRange,
  onSeek,
  onSelectChord,
  onToggleLoopChord,
  onClearLoop,
}) => {
  const [zoom, setZoom] = useState<number>(1.6);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDraggingRef = useRef(false);

  const duration = Math.max(0.1, analysis.duration);

  // Auto-keep playhead smoothly visible when zoomed > 1
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !isPlaying || zoom <= 1.02) return;
    const totalW = el.scrollWidth;
    const viewW = el.clientWidth;
    const playheadX = (currentTime / duration) * totalW;
    const leftEdge = el.scrollLeft;
    const rightEdge = leftEdge + viewW;
    if (playheadX < leftEdge + viewW * 0.15 || playheadX > rightEdge - viewW * 0.25) {
      el.scrollTo({
        left: Math.max(0, playheadX - viewW * 0.32),
        behavior: 'smooth',
      });
    }
  }, [currentTime, duration, isPlaying, zoom]);

  // Draw High-DPI Waveform + Beats + Loop overlay + Playhead
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = scrollRef.current;
    if (!canvas || !container) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = Math.max(container.clientWidth, Math.floor(container.clientWidth * zoom));
      const cssHeight = 68;

      if (canvas.width !== Math.floor(cssWidth * dpr) || canvas.height !== Math.floor(cssHeight * dpr)) {
        canvas.width = Math.floor(cssWidth * dpr);
        canvas.height = Math.floor(cssHeight * dpr);
      }
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      // Subtle beat ticks
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.09)';
      ctx.lineWidth = 1;
      for (let i = 0; i < analysis.beats.length; i++) {
        const bx = (analysis.beats[i] / duration) * cssWidth;
        const isBar = i % 4 === 0;
        ctx.beginPath();
        ctx.strokeStyle = isBar ? 'rgba(148, 163, 184, 0.20)' : 'rgba(148, 163, 184, 0.07)';
        ctx.moveTo(bx, isBar ? 0 : cssHeight * 0.2);
        ctx.lineTo(bx, cssHeight);
        ctx.stroke();
      }

      // Loop Range Highlight
      if (loopRange) {
        const lx0 = (loopRange.start / duration) * cssWidth;
        const lx1 = (loopRange.end / duration) * cssWidth;
        ctx.fillStyle = 'rgba(245, 158, 11, 0.16)';
        ctx.fillRect(lx0, 0, Math.max(2, lx1 - lx0), cssHeight);
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(lx0, 0);
        ctx.lineTo(lx0, cssHeight);
        ctx.moveTo(lx1, 0);
        ctx.lineTo(lx1, cssHeight);
        ctx.stroke();
      }

      // Waveform symmetric bars
      const peaks = analysis.waveform;
      const nBars = peaks.length;
      const step = cssWidth / Math.max(1, nBars);
      const barW = Math.max(1.4, step * 0.68);
      const midY = cssHeight * 0.5;
      const playX = (currentTime / duration) * cssWidth;

      for (let i = 0; i < nBars; i++) {
        const x = i * step;
        const amp = Math.max(0.06, peaks[i]) * (cssHeight * 0.42);
        const isPlayed = x <= playX;
        const inLoop =
          loopRange &&
          x >= (loopRange.start / duration) * cssWidth &&
          x <= (loopRange.end / duration) * cssWidth;

        if (inLoop) {
          ctx.fillStyle = isPlayed ? '#FBBF24' : 'rgba(251, 191, 36, 0.48)';
        } else {
          ctx.fillStyle = isPlayed ? '#38BDF8' : '#334155';
        }
        ctx.beginPath();
        ctx.roundRect(x, midY - amp, barW, amp * 2, 1.5);
        ctx.fill();
      }

      // Playhead cursor line
      ctx.strokeStyle = '#F8FAFC';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, cssHeight);
      ctx.stroke();

      ctx.fillStyle = '#38BDF8';
      ctx.beginPath();
      ctx.arc(playX, 6, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    };

    draw();
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [analysis.beats, analysis.waveform, currentTime, duration, loopRange, zoom]);

  const seekFromPointer = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    onSeek(ratio * duration);
  };

  const playheadPercent = useMemo(
    () => Math.max(0, Math.min(100, (currentTime / duration) * 100)),
    [currentTime, duration]
  );

  return (
    <div className="rounded-2xl border border-slate-800/90 bg-[#0D1320]/95 shadow-xl overflow-hidden">
      {/* Top Mini Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-slate-800/80 bg-[#0A0F1A]">
        <div className="flex items-center gap-3 text-xs">
          <span className="font-mono font-semibold text-sky-400 text-sm">
            {formatTime(currentTime)}
          </span>
          <span className="text-slate-600">/</span>
          <span className="font-mono text-slate-400">{formatTime(duration)}</span>
          <span className="hidden sm:inline-block text-slate-600">•</span>
          <span className="hidden sm:inline-block text-slate-400">
            Click waveform to scrub · Click any chord to audition · Double-click chord to loop
          </span>
        </div>

        <div className="flex items-center gap-2">
          {loopRange && (
            <button
              onClick={onClearLoop}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition cursor-pointer"
              title="Clear A-B Practice Loop"
            >
              <Repeat className="w-3.5 h-3.5" />
              Loop: {loopRange.label || `${formatTime(loopRange.start)}–${formatTime(loopRange.end)}`} ×
            </button>
          )}

          <div className="flex items-center rounded-lg bg-slate-900 border border-slate-800 p-0.5">
            <button
              onClick={() => setZoom((z) => Math.max(1, Number((z - 0.6).toFixed(1))))}
              className="p-1 text-slate-400 hover:text-slate-100 disabled:opacity-40 cursor-pointer"
              disabled={zoom <= 1}
              title="Zoom Out Timeline"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 text-[11px] font-mono text-slate-300">{zoom.toFixed(1)}x</span>
            <button
              onClick={() => setZoom((z) => Math.min(4.6, Number((z + 0.6).toFixed(1))))}
              className="p-1 text-slate-400 hover:text-slate-100 disabled:opacity-40 cursor-pointer"
              disabled={zoom >= 4.5}
              title="Zoom In Timeline"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Synchronized Waveform + Chord Blocks */}
      <div ref={scrollRef} className="overflow-x-auto select-none">
        <div style={{ width: `${Math.max(100, zoom * 100)}%` }} className="relative">
          {/* Waveform Canvas */}
          <canvas
            ref={canvasRef}
            className="block cursor-ew-resize"
            onPointerDown={(e) => {
              isDraggingRef.current = true;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              seekFromPointer(e.clientX);
            }}
            onPointerMove={(e) => {
              if (isDraggingRef.current) {
                seekFromPointer(e.clientX);
              }
            }}
            onPointerUp={() => {
              isDraggingRef.current = false;
            }}
          />

          {/* Synchronized Chord Timeline Track */}
          <div className="relative h-14 border-t border-slate-800/80 bg-[#0B101C]">
            {/* Continuous Playhead Line through Chord Strip */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-sky-400/90 z-20 shadow-[0_0_8px_rgba(56,189,248,0.9)]"
              style={{ left: `${playheadPercent}%` }}
            />

            {analysis.chords.map((ch) => {
              const leftPct = (ch.start / duration) * 100;
              const widthPct = Math.max(0.35, ((ch.end - ch.start) / duration) * 100);
              const isActive = ch.id === activeChordId;
              const isLooped =
                loopRange &&
                Math.abs(loopRange.start - ch.start) < 0.08 &&
                Math.abs(loopRange.end - ch.end) < 0.08;

              const { primary, secondary } = formatPrimaryChordLabel(
                ch,
                transpose,
                useFlats,
                notation
              );

              return (
                <div
                  key={ch.id}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  onClick={() => onSelectChord(ch)}
                  onDoubleClick={() => onToggleLoopChord(ch)}
                  title={`${primary} (${secondary}) • ${formatTime(ch.start)} – ${formatTime(ch.end)} • Confidence ${Math.round(ch.confidence * 100)}%\nClick to jump & hear • Double-click to loop`}
                  className={`group absolute top-1.5 bottom-1.5 rounded-lg border px-2 flex flex-col justify-center overflow-hidden transition-all cursor-pointer ${
                    isActive
                      ? 'bg-sky-500/25 border-sky-400 text-white shadow-[0_0_18px_rgba(56,189,248,0.28)] z-10'
                      : isLooped
                        ? 'bg-amber-500/20 border-amber-400/80 text-amber-100'
                        : ch.isDiatonic
                          ? 'bg-slate-800/65 border-slate-700/75 text-slate-200 hover:bg-slate-800 hover:border-slate-500'
                          : 'bg-indigo-950/55 border-indigo-700/50 text-indigo-200 hover:bg-indigo-900/50'
                  }`}
                >
                  <div className="flex items-baseline gap-1.5 truncate">
                    <span className="font-bold text-xs sm:text-sm tracking-tight truncate">
                      {primary}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 truncate hidden sm:inline">
                      {secondary}
                    </span>
                  </div>
                  {/* Subtle confidence bar at bottom of chord block */}
                  <div className="mt-1 h-0.5 w-full rounded-full bg-slate-900/70 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        isActive ? 'bg-sky-400' : ch.isDiatonic ? 'bg-emerald-400/70' : 'bg-amber-400/75'
                      }`}
                      style={{ width: `${Math.round(ch.confidence * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
