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
      log(msg: string): void;
    };
    KeySenseMidi?: Record<string, (...args: any[]) => void>;
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

export function nativeLog(msg: string): void {
  if (isAndroidNative()) window.KeySenseNative!.log(msg);
}
