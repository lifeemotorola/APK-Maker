package com.keysense.studio;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * JavascriptInterface exposed to the WebView page as `window.KeySenseNative`.
 * Backs the web app's nativeBridge.ts: MIDI/Bluetooth device control, asset
 * reads for the offline API shim, and saving exported files to Downloads.
 */
public class NativeBridge {

    private final MainActivity activity;
    private final MidiController midi;

    public NativeBridge(MainActivity activity, MidiController midi) {
        this.activity = activity;
        this.midi = midi;
    }

    @JavascriptInterface
    public String platform() {
        return "android";
    }

    @JavascriptInterface
    public String appVersion() {
        try {
            return activity.getPackageManager()
                    .getPackageInfo(activity.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "1.0.0";
        }
    }

    // ------------------------------------------------------------------
    // MIDI / Bluetooth
    // ------------------------------------------------------------------

    @JavascriptInterface
    public String listMidiDevices() {
        return midi.listDevicesJson();
    }

    @JavascriptInterface
    public boolean connectMidiDevice(int index) {
        return midi.connect(index);
    }

    @JavascriptInterface
    public void disconnectMidi() {
        midi.close();
    }

    @JavascriptInterface
    public String connectedMidiDevice() {
        return midi.getConnectedName();
    }

    @JavascriptInterface
    public boolean bluetoothSupported() {
        PackageManager pm = activity.getPackageManager();
        return pm.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH)
                || pm.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE);
    }

    // ------------------------------------------------------------------
    // Assets (offline API shim fallback) & logging
    // ------------------------------------------------------------------

    @JavascriptInterface
    public String readAsset(String path) {
        return activity.readAssetText(path);
    }

    @JavascriptInterface
    public void log(String msg) {
        Log.d(MainActivity.TAG, "JS: " + msg);
    }

    // ------------------------------------------------------------------
    // Saving exported files (e.g. .mid) to the public Downloads folder
    // ------------------------------------------------------------------

    @JavascriptInterface
    public String saveFile(String filename, String base64Data, String mime) {
        try {
            String safeName = filename.replaceAll("[^A-Za-z0-9_.-]", "_");
            if (safeName.isEmpty()) safeName = "keysense_export.bin";
            byte[] data = Base64.decode(base64Data, Base64.DEFAULT);
            String displayMime = (mime == null || mime.isEmpty()) ? "application/octet-stream" : mime;

            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                cv.put(MediaStore.Downloads.MIME_TYPE, displayMime);
                cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/KeySense");
                cv.put(MediaStore.Downloads.IS_PENDING, 1);
                ContentResolver resolver = activity.getContentResolver();
                Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) return null;
                try (OutputStream os = resolver.openOutputStream(uri)) {
                    if (os == null) return null;
                    os.write(data);
                    os.flush();
                }
                cv.clear();
                cv.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(uri, cv, null, null);
                return "Downloads/KeySense/" + safeName;
            } else {
                //noinspection deprecation
                File dir = new File(Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_DOWNLOADS), "KeySense");
                if (!dir.exists() && !dir.mkdirs()) return null;
                File f = new File(dir, safeName);
                try (FileOutputStream fos = new FileOutputStream(f)) {
                    fos.write(data);
                    fos.flush();
                }
                MediaScannerConnection.scanFile(activity,
                        new String[]{f.getAbsolutePath()},
                        new String[]{displayMime}, null);
                return f.getAbsolutePath();
            }
        } catch (Exception e) {
            Log.e(MainActivity.TAG, "saveFile failed", e);
            return null;
        }
    }
}
