package com.wificam.app;

/**
 * Latest-frame bus between the camera thread and the MJPEG streamers.
 * Also keeps stream statistics (frame count, bytes, uptime, measured fps)
 * that /status reports to the computer driver.
 */
public final class FrameBus {

    private static byte[] latest;
    private static long seq;
    private static long frameCount;
    private static long byteCount;
    private static long startedAt = System.currentTimeMillis();

    private FrameBus() {
    }

    public static synchronized void put(byte[] jpeg) {
        latest = jpeg;
        seq++;
        frameCount++;
        byteCount += jpeg.length;
        FrameBus.class.notifyAll();
    }

    public static synchronized void clear() {
        latest = null;
        seq++;
        frameCount = 0;
        byteCount = 0;
        startedAt = System.currentTimeMillis();
        FrameBus.class.notifyAll();
    }

    /** Wait for a frame newer than {@code lastSeq}; returns null on timeout. */
    public static synchronized byte[] awaitFrame(long lastSeq, long timeoutMs) {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (seq <= lastSeq) {
            long left = deadline - System.currentTimeMillis();
            if (left <= 0) return null;
            try {
                FrameBus.class.wait(left);
            } catch (InterruptedException e) {
                return null;
            }
        }
        return latest;
    }

    public static synchronized byte[] latest() {
        return latest;
    }

    public static synchronized long currentSeq() {
        return seq;
    }

    public static synchronized long frameCount() {
        return frameCount;
    }

    public static synchronized long byteCount() {
        return byteCount;
    }

    public static synchronized long uptimeMs() {
        return System.currentTimeMillis() - startedAt;
    }

    /** Measured frame rate over the whole run (0 when no frames yet). */
    public static synchronized double fps() {
        long up = uptimeMs();
        if (up <= 0) return 0;
        return frameCount * 1000.0 / up;
    }
}
