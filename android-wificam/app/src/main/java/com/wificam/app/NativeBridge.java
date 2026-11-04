package com.wificam.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.JavascriptInterface;

/**
 * JS <-> native bridge for WiFi Cam (exposed as window.WifiCam).
 */
public class NativeBridge {

    private final MainActivity activity;

    // pending camera start after the runtime CAMERA permission grant
    private String pendingWhich;
    private int pendingW, pendingH, pendingFps;

    public NativeBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String platform() {
        return "android";
    }

    @JavascriptInterface
    public String appVersion() {
        return "1.0";
    }

    @JavascriptInterface
    public void log(String msg) {
        android.util.Log.d(MainActivity.TAG, "page: " + msg);
    }

    /** LAN URL of the MJPEG stream, e.g. http://192.168.1.50:8080/stream */
    @JavascriptInterface
    public String getStreamUrl() {
        return "http://" + LanServer.lanIp() + ":" + LanServer.PORT + "/stream";
    }

    @JavascriptInterface
    public String getLanIp() {
        return LanServer.lanIp();
    }

    @JavascriptInterface
    public boolean isStreaming() {
        return CameraHolder.controller != null && CameraHolder.controller.isRunning();
    }

    @JavascriptInterface
    public String startCamera(String which, int w, int h, int fps) {
        if (activity.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            pendingWhich = which;
            pendingW = w;
            pendingH = h;
            pendingFps = fps;
            activity.requestCameraPermission();
            return "pending-permission";
        }
        return startCameraInternal(which, w, h, fps);
    }

    public String startCameraInternal(String which, int w, int h, int fps) {
        try {
            Intent svc = new Intent(activity, CameraService.class);
            if (Build.VERSION.SDK_INT >= 26) {
                activity.startForegroundService(svc);
            } else {
                activity.startService(svc);
            }
        } catch (Exception e) {
            android.util.Log.e(MainActivity.TAG, "foreground service failed", e);
        }
        if (CameraHolder.controller == null) {
            CameraHolder.controller = new CameraController(activity, new CameraController.StateListener() {
                @Override
                public void onError(String message) {
                    activity.pushJs("if(window.WifiCamEvents){window.WifiCamEvents.onError("
                            + org.json.JSONObject.quote(message) + ")}");
                }
            });
        }
        boolean ok = CameraHolder.controller.start(which, w, h, fps);
        return ok ? "started" : "error";
    }

    /** Called by MainActivity after the CAMERA permission is granted. */
    public void onCameraPermissionGranted() {
        if (pendingWhich != null) {
            String w = pendingWhich;
            int pw = pendingW, ph = pendingH, pf = pendingFps;
            pendingWhich = null;
            startCameraInternal(w, pw, ph, pf);
        }
    }

    @JavascriptInterface
    public void stopCamera() {
        if (CameraHolder.controller != null) {
            CameraHolder.controller.stop();
        }
        try {
            activity.stopService(new Intent(activity, CameraService.class));
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public void setTorch(boolean on) {
        if (CameraHolder.controller != null) CameraHolder.controller.setTorch(on);
    }
}
