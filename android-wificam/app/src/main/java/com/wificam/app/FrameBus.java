package com.wificam.app;

/**
 * Latest-JPEG frame bus between the camera thread and the HTTP stream
 * handlers. Only the newest frame is kept (slow clients drop frames).
 */
public final class FrameBus {

    private static final Object LOCK = new Object();
    private static byte[] latest;
    private static long latestSeq;
    private static long seq;

    private FrameBus() {
    }

    public static void put(byte[] jpeg) {
        synchronized (LOCK) {
            latest = jpeg;
            seq++;
            latestSeq = seq;
            LOCK.notifyAll();
        }
    }

    public static void clear() {
        synchronized (LOCK) {
            latest = null;
            seq++;
            latestSeq = seq;
            LOCK.notifyAll();
        }
    }

    /** Wait up to timeoutMs for a frame newer than lastSeenSeq; returns null on timeout. */
    public static byte[] awaitFrame(long lastSeenSeq, long timeoutMs) {
        long deadline = System.currentTimeMillis() + timeoutMs;
        synchronized (LOCK) {
            while (latestSeq <= lastSeenSeq) {
                long wait = deadline - System.currentTimeMillis();
                if (wait <= 0) return null;
                try {
                    LOCK.wait(wait);
                } catch (InterruptedException e) {
                    return null;
                }
            }
            return latest;
        }
    }

    public static long currentSeq() {
        synchronized (LOCK) {
            return latestSeq;
        }
    }
}
