import React, { useMemo } from "react";
import { isBlackKey, midiToNoteName, mod12 } from "../lib/musicTheory";
import { GUITAR_TUNING, suggestGuitarShape } from "../lib/practiceLayout";
import { pianoSynth } from "../lib/pianoSynth";

export function PracticeKeyboard({
  notes,
  useFlats,
}: {
  notes: number[];
  useFlats: boolean;
}) {
  const active = new Set(notes.map(mod12));
  const whites = Array.from({ length: 25 }, (_, i) => 48 + i).filter(
    (m) => !isBlackKey(m),
  );
  const blacks = Array.from({ length: 25 }, (_, i) => 48 + i).filter(
    isBlackKey,
  );
  return (
    <div className="practice-keyboard" aria-label="Interactive chord keyboard">
      <div className="white-key-row">
        {whites.map((m) => (
          <button
            key={m}
            aria-label={`Play ${midiToNoteName(m, useFlats)}`}
            className={
              "practice-key white" + (active.has(mod12(m)) ? " lit" : "")
            }
            onPointerDown={(e) => {
              e.preventDefault();
              pianoSynth.noteOn(m, 0.7, 1);
            }}
            onPointerUp={() => pianoSynth.noteOff(m)}
            onPointerCancel={() => pianoSynth.noteOff(m)}
            onPointerLeave={() => pianoSynth.noteOff(m)}
            onKeyDown={(e) => {
              if (!e.repeat && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                pianoSynth.noteOn(m, 0.7, 1);
              }
            }}
            onKeyUp={() => pianoSynth.noteOff(m)}
            onBlur={() => pianoSynth.noteOff(m)}
          >
            <span>{midiToNoteName(m, useFlats)}</span>
          </button>
        ))}
      </div>
      {blacks.map((m) => {
        const before = whites.filter((w) => w < m).length;
        return (
          <button
            key={m}
            aria-label={`Play ${midiToNoteName(m, useFlats)}`}
            className={
              "practice-key black" + (active.has(mod12(m)) ? " lit" : "")
            }
            style={{
              left: `${(before / whites.length) * 100}%`,
              width: `${(0.63 / whites.length) * 100}%`,
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              pianoSynth.noteOn(m, 0.7, 1);
            }}
            onPointerUp={() => pianoSynth.noteOff(m)}
            onPointerCancel={() => pianoSynth.noteOff(m)}
            onPointerLeave={() => pianoSynth.noteOff(m)}
            onKeyDown={(e) => {
              if (!e.repeat && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                pianoSynth.noteOn(m, 0.7, 1);
              }
            }}
            onKeyUp={() => pianoSynth.noteOff(m)}
            onBlur={() => pianoSynth.noteOff(m)}
          />
        );
      })}
    </div>
  );
}

