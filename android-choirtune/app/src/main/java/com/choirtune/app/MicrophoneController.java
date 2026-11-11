package com.choirtune.app;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Base64;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** Foreground-only mono PCM capture. Each 4096-sample frame overlaps the last;
 * a new frame is sent every sampleRate/25 samples, not every full buffer.
 * One serial worker owns/release AudioRecord; generation guards drop stale
 * queued frames after stop, permission cancellation, backgrounding or restart. */
public final class MicrophoneController {
    private final MainActivity activity;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile int generation = 0;
    private volatile AudioRecord recorder;
    private volatile boolean destroyed = false;

    public MicrophoneController(MainActivity activity) { this.activity = activity; }
    public synchronized void stop() {
        generation++;
        AudioRecord active = recorder;
        if (active != null) {
            try { active.stop(); } catch (Exception ignored) { }
        }
    }
    private void send(final int token, final String js) {
        activity.runOnUiThread(new Runnable() { public void run() {
            if (!destroyed && generation == token) activity.pushJs(js);
        }});
    }
    public synchronized void start() {
        if (destroyed) return;
        stop();
        final int token = generation;
        worker.execute(new Runnable() { public void run() { capture(token); }});
    }
    private void capture(int token) {
        AudioRecord audio = null;
        try {
            if (destroyed || token != generation) return;
            int rate = 44100;
            int minimum = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (minimum <= 0) {
                rate = 48000;
                minimum = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            }
            if (minimum <= 0) throw new IllegalStateException("No supported microphone sample rate");
            audio = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum * 2, 32768));
            if (audio.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("Microphone initialization failed");
            synchronized (this) {
                if (destroyed || token != generation) return;
                recorder = audio;
                audio.startRecording();
            }
            if (audio.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new IllegalStateException("Microphone did not start recording");
            rate = audio.getSampleRate();
            send(token, "window.ChoirTunerNative&&window.ChoirTunerNative.onReady(" + rate + ")");
            short[] hop = new short[rate / 25];
            short[] window = new short[4096];
            int filled = 0, sinceFrame = 0;
            while (!destroyed && generation == token) {
                int count = audio.read(hop, 0, hop.length);
                if (count <= 0) throw new IllegalStateException("Microphone read failed: " + count);
                int keep = window.length - count;
                System.arraycopy(window, count, window, 0, keep);
                System.arraycopy(hop, 0, window, keep, count);
                filled += count; sinceFrame += count;
                if (filled < window.length || sinceFrame < hop.length) continue;
                sinceFrame = 0;
                byte[] bytes = new byte[window.length * 2];
                for (int i = 0; i < window.length; i++) {
                    bytes[i * 2] = (byte) window[i]; bytes[i * 2 + 1] = (byte) (window[i] >> 8);
                }
                String payload = Base64.encodeToString(bytes, Base64.NO_WRAP);
                send(token, "window.ChoirTunerNative&&window.ChoirTunerNative.onFrame("
                    + JSONObject.quote(payload) + "," + rate + ")");
            }
        } catch (Exception error) {
            send(token, "window.ChoirTunerNative&&window.ChoirTunerNative.onError("
                + JSONObject.quote(error.getMessage() == null ? "Capture failed" : error.getMessage()) + ")");
        } finally {
            if (audio != null) {
                try { audio.stop(); } catch (Exception ignored) { }
                audio.release();
            }
            if (recorder == audio) recorder = null;
        }
    }
    public synchronized void destroy() { destroyed = true; stop(); worker.shutdownNow(); }
}
