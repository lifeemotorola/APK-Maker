import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bluetooth,
  ChevronLeft,
  ChevronRight,
  Download,
  FileAudio,
  Loader2,
  Mic,
  Music,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  Sparkles,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  ChordBlock,
  DemoTrack,
  NotationMode,
  SongAnalysis,
  SynthTone,
  VoicingMode,
} from './types';
import {
  formatPrimaryChordLabel,
  getActiveChordMidiNotes,
  midiToNoteName,
  mod12,
  transposeChordSymbol,
  transposeKeyInfo,
} from './lib/musicTheory';
import { pianoSynth, transcodeFileToMonoWav } from './lib/pianoSynth';
import { apiFetch } from './lib/api';
import { isAndroidNative, subscribeNativeMidi } from './lib/nativeBridge';
import { buildMidiFromAnalysis, downloadBytes } from './lib/midiExport';
import { WaveformTimeline } from './components/WaveformTimeline';
import { StudioPiano } from './components/StudioPiano';
import { ChordDictionaryGrid } from './components/ChordDictionaryGrid';
import { KeyHarmonyPanel } from './components/KeyHarmonyPanel';
import { LiveMicModal } from './components/LiveMicModal';
import { MidiPanel } from './components/MidiPanel';

export const App: React.FC = () => {
  const [demos, setDemos] = useState<DemoTrack[]>([]);
  const [activeDemoId, setActiveDemoId] = useState<string>('gospel-sunrise');
  const [analysis, setAnalysis] = useState<SongAnalysis | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(true);
  const [analyzeStatus, setAnalyzeStatus] = useState<string>('Loading studio session...');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);

  // Playback & Transport State
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [songVolume, setSongVolume] = useState<number>(0.88);
  const [songMuted, setSongMuted] = useState<boolean>(false);
  const [loopRange, setLoopRange] = useState<{
    start: number;
    end: number;
    label?: string;
  } | null>(null);

  // Harmony, Piano & Transpose Controls
  const [transpose, setTranspose] = useState<number>(0);
  const [notation, setNotation] = useState<NotationMode>('chord');
  const [voicingMode, setVoicingMode] = useState<VoicingMode>('smooth');
  const [synthTone, setSynthTone] = useState<SynthTone>('grand');
  const [playAlongVolume, setPlayAlongVolume] = useState<number>(0.25);
  const [bottomTab, setBottomTab] = useState<'chords' | 'harmony'>('chords');

  // Live Mic Modal
  const [micOpen, setMicOpen] = useState<boolean>(false);
  const [liveMicMidi, setLiveMicMidi] = useState<number[]>([]);
  const [exportingMidi, setExportingMidi] = useState<boolean>(false);

  // Native MIDI / Bluetooth (USB + BLE) input panel (Android APK)
  const [midiOpen, setMidiOpen] = useState<boolean>(false);
  const nativeMidiNotesRef = useRef<Set<number>>(new Set());

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const customBlobUrlRef = useRef<string | null>(null);
  const lastAutoPlayedChordRef = useRef<number | null>(null);

  // Sync Synth Tone
  useEffect(() => {
    pianoSynth.setTone(synthTone);
  }, [synthTone]);

  // Sync Original Song Audio Volume & Speed
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = songMuted ? 0 : songVolume;
  }, [songVolume, songMuted]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = playbackRate;
    if ('preservesPitch' in el) {
      el.preservesPitch = true;
    }
  }, [playbackRate, audioUrl]);

  // Native MIDI (USB / Bluetooth BLE) events -> studio synth + piano highlight
  useEffect(() => {
    if (!isAndroidNative()) return;
    const unsub = subscribeNativeMidi((ev) => {
      if (ev.type === 'noteOn') {
        pianoSynth.noteOn(ev.note, Math.max(0.15, (ev.vel || 100) / 127), 3.2);
        nativeMidiNotesRef.current.add(ev.note);
        setLiveMicMidi([...nativeMidiNotesRef.current].sort((a, b) => a - b));
      } else if (ev.type === 'noteOff') {
        pianoSynth.noteOff(ev.note);
        nativeMidiNotesRef.current.delete(ev.note);
        setLiveMicMidi([...nativeMidiNotesRef.current].sort((a, b) => a - b));
      } else if (ev.type === 'deviceDisconnected') {
        pianoSynth.stopAll();
        nativeMidiNotesRef.current.clear();
        setLiveMicMidi([]);
      }
    });
    return unsub;
  }, []);

  // Load Demo Tracks Manifest & Initial Demo on Mount
  const loadDemoTrack = useCallback(async (demoId: string, trackList?: DemoTrack[]) => {
    setErrorBanner(null);
    setIsAnalyzing(true);
    setAnalyzeStatus('Loading studio piano analysis...');
    setIsPlaying(false);
    setCurrentTime(0);
    setTranspose(0);
    setLoopRange(null);
    lastAutoPlayedChordRef.current = null;

    try {
      const res = await apiFetch(`/api/demos/${encodeURIComponent(demoId)}`);
      if (!res.ok) throw new Error(`Failed to load demo track (${res.status})`);
      const data: SongAnalysis = await res.json();
      setAnalysis(data);
      setActiveDemoId(demoId);

      const list = trackList || demos;
      const found = list.find((d) => d.id === demoId);
      setAudioUrl(found ? found.audioUrl : `/demos/${demoId}.wav`);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to load demo song.');
    } finally {
      setIsAnalyzing(false);
    }
  }, [demos]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/demos');
        const json = await res.json();
        if (cancelled) return;
        const list: DemoTrack[] = json.demos || [];
        setDemos(list);
        const initialId = list[0]?.id || 'gospel-sunrise';
        await loadDemoTrack(initialId, list);
      } catch (err) {
        if (!cancelled) {
          setErrorBanner(err instanceof Error ? err.message : 'Unable to connect to DSP server.');
          setIsAnalyzing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 60fps Playhead & A-B Loop Sync
  useEffect(() => {
    let rafId = 0;
    const update = () => {
      const el = audioRef.current;
      if (el && !el.paused) {
        if (loopRange && el.currentTime >= loopRange.end - 0.02) {
          el.currentTime = loopRange.start;
          lastAutoPlayedChordRef.current = null;
        }
        setCurrentTime(el.currentTime);
      }
      rafId = requestAnimationFrame(update);
    };
    if (isPlaying) {
      rafId = requestAnimationFrame(update);
    }
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, loopRange]);

  // Transposed Key Info
  const shiftedKey = useMemo(() => {
    if (!analysis) return null;
    return transposeKeyInfo(analysis.key, transpose);
  }, [analysis, transpose]);

  const useFlats = shiftedKey?.useFlats ?? false;

  // Current & Next Chord Lookup
  const { activeChord, nextChord, activeChordIndex } = useMemo(() => {
    if (!analysis || !analysis.chords.length) {
      return { activeChord: null, nextChord: null, activeChordIndex: -1 };
    }
    let idx = analysis.chords.findIndex(
      (c) => currentTime >= c.start && currentTime < c.end
    );
    if (idx === -1) {
      idx = currentTime >= analysis.duration ? analysis.chords.length - 1 : 0;
    }
    return {
      activeChord: analysis.chords[idx] || null,
      nextChord: analysis.chords[idx + 1] || null,
      activeChordIndex: idx,
    };
  }, [analysis, currentTime]);

  // Optional Play-Along Studio Chord Guide Synth on chord transitions!
  useEffect(() => {
    if (!isPlaying || !activeChord || playAlongVolume <= 0.01) return;
    if (lastAutoPlayedChordRef.current === activeChord.id) return;
    lastAutoPlayedChordRef.current = activeChord.id;

    const notes = getActiveChordMidiNotes(activeChord, voicingMode, transpose);
    const dur = Math.min(2.2, Math.max(0.45, activeChord.duration / playbackRate));
    pianoSynth.auditionChord(notes.lh, notes.rh, dur, playAlongVolume * 0.85);
  }, [activeChord, isPlaying, playAlongVolume, playbackRate, transpose, voicingMode]);

  // Upload & Transcode Any Song File
  const handleAnalyzeAudioBlob = async (fileOrBlob: File | Blob, displayFilename: string) => {
    setErrorBanner(null);
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsAnalyzing(true);
    setAnalyzeStatus(`Decoding "${displayFilename}"...`);

    try {
      // Create crisp browser playback URL from original high-quality file
      if (customBlobUrlRef.current) {
        URL.revokeObjectURL(customBlobUrlRef.current);
      }
      const localPlayUrl = URL.createObjectURL(fileOrBlob);
      customBlobUrlRef.current = localPlayUrl;

      // Transcode in-memory to 22,050Hz 16-bit mono WAV so ANY format (.m4a, .mp4, .mp3, .webm, .wav, .ogg, .flac) analyzes cleanly!
      const wavBlob = await transcodeFileToMonoWav(fileOrBlob);
      setAnalyzeStatus('Extracting piano keys, chords, basslines & key signature...');

      const res = await apiFetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/wav',
          'X-Filename': encodeURIComponent(displayFilename),
        },
        body: wavBlob,
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || `Analysis failed (${res.status})`);
      }

      setAnalysis(payload);
      setAudioUrl(localPlayUrl);
      setActiveDemoId('custom');
      setCurrentTime(0);
      setTranspose(0);
      setLoopRange(null);
      lastAutoPlayedChordRef.current = null;
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : 'Could not decode or analyze this file. Please upload a valid audio/video song file.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleAnalyzeAudioBlob(file, file.name);
    }
    e.target.value = '';
  };

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el || !audioUrl) return;
    if (el.paused) {
      el.play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    } else {
      el.pause();
      setIsPlaying(false);
    }
  }, [audioUrl]);

  const handleSeek = useCallback((sec: number) => {
    const el = audioRef.current;
    const clamped = Math.max(0, Math.min(analysis?.duration ?? sec, sec));
    if (el) {
      el.currentTime = clamped;
    }
    lastAutoPlayedChordRef.current = null;
    setCurrentTime(clamped);
  }, [analysis?.duration]);

  const handleSelectChord = useCallback(
    (chord: ChordBlock) => {
      handleSeek(chord.start + 0.01);
      const el = audioRef.current;
      if (!el || el.paused) {
        const notes = getActiveChordMidiNotes(chord, voicingMode, transpose);
        pianoSynth.auditionChord(notes.lh, notes.rh, 1.35);
      }
    },
    [handleSeek, transpose, voicingMode]
  );

  const handleToggleLoopChord = useCallback(
    (chord: ChordBlock) => {
      const { primary } = formatPrimaryChordLabel(chord, transpose, useFlats, notation);
      setLoopRange((prev) => {
        if (
          prev &&
          Math.abs(prev.start - chord.start) < 0.08 &&
          Math.abs(prev.end - chord.end) < 0.08
        ) {
          return null;
        }
        handleSeek(chord.start);
        return { start: chord.start, end: chord.end, label: primary };
      });
    },
    [handleSeek, notation, transpose, useFlats]
  );

  const stepChord = useCallback(
    (delta: number) => {
      if (!analysis || !analysis.chords.length) return;
      const nextIdx = Math.max(
        0,
        Math.min(analysis.chords.length - 1, activeChordIndex + delta)
      );
      handleSelectChord(analysis.chords[nextIdx]);
    },
    [activeChordIndex, analysis, handleSelectChord]
  );

  // Global Studio Transport Shortcuts (Space = Play/Pause, Arrows = Prev/Next Chord)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        stepChord(-1);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        stepChord(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepChord, togglePlay]);

  // Transpose straight to C Major / A Minor (White Keys helper!)
  const handleTransposeToC = () => {
    if (!analysis) return;
    const targetRoot = analysis.key.mode === 'major' ? 0 : 9; // C Major (0) or A Minor (9)
    let diff = mod12(targetRoot - analysis.key.rootPc);
    if (diff > 6) diff -= 12;
    setTranspose(diff);
  };

  // Export Multi-Track MIDI (.mid) — server-side on web, client-side in the Android APK
  const handleExportMidi = async () => {
    if (!analysis) return;
    setExportingMidi(true);
    try {
      if (isAndroidNative()) {
        const bytes = buildMidiFromAnalysis(
          analysis,
          voicingMode === 'detected' ? 'smooth' : voicingMode,
          transpose
        );
        const cleanName = analysis.filename.replace(/\.[^.]+$/, '');
        const fileName = `${cleanName}_${shiftedKey?.name.replace(/\s+/g, '') || 'KeySense'}.mid`;
        downloadBytes(fileName, bytes, 'audio/midi');
        return;
      }
      const res = await apiFetch('/api/export-midi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis,
          voicingMode: voicingMode === 'detected' ? 'smooth' : voicingMode,
          transpose,
        }),
      });
      if (!res.ok) throw new Error('MIDI export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const cleanName = analysis.filename.replace(/\.[^.]+$/, '');
      a.href = url;
      a.download = `${cleanName}_${shiftedKey?.name.replace(/\s+/g, '') || 'KeySense'}.mid`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to export MIDI.');
    } finally {
      setExportingMidi(false);
    }
  };

  const activeChordDisplay = useMemo(() => {
    if (!activeChord) return null;
    const labels = formatPrimaryChordLabel(activeChord, transpose, useFlats, notation);
    const details = transposeChordSymbol(activeChord, transpose, useFlats);
    const midiVoicing = getActiveChordMidiNotes(activeChord, voicingMode, transpose);
    return {
      ...labels,
      ...details,
      lhNames: midiVoicing.lh.map((m) => midiToNoteName(m, useFlats)),
      rhNames: midiVoicing.rh.map((m) => midiToNoteName(m, useFlats)),
      midiVoicing,
    };
  }, [activeChord, notation, transpose, useFlats, voicingMode]);

  const nextChordDisplay = useMemo(() => {
    if (!nextChord) return null;
    return formatPrimaryChordLabel(nextChord, transpose, useFlats, notation);
  }, [nextChord, notation, transpose, useFlats]);

  const chordProgressPct = useMemo(() => {
    if (!activeChord) return 0;
    const span = Math.max(0.05, activeChord.end - activeChord.start);
    return Math.max(0, Math.min(100, ((currentTime - activeChord.start) / span) * 100));
  }, [activeChord, currentTime]);

  return (
    <div
      className="min-h-screen bg-[#080B12] text-slate-100 flex flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingFile(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDraggingFile(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingFile(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleAnalyzeAudioBlob(file, file.name);
      }}
    >
      {/* Hidden Audio Element */}
      <audio
        ref={audioRef}
        src={audioUrl || undefined}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          if (loopRange && audioRef.current) {
            audioRef.current.currentTime = loopRange.start;
            audioRef.current.play().catch(() => {});
          } else {
            setIsPlaying(false);
          }
        }}
      />

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,video/mp4,video/webm,.mp3,.wav,.m4a,.ogg,.flac,.aac,.mp4,.webm"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Full-Window Drag-and-Drop Overlay */}
      {isDraggingFile && (
        <div className="fixed inset-0 z-50 bg-sky-950/80 backdrop-blur-md border-4 border-dashed border-sky-400 flex flex-col items-center justify-center p-6 pointer-events-none">
          <Upload className="w-14 h-14 text-sky-300 mb-3 animate-bounce" />
          <h2 className="text-2xl font-bold text-white">Drop Any Song to Find Piano Keys &amp; Chords</h2>
          <p className="text-sm text-sky-200 mt-1">
            Supports MP3, WAV, M4A, MP4, FLAC, OGG &amp; WebM
          </p>
        </div>
      )}

      {/* Top Studio Header Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#0A0E18]/95 backdrop-blur-md">
        <div className="max-w-[1440px] mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          {/* Brand + Active Track Selector */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 via-sky-500 to-indigo-600 p-0.5 shadow-lg shadow-sky-500/20">
                <div className="w-full h-full rounded-[10px] bg-[#0A0E18] flex items-center justify-center">
                  <Music className="w-4 h-4 text-sky-400" />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-extrabold tracking-tight text-base text-white">
                    KeySense
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                    Studio
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-none mt-0.5">
                  Song Piano Key &amp; Chord Intelligence
                </p>
              </div>
            </div>

            <div className="h-6 w-px bg-slate-800 hidden sm:block" />

            {/* Demo Song Selector */}
            <div className="flex items-center gap-2">
              <FileAudio className="w-4 h-4 text-amber-400 hidden md:block" />
              <select
                value={activeDemoId}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val !== 'custom') loadDemoTrack(val);
                }}
                className="rounded-xl bg-[#111827] border border-slate-700/90 text-xs sm:text-sm font-medium text-slate-100 px-3 py-1.5 focus:outline-none focus:border-sky-400 cursor-pointer max-w-[260px] sm:max-w-[320px] truncate"
              >
                {activeDemoId === 'custom' && analysis && (
                  <option value="custom">Uploaded: {analysis.filename}</option>
                )}
                <optgroup label="Built-in Studio Demo Songs">
                  {demos.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title} ({d.keyName})
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>

          {/* Primary Actions: Upload Song, Live Mic, Export MIDI */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs sm:text-sm shadow-lg shadow-sky-500/20 transition cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              Upload Song
            </button>

            <button
              onClick={() => {
                if (isPlaying) togglePlay();
                setMicOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/35 font-medium text-xs sm:text-sm transition cursor-pointer"
            >
              <Mic className="w-4 h-4" />
              Live Mic
            </button>

            <button
              onClick={() => setMidiOpen(true)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border font-medium text-xs sm:text-sm transition cursor-pointer ${
                isAndroidNative()
                  ? 'bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border-indigo-500/35'
                  : 'bg-slate-800/90 hover:bg-slate-700 text-slate-400 border-slate-700'
              }`}
              title="USB MIDI & Bluetooth (BLE) MIDI controllers — Android APK"
            >
              <Bluetooth className="w-4 h-4" />
              MIDI / BT
            </button>

            <button
              onClick={handleExportMidi}
              disabled={!analysis || exportingMidi}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-xs sm:text-sm transition disabled:opacity-40 cursor-pointer"
              title="Download Multi-Track MIDI (.mid) with Piano Chords + Detected Song Notes"
            >
              <Download className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">
                {exportingMidi ? 'Exporting...' : 'Export MIDI'}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Studio Content */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 py-4 space-y-4">
        {errorBanner && (
          <div className="rounded-xl bg-rose-500/15 border border-rose-500/40 px-4 py-3 text-sm text-rose-200 flex items-center justify-between">
            <span>{errorBanner}</span>
            <button
              onClick={() => setErrorBanner(null)}
              className="text-xs underline ml-4 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {isAnalyzing && (
          <div className="rounded-2xl border border-sky-500/30 bg-[#0D1424] p-8 text-center space-y-3">
            <Loader2 className="w-9 h-9 text-sky-400 animate-spin mx-auto" />
            <div className="text-base font-semibold text-white">{analyzeStatus}</div>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Running 24-BPO Constant-Q Transform, Harmonic-Percussive separation, key profile matching, and voice-led piano chord transcription...
            </p>
          </div>
        )}

        {!isAnalyzing && analysis && shiftedKey && (
          <>
            {/* Transport, Speed, KeyTranspose & Notation Control Bar */}
            <div className="rounded-2xl border border-slate-800/90 bg-[#0D1320] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              {/* Left: Transport Play/Pause + Prev/Next Chord + Song Audio Volume + Speed */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  onClick={() => stepChord(-1)}
                  className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 cursor-pointer"
                  title="Previous Chord (Left Arrow)"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <button
                  onClick={togglePlay}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-400 to-sky-500 hover:from-sky-300 hover:to-sky-400 text-slate-950 font-bold text-sm shadow-lg shadow-sky-500/25 transition cursor-pointer"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-4 h-4 fill-current" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      Play Song
                    </>
                  )}
                </button>

                <button
                  onClick={() => stepChord(1)}
                  className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 cursor-pointer"
                  title="Next Chord (Right Arrow)"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>

                {/* Song Audio Volume */}
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#080C15] border border-slate-800 text-xs">
                  <button
                    onClick={() => setSongMuted((m) => !m)}
                    className="text-slate-300 hover:text-white cursor-pointer"
                    title="Mute/Unmute Original Song Track"
                  >
                    {songMuted || songVolume === 0 ? (
                      <VolumeX className="w-4 h-4 text-rose-400" />
                    ) : (
                      <Volume2 className="w-4 h-4 text-emerald-400" />
                    )}
                  </button>
                  <span className="text-slate-400 hidden sm:inline">Song:</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={songMuted ? 0 : songVolume}
                    onChange={(e) => {
                      setSongMuted(false);
                      setSongVolume(parseFloat(e.target.value));
                    }}
                    className="w-16 accent-emerald-400 cursor-pointer"
                  />
                </div>

                {/* Practice Speed Selector (Pitch-Preserved!) */}
                <div className="inline-flex items-center rounded-xl bg-[#080C15] p-0.5 border border-slate-800 text-xs">
                  {[0.5, 0.75, 1.0, 1.25].map((spd) => (
                    <button
                      key={spd}
                      onClick={() => setPlaybackRate(spd)}
                      className={`px-2 py-1 rounded-lg font-mono transition cursor-pointer ${
                        playbackRate === spd
                          ? 'bg-slate-800 text-sky-300 font-bold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                      title="Change playback speed without altering song pitch"
                    >
                      {spd}x
                    </button>
                  ))}
                </div>
              </div>

              {/* Right: Transpose Semitones + "Play in C" + Notation System */}
              <div className="flex flex-wrap items-center gap-2.5">
                {/* Transpose Control */}
                <div className="flex items-center gap-1 rounded-xl bg-[#080C15] border border-slate-800 px-2 py-1 text-xs">
                  <span className="text-slate-400 mr-1">Transpose:</span>
                  <button
                    onClick={() => setTranspose((t) => Math.max(-6, t - 1))}
                    className="w-6 h-6 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 font-mono font-bold cursor-pointer"
                  >
                    −
                  </button>
                  <span
                    className={`w-10 text-center font-mono font-bold ${
                      transpose !== 0 ? 'text-amber-300' : 'text-slate-300'
                    }`}
                  >
                    {transpose > 0 ? `+${transpose}` : transpose} st
                  </span>
                  <button
                    onClick={() => setTranspose((t) => Math.min(6, t + 1))}
                    className="w-6 h-6 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 font-mono font-bold cursor-pointer"
                  >
                    +
                  </button>

                  {shiftedKey.rootPc !== (analysis.key.mode === 'major' ? 0 : 9) && (
                    <button
                      onClick={handleTransposeToC}
                      className="ml-1 px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 font-medium cursor-pointer"
                      title="Transpose all chords and piano keys to C Major / A Minor (all white keys!)"
                    >
                      To C
                    </button>
                  )}

                  {transpose !== 0 && (
                    <button
                      onClick={() => setTranspose(0)}
                      className="p-1 text-slate-400 hover:text-white cursor-pointer"
                      title="Reset to Original Song Key"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Notation System Switcher */}
                <div className="inline-flex rounded-xl bg-[#080C15] p-0.5 border border-slate-800 text-xs">
                  {(
                    [
                      { id: 'chord', label: 'Chords' },
                      { id: 'nashville', label: 'Numbers (1-4-5)' },
                      { id: 'roman', label: 'Roman (I-IV-V)' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setNotation(item.id)}
                      className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                        notation === item.id
                          ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 3-Column Live Harmony Spotlight HUD */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5">
              {/* Col 1 (5 cols): Active Chord & Exact Left/Right Hand Piano Keys */}
              <div className="md:col-span-5 rounded-2xl border border-sky-500/35 bg-gradient-to-br from-[#0F192D] to-[#0B111E] p-4 relative overflow-hidden">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-400">
                      Current Chord
                    </span>
                    <div className="flex items-baseline gap-2.5 mt-0.5">
                      <span className="text-4xl font-black tracking-tight text-white font-mono">
                        {activeChordDisplay ? activeChordDisplay.primary : '—'}
                      </span>
                      {activeChordDisplay && (
                        <span className="text-sm font-mono px-2 py-0.5 rounded-lg bg-slate-800/90 text-slate-300 border border-slate-700">
                          {activeChordDisplay.secondary} · {activeChord?.roman}
                        </span>
                      )}
                    </div>
                  </div>

                  {activeChord && activeChordDisplay && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() =>
                          pianoSynth.auditionChord(
                            activeChordDisplay.midiVoicing.lh,
                            activeChordDisplay.midiVoicing.rh,
                            1.4
                          )
                        }
                        className="px-2.5 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 text-xs font-medium flex items-center gap-1 cursor-pointer"
                        title="Play this chord on the studio piano"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        Hear
                      </button>
                      <button
                        onClick={() => handleToggleLoopChord(activeChord)}
                        className={`px-2.5 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1 cursor-pointer ${
                          loopRange &&
                          Math.abs(loopRange.start - activeChord.start) < 0.08
                            ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold'
                            : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700'
                        }`}
                        title="Loop this chord continuously to practice finger placement"
                      >
                        <Repeat className="w-3.5 h-3.5" />
                        Loop
                      </button>
                    </div>
                  )}
                </div>

                {/* Exact Left-Hand & Right-Hand Piano Keys Readout */}
                {activeChordDisplay && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/35 text-amber-200 font-mono">
                      <span className="font-bold text-amber-400">LH:</span>
                      {activeChordDisplay.lhNames.join(' · ') || '—'}
                    </div>
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/15 border border-sky-500/35 text-sky-200 font-mono">
                      <span className="font-bold text-sky-400">RH:</span>
                      {activeChordDisplay.rhNames.join(' · ') || '—'}
                    </div>
                  </div>
                )}

                {/* Progress bar to next chord */}
                <div className="mt-3 h-1 w-full rounded-full bg-slate-900 overflow-hidden">
                  <div
                    className="h-full bg-sky-400 transition-all duration-75"
                    style={{ width: `${chordProgressPct}%` }}
                  />
                </div>
              </div>

              {/* Col 2 (3 cols): Next Chord Preview */}
              <div className="md:col-span-3 rounded-2xl border border-slate-800/90 bg-[#0D1320] p-4 flex flex-col justify-between">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Up Next
                  </span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-extrabold text-slate-200 font-mono">
                      {nextChordDisplay ? nextChordDisplay.primary : 'End'}
                    </span>
                    {nextChordDisplay && (
                      <span className="text-xs font-mono text-slate-400">
                        ({nextChordDisplay.secondary})
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-3 text-xs text-slate-400 font-mono">
                  {nextChord
                    ? `In ${Math.max(0, nextChord.start - currentTime).toFixed(1)}s · ${
                        transposeChordSymbol(nextChord, transpose, useFlats).noteNames.join(' - ')
                      }`
                    : 'Final bar of progression'}
                </div>
              </div>

              {/* Col 3 (4 cols): Song Key, BPM & Clickable Scale Keys */}
              <div className="md:col-span-4 rounded-2xl border border-slate-800/90 bg-[#0D1320] p-4 flex flex-col justify-between">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      {transpose === 0 ? 'Detected Song Key' : `Transposed Key (${transpose > 0 ? `+${transpose}` : transpose})`}
                    </span>
                    <div className="text-2xl font-extrabold text-white mt-0.5">
                      {shiftedKey.name}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-sm font-mono font-bold text-amber-300">
                      {Math.round(analysis.bpm)} BPM
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Rel: {shiftedKey.relativeKey}
                    </div>
                  </div>
                </div>

                {/* Scale Notes Quick Pills */}
                <div className="mt-2.5 flex items-center gap-1 flex-wrap">
                  <span className="text-[11px] text-slate-400 mr-1">Scale:</span>
                  {shiftedKey.scaleNotes.map((sn, idx) => (
                    <button
                      key={idx}
                      onClick={() =>
                        pianoSynth.noteOn(60 + shiftedKey.scalePitchClasses[idx], 0.8, 0.9)
                      }
                      className="px-1.5 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-200 text-[11px] font-mono font-semibold transition cursor-pointer"
                      title="Click to hear scale note"
                    >
                      {sn}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Synchronized Waveform + Chord Timeline */}
            <WaveformTimeline
              analysis={analysis}
              currentTime={currentTime}
              isPlaying={isPlaying}
              transpose={transpose}
              useFlats={useFlats}
              notation={notation}
              activeChordId={activeChord?.id ?? null}
              loopRange={loopRange}
              onSeek={handleSeek}
              onSelectChord={handleSelectChord}
              onToggleLoopChord={handleToggleLoopChord}
              onClearLoop={() => setLoopRange(null)}
            />

            {/* Interactive 61-Key Studio Piano + Falling Note Waterfall */}
            <StudioPiano
              chords={analysis.chords}
              pianoRoll={analysis.pianoRoll}
              currentTime={currentTime}
              activeChord={activeChord}
              transpose={transpose}
              useFlats={useFlats}
              scalePitchClasses={shiftedKey.scalePitchClasses}
              voicingMode={voicingMode}
              onChangeVoicingMode={setVoicingMode}
              synthTone={synthTone}
              onChangeSynthTone={setSynthTone}
              playAlongVolume={playAlongVolume}
              onChangePlayAlongVolume={setPlayAlongVolume}
              liveDetectedMidi={liveMicMidi}
            />

            {/* Bottom Musician Tools Tabs */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-2 border-b border-slate-800/90 pb-2">
                <button
                  onClick={() => setBottomTab('chords')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer ${
                    bottomTab === 'chords'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Piano Chord Diagrams &amp; Song Chart
                </button>
                <button
                  onClick={() => setBottomTab('harmony')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer ${
                    bottomTab === 'harmony'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Key Scale, Pitch Profile &amp; Number System
                </button>
              </div>

              {bottomTab === 'chords' ? (
                <ChordDictionaryGrid
                  chords={analysis.chords}
                  songKeyName={shiftedKey.name}
                  bpm={analysis.bpm}
                  transpose={transpose}
                  useFlats={useFlats}
                  notation={notation}
                  voicingMode={voicingMode}
                  activeChordId={activeChord?.id ?? null}
                  onSelectChord={handleSelectChord}
                />
              ) : (
                <KeyHarmonyPanel
                  keyInfo={analysis.key}
                  transpose={transpose}
                  tuningHz={analysis.tuningHz}
                />
              )}
            </div>
          </>
        )}
      </main>

      {/* Live Microphone Chord & Piano Key Modal */}
      <LiveMicModal
        isOpen={micOpen}
        onClose={() => setMicOpen(false)}
        onLiveNotesUpdate={setLiveMicMidi}
        onRecordedClipReady={(blob, filename) => handleAnalyzeAudioBlob(blob, filename)}
      />

      {/* Native MIDI / Bluetooth (USB + BLE) input panel — Android APK */}
      <MidiPanel
        isOpen={midiOpen}
        onClose={() => setMidiOpen(false)}
        onLiveNotes={setLiveMicMidi}
      />
    </div>
  );
};

export default App;
