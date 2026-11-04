import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Radio, Square, Wand2, X } from 'lucide-react';
import { classifyLiveChroma, midiToNoteName } from '../lib/musicTheory';
import {
  isAndroidNative,
  requestMicPermissionNative,
  startNativeMic,
  stopNativeMic,
  subscribeNativeMic,
} from '../lib/nativeBridge';

interface LiveMicModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLiveNotesUpdate: (midis: number[]) => void;
  onRecordedClipReady: (blob: Blob, filename: string) => void;
}

export const LiveMicModal: React.FC<LiveMicModalProps> = ({
  isOpen,
  onClose,
  onLiveNotesUpdate,
  onRecordedClipReady,
}) => {
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [liveChord, setLiveChord] = useState<{
    symbol: string;
    notes: string[];
    confidence: number;
  } | null>(null);
  const [liveKeyNames, setLiveKeyNames] = useState<string[]>([]);
  const [inputLevel, setInputLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const nativeMicRef = useRef(false);
  const micUnsubRef = useRef<(() => void) | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);

  const stopMic = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    if (nativeMicRef.current) {
      stopNativeMic();
      nativeMicRef.current = false;
    }
    if (micUnsubRef.current) {
      micUnsubRef.current();
      micUnsubRef.current = null;
    }

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setListening(false);
    setRecording(false);
    setInputLevel(0);
    onLiveNotesUpdate([]);
  };

  useEffect(() => {
    if (!isOpen) {
      stopMic();
    }
    return () => stopMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const startMic = async () => {
    setErrorMsg(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone access is not available in this browser context.');
      }
      // Some Android WebViews reject the full constraint set; fall back to plain audio.
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e2) {
          // Last resort inside the APK: native AudioRecord capture pushed over
          // the bridge (fixes "Could not start audio source" / NotReadableError).
          if (isAndroidNative() && startNativeMic()) {
            nativeMicRef.current = true;
            stream = null;
          } else {
            throw e2;
          }
        }
      }
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      // make sure the context is running (WebView autoplay policies can suspend it)
      if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch { /* best effort */ }
      }

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 8192;
      analyser.smoothingTimeConstant = 0.72;
      if (stream) {
        const src = ctx.createMediaStreamSource(stream);
        src.connect(analyser);
      } else {
        // native mic: turn each pushed PCM chunk into a buffer source into the analyser
        micUnsubRef.current = subscribeNativeMic((pcm, sampleRate) => {
          const c = audioCtxRef.current;
          if (!c || c.state !== 'running') return;
          const buf = c.createBuffer(1, pcm.length, sampleRate);
          buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
          const src = c.createBufferSource();
          src.buffer = buf;
          src.connect(analyser);
          src.start();
        });
      }
      // route through a muted gain to destination so the graph is always pulled
      const mute = ctx.createGain();
      mute.gain.value = 0;
      analyser.connect(mute);
      mute.connect(ctx.destination);

      const freqData = new Float32Array(analyser.frequencyBinCount);
      const smoothChroma = new Array<number>(12).fill(0);

      setListening(true);

      const tick = () => {
        analyser.getFloatFrequencyData(freqData);
        const sr = ctx.sampleRate;
        const binHz = sr / analyser.fftSize;

        const midiEnergies: Array<{ midi: number; amp: number }> = [];
        const frameChroma = new Array<number>(12).fill(0);
        let maxAmp = 0;

        for (let m = 36; m <= 84; m++) {
          const f = 440 * Math.pow(2, (m - 69) / 12);
          const bin = Math.round(f / binHz);
          if (bin <= 1 || bin >= freqData.length - 2) continue;
          const db = Math.max(freqData[bin - 1], freqData[bin], freqData[bin + 1]);
          const lin = Math.pow(10, (db + 95) / 35);
          const val = db > -72 ? Math.max(0, lin) : 0;
          if (val > maxAmp) maxAmp = val;
          midiEnergies.push({ midi: m, amp: val });
          frameChroma[((m % 12) + 12) % 12] += val;
        }

        setInputLevel(Math.min(100, Math.round(maxAmp * 38)));

        for (let i = 0; i < 12; i++) {
          smoothChroma[i] = smoothChroma[i] * 0.65 + frameChroma[i] * 0.35;
        }

        if (maxAmp > 0.35) {
          // Overtone-aware top keys
          const sorted = [...midiEnergies]
            .filter((x) => x.amp > maxAmp * 0.42)
            .sort((a, b) => b.amp - a.amp)
            .slice(0, 5);
          const activeMidis = sorted.map((x) => x.midi).sort((a, b) => a - b);
          onLiveNotesUpdate(activeMidis);
          setLiveKeyNames(activeMidis.map((m) => midiToNoteName(m, false)));

          const detected = classifyLiveChroma(smoothChroma, false);
          if (detected) {
            setLiveChord({
              symbol: detected.symbol,
              notes: detected.notes,
              confidence: detected.confidence,
            });
          }
        } else {
          onLiveNotesUpdate([]);
          setLiveKeyNames([]);
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Could not access microphone. Please grant mic permission or upload an audio file instead.'
      );
    }
  };

  const toggleRecording = () => {
    if (!streamRef.current) return;
    if (recording && recorderRef.current) {
      recorderRef.current.stop();
      setRecording(false);
      if (timerRef.current) window.clearInterval(timerRef.current);
      return;
    }

    chunksRef.current = [];
    const rec = new MediaRecorder(streamRef.current);
    recorderRef.current = rec;
    rec.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
      stopMic();
      onClose();
      onRecordedClipReady(blob, `Live_Mic_Capture_${new Date().toISOString().slice(11, 19).replace(/:/g, '-')}.wav`);
    };
    rec.start(200);
    setRecordSec(0);
    setRecording(true);
    timerRef.current = window.setInterval(() => {
      setRecordSec((s) => s + 1);
    }, 1000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-[#0D1322] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-[#090E1A]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
              <Radio className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Live Microphone Key &amp; Chord Finder</h2>
              <p className="text-xs text-slate-400">
                Play a song nearby or play an instrument to detect chords &amp; piano keys live
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {errorMsg && (
            <div className="rounded-xl bg-rose-500/15 border border-rose-500/40 p-3 text-xs text-rose-200 space-y-2">
              <div>{errorMsg}</div>
              {isAndroidNative() && (
                <button
                  onClick={() => {
                    requestMicPermissionNative();
                    setErrorMsg(null);
                    startMic();
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/30 hover:bg-rose-500/50 text-rose-100 font-semibold cursor-pointer"
                >
                  <Mic className="w-3.5 h-3.5" />
                  Grant microphone permission &amp; retry
                </button>
              )}
            </div>
          )}

          {!listening ? (
            <div className="text-center py-6 space-y-4">
              <p className="text-sm text-slate-300 max-w-sm mx-auto">
                Start listening to see live detected piano keys on the studio keyboard, or record a clip for full timeline chord &amp; key transcription.
              </p>
              <button
                onClick={startMic}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm shadow-lg shadow-sky-500/20 transition cursor-pointer"
              >
                <Mic className="w-4 h-4" />
                Start Live Microphone
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Input Level Meter */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    Listening Live...
                  </span>
                  <span className="font-mono">{inputLevel}% Level</span>
                </div>
                <div className="h-2 rounded-full bg-slate-900 overflow-hidden border border-slate-800">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 via-sky-400 to-amber-400 transition-all duration-75"
                    style={{ width: `${inputLevel}%` }}
                  />
                </div>
              </div>

              {/* Live Chord & Piano Keys Readout */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-[#080C15] border border-slate-800 p-4 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">
                    Live Detected Chord
                  </div>
                  <div className="text-3xl font-extrabold text-sky-400 mt-1 font-mono">
                    {liveChord ? liveChord.symbol : '—'}
                  </div>
                  <div className="text-xs text-slate-400 mt-1 font-mono">
                    {liveChord ? liveChord.notes.join(' · ') : 'Waiting for harmony...'}
                  </div>
                </div>

                <div className="rounded-xl bg-[#080C15] border border-slate-800 p-4 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">
                    Active Piano Keys
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-1.5 mt-2 min-h-[36px]">
                    {liveKeyNames.length > 0 ? (
                      liveKeyNames.map((kn) => (
                        <span
                          key={kn}
                          className="px-2 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-mono font-bold"
                        >
                          {kn}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-500">Play or sing notes...</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Capture Clip for Full Timeline Analysis */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
                <button
                  onClick={stopMic}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium cursor-pointer"
                >
                  <MicOff className="w-3.5 h-3.5" />
                  Stop Mic
                </button>

                <button
                  onClick={toggleRecording}
                  disabled={!streamRef.current}
                  title={streamRef.current ? 'Record a clip and transcribe the full timeline' : 'Recording needs the WebView mic stream; live detection still works via native capture'}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer disabled:opacity-40 ${
                    recording
                      ? 'bg-rose-500 hover:bg-rose-400 text-white animate-pulse'
                      : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                  }`}
                >
                  {recording ? (
                    <>
                      <Square className="w-3.5 h-3.5 fill-current" />
                      Stop &amp; Transcribe ({recordSec}s)
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-3.5 h-3.5" />
                      Record Clip for Full Song Timeline
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
