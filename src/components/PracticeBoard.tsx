import React, { useEffect, useMemo, useRef } from "react";
import type { ChordBlock, NotationMode } from "../types";
import { buildPracticeBars } from "../lib/practiceLayout";
import { formatPrimaryChordLabel, formatTime } from "../lib/musicTheory";

interface Props {
  chords: ChordBlock[];
  duration: number;
  bpm: number;
  currentTime: number;
  transpose: number;
  useFlats: boolean;
  notation: NotationMode;
  onSelect: (chord: ChordBlock) => void;
  sections: Record<number, string>;
}
export function PracticeBoard({
  chords,
  duration,
  bpm,
  currentTime,
  transpose,
  useFlats,
  notation,
  onSelect,
  sections,
}: Props) {
  const layout = useMemo(
    () => buildPracticeBars(chords, duration, bpm),
    [chords, duration, bpm],
  );
  const board = useRef<HTMLDivElement>(null);
  const activeBar = Math.min(
    layout.totalBars - 1,
    Math.floor(currentTime / layout.seconds),
  );
  const lastScroll = useRef(-1);
  useEffect(() => {
    if (activeBar === lastScroll.current) return;
    lastScroll.current = activeBar;
    const root = board.current,
      row = root?.querySelector<HTMLElement>(`[data-bar="${activeBar}"]`);
    if (!root || !row) return;
    // Scroll only the chart, never move the user's entire page.
    if (
      row.offsetTop < root.scrollTop ||
      row.offsetTop + row.offsetHeight > root.scrollTop + root.clientHeight
    )
      root.scrollTop = Math.max(0, row.offsetTop - root.clientHeight / 3);
  }, [activeBar]);
  if (!chords.length)
    return (
      <div className="chart-empty">
        No chords available for this view. Try switching off the in-key filter
        in Play Settings.
      </div>
    );
  return (
    <>
      <div
        ref={board}
        className="practice-board"
        aria-label="Timed chord progression"
      >
        {layout.bars.map((bar) => (
          <div key={bar.index} className="practice-bar" data-bar={bar.index}>
            <div className="bar-label">
              <span>{bar.index + 1}</span>
              <span>{formatTime(bar.start)}</span>
            </div>
            <div
              className={"bar-beats section-" + (sections[bar.index] || "B")}
            >
              {[1, 2, 3].map((beat) => (
                <span
                  key={beat}
                  className="beat-divider"
                  style={{ left: `${beat * 25}%` }}
                />
              ))}
              {bar.cells.map((cell) => {
                const active =
                  currentTime >= cell.start && currentTime < cell.end;
                const label = formatPrimaryChordLabel(
                  cell.chord,
                  transpose,
                  useFlats,
                  notation,
                ).primary;
                return (
                  <button
                    key={cell.chord.id}
                    className={"chord-cell" + (active ? " is-active" : "")}
                    aria-label={`${label} at ${formatTime(cell.start)}`}
                    aria-current={active ? "true" : undefined}
                    title={`${label} · ${cell.start.toFixed(1)}-${cell.end.toFixed(1)} seconds`}
                    style={{
                      left: `${((cell.start - bar.start) / (bar.end - bar.start)) * 100}%`,
                      width: `${((cell.end - cell.start) / (bar.end - bar.start)) * 100}%`,
                    }}
                    onClick={() =>
                      onSelect({ ...cell.chord, start: cell.start })
                    }
                  >
                    {sections[bar.index] &&
                      cell.start === bar.cells[0]?.start && (
                        <span className="section-flag">
                          {sections[bar.index]}
                        </span>
                      )}
                    <span className="chord-cell-name">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="chart-footnote">
        Four-beat practice groups from estimated tempo, not a detected time
        signature. Tap a chord to seek and hear it.
      </p>
      {layout.totalBars > layout.bars.length && (
        <p className="chart-footnote">
          Showing the first {layout.bars.length} groups. The full timed chart is
          in Play Settings / Chord Tracker.
        </p>
      )}
    </>
  );
}
