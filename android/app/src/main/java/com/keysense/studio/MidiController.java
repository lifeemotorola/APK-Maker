package com.keysense.studio;

import android.content.Context;
import android.media.midi.MidiDevice;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiManager;
import android.media.midi.MidiOutputPort;
import android.media.midi.MidiReceiver;
import android.os.Bundle;
import android.os.Handler;
import android.util.Log;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * USB MIDI + Bluetooth (BLE) MIDI input via android.media.midi.MidiManager.
 *
 * MidiManager automatically enumerates:
 *   - USB MIDI devices (USB host mode), and
 *   - Bluetooth LE MIDI devices (once BLUETOOTH_SCAN/CONNECT or legacy
 *     BLUETOOTH + location permissions are granted).
 *
 * To RECEIVE MIDI from a device we open the device's OUTPUT port
 * (MidiDevice.openOutputPort) and connect a MidiReceiver to it
 * (MidiSender.connect). Raw MIDI bytes are parsed (running status, sysex,
 * system real-time) and forwarded to the WebView page as
 * window.KeySenseMidi.* calls.
 */
public class MidiController {

    private final Context context;
    private final WebView webView;
    private final Handler handler;

    private MidiManager midiManager;
    private MidiManager.DeviceCallback deviceCallback;
    private MidiDevice openDevice;
    private MidiOutputPort outputPort; // device's OUTPUT port = data flowing FROM the device to us
    private String connectedName = "";

    public MidiController(Context context, WebView webView, Handler handler) {
        this.context = context;
        this.webView = webView;
        this.handler = handler;
    }

    public void start() {
        try {
            midiManager = (MidiManager) context.getSystemService(Context.MIDI_SERVICE);
        } catch (Exception e) {
            Log.e(MainActivity.TAG, "MidiManager unavailable", e);
            midiManager = null;
        }
        if (midiManager == null) {
            pushDevices();
            return;
        }
        deviceCallback = new MidiManager.DeviceCallback() {
            @Override
            public void onDeviceAdded(MidiDeviceInfo device) {
                pushDevices();
            }

            @Override
            public void onDeviceRemoved(MidiDeviceInfo device) {
                pushDevices();
            }
        };
        try {
            midiManager.registerDeviceCallback(deviceCallback, handler);
        } catch (Exception e) {
            Log.e(MainActivity.TAG, "registerDeviceCallback failed", e);
        }
        pushDevices();
    }

    public void stop() {
        close();
        if (midiManager != null && deviceCallback != null) {
            try {
                midiManager.unregisterDeviceCallback(deviceCallback);
            } catch (Exception ignored) {
            }
        }
    }

    public void refreshDevices() {
        pushDevices();
    }

    public String getConnectedName() {
        return connectedName;
    }

    /** JSON array of all MIDI devices (index matches connectMidiDevice index). */
    public String listDevicesJson() {
        JSONArray arr = new JSONArray();
        if (midiManager != null) {
            try {
                MidiDeviceInfo[] infos = midiManager.getDevices();
                for (int i = 0; i < infos.length; i++) {
                    MidiDeviceInfo info = infos[i];
                    Bundle props = info.getProperties();
                    String name = props != null ? props.getString(MidiDeviceInfo.PROPERTY_NAME) : null;
                    if (name == null || name.trim().isEmpty()) {
                        name = "MIDI Device " + info.getId();
                    }
                    String manufacturer = props != null ? props.getString(MidiDeviceInfo.PROPERTY_MANUFACTURER) : null;
                    String product = props != null ? props.getString(MidiDeviceInfo.PROPERTY_PRODUCT) : null;

                    int type = info.getType();
                    String typeStr;
                    boolean bluetooth;
                    if (type == MidiDeviceInfo.TYPE_USB) {
                        typeStr = "usb";
                        bluetooth = false;
                    } else if (type == MidiDeviceInfo.TYPE_BLUETOOTH) {
                        typeStr = "bluetooth";
                        bluetooth = true;
                    } else if (type == MidiDeviceInfo.TYPE_VIRTUAL) {
                        typeStr = "virtual";
                        bluetooth = false;
                    } else {
                        typeStr = "unknown";
                        bluetooth = false;
                    }
                    if (props != null && props.getParcelable(MidiDeviceInfo.PROPERTY_BLUETOOTH_DEVICE) != null) {
                        bluetooth = true;
                        typeStr = "bluetooth";
                    }

                    JSONObject o = new JSONObject();
                    o.put("index", i);
                    o.put("id", info.getId());
                    o.put("name", (manufacturer != null && !manufacturer.isEmpty()
                            ? manufacturer + " " : "") + name
                            + (product != null && !product.isEmpty() && !product.equals(name)
                            ? " (" + product + ")" : ""));
                    o.put("type", typeStr);
                    o.put("bluetooth", bluetooth);
                    o.put("inputPorts", info.getInputPortCount());
                    o.put("outputPorts", info.getOutputPortCount());
                    // we receive from the device's OUTPUT ports
                    o.put("hasInput", info.getOutputPortCount() > 0);
                    arr.put(o);
                }
            } catch (Exception e) {
                Log.e(MainActivity.TAG, "getDevices failed", e);
            }
        }
        return arr.toString();
    }

