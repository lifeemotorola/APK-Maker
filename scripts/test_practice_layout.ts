import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPracticeBars,
  suggestGuitarShape,
  GUITAR_TUNING,
} from "../src/lib/practiceLayout";
import { mod12 } from "../src/lib/musicTheory";
import type { SongAnalysis } from "../src/types";
const demo: SongAnalysis = JSON.parse(
  readFileSync("demos/gospel-sunrise.json", "utf8"),
);
const template = demo.chords[0];
const chords = [
  { ...template, id: 0, start: 0, end: 3, duration: 3 },
  { ...template, id: 1, start: 4, end: 5, duration: 1 },
];
const result = buildPracticeBars(chords, 5, 120);
assert.equal(result.totalBars, 3);
assert.deepEqual(
  result.bars.map((b) => [b.start, b.end]),
  [
    [0, 2],
    [2, 4],
    [4, 5],
  ],
);
assert.deepEqual(
  result.bars[1].cells.map((c) => [c.start, c.end]),
  [[2, 3]],
  "Do not fill an actual gap with a chord",
);
assert.equal(
  result.bars[1].cells[0].chord.id,
  0,
  "Chord spanning groups retains its source id",
);
assert.equal(buildPracticeBars([], 0, 120).bars.length, 0);
assert.equal(buildPracticeBars([], 2, NaN).seconds, 2);
assert.equal(buildPracticeBars([], 100, 120, 3).bars.length, 3);
assert.equal(
  buildPracticeBars([], 100, 120, 3).totalBars,
  50,
  "UI can disclose clipped chart length",
);
for (const [pcs, bass] of [
  [[0, 4, 7], 0],
  [[11, 3, 6], 11],
  [[9, 0, 4, 7], 9],
  [[0, 4, 7], 4],
] as [number[], number][]) {
  const shape = suggestGuitarShape(pcs, bass);
  assert(shape, "Expected a usable suggested shape: " + pcs);
  const played = shape.frets.flatMap((f, i) =>
    f === null ? [] : [GUITAR_TUNING[i] + f],
  );
  assert(played.length >= 4);
  assert.equal(mod12(Math.min(...played)), bass, "Preserve slash/root bass");
  assert.deepEqual(
    [...new Set(played.map(mod12))].sort(),
    [...new Set(pcs)].sort(),
    "Never silently substitute a different chord",
  );
  const fretted = shape.frets.filter((f): f is number => f !== null && f > 0);
  assert(
    fretted.every((f) => f >= shape.startFret && f < shape.startFret + 4),
    "All dots fit displayed frets",
  );
}
assert.equal(suggestGuitarShape([], 0), null);
assert.equal(suggestGuitarShape([0, 1, 2, 3, 4, 5, 6], 0), null);
const app = readFileSync("src/App.tsx", "utf8").replace(/\s+/g, " ");
for (const label of [
  "Staff Notation",
  "Keyboard",
  "Guitar",
  "Play Settings",
  "Demo Songs",
  "Favorites",
  "User Songs",
])
  assert(app.includes(label));
assert(app.includes("Playback speed preserves"));
assert(app.includes("not the original recording"));
assert(
  app.includes("ChordTracker") &&
    app.includes("StudioPiano") &&
    app.includes("LiveMicModal") &&
    app.includes("MidiPanel"),
);
console.log(
  "PRACTICE LAYOUT TEST: bar timing, gaps, clipping, guitar chord/bass integrity, instrument tabs and preserved tools PASSED",
);
