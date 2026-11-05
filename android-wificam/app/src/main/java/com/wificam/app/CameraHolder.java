package com.wificam.app;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;
import android.view.Surface;

/**
 * Shared camera controller between the activity (native preview), the LAN
 * server (/api/* endpoints) and the foreground service.
 */
public final class CameraHolder {

    public static volatile CameraController controller;

    private CameraHolder() {
    }

    /**
     * Start the foreground service + camera (idempotent). Safe to call from
     * HTTP handler threads; {@code preview} may be null (stream-only).
     */
    public static synchronized boolean ensureStarted(Context ctx, String which, int w, int h, int fps,
                                                       Surface preview, CameraController.StateListener listener) {
        try {
            Intent svc = new Intent(ctx, CameraService.class);
            if (Build.VERSION.SDK_INT >= 26) {
                ctx.startForegroundService(svc);
            } else {
                ctx.startService(svc);
            }
        } catch (Exception e) {
            Log.e(MainActivity.TAG, "foreground service failed", e);
        }
        if (controller == null) {
            final CameraController.StateListener l;
            if (listener != null) {
                l = listener;
            } else {
                l = new CameraController.StateListener() {
                    @Override
                    public void onError(String message) {
                        Log.e(MainActivity.TAG, "camera error: " + message);
                    }
                };
            }
            controller = new CameraController(ctx, l);
        }
        return controller.start(which, w, h, fps, preview);
    }

    /** Stop the camera and the foreground service. */
    public static synchronized void stopAll(Context ctx) {
        if (controller != null) {
            controller.stop();
        }
        try {
            ctx.stopService(new Intent(ctx, CameraService.class));
        } catch (Exception ignored) {
        }
    }
}
