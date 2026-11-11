import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileAudio,
  ListMusic,
  Loader2,
  Mic,
  Music,
  Pause,
  Play,
  Repeat,
  Upload,
  Volume2,
  VolumeX,
  MoreHorizontal,
  Star,
  Piano,
  Guitar,
  SlidersHorizontal,
  Maximize,
  Minimize,
  FastForward,
  Rewind,
  AudioLines,
  Settings,
  FolderOpen,
  Home,
  Check,
  X,
} from "lucide-react";
import {
  ChordBlock,
  DemoTrack,
  NotationMode,
  SongAnalysis,
  SynthTone,
  VoicingMode,
} from "./types";
import {
  chordIsInKey,
  formatPrimaryChordLabel,
  getActiveChordMidiNotes,
  midiToNoteName,
  mod12,
  transposeChordSymbol,
  transposeKeyInfo,
  formatTime,
} from "./lib/musicTheory";
import { pianoSynth, transcodeFileToMonoWav } from "./lib/pianoSynth";
import { apiFetch } from "./lib/api";
import { isAndroidNative, subscribeNativeMidi } from "./lib/nativeBridge";
import { buildMidiFromAnalysis, downloadBytes } from "./lib/midiExport";
import { WaveformTimeline } from "./components/WaveformTimeline";
import { ChordTracker } from "./components/ChordTracker";
import { StudioPiano } from "./components/StudioPiano";
import { ChordDictionaryGrid } from "./components/ChordDictionaryGrid";
import { KeyHarmonyPanel } from "./components/KeyHarmonyPanel";
import { LiveMicModal } from "./components/LiveMicModal";
import { PracticeBoard } from "./components/PracticeBoard";
import {
  PracticeKeyboard,
  ChordStaff,
  GuitarDiagram,
} from "./components/InstrumentViews";
import { AdvancedTool } from "./components/AdvancedTool";
import { StudioDialog } from "./components/StudioDialog";
import { MidiPanel } from "./components/MidiPanel";

