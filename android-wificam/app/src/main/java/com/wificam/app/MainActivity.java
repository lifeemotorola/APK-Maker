package com.wificam.app;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * WiFi Cam — Android shell.
 *
 * Starts a LAN HTTP server ({@link LanServer} on 0.0.0.0:8080) that serves the
 * control page (assets/www) on loopback and streams the phone camera as MJPEG
 * at /stream for any device on the same WiFi. The page drives the camera via
 * the {@link NativeBridge} (window.WifiCam); CAMERA (and POST_NOTIFICATIONS on
 * API 33+) are requested at runtime.
 */
public class MainActivity extends Activity {

    public static final String TAG = "WiFiCam";

    private static final int REQUEST_CAM_PERMS = 3001;

    private WebView webView;
    private LanServer server;
    private NativeBridge bridge;

    public void pushJs(final String js) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView != null) webView.evaluateJavascript(js, null);
            }
        });
    }

    public void requestCameraPermission() {
        List<String> perms = new ArrayList<String>();
        perms.add(Manifest.permission.CAMERA);
        if (Build.VERSION.SDK_INT >= 33) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        requestPermissions(perms.toArray(new String[0]), REQUEST_CAM_PERMS);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        server = new LanServer(this);
        try {
            server.start();
            Log.d(TAG, "LAN server on 0.0.0.0:" + LanServer.PORT + " ip=" + LanServer.lanIp());
        } catch (IOException e) {
            Log.e(TAG, "LAN server failed to start", e);
        }

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);

        bridge = new NativeBridge(this);
        webView.addJavascriptInterface(bridge, "WifiCam");

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                Log.d(TAG, "JS[" + consoleMessage.sourceId() + ":" + consoleMessage.lineNumber() + "] "
                        + consoleMessage.message());
                return true;
            }
        });

        webView.loadUrl("http://127.0.0.1:" + LanServer.PORT + "/");

        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestCameraPermission();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQUEST_CAM_PERMS) {
            for (int r : grantResults) {
                if (r != PackageManager.PERMISSION_GRANTED) {
                    pushJs("if(window.WifiCamEvents){window.WifiCamEvents.onError('camera permission denied')}");
                    return;
                }
            }
            if (bridge != null) bridge.onCameraPermissionGranted();
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    @Override
    protected void onDestroy() {
        if (CameraHolder.controller != null) {
            CameraHolder.controller.stop();
            CameraHolder.controller = null;
        }
        if (server != null) {
            server.stop();
            server = null;
        }
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
