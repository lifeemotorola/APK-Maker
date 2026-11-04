/**
 * Bridge between the KeySense web UI and the native Android shell
 * (WebView + android.media.midi USB/BLE MIDI + Bluetooth).
 *
 * On desktop browsers `window.KeySenseNative` is undefined and all
 * helpers degrade gracefully (isAndroidNative() === false).
 */

export interface NativeMidiDevice {
  index: number;
  name: string;
  type: string; // 'usb' | 'bluetooth' | 'virtual' | 'unknown'
  bluetooth: boolean;
  id: number;
  inputPorts: number;
  outputPorts: number;
  hasInput: boolean;
}

export type NativeMidiEvent =
  | { type: 'noteOn'; note: number; vel: number }
  | { type: 'noteOff'; note: number }
  | { type: 'cc'; cc: number; value: number }
  | { type: 'program'; value: number }
  | { type: 'pitchBend'; value: number }
  | { type: 'deviceConnected'; device: string }
  | { type: 'deviceDisconnected' }
  | { type: 'devices'; devices: NativeMidiDevice[] };

declare global {
  interface Window {
    KeySenseNative?: {
      platform(): string;
      appVersion(): string;
      listMidiDevices(): string;
      connectMidiDevice(index: number): boolean;
      disconnectMidi(): void;
      connectedMidiDevice(): string;
      readAsset(path: string): string | null;
      saveFile(filename: string, base64Data: string, mime: string): string | null;
      bluetoothSupported(): boolean;
      requestMicPermission(): boolean;
      startNativeMic(): boolean;
      stopNativeMic(): void;
      log(msg: string): void;
    };
    KeySenseMidi?: Record<string, (...args: any[]) => void>;
    KeySenseMic?: { pushPcm(base64Pcm16: string, sampleRate: number): void };
  }
}

export function isAndroidNative(): boolean {
  return typeof window !== 'undefined' && !!window.KeySenseNative;
}

const listeners = new Set<(ev: NativeMidiEvent) => void>();
let bridgeInstalled = false;

function installBridge(): void {
  if (bridgeInstalled || typeof window === 'undefined') return;
  bridgeInstalled = true;
  const emit = (ev: NativeMidiEvent) => {
    listeners.forEach((cb) => {
      try {
        cb(ev);
      } catch {
        /* listener error must not break the bridge */
      }
    });
  };
  window.KeySenseMidi = {
    noteOn: (note: number, vel: number) => emit({ type: 'noteOn', note, vel }),
    noteOff: (note: number) => emit({ type: 'noteOff', note }),
    cc: (cc: number, value: number) => emit({ type: 'cc', cc, value }),
    program: (p: number) => emit({ type: 'program', value: p }),
    pitchBend: (v: number) => emit({ type: 'pitchBend', value: v }),
    deviceConnected: (name: string) => emit({ type: 'deviceConnected', device: name }),
    deviceDisconnected: () => emit({ type: 'deviceDisconnected' }),
    devices: (json: string) => {
      try {
        emit({ type: 'devices', devices: JSON.parse(json) });
      } catch {
        /* ignore malformed payload */
      }
    },
  };
}

export function subscribeNativeMidi(cb: (ev: NativeMidiEvent) => void): () => void {
  installBridge();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function listMidiDevices(): NativeMidiDevice[] {
  if (!isAndroidNative()) return [];
  try {
    return JSON.parse(window.KeySenseNative!.listMidiDevices() || '[]');
  } catch {
    return [];
  }
}

export function connectMidiDevice(index: number): boolean {
  if (!isAndroidNative()) return false;
  return !!window.KeySenseNative!.connectMidiDevice(index);
}

export function disconnectMidiDevice(): void {
  if (isAndroidNative()) window.KeySenseNative!.disconnectMidi();
}

export function connectedMidiDevice(): string {
  if (!isAndroidNative()) return '';
  return window.KeySenseNative!.connectedMidiDevice() || '';
}

export function readAssetText(path: string): string | null {
  if (!isAndroidNative()) return null;
  return window.KeySenseNative!.readAsset(path);
}

export function saveNativeFile(filename: string, data: Uint8Array, mime: string): string | null {
  if (!isAndroidNative()) return null;
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < data.length; i += CHUNK) {
    bin += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  return window.KeySenseNative!.saveFile(filename, btoa(bin), mime);
}

export function bluetoothSupported(): boolean {
  if (!isAndroidNative()) return false;
  return !!window.KeySenseNative!.bluetoothSupported();
}

export function requestMicPermissionNative(): boolean {
  if (!isAndroidNative()) return true; // desktop browsers ask per-site
  try {
    return !!window.KeySenseNative!.requestMicPermission();
  } catch {
    return false;
  }
}

/* ---- native mic capture (AudioRecord fallback when getUserMedia fails) ---- */
const micListeners = new Set<(pcm: Float32Array, sampleRate: number) => void>();
let micBridgeInstalled = false;

function installMicBridge(): void {
  if (micBridgeInstalled || typeof window === 'undefined') return;
  micBridgeInstalled = true;
  window.KeySenseMic = {
    pushPcm: (b64: string, sampleRate: number) => {
      try {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const int16 = new Int16Array(bytes.buffer);
        const pcm = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) pcm[i] = int16[i] / 32768;
        micListeners.forEach((cb) => {
          try { cb(pcm, sampleRate); } catch { /* listener error must not break the bridge */ }
        });
      } catch { /* ignore malformed payload */ }
    },
  };
}

export function subscribeNativeMic(cb: (pcm: Float32Array, sampleRate: number) => void): () => void {
  installMicBridge();
  micListeners.add(cb);
  return () => micListeners.delete(cb);
}

export function startNativeMic(): boolean {
  if (!isAndroidNative()) return false;
  try {
    return !!window.KeySenseNative!.startNativeMic();
  } catch {
    return false;
  }
}

export function stopNativeMic(): void {
  if (isAndroidNative()) {
    try { window.KeySenseNative!.stopNativeMic(); } catch { /* ignore */ }
  }
}

export function nativeLog(msg: string): void {
  if (isAndroidNative()) window.KeySenseNative!.log(msg);
}
