import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bluetooth,
  Cable,
  Download,
  Music2,
  Plug,
  PlugZap,
  Radio,
  RefreshCw,
  Square,
  Usb,
  X,
} from 'lucide-react';
import {
  NativeMidiDevice,
  bluetoothSupported,
  connectMidiDevice,
  disconnectMidiDevice,
  isAndroidNative,
  listMidiDevices,
  subscribeNativeMidi,
} from '../lib/nativeBridge';
import { buildLivePerformanceMidi, downloadBytes, LiveMidiRecordedEvent } from '../lib/midiExport';
import { classifyLiveChroma, midiToNoteName, mod12 } from '../lib/musicTheory';

interface MidiPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Live active MIDI notes forwarded to the studio piano highlight. */
  onLiveNotes: (midis: number[]) => void;
}

export const MidiPanel: React.FC<MidiPanelProps> = ({ isOpen, onClose, onLiveNotes }) => {
  const [devices, setDevices] = useState<NativeMidiDevice[]>([]);
  const [connectedName, setConnectedName] = useState<string>('');
  const [activeNotes, setActiveNotes] = useState<Map<number, number>>(new Map());
  const [sustain, setSustain] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const activeNotesRef = useRef<Map<number, number>>(new Map());
  const recordedRef = useRef<LiveMidiRecordedEvent[]>([]);
  const recStartRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);

  const refresh = useCallback(() => {
    setDevices(listMidiDevices());
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    const unsub = subscribeNativeMidi((ev) => {
      switch (ev.type) {
        case 'devices':
          setDevices(ev.devices);
          break;
        case 'deviceConnected':
          setConnectedName(ev.device);
          setStatusMsg(`Connected to ${ev.device}`);
          break;
        case 'deviceDisconnected':
          setConnectedName('');
          setStatusMsg('MIDI device disconnected');
          break;
        case 'noteOn': {
          const next = new Map(activeNotesRef.current);
          next.set(ev.note, ev.vel);
          activeNotesRef.current = next;
          setActiveNotes(next);
          onLiveNotes([...next.keys()].sort((a, b) => a - b));
          if (recording && recStartRef.current) {
            recordedRef.current.push({
              tSec: (performance.now() - recStartRef.current) / 1000,
              on: true,
              note: ev.note,
              vel: ev.vel,
            });
          }
          break;
        }
        case 'noteOff': {
          const next = new Map(activeNotesRef.current);
          next.delete(ev.note);
          activeNotesRef.current = next;
          setActiveNotes(next);
          onLiveNotes([...next.keys()].sort((a, b) => a - b));
          if (recording && recStartRef.current) {
            recordedRef.current.push({
              tSec: (performance.now() - recStartRef.current) / 1000,
              on: false,
              note: ev.note,
              vel: 0,
            });
          }
          break;
        }
        case 'cc':
          if (ev.cc === 64) setSustain(ev.value >= 64);
          break;
        default:
          break;
      }
    });
    return () => {
      unsub();
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, recording, onLiveNotes]);

  // Live chord classification from the currently held MIDI notes (12-bin chroma)
  const liveChord = useMemo(() => {
    const chroma = new Array<number>(12).fill(0);
    let any = false;
    activeNotes.forEach((vel, note) => {
      chroma[mod12(note)] += (vel || 100) / 127;
      any = true;
    });
    if (!any) return null;
    return classifyLiveChroma(chroma, false);
  }, [activeNotes]);

  const noteNames = useMemo(
    () => [...activeNotes.keys()].sort((a, b) => a - b).map((m) => midiToNoteName(m, false)),
    [activeNotes]
  );

  const handleConnect = (dev: NativeMidiDevice) => {
    setStatusMsg(null);
    const ok = connectMidiDevice(dev.index);
    if (!ok) setStatusMsg('Could not open this MIDI device.');
  };

  const handleDisconnect = () => {
    disconnectMidiDevice();
    setActiveNotes(new Map());
    activeNotesRef.current = new Map();
    onLiveNotes([]);
  };

  const toggleRecording = () => {
    if (recording) {
      setRecording(false);
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      const events = recordedRef.current;
      if (events.length > 0) {
        const bytes = buildLivePerformanceMidi(events, 120);
        const fname = `KeySense_LiveMIDI_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.mid`;
        const path = downloadBytes(fname, bytes, 'audio/midi');
        setStatusMsg(
          path
            ? `Exported ${events.length} MIDI events -> ${path}`
            : `Exported ${events.length} MIDI events -> ${fname}`
        );
      }
      recordedRef.current = [];
      setRecordSec(0);
    } else {
      recordedRef.current = [];
      recStartRef.current = performance.now();
      setRecording(true);
      setRecordSec(0);
      timerRef.current = window.setInterval(() => setRecordSec((s) => s + 1), 1000);
    }
  };

  if (!isOpen) return null;

  const native = isAndroidNative();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-[#0D1322] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-[#090E1A]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-300">
              <Bluetooth className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">MIDI &amp; Bluetooth Input</h2>
              <p className="text-xs text-slate-400">
                {native
                  ? 'USB MIDI keyboards & BLE Bluetooth MIDI controllers'
                  : 'Available in the Android APK build (window.KeySenseNative not present in this browser)'}
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
          {!native && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-200">
              You are running the web build. MIDI / Bluetooth device input is enabled in the{' '}
              <span className="font-semibold">KeySense Studio Android APK</span>, which bridges
              Android&apos;s <span className="font-mono">android.media.midi.MidiManager</span> (USB +
              BLE Bluetooth MIDI) into this UI.
            </div>
          )}

          {statusMsg && (
            <div className="rounded-xl bg-sky-500/10 border border-sky-500/30 p-3 text-xs text-sky-200">
              {statusMsg}
            </div>
          )}

          {/* Device list */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                MIDI Devices {native && bluetoothSupported() ? '(USB + Bluetooth LE)' : ''}
              </span>
              <button
                onClick={refresh}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                Scan
              </button>
            </div>

            {devices.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-xs text-slate-500">
                {native
                  ? 'No MIDI devices found. Pair a Bluetooth MIDI controller (BLE) or plug in a USB MIDI keyboard, then tap Scan.'
                  : 'No native MIDI bridge in this browser build.'}
              </div>
            )}

            <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
              {devices.map((d) => (
                <div
                  key={d.index}
                  className="flex items-center justify-between gap-2 rounded-xl bg-[#080C15] border border-slate-800 px-3 py-2.5"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {d.bluetooth ? (
                      <Bluetooth className="w-4 h-4 text-indigo-400 shrink-0" />
                    ) : d.type === 'usb' ? (
                      <Usb className="w-4 h-4 text-sky-400 shrink-0" />
                    ) : (
                      <Cable className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-100 truncate">{d.name}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {d.bluetooth ? 'Bluetooth LE MIDI' : d.type.toUpperCase()} · in:{d.inputPorts} out:
                        {d.outputPorts}
                      </div>
                    </div>
                  </div>
                  {connectedName ? (
                    <button
                      onClick={handleDisconnect}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/35 text-xs font-medium cursor-pointer shrink-0"
                    >
                      <PlugZap className="w-3.5 h-3.5" />
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnect(d)}
                      disabled={!d.hasInput}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer shrink-0"
                    >
                      <Plug className="w-3.5 h-3.5" />
                      Connect
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Live readout */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-[#080C15] border border-slate-800 p-4 text-center">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 flex items-center justify-center gap-1.5">
                <Radio className={`w-3 h-3 ${connectedName ? 'text-emerald-400 animate-pulse' : 'text-slate-600'}`} />
                Live Chord
              </div>
              <div className="text-3xl font-extrabold text-indigo-400 mt-1 font-mono">
                {liveChord ? liveChord.symbol : '—'}
              </div>
              <div className="text-xs text-slate-400 mt-1 font-mono">
                {liveChord ? liveChord.notes.join(' · ') : connectedName ? 'Play a chord...' : 'Connect a device'}
              </div>
            </div>

            <div className="rounded-xl bg-[#080C15] border border-slate-800 p-4 text-center">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Held Keys</div>
              <div className="flex flex-wrap items-center justify-center gap-1.5 mt-2 min-h-[36px]">
                {noteNames.length > 0 ? (
                  noteNames.map((kn) => (
                    <span
                      key={kn}
                      className="px-2 py-1 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 text-xs font-mono font-bold"
                    >
                      {kn}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-slate-500">—</span>
                )}
              </div>
              <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                <span
                  className={`w-2 h-2 rounded-full ${sustain ? 'bg-amber-400' : 'bg-slate-700'}`}
                />
                Sustain pedal {sustain ? 'ON' : 'off'}
              </div>
            </div>
          </div>

          {/* Record live performance -> .mid */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <Music2 className="w-3.5 h-3.5 text-indigo-400" />
              Incoming notes play through the studio synth &amp; light up the piano.
            </div>
            <button
              onClick={toggleRecording}
              disabled={!connectedName}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer disabled:opacity-40 ${
                recording
                  ? 'bg-rose-500 hover:bg-rose-400 text-white animate-pulse'
                  : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
              }`}
            >
              {recording ? (
                <>
                  <Square className="w-3.5 h-3.5 fill-current" />
                  Stop &amp; Export .mid ({recordSec}s)
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  Record &amp; Export MIDI
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