    /** Opens the output port (data FROM the device) of the device at `index`. */
    public boolean connect(int index) {
        if (midiManager == null) return false;
        MidiDeviceInfo[] infos;
        try {
            infos = midiManager.getDevices();
        } catch (Exception e) {
            return false;
        }
        if (index < 0 || index >= infos.length) return false;
        final MidiDeviceInfo info = infos[index];
        if (info.getOutputPortCount() <= 0) return false;

        close();
        try {
            midiManager.openDevice(info, new MidiManager.OnDeviceOpenedListener() {
                @Override
                public void onDeviceOpened(MidiDevice device) {
                    if (device == null) {
                        pushDisconnected();
                        return;
                    }
                    openDevice = device;
                    // The device's OUTPUT port delivers the MIDI data played on it.
                    outputPort = device.openOutputPort(0);
                    if (outputPort == null) {
                        pushDisconnected();
                        return;
                    }
                    outputPort.connect(new MidiInputReceiver());
                    Bundle props = info.getProperties();
                    String name = props != null ? props.getString(MidiDeviceInfo.PROPERTY_NAME) : null;
                    connectedName = (name == null || name.isEmpty()) ? "MIDI Device " + info.getId() : name;
                    pushJs("window.KeySenseMidi&&window.KeySenseMidi.deviceConnected("
                            + jsString(connectedName) + ")");
                    pushDevices();
                }
            }, handler);
            return true;
        } catch (Exception e) {
            Log.e(MainActivity.TAG, "openDevice failed", e);
            return false;
        }
    }

    /** Closes the currently open MIDI device (if any). */
    public void close() {
        boolean wasConnected = openDevice != null || connectedName.length() > 0;
        try {
            if (outputPort != null) outputPort.close();
        } catch (Exception ignored) {
        }
        try {
            if (openDevice != null) openDevice.close();
        } catch (Exception ignored) {
        }
        outputPort = null;
        openDevice = null;
        connectedName = "";
        if (wasConnected) pushDisconnected();
    }

    // ------------------------------------------------------------------
    // MIDI byte-stream parsing
    // ------------------------------------------------------------------

    private class MidiInputReceiver extends MidiReceiver {
        private int runningStatus = -1;
        private final int[] data = new int[2];
        private int dataLen = 0;

        @Override
        public void onSend(byte[] msg, int offset, int count, long timestamp) {
            int i = offset;
            int end = offset + count;
            while (i < end) {
                int b = msg[i] & 0xff;
                if (b >= 0xf0) {
                    // System messages
                    if (b == 0xf0) {
                        // SysEx: skip everything up to and including 0xF7
                        i++;
                        while (i < end && (msg[i] & 0xff) != 0xf7) i++;
                        if (i < end) i++;
                    } else {
                        i++;
                        if (b == 0xfa) {
                            pushJs("window.KeySenseMidi&&window.KeySenseMidi.transport&&window.KeySenseMidi.transport('start')");
                        } else if (b == 0xfc) {
                            pushJs("window.KeySenseMidi&&window.KeySenseMidi.transport&&window.KeySenseMidi.transport('stop')");
                        }
                    }
                    runningStatus = -1;
                    dataLen = 0;
                    continue;
                }
                if (b >= 0x80) {
                    runningStatus = b;
                    dataLen = 0;
                    i++;
                    continue;
                }
                // Data byte (uses running status)
                if (runningStatus < 0x80) {
                    i++;
                    continue;
                }
                if (dataLen < 2) data[dataLen++] = b;
                i++;
                int type = runningStatus & 0xf0;
                int need = (type == 0xc0 || type == 0xd0) ? 1 : 2;
                if (dataLen >= need) {
                    handleMessage(runningStatus, data[0], need > 1 ? data[1] : 0);
                    dataLen = 0;
                }
            }
        }
    }

    private void handleMessage(int status, int d1, int d2) {
        int type = status & 0xf0;
        switch (type) {
            case 0x90: // note on (velocity 0 == note off)
                if (d2 > 0) {
                    pushJs("window.KeySenseMidi&&window.KeySenseMidi.noteOn(" + d1 + "," + d2 + ")");
                } else {
                    pushJs("window.KeySenseMidi&&window.KeySenseMidi.noteOff(" + d1 + ")");
                }
                break;
            case 0x80: // note off
                pushJs("window.KeySenseMidi&&window.KeySenseMidi.noteOff(" + d1 + ")");
                break;
            case 0xb0: // control change (64 = sustain pedal)
                pushJs("window.KeySenseMidi&&window.KeySenseMidi.cc(" + d1 + "," + d2 + ")");
                break;
            case 0xc0: // program change
                pushJs("window.KeySenseMidi&&window.KeySenseMidi.program(" + d1 + ")");
                break;
            case 0xe0: { // pitch bend (14-bit)
                int val = d1 | (d2 << 7);
                pushJs("window.KeySenseMidi&&window.KeySenseMidi.pitchBend(" + val + ")");
                break;
            }
            default:
                break; // 0xa0 poly aftertouch, 0xd0 channel pressure: ignored
        }
    }

    // ------------------------------------------------------------------
    // JS pushing helpers
    // ------------------------------------------------------------------

    private void pushJs(final String js) {
        webView.post(new Runnable() {
            @Override
            public void run() {
                webView.evaluateJavascript(js, null);
            }
        });
    }

    private void pushDevices() {
        // JSON is a valid JS expression, so it can be inlined directly
        pushJs("window.KeySenseMidi&&window.KeySenseMidi.devices(" + listDevicesJson() + ")");
    }

    private void pushDisconnected() {
        connectedName = "";
        pushJs("window.KeySenseMidi&&window.KeySenseMidi.deviceDisconnected()");
        pushDevices();
    }

    private static String jsString(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        sb.append('"');
        return sb.toString();
    }
}