export const App: React.FC = () => {
  const [demos, setDemos] = useState<DemoTrack[]>([]);
  const [activeDemoId, setActiveDemoId] = useState<string>("gospel-sunrise");
  const [analysis, setAnalysis] = useState<SongAnalysis | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(true);
  const [analyzeStatus, setAnalyzeStatus] = useState<string>(
    "Loading studio session...",
  );
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
  const [notation, setNotation] = useState<NotationMode>("chord");
  const [voicingMode, setVoicingMode] = useState<VoicingMode>("smooth");
  const [synthTone, setSynthTone] = useState<SynthTone>("grand");
  const [playAlongVolume, setPlayAlongVolume] = useState<number>(0.25);
  const [bottomTab, setBottomTab] = useState<
    "staff" | "keyboard" | "guitar" | "settings"
  >("keyboard");
  const [homePage, setHomePage] = useState<
    "home" | "demos" | "favorites" | "user" | null
  >(null);
  const [focusMode, setFocusMode] = useState(false);
  const [dialog, setDialog] = useState<"more" | "chord" | null>(null);
  const [sections, setSections] = useState<Record<number, string>>({});
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("keysense.favorites") || "[]",
      );
      return Array.isArray(saved)
        ? saved.filter((id) => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  });

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
    if ("preservesPitch" in el) {
      el.preservesPitch = true;
    }
  }, [playbackRate, audioUrl]);

  // Native MIDI (USB / Bluetooth BLE) events -> studio synth + piano highlight
  useEffect(() => {
    if (!isAndroidNative()) return;
    const unsub = subscribeNativeMidi((ev) => {
      if (ev.type === "noteOn") {
        pianoSynth.noteOn(ev.note, Math.max(0.15, (ev.vel || 100) / 127), 3.2);
        nativeMidiNotesRef.current.add(ev.note);
        setLiveMicMidi([...nativeMidiNotesRef.current].sort((a, b) => a - b));
      } else if (ev.type === "noteOff") {
        pianoSynth.noteOff(ev.note);
        nativeMidiNotesRef.current.delete(ev.note);
        setLiveMicMidi([...nativeMidiNotesRef.current].sort((a, b) => a - b));
      } else if (ev.type === "deviceDisconnected") {
        pianoSynth.stopAll();
        nativeMidiNotesRef.current.clear();
        setLiveMicMidi([]);
      }
    });
    return unsub;
  }, []);

  // Load Demo Tracks Manifest & Initial Demo on Mount
  const loadDemoTrack = useCallback(
    async (demoId: string, trackList?: DemoTrack[]) => {
      setErrorBanner(null);
      audioRef.current?.pause();
      pianoSynth.stopAll();
      setIsAnalyzing(true);
      setAnalyzeStatus("Loading studio piano analysis...");
      setIsPlaying(false);
      setCurrentTime(0);
      setTranspose(0);
      setLoopRange(null);
      setSections({});
      lastAutoPlayedChordRef.current = null;

      try {
        const res = await apiFetch(`/api/demos/${encodeURIComponent(demoId)}`);
        if (!res.ok)
          throw new Error(`Failed to load demo track (${res.status})`);
        const data: SongAnalysis = await res.json();
        setAnalysis(data);
        setActiveDemoId(demoId);

        const list = trackList || demos;
        const found = list.find((d) => d.id === demoId);
        setAudioUrl(found ? found.audioUrl : `/demos/${demoId}.wav`);
      } catch (err) {
        setErrorBanner(
          err instanceof Error ? err.message : "Failed to load demo song.",
        );
      } finally {
        setIsAnalyzing(false);
      }
    },
    [demos],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/demos");
        const json = await res.json();
        if (cancelled) return;
        const list: DemoTrack[] = json.demos || [];
        setDemos(list);
        const initialId = list[0]?.id || "gospel-sunrise";
        await loadDemoTrack(initialId, list);
      } catch (err) {
        if (!cancelled) {
          setErrorBanner(
            err instanceof Error
              ? err.message
              : "Unable to connect to DSP server.",
          );
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

  // "Relevant progression only": show just the in-key chord progression of the song (default ON)
  const [onlyInKey, setOnlyInKey] = useState<boolean>(true);
  const visibleChords = useMemo(() => {
    if (!analysis) return [];
    if (!onlyInKey) return analysis.chords;
    return analysis.chords.filter((c) => chordIsInKey(c, analysis.key));
  }, [analysis, onlyInKey]);

  // Current & Next Chord Lookup
  const { activeChord, nextChord, activeChordIndex } = useMemo(() => {
    if (!analysis || !analysis.chords.length) {
      return { activeChord: null, nextChord: null, activeChordIndex: -1 };
    }
    let idx = analysis.chords.findIndex(
      (c) => currentTime >= c.start && currentTime < c.end,
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
    const dur = Math.min(
      2.2,
      Math.max(0.45, activeChord.duration / playbackRate),
    );
    pianoSynth.auditionChord(notes.lh, notes.rh, dur, playAlongVolume * 0.85);
  }, [
    activeChord,
    isPlaying,
    playAlongVolume,
    playbackRate,
    transpose,
    voicingMode,
  ]);

  // Upload & Transcode Any Song File
  const handleAnalyzeAudioBlob = async (
    fileOrBlob: File | Blob,
    displayFilename: string,
  ) => {
    setErrorBanner(null);
    setIsPlaying(false);
    pianoSynth.stopAll();
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsAnalyzing(true);
    setAnalyzeStatus(`Decoding "${displayFilename}"...`);

    let pendingUrl: string | null = null;
    try {
      // Retain the current song until the replacement has analyzed successfully.
      const localPlayUrl = URL.createObjectURL(fileOrBlob);
      pendingUrl = localPlayUrl;

      // Transcode in-memory to 22,050Hz 16-bit mono WAV so ANY format (.m4a, .mp4, .mp3, .webm, .wav, .ogg, .flac) analyzes cleanly!
      const wavBlob = await transcodeFileToMonoWav(fileOrBlob);
      setAnalyzeStatus(
        "Extracting piano keys, chords, basslines & key signature...",
      );

      const res = await apiFetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "audio/wav",
          "X-Filename": encodeURIComponent(displayFilename),
        },
        body: wavBlob,
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || `Analysis failed (${res.status})`);
      }

      if (customBlobUrlRef.current)
        URL.revokeObjectURL(customBlobUrlRef.current);
      customBlobUrlRef.current = localPlayUrl;
      pendingUrl = null;
      setAnalysis(payload);
      setAudioUrl(localPlayUrl);
      setActiveDemoId("custom");
      setCurrentTime(0);
      setTranspose(0);
      setLoopRange(null);
      setSections({});
      setHomePage(null);
      lastAutoPlayedChordRef.current = null;
    } catch (err) {
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
      setErrorBanner(
        err instanceof Error
          ? err.message
          : "Could not decode or analyze this file. Please upload a valid audio/video song file.",
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
    e.target.value = "";
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

  const handleSeek = useCallback(
    (sec: number) => {
      const el = audioRef.current;
      const clamped = Math.max(0, Math.min(analysis?.duration ?? sec, sec));
      if (el) {
        el.currentTime = clamped;
      }
      lastAutoPlayedChordRef.current = null;
      setCurrentTime(clamped);
    },
    [analysis?.duration],
  );

  const handleSelectChord = useCallback(
    (chord: ChordBlock) => {
      handleSeek(chord.start + 0.01);
      const el = audioRef.current;
      if (!el || el.paused) {
        const notes = getActiveChordMidiNotes(chord, voicingMode, transpose);
        pianoSynth.auditionChord(notes.lh, notes.rh, 1.35);
      }
    },
    [handleSeek, transpose, voicingMode],
  );

  const handleToggleLoopChord = useCallback(
    (chord: ChordBlock) => {
      const { primary } = formatPrimaryChordLabel(
        chord,
        transpose,
        useFlats,
        notation,
      );
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
    [handleSeek, notation, transpose, useFlats],
  );

  const stepChord = useCallback(
    (delta: number) => {
      if (!analysis || !analysis.chords.length) return;
      const nextIdx = Math.max(
        0,
        Math.min(analysis.chords.length - 1, activeChordIndex + delta),
      );
      handleSelectChord(analysis.chords[nextIdx]);
    },
    [activeChordIndex, analysis, handleSelectChord],
  );

  // Global Studio Transport Shortcuts (Space = Play/Pause, Arrows = Prev/Next Chord)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        focusMode &&
        !document.querySelector("dialog[open]")
      ) {
        setFocusMode(false);
        return;
      }
      if (
        homePage ||
        micOpen ||
        midiOpen ||
        document.querySelector("dialog[open]")
      )
        return;
      if (
        ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(
          (e.target as HTMLElement)?.tagName,
        )
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        stepChord(-1);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        stepChord(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepChord, togglePlay, homePage, micOpen, midiOpen, focusMode]);

  // Transpose straight to C Major / A Minor (White Keys helper!)
  const handleTransposeToC = () => {
    if (!analysis) return;
    const targetRoot = analysis.key.mode === "major" ? 0 : 9; // C Major (0) or A Minor (9)
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
          voicingMode === "detected" ? "smooth" : voicingMode,
          transpose,
        );
        const cleanName = analysis.filename.replace(/\.[^.]+$/, "");
        const fileName = `${cleanName}_${shiftedKey?.name.replace(/\s+/g, "") || "KeySense"}.mid`;
        const savedPath = downloadBytes(fileName, bytes, "audio/midi");
        if (savedPath) setAnalyzeStatus(`MIDI exported to ${savedPath}`);
        return;
      }
      const res = await apiFetch("/api/export-midi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis,
          voicingMode: voicingMode === "detected" ? "smooth" : voicingMode,
          transpose,
        }),
      });
      if (!res.ok) throw new Error("MIDI export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const cleanName = analysis.filename.replace(/\.[^.]+$/, "");
      a.href = url;
      a.download = `${cleanName}_${shiftedKey?.name.replace(/\s+/g, "") || "KeySense"}.mid`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to export MIDI.",
      );
    } finally {
      setExportingMidi(false);
    }
  };

  const activeChordDisplay = useMemo(() => {
    if (!activeChord) return null;
    const labels = formatPrimaryChordLabel(
      activeChord,
      transpose,
      useFlats,
      notation,
    );
    const details = transposeChordSymbol(activeChord, transpose, useFlats);
    const midiVoicing = getActiveChordMidiNotes(
      activeChord,
      voicingMode,
      transpose,
    );
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

  const title =
    demos.find((d) => d.id === activeDemoId)?.title ||
    analysis?.filename ||
    "Choose a song";
  const artist =
    demos.find((d) => d.id === activeDemoId)?.artist ||
    "Your uploaded recording";
  const selectedBar = Math.floor(
    currentTime / ((4 * 60) / (analysis?.bpm || 120)),
  );
  const isFavorite = favoriteIds.includes(activeDemoId);
  const toggleFavorite = () => {
    if (activeDemoId === "custom") return;
    const next = isFavorite
      ? favoriteIds.filter((id) => id !== activeDemoId)
      : [...favoriteIds, activeDemoId];
    try {
      localStorage.setItem("keysense.favorites", JSON.stringify(next));
      setFavoriteIds(next);
    } catch {
      setErrorBanner("Could not save favorites. Check browser/app storage.");
    }
  };
  const returnHome = () => {
    audioRef.current?.pause();
    pianoSynth.stopAll();
    setHomePage("home");
    setFocusMode(false);
  };

  return (
    <div
      className={
        "keysense-app view-" + bottomTab + (focusMode ? " focus-mode" : "")
      }
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
      <audio
        ref={audioRef}
        src={audioUrl || undefined}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          if (loopRange && audioRef.current) {
            audioRef.current.currentTime = loopRange.start;
            audioRef.current.play().catch(() => setIsPlaying(false));
          } else setIsPlaying(false);
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        aria-label="Upload song"
        accept="audio/*,video/mp4,video/webm,.mp3,.wav,.m4a,.ogg,.flac,.aac,.mp4,.webm"
        onChange={handleFileChange}
        hidden
      />
      {isDraggingFile && (
        <div className="song-drop-overlay">
          <Upload size={44} />
          <h2>Drop your song here</h2>
          <p>MP3, WAV, M4A, FLAC and other device-supported formats</p>
        </div>
      )}

      <header className="studio-topbar">
        <button
          className="icon-button"
          aria-label={homePage ? "Back to player" : "Open home"}
          onClick={() => (homePage ? setHomePage(null) : returnHome())}
        >
          <ChevronLeft />
        </button>
        <div className="studio-wordmark">
          KeySense <span>STUDIO</span>
        </div>
        <button
          className="icon-button more-button"
          aria-label="Song menu"
          aria-haspopup="dialog"
          onClick={() => setDialog("more")}
        >
          <MoreHorizontal />
        </button>
      </header>

      {errorBanner && (
        <div className="studio-error" role="alert">
          <span>{errorBanner}</span>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setErrorBanner(null)}
          >
            <X />
          </button>
        </div>
      )}
      {isAnalyzing && (
        <div className="studio-loading" role="status">
          <Loader2 className="animate-spin" />
          <div>
            <strong>{analyzeStatus}</strong>
            <p>Estimating the key, timing and chords. Keep this screen open.</p>
          </div>
        </div>
      )}

      {homePage ? (
        <main className="studio-home">
          <div className="home-heading">
            <p className="eyebrow">YOUR MUSIC, IN PRACTICE</p>
            <h1>
              {homePage === "home"
                ? "Home"
                : homePage === "demos"
                  ? "Demo Songs"
                  : homePage === "favorites"
                    ? "Favorites"
                    : "User Songs"}
            </h1>
            <p>Listen. Find the harmony. Play along.</p>
          </div>
          {homePage === "home" ? (
            <>
              <div className="home-group-label">Music</div>
              {[
                {
                  label: "Music",
                  hint: "Open a recording from your device",
                  icon: Music,
                  action: () => fileInputRef.current?.click(),
                },
                {
                  label: "Demo Songs",
                  hint: `${demos.length} bundled practice sessions`,
                  icon: ListMusic,
                  action: () => setHomePage("demos"),
                },
                {
                  label: "Favorites",
                  hint: "Your bookmarked demo songs",
                  icon: Star,
                  action: () => setHomePage("favorites"),
                },
                {
                  label: "User Songs",
                  hint: "Current uploaded recording",
                  icon: FolderOpen,
                  action: () => setHomePage("user"),
                },
              ].map((item) => (
                <button
                  key={item.label}
                  className="home-row"
                  onClick={item.action}
                >
                  <item.icon />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                  </span>
                  <ChevronRight />
                </button>
              ))}
              <div className="home-group-label">Instrument</div>
              <button className="home-row" onClick={() => setMidiOpen(true)}>
                <Piano />
                <span>
                  <strong>Connect an instrument</strong>
                  <small>USB / Bluetooth MIDI · Android</small>
                </span>
                <ChevronRight />
              </button>
              <div className="home-group-label">Settings</div>
              <button
                className="home-row"
                onClick={() => {
                  setHomePage(null);
                  setBottomTab("settings");
                }}
              >
                <Settings />
                <span>
                  <strong>Play Settings</strong>
                  <small>Tempo, transpose, sound and analysis views</small>
                </span>
                <ChevronRight />
              </button>
            </>
          ) : (
            <>
              <button
                className="text-button"
                onClick={() => setHomePage("home")}
              >
                <ChevronLeft size={16} /> All music
              </button>
              {(homePage === "demos" || homePage === "favorites") &&
                demos
                  .filter(
                    (d) => homePage === "demos" || favoriteIds.includes(d.id),
                  )
                  .map((d) => (
                    <button
                      key={d.id}
                      className="home-row"
                      disabled={isAnalyzing}
                      onClick={() => {
                        setHomePage(null);
                        loadDemoTrack(d.id);
                      }}
                    >
                      <Music />
                      <span>
                        <strong>{d.title}</strong>
                        <small>
                          {d.keyName} · {Math.round(d.bpm)} BPM ·{" "}
                          {formatTime(d.duration)}
                        </small>
                      </span>
                      <ChevronRight />
                    </button>
                  ))}
              {homePage === "favorites" &&
                !demos.some((d) => favoriteIds.includes(d.id)) && (
                  <p className="home-empty">
                    No favorites yet. Open a demo song and use Song menu / Add
                    to Favorites.
                  </p>
                )}
              {homePage === "user" && (
                <>
                  <p className="home-empty">
                    Uploaded audio stays in this session only. Reopen the file
                    after restarting; it is not stored in your favorites.
                  </p>
                  {activeDemoId === "custom" && analysis && (
                    <button
                      className="home-row"
                      onClick={() => setHomePage(null)}
                    >
                      <FileAudio />
                      <span>
                        <strong>{analysis.filename}</strong>
                        <small>Current session</small>
                      </span>
                      <ChevronRight />
                    </button>
                  )}
                  <button
                    className="amber-button"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={18} /> Choose a song
                  </button>
                </>
              )}
            </>
          )}
          <div className="home-signoff">
            <AudioLines size={24} />
            <span>
              KeySense Studio<small>Your pocket music studio</small>
            </span>
          </div>
        </main>
      ) : (
        <main className="practice-workspace">
          {!analysis && !isAnalyzing && (
            <div className="home-empty">
              <h1>Start a practice session</h1>
              <button
                className="amber-button"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload /> Choose a song
              </button>
              <button
                className="text-button"
                onClick={() => setHomePage("demos")}
              >
                Browse demo songs
              </button>
            </div>
          )}
          {analysis && shiftedKey && (
            <>
              <section className="song-transport" aria-label="Song playback">
                <div className="song-identity">
                  <div className="song-art">
                    <Music />
                  </div>
                  <div className="song-title">
                    <h1>{title}</h1>
                    <p>{artist}</p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Upload another song"
                    disabled={isAnalyzing}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload />
                  </button>
                </div>
                <div className="session-metadata">
                  <span className="key-pill">{shiftedKey.name}</span>
                  <span>{Math.round(analysis.bpm)} BPM</span>
                  <span>Estimated chords</span>
                  {transpose !== 0 && (
                    <span>
                      Guide {transpose > 0 ? "+" : ""}
                      {transpose} st
                    </span>
                  )}
                </div>
                <div className="seek-row">
                  <time>{formatTime(currentTime)}</time>
                  <input
                    type="range"
                    aria-label="Song position"
                    min={0}
                    max={analysis.duration}
                    step={0.01}
                    value={Math.min(currentTime, analysis.duration)}
                    onChange={(e) => handleSeek(Number(e.target.value))}
                  />
                  <time>{formatTime(analysis.duration)}</time>
                </div>
                <div className="transport-buttons">
                  <button
                    className="transport-button"
                    aria-label="Previous chord"
                    disabled={isAnalyzing}
                    onClick={() => stepChord(-1)}
                  >
                    <Rewind />
                  </button>
                  <button
                    className="transport-button main-play"
                    aria-label={isPlaying ? "Pause song" : "Play song"}
                    disabled={isAnalyzing || !audioUrl}
                    onClick={togglePlay}
                  >
                    {isPlaying ? (
                      <Pause fill="currentColor" />
                    ) : (
                      <Play fill="currentColor" />
                    )}
                  </button>
                  <button
                    className="transport-button"
                    aria-label="Next chord"
                    disabled={isAnalyzing}
                    onClick={() => stepChord(1)}
                  >
                    <FastForward />
                  </button>
                  <button
                    className="transport-button record-control"
                    aria-label="Open live microphone"
                    onClick={() => {
                      audioRef.current?.pause();
                      setMicOpen(true);
                    }}
                  >
                    <span>
                      <Mic size={18} />
                    </span>
                  </button>
                  <button
                    className={
                      "transport-button loop-control" +
                      (loopRange ? " selected" : "")
                    }
                    aria-label="Loop current chord"
                    aria-pressed={!!loopRange}
                    disabled={!activeChord}
                    onClick={() =>
                      activeChord && handleToggleLoopChord(activeChord)
                    }
                  >
                    <Repeat />
                    <small>A-B</small>
                  </button>
                  <button
                    className="transport-button"
                    aria-label="Open play settings"
                    onClick={() => setBottomTab("settings")}
                  >
                    <SlidersHorizontal />
                  </button>
                </div>
                {loopRange && (
                  <div className="loop-notice">
                    Looping {loopRange.label}: {formatTime(loopRange.start)} -{" "}
                    {formatTime(loopRange.end)}{" "}
                    <button onClick={() => setLoopRange(null)}>
                      Clear loop
                    </button>
                  </div>
                )}
              </section>

              <section className="chart-section" aria-labelledby="chart-title">
                <div className="chart-heading">
                  <h2 id="chart-title">Chord progression</h2>
                  <button
                    className="text-button"
                    disabled={!activeChord}
                    onClick={() => setDialog("chord")}
                  >
                    Chord &amp; section <SlidersHorizontal size={14} />
                  </button>
                </div>
                <PracticeBoard
                  chords={visibleChords}
                  duration={analysis.duration}
                  bpm={analysis.bpm}
                  currentTime={currentTime}
                  transpose={transpose}
                  useFlats={useFlats}
                  notation={notation}
                  onSelect={handleSelectChord}
                  sections={sections}
                />
              </section>

              <section
                className="instrument-panel"
                aria-label="Chord instrument view"
              >
                <div className="current-chord">
                  <div>
                    <small>NOW PLAYING</small>
                    <strong>{activeChordDisplay?.primary || "--"}</strong>
                  </div>
                  <div className="next-chord">
                    <small>UP NEXT</small>
                    <span>{nextChordDisplay?.primary || "End"}</span>
                  </div>
                </div>
                {bottomTab === "keyboard" && (
                  <>
                    <PracticeKeyboard
                      notes={
                        liveMicMidi.length
                          ? liveMicMidi
                          : activeChordDisplay?.midiVoicing.all || []
                      }
                      useFlats={useFlats}
                    />
                    <p className="instrument-caption">
                      {liveMicMidi.length
                        ? "Live input pitch classes"
                        : "Highlighted chord pitch classes"}{" "}
                      · tap any key to play
                    </p>
                  </>
                )}
                {bottomTab === "staff" && (
                  <ChordStaff
                    notes={activeChordDisplay?.midiVoicing.all || []}
                    useFlats={useFlats}
                  />
                )}
                {bottomTab === "guitar" && (
                  <GuitarDiagram
                    notes={activeChordDisplay?.midiVoicing.all || []}
                    bassPc={mod12((activeChord?.bassPc || 0) + transpose)}
                  />
                )}
                {bottomTab === "settings" && (
                  <div className="play-settings">
                    <h2>Play Settings</h2>
                    <div className="settings-grid">
                      <label>
                        Playback speed
                        <select
                          value={playbackRate}
                          onChange={(e) =>
                            setPlaybackRate(Number(e.target.value))
                          }
                        >
                          {[0.5, 0.75, 1, 1.25, 1.5].map((n) => (
                            <option key={n} value={n}>
                              {n}x
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Transpose guide
                        <select
                          value={transpose}
                          onChange={(e) => setTranspose(Number(e.target.value))}
                        >
                          {Array.from({ length: 25 }, (_, i) => i - 12).map(
                            (n) => (
                              <option key={n} value={n}>
                                {n > 0 ? "+" : ""}
                                {n} semitones
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <label>
                        Notation
                        <select
                          value={notation}
                          onChange={(e) =>
                            setNotation(e.target.value as NotationMode)
                          }
                        >
                          <option value="chord">Chord names</option>
                          <option value="roman">Roman numerals</option>
                          <option value="nashville">Nashville numbers</option>
                        </select>
                      </label>
                      <label>
                        Voicing
                        <select
                          value={voicingMode}
                          onChange={(e) =>
                            setVoicingMode(e.target.value as VoicingMode)
                          }
                        >
                          <option value="smooth">Smooth</option>
                          <option value="root">Easy triad</option>
                          <option value="pro">Pro 7th/9th</option>
                          <option value="detected">Detected notes</option>
                        </select>
                      </label>
                      <label>
                        Piano tone
                        <select
                          value={synthTone}
                          onChange={(e) =>
                            setSynthTone(e.target.value as SynthTone)
                          }
                        >
                          <option value="grand">Grand piano</option>
                          <option value="rhodes">Warm Rhodes</option>
                        </select>
                      </label>
                      <label>
                        Song volume
                        <input
                          aria-label="Song volume"
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={songVolume}
                          onChange={(e) =>
                            setSongVolume(Number(e.target.value))
                          }
                        />
                      </label>
                      <label>
                        Chord guide volume
                        <input
                          aria-label="Chord guide volume"
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={playAlongVolume}
                          onChange={(e) =>
                            setPlayAlongVolume(Number(e.target.value))
                          }
                        />
                      </label>
                    </div>
                    <p className="instrument-caption">
                      Transpose changes the chord guide, diagrams and MIDI, not
                      the original recording. Playback speed preserves the
                      recording's pitch.
                    </p>
                    <div className="settings-actions">
                      <button
                        className="text-button"
                        onClick={handleTransposeToC}
                      >
                        White-key guide
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setSongMuted(!songMuted)}
                      >
                        {songMuted ? (
                          <VolumeX size={16} />
                        ) : (
                          <Volume2 size={16} />
                        )}
                        {songMuted ? "Unmute song" : "Mute song"}
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          setTranspose(0);
                          setPlaybackRate(1);
                          setLoopRange(null);
                          handleSeek(0);
                        }}
                      >
                        Reset playback
                      </button>
                    </div>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={onlyInKey}
                        onChange={(e) => setOnlyInKey(e.target.checked)}
                      />{" "}
                      Show only chords in the estimated key
                    </label>
                    <AdvancedTool title="Full studio piano">
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
                    </AdvancedTool>
                    <AdvancedTool title="Waveform &amp; loop editor">
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
                    </AdvancedTool>
                    <AdvancedTool title="Key harmony &amp; scale">
                      <KeyHarmonyPanel
                        keyInfo={analysis.key}
                        transpose={transpose}
                        tuningHz={analysis.tuningHz}
                      />
                    </AdvancedTool>
                    <AdvancedTool title="Piano chord dictionary">
                      <ChordDictionaryGrid
                        chords={visibleChords}
                        songKeyName={shiftedKey.name}
                        bpm={analysis.bpm}
                        transpose={transpose}
                        useFlats={useFlats}
                        notation={notation}
                        voicingMode={voicingMode}
                        activeChordId={activeChord?.id ?? null}
                        onSelectChord={handleSelectChord}
                      />
                    </AdvancedTool>
                    <AdvancedTool title="Chord Tracker &amp; text export">
                      <ChordTracker
                        analysis={analysis}
                        title={title}
                        keyName={shiftedKey.name}
                        currentTime={currentTime}
                        isPlaying={isPlaying}
                        activeChordId={activeChord?.id ?? null}
                        transpose={transpose}
                        useFlats={useFlats}
                        notation={notation}
                        onSeek={handleSeek}
                        onSelectChord={handleSelectChord}
                      />
                    </AdvancedTool>
                  </div>
                )}
              </section>
              <nav className="instrument-tabs" aria-label="Instrument views">
                <button
                  aria-label={focusMode ? "Exit full screen" : "Full screen"}
                  aria-pressed={focusMode}
                  onClick={() => setFocusMode(!focusMode)}
                >
                  {focusMode ? <Minimize /> : <Maximize />}
                  <span>{focusMode ? "Exit Full Screen" : "Full Screen"}</span>
                </button>
                {(
                  [
                    { id: "staff", label: "Staff Notation", icon: AudioLines },
                    { id: "keyboard", label: "Keyboard", icon: Piano },
                    { id: "guitar", label: "Guitar", icon: Guitar },
                    {
                      id: "settings",
                      label: "Play Settings",
                      icon: SlidersHorizontal,
                    },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    aria-pressed={bottomTab === tab.id}
                    onClick={() => {
                      setBottomTab(tab.id);
                      setFocusMode(false);
                    }}
                    className={bottomTab === tab.id ? "active" : ""}
                  >
                    <tab.icon />
                    <span>{tab.label}</span>
                  </button>
                ))}
              </nav>
            </>
          )}
        </main>
      )}
      <StudioDialog
        open={dialog === "more"}
        title="Song menu"
        onClose={() => setDialog(null)}
      >
        <button
          className="menu-action"
          onClick={() => {
            setDialog(null);
            setMidiOpen(true);
          }}
        >
          <Piano />
          <span>
            Connect to Instrument<small>USB / Bluetooth MIDI on Android</small>
          </span>
          <ChevronRight />
        </button>
        <button
          className="menu-action"
          disabled={!analysis || activeDemoId === "custom"}
          onClick={toggleFavorite}
        >
          <Star fill={isFavorite ? "currentColor" : "none"} />
          <span>
            {isFavorite ? "Remove from Favorites" : "Add to Favorites"}
            <small>
              {activeDemoId === "custom"
                ? "Favorites are available for bundled demos"
                : "Bookmark this demo song"}
            </small>
          </span>
          {isFavorite && <Check />}
        </button>
        <button
          className="menu-action"
          onClick={() => {
            setDialog(null);
            setHomePage(null);
            setBottomTab("settings");
          }}
        >
          <SlidersHorizontal />
          <span>Chord Analysis &amp; Play Settings</span>
          <ChevronRight />
        </button>
        <button
          className="menu-action"
          disabled={!analysis || exportingMidi}
          onClick={handleExportMidi}
        >
          <Download />
          <span>
            {exportingMidi ? "Exporting MIDI..." : "Export MIDI"}
            <small>Chord guide and detected notes</small>
          </span>
        </button>
        <button
          className="menu-action"
          onClick={() => {
            setDialog(null);
            returnHome();
          }}
        >
          <Home />
          <span>Music library</span>
          <ChevronRight />
        </button>
      </StudioDialog>
      <StudioDialog
        open={dialog === "chord"}
        title="Chord & section"
        onClose={() => setDialog(null)}
      >
        <div className="chord-dialog-label">
          {activeChordDisplay?.primary || "--"}
          <small>
            {activeChordDisplay?.midiVoicing.all
              .map((m) => midiToNoteName(m, useFlats))
              .join(" · ")}
          </small>
        </div>
        <p className="instrument-caption">
          Estimated chord · confidence{" "}
          {Math.round((activeChord?.confidence || 0) * 100)}%. Group{" "}
          {selectedBar + 1}. Choose a section color for your own rehearsal plan.
        </p>
        <div className="section-choices">
          {["A", "B", "C", "D"].map((section) => (
            <button
              key={section}
              className={"section-" + section}
              aria-pressed={sections[selectedBar] === section}
              onClick={() =>
                setSections((prev) => ({ ...prev, [selectedBar]: section }))
              }
            >
              {section}
            </button>
          ))}
        </div>
        <div className="settings-actions">
          <button
            className="text-button"
            onClick={() =>
              setSections((prev) => {
                const next = { ...prev };
                delete next[selectedBar];
                return next;
              })
            }
          >
            Clear section
          </button>
          <button
            className="amber-button"
            disabled={!activeChord}
            onClick={() => {
              if (activeChord) {
                const n = getActiveChordMidiNotes(
                  activeChord,
                  voicingMode,
                  transpose,
                );
                pianoSynth.auditionChord(n.lh, n.rh, 1.4);
              }
            }}
          >
            Hear chord
          </button>
        </div>
        <p className="instrument-caption">
          Section colors last for this song session. They are not automatically
          detected song sections.
        </p>
      </StudioDialog>
      <LiveMicModal
        isOpen={micOpen}
        onClose={() => setMicOpen(false)}
        onLiveNotesUpdate={setLiveMicMidi}
        onRecordedClipReady={(blob, filename) =>
          handleAnalyzeAudioBlob(blob, filename)
        }
      />
      <MidiPanel
        isOpen={midiOpen}
        onClose={() => setMidiOpen(false)}
        onLiveNotes={setLiveMicMidi}
      />
    </div>
  );
};
export default App;
