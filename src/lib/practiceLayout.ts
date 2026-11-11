import type { ChordBlock } from "../types";
import { mod12 } from "./musicTheory";

export interface PracticeCell {
  chord: ChordBlock;
  start: number;
  end: number;
}
export interface PracticeBar {
  index: number;
  start: number;
  end: number;
  cells: PracticeCell[];
}
/** Four-beat practice groups from the estimated tempo, NOT detected time signatures. */
export function buildPracticeBars(
  chords: ChordBlock[],
  duration: number,
  bpm: number,
  limit = 500,
) {
  const seconds = (4 * 60) / (Number.isFinite(bpm) && bpm > 0 ? bpm : 120);
  const totalBars = Math.max(0, Math.ceil(Math.max(0, duration) / seconds));
  const bars: PracticeBar[] = [];
  for (let i = 0; i < Math.min(totalBars, limit); i++) {
    const start = i * seconds,
      end = Math.min(duration, start + seconds);
    bars.push({
      index: i,
      start,
      end,
      cells: chords
        .filter((c) => c.end > start && c.start < end)
        .map((chord) => ({
          chord,
          start: Math.max(start, chord.start),
          end: Math.min(end, chord.end),
        })),
    });
  }
  return { bars, totalBars, seconds };
}

export const GUITAR_TUNING = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4
export interface GuitarShape {
  frets: (number | null)[];
  startFret: number;
}
/** Find a standard-tuning suggestion, never substitute a different chord.
 * Diagrams show fret positions, not finger numbers or a guaranteed easy grip.
 */
export function suggestGuitarShape(
  pitchClasses: number[],
  bassPc: number,
): GuitarShape | null {
  const target = new Set(pitchClasses.map(mod12));
  target.add(mod12(bassPc));
  if (target.size < 2 || target.size > 6) return null;
  let best: GuitarShape | null = null,
    bestScore = Infinity;
  for (let base = 1; base <= 9; base++) {
    const choices = GUITAR_TUNING.map((open) => [
      null,
      ...Array.from({ length: 13 }, (_, f) => f).filter(
        (f) =>
          (f === 0 || (f >= base && f < base + 4)) &&
          target.has(mod12(open + f)),
      ),
    ]);
    function search(string: number, frets: (number | null)[]) {
      if (string < 6) {
        for (const fret of choices[string])
          search(string + 1, [...frets, fret]);
        return;
      }
      const played = frets.flatMap((f, i) =>
        f === null ? [] : [GUITAR_TUNING[i] + f],
      );
      if (played.length < 4 || mod12(Math.min(...played)) !== mod12(bassPc))
        return;
      const found = new Set(played.map(mod12));
      if ([...target].some((pc) => !found.has(pc))) return;
      const positive = frets.filter((f): f is number => f !== null && f > 0);
      const min = positive.length ? Math.min(...positive) : 1;
      const max = positive.length ? Math.max(...positive) : 1;
      // Conservative finger count: a lowest-fret barre may cover its span only
      // when no open/muted string interrupts it.
      const lowestPositions = frets
        .map((f, i) => (f === min ? i : -1))
        .filter((i) => i >= 0);
      const barre =
        lowestPositions.length > 1 &&
        frets
          .slice(lowestPositions[0], lowestPositions.at(-1)! + 1)
          .every((f) => f !== null && f >= min);
      const fingers =
        positive.length - (barre ? lowestPositions.length - 1 : 0);
      if (fingers > 4) return;
      const score =
        max * 2 +
        min +
        (max - min) * 2 +
        frets.filter((f) => f === null).length * 3 -
        frets.filter((f) => f === 0).length;
      if (score < bestScore) {
        bestScore = score;
        best = { frets, startFret: max <= 4 ? 1 : min };
      }
    }
    search(0, []);
  }
  return best;
}
