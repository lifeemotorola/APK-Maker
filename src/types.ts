export type VoicingMode = 'smooth' | 'root' | 'pro' | 'detected';

export type NotationMode = 'chord' | 'nashville' | 'roman';

export type SynthTone = 'grand' | 'rhodes';

export interface VoicingSet {
  lh: number[];
  rh: number[];
  all: number[];
}

export interface ChordBlock {
  id: number;
  start: number;
  end: number;
  duration: number;
  symbol: string;
  rootPc: number;
  rootName: string;
  suffix: string;
  bassPc: number;
  bassName: string;
  hasSlash: boolean;
  intervals: number[];
  pitchClasses: number[];
  noteNames: string[];
  roman: string;
  nashville: string;
  isDiatonic: boolean;
  confidence: number;
  voicings: {
    smooth: VoicingSet;
    root: VoicingSet;
    pro: VoicingSet;
  };
  detectedMidi: number[];
}

export interface KeyInfo {
  rootPc: number;
  rootName: string;
  mode: 'major' | 'minor';
  name: string;
  useFlats: boolean;
  confidence: number;
  relativeKey: string;
  alternateKey: string;
  camelot: string;
  scalePitchClasses: number[];
  scaleNotes: string[];
  chromaProfile: number[];
}

export interface PianoRollNote {
  midi: number;
  vel: number;
}

export interface PianoRollSlice {
  t: number;
  notes: PianoRollNote[];
}

export interface ChordSummaryItem {
  symbol: string;
  seconds: number;
  share: number;
}

export interface SongAnalysis {
  filename: string;
  duration: number;
  bpm: number;
  tuningHz: number;
  key: KeyInfo;
  beats: number[];
  chords: ChordBlock[];
  chordSummary: ChordSummaryItem[];
  pianoRoll: PianoRollSlice[];
  waveform: number[];
  analysisTimeSec: number;
}

export interface DemoTrack {
  id: string;
  title: string;
  artist: string;
  genre: string;
  audioUrl: string;
  duration: number;
  bpm: number;
  keyName: string;
  chordPreview: string[];
}
