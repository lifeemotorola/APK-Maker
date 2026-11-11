package com.choirtune.app;

import android.app.ActivityManager;
import android.content.Context;
import android.util.Base64;
import android.util.Log;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import org.json.JSONObject;

/** One bounded, app-private offline job. No audio/model network requests. */
public final class DemucsController {
    private static final int MAX_BYTES = 44100 * 30 * 4;
    private static final long MODEL_BYTES = 83994361L;
    private static final String MODEL_SHA = "72b17c42d308982ddb5069bc3bf48b81a5aac4cb6516e4366c0fa7cef6df0064";
    // Native progress/cancellation flags are process-wide: serialize across activities.
    private static final Object ENGINE_LOCK = new Object();
    private static final boolean LOADED;
    static {
        boolean ok = false;
        try { System.loadLibrary("choirdemucs"); ok = true; }
        catch (LinkageError error) { Log.w(MainActivity.TAG, "Native Demucs unavailable", error); }
        LOADED = ok;
    }
    private static native void reset();
    private static native void cancelNative();
    private static native float progressNative();
    private static native String runNative(String model, String pcm, String wav);
    private final Context context;
    private final File directory, input, output;
    private String phase = "idle", error = "";
    private int expected, written;
    private FileOutputStream upload;
    private volatile boolean cancelled, destroyed;
    private boolean running;

    public DemucsController(Context context) {
        this.context = context.getApplicationContext();
        directory = new File(context.getCacheDir(), "demucs-" + java.util.UUID.randomUUID().toString());
        directory.mkdirs();
        input = new File(directory, "input.pcm");
        output = new File(directory, "vocals.wav");
    }
    public boolean available() { return LOADED; }
    public synchronized String begin(int bytes) {
        if (!LOADED) return "On-device Demucs requires a supported 64-bit ARM phone";
        if (destroyed || running) return "Demucs is still processing or cancelling; please wait";
        cleanup();
        if (bytes < 44100 || bytes > MAX_BYTES || bytes % 4 != 0) return "Choose a clip between 0.25 and 30 seconds";
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        ((ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(memory);
        if (memory.lowMemory || memory.totalMem < 3500L * 1024 * 1024 || memory.availMem < 2500L * 1024 * 1024)
            return "Demucs needs at least 2.5 GB currently available RAM (6 GB phones recommended). Close other apps or use ordinary estimates.";
        if (directory.getUsableSpace() < MODEL_BYTES + MAX_BYTES * 2L + 20 * 1024 * 1024)
            return "Free at least 120 MB of internal storage before processing";
        try {
            upload = new FileOutputStream(input);
            expected = bytes; written = 0; cancelled = false; error = ""; phase = "receiving";
            return "";
        } catch (IOException e) { return "Could not prepare private audio storage"; }
    }
    public synchronized String append(String chunk) {
        if (destroyed || upload == null || !"receiving".equals(phase)) return "No active PCM transfer";
        try {
            if (chunk == null || chunk.length() > 65536) throw new IOException("Audio chunk too large");
            byte[] data = Base64.decode(chunk, Base64.NO_WRAP);
            if (data.length == 0 || written + data.length > expected) throw new IOException("Invalid audio size");
            upload.write(data); written += data.length;
            return "";
        } catch (Exception e) { fail("PCM transfer failed"); return error; }
    }
    public synchronized String start() {
        if (destroyed || upload == null || written != expected) return "Incomplete audio transfer";
        try { upload.close(); upload = null; }
        catch (IOException e) { fail("Could not finish PCM transfer"); return error; }
        phase = "loading"; running = true;
        new Thread(new Runnable() { public void run() { process(); } }, "choir-demucs").start();
        return "";
    }
    private void process() {
        String failure = null;
        synchronized (ENGINE_LOCK) {
            try {
                if (cancelled || destroyed) throw new IOException("Processing cancelled");
                reset();
                File model = prepareModel();
                synchronized (this) {
                    if (cancelled || destroyed) throw new IOException("Processing cancelled");
                    phase = "processing";
                }
                failure = runNative(model.getAbsolutePath(), input.getAbsolutePath(), output.getAbsolutePath());
                if (failure == null) failure = "Native inference did not return a result";
            } catch (OutOfMemoryError e) { failure = "Not enough memory for Demucs. Close other apps and try again."; }
            catch (Exception e) { failure = e.getMessage() == null ? "Demucs processing failed" : e.getMessage(); }
            synchronized (this) {
                running = false;
                input.delete();
                if (cancelled || destroyed) { phase = "cancelled"; output.delete(); }
                else if (failure != null && failure.length() > 0) fail(failure);
                else phase = "done";
                if (destroyed) { cleanup(); directory.delete(); }
            }
        }
    }
    private File prepareModel() throws Exception {
        File model = new File(context.getFilesDir(), "ggml-model-htdemucs-4s-f16.bin");
        if (model.length() == MODEL_BYTES && MODEL_SHA.equals(sha(model))) return model;
        model.delete();
        File temp = new File(context.getFilesDir(), "demucs-model.partial");
        try (InputStream in = context.getAssets().open("demucs/ggml-model-htdemucs-4s-f16.bin");
             FileOutputStream out = new FileOutputStream(temp)) {
            byte[] buffer = new byte[65536];
            int n;
            while ((n = in.read(buffer)) != -1) {
                if (cancelled || destroyed) throw new IOException("Processing cancelled");
                out.write(buffer, 0, n);
            }
        } catch (Exception e) { temp.delete(); throw e; }
        if (temp.length() != MODEL_BYTES || !MODEL_SHA.equals(sha(temp))) {
            temp.delete(); throw new IOException("Bundled model checksum mismatch. Reinstall the APK.");
        }
        if (!temp.renameTo(model)) { temp.delete(); throw new IOException("Cannot install embedded model"); }
        return model;
    }
    private String sha(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[65536]; int n;
            while ((n = in.read(buffer)) != -1) {
                if (cancelled || destroyed) throw new IOException("Processing cancelled");
                digest.update(buffer, 0, n);
            }
        }
        StringBuilder result = new StringBuilder();
        for (byte b : digest.digest()) result.append(String.format(java.util.Locale.US, "%02x", b & 255));
        return result.toString();
    }
    public synchronized String status() {
        try {
            JSONObject json = new JSONObject();
            json.put("phase", phase); json.put("error", error);
            json.put("progress", "processing".equals(phase) ? progressNative() : "done".equals(phase) ? 1 : 0);
            return json.toString();
        } catch (Exception e) { return "{\"phase\":\"error\",\"error\":\"Status unavailable\"}"; }
    }
    public synchronized InputStream vocals() throws IOException {
        if (!"done".equals(phase) || destroyed) throw new IOException("No vocal output ready");
        return new FileInputStream(output);
    }
    public synchronized void cancel() {
        cancelled = true;
        // Do not cancel another activity's native job while this worker is waiting.
        if (LOADED && "processing".equals(phase)) cancelNative();
        if (!running) { cleanup(); phase = "cancelled"; }
    }
    public synchronized void destroy() { destroyed = true; cancel(); if (!running) directory.delete(); }
    private void fail(String message) { error = message; phase = "error"; cleanup(); }
    private void cleanup() {
        if (upload != null) { try { upload.close(); } catch (IOException ignored) { } upload = null; }
        input.delete(); output.delete();
    }
}