function staffStep(midi: number, useFlats: boolean) {
  const name = midiToNoteName(midi, useFlats);
  const octave = Number(name.match(/-?\d+$/)?.[0] || 4);
  return octave * 7 + "CDEFGAB".indexOf(name[0]);
}
export function ChordStaff({
  notes,
  useFlats,
}: {
  notes: number[];
  useFlats: boolean;
}) {
  const positions = notes.map((n) =>
    n >= 60
      ? 82 - (staffStep(n, useFlats) - 30) * 5
      : 194 - (staffStep(n, useFlats) - 18) * 5,
  );
  const top = Math.min(0, ...positions.map((y) => y - 15));
  const bottom = Math.max(230, ...positions.map((y) => y + 15));
  return (
    <div className="staff-view">
      <svg
        viewBox={`0 ${top} 380 ${bottom - top}`}
        role="img"
        aria-label={
          "Chord voicing on treble and bass staves: " +
          notes.map((n) => midiToNoteName(n, useFlats)).join(", ")
        }
      >
        {[
          {
            label: "Treble",
            bottom: 82,
            base: 4 * 7 + 2,
            notes: notes.filter((n) => n >= 60),
          },
          {
            label: "Bass",
            bottom: 194,
            base: 2 * 7 + 4,
            notes: notes.filter((n) => n < 60),
          },
        ].map((staff) => (
          <g key={staff.label}>
            <text x="14" y={staff.bottom - 50} fill="#999" fontSize="11">
              {staff.label}
            </text>
            {[0, 1, 2, 3, 4].map((line) => (
              <line
                key={line}
                x1="70"
                x2="365"
                y1={staff.bottom - line * 10}
                y2={staff.bottom - line * 10}
                stroke="#777"
              />
            ))}
            {staff.notes.map((m, i) => {
              const step = staffStep(m, useFlats),
                y = staff.bottom - (step - staff.base) * 5;
              const x = 185 + (i % 2) * 14;
              const name = midiToNoteName(m, useFlats),
                accidental = name.includes("#")
                  ? "#"
                  : name.includes("b")
                    ? "b"
                    : "";
              const ledgers: number[] = [];
              for (let l = staff.bottom + 10; l <= y; l += 10) ledgers.push(l);
              for (let l = staff.bottom - 50; l >= y; l -= 10) ledgers.push(l);
              return (
                <g key={m}>
                  {ledgers.map((l) => (
                    <line
                      key={l}
                      x1={x - 15}
                      x2={x + 15}
                      y1={l}
                      y2={l}
                      stroke="#aaa"
                    />
                  ))}
                  {accidental && (
                    <text
                      x={x - 30 - i * 9}
                      y={y + 5}
                      fill="#eee"
                      fontSize="19"
                    >
                      {accidental}
                    </text>
                  )}
                  <ellipse
                    cx={x}
                    cy={y}
                    rx="8"
                    ry="5"
                    transform={`rotate(-18 ${x} ${y})`}
                    fill="#f2ede3"
                  />
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      <p className="instrument-caption">
        Suggested chord voicing, not a transcribed melody or rhythm.
      </p>
    </div>
  );
}

export function GuitarDiagram({
  notes,
  bassPc,
}: {
  notes: number[];
  bassPc: number;
}) {
  const shape = useMemo(
    () => suggestGuitarShape(notes.map(mod12), bassPc),
    [notes, bassPc],
  );
  if (!shape)
    return (
      <p className="instrument-caption">
        No comfortable standard-tuning shape found for this voicing. Try
        Keyboard or a simpler voicing in Play Settings.
      </p>
    );
  return (
    <div className="guitar-view">
      <div className="guitar-meta">
        <span>Standard tuning · E A D G B E</span>
        <span>Capo: 0</span>
      </div>
      <svg
        viewBox="0 0 360 170"
        role="img"
        aria-label={
          "Suggested guitar frets, low E to high E: " +
          shape.frets.map((f) => (f === null ? "muted" : f)).join(", ")
        }
      >
        {[0, 1, 2, 3, 4].map((f) => (
          <line
            key={f}
            x1="60"
            x2="310"
            y1={38 + f * 28}
            y2={38 + f * 28}
            stroke="#b5b5b5"
            strokeWidth={f === 0 && shape.startFret === 1 ? 4 : 1}
          />
        ))}
        {GUITAR_TUNING.map((open, i) => (
          <g key={open + "-" + i}>
            <line
              x1={60 + i * 50}
              x2={60 + i * 50}
              y1="38"
              y2="150"
              stroke="#aaa"
            />
            <text
              x={60 + i * 50}
              y="22"
              textAnchor="middle"
              fill="#ddd"
              fontSize="15"
            >
              {shape.frets[i] === null ? "x" : shape.frets[i] === 0 ? "o" : ""}
            </text>
            {shape.frets[i] !== null && shape.frets[i]! > 0 && (
              <circle
                cx={60 + i * 50}
                cy={38 + (shape.frets[i]! - shape.startFret + 0.5) * 28}
                r="8"
                fill="#df8736"
                stroke="#fff"
                strokeWidth="1.5"
              />
            )}
          </g>
        ))}
        <text x="25" y="58" fill="#ddd" fontSize="13">
          {shape.startFret} fr
        </text>
      </svg>
      <p className="instrument-caption">
        Suggested fret positions, not finger numbers. x = mute, o = open. Use a
        comfortable grip.
      </p>
    </div>
  );
}
