package com.keysense.studio;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.ValueCallback;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * KeySense Studio — Android shell.
 *
 * Hosts the full KeySense web studio (bundled in assets/www) inside a WebView
 * and bridges native capabilities into it through the `KeySenseNative`
 * JavascriptInterface:
 *
 *   - USB MIDI + Bluetooth LE MIDI input via android.media.midi.MidiManager
 *     (see {@link MidiController}); events are pushed to the page as
 *     window.KeySenseMidi.noteOn/noteOff/cc/... calls.
 *   - Offline API shim: requests to https://keysense.local/api/* and
 *     /demos/* are intercepted and served from the APK assets.
 *   - Microphone permission passthrough for the Live Mic feature.
 *   - File saving (Export MIDI) into the public Downloads folder.
 */
public class MainActivity extends Activity {

    public static final String TAG = "KeySense";
    /** Fake origin used as the WebView base URL; every request is intercepted. */
    public static final String BASE_URL = "https://keysense.local/";

    private static final int REQUEST_FILE_CHOOSER = 2001;
    private ValueCallback<Uri[]> fileChooserCallback;

    private WebView webView;
    private MidiController midiController;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestRuntimePermissions();

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(webView);
        configureWebView();

        midiController = new MidiController(this, webView, mainHandler);
        midiController.start();

        webView.loadUrl(BASE_URL);
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true); // needed so JS can read the user-picked song file (content://)
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);

        webView.setWebViewClient(new AssetWebViewClient());
        webView.setWebChromeClient(new KeySenseChromeClient());
        webView.addJavascriptInterface(new NativeBridge(this, midiController), "KeySenseNative");
    }

    // ------------------------------------------------------------------
    // Runtime permissions (Bluetooth scan/connect, location for BLE on
    // API <= 30, microphone for Live Mic, storage for MIDI export on old APIs)
    // ------------------------------------------------------------------

    private void requestRuntimePermissions() {
        List<String> needed = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31) {
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.BLUETOOTH_SCAN);
            }
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.BLUETOOTH_CONNECT);
            }
        } else {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.ACCESS_FINE_LOCATION);
            }
            if (Build.VERSION.SDK_INT <= 30
                    && checkSelfPermission(Manifest.permission.BLUETOOTH) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.BLUETOOTH);
            }
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.RECORD_AUDIO);
        }
        if (!needed.isEmpty()) {
            requestPermissions(needed.toArray(new String[0]), 1001);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 1001 && midiController != null) {
            // Bluetooth permissions affect which MIDI devices are visible
            midiController.refreshDevices();
        }
    }

    // ------------------------------------------------------------------
    // Asset / API request interceptor
    // ------------------------------------------------------------------

    private static String mimeFor(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".wav")) return "audio/wav";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".mid") || p.endsWith(".midi")) return "audio/midi";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    /** Reads a bundled asset as UTF-8 text. Path must be relative & sanitized. */
    public String readAssetText(String path) {
        InputStream in = openAsset(path);
        if (in == null) return null;
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), "UTF-8");
        } catch (IOException e) {
            Log.e(TAG, "readAssetText failed: " + path, e);
            return null;
        } finally {
            try { in.close(); } catch (IOException ignored) {}
        }
    }

    /** Opens an asset after validating the path (no traversal). */
    public InputStream openAsset(String path) {
        if (path == null) return null;
        String clean = path.replace('\\', '/');
        if (clean.startsWith("/")) clean = clean.substring(1);
        if (!clean.matches("[A-Za-z0-9_./-]+") || clean.contains("..")) {
            Log.w(TAG, "blocked asset path: " + path);
            return null;
        }
        try {
            return getAssets().open(clean);
        } catch (IOException e) {
            return null;
        }
    }

    private WebResourceResponse bytesResponse(int status, String reason, String mime, byte[] data) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse(mime, "UTF-8", status, reason, headers, new ByteArrayInputStream(data));
    }

    private WebResourceResponse assetResponse(String assetPath, String mime) {
        InputStream in = openAsset(assetPath);
        if (in == null) {
            return bytesResponse(404, "Not Found", "application/json",
                    "{\"error\":\"missing asset\"}".getBytes());
        }
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Cache-Control", "public, max-age=300");
        return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, in);
    }

    /** Serves an asset honouring HTTP Range requests (needed by <audio>/<video>). */
    private WebResourceResponse rangedAssetResponse(String assetPath, String mime, WebResourceRequest request) {
        byte[] data;
        try {
            InputStream in = openAsset(assetPath);
            if (in == null) {
                return bytesResponse(404, "Not Found", "application/json",
                        "{\"error\":\"missing asset\"}".getBytes());
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            in.close();
            data = out.toByteArray();
        } catch (IOException e) {
            return bytesResponse(500, "Error", "application/json",
                    ("{\"error\":\"" + e.getMessage() + "\"}").getBytes());
        }

        Map<String, String> reqHeaders = request.getRequestHeaders();
        String range = reqHeaders != null ? reqHeaders.get("Range") : null;
        if (range != null) {
            try {
                // bytes=start-end
                String spec = range.replace("bytes=", "").trim();
                String[] parts = spec.split("-");
                int start = parts[0].isEmpty() ? 0 : Integer.parseInt(parts[0]);
                int end = (parts.length > 1 && !parts[1].isEmpty()) ? Integer.parseInt(parts[1]) : data.length - 1;
                start = Math.max(0, Math.min(start, data.length - 1));
                end = Math.max(start, Math.min(end, data.length - 1));
                int len = end - start + 1;
                byte[] chunk = new byte[len];
                System.arraycopy(data, start, chunk, 0, len);
                Map<String, String> headers = new HashMap<>();
                headers.put("Access-Control-Allow-Origin", "*");
                headers.put("Accept-Ranges", "bytes");
                headers.put("Content-Range", "bytes " + start + "-" + end + "/" + data.length);
                headers.put("Content-Length", String.valueOf(len));
                return new WebResourceResponse(mime, "UTF-8", 206, "Partial Content", headers,
                        new ByteArrayInputStream(chunk));
            } catch (Exception ignored) {
                // fall through to full response
            }
        }
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Accept-Ranges", "bytes");
        headers.put("Content-Length", String.valueOf(data.length));
        return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, new ByteArrayInputStream(data));
    }

    private class AssetWebViewClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            try {
                String url = request.getUrl().toString();
                if (!url.startsWith(BASE_URL)) return null; // let anything else through
                String path = url.substring(BASE_URL.length());

                if (path.isEmpty() || path.equals("index.html")) {
                    return assetResponse("www/index.html", "text/html");
                }
                if (path.startsWith("assets/")) {
                    return assetResponse("www/" + path, mimeFor(path));
                }
                if (path.equals("api/health")) {
                    return bytesResponse(200, "OK", "application/json",
                            "{\"status\":\"ok\",\"engine\":\"KeySense Studio Android (offline)\",\"platform\":\"android\"}"
                                    .getBytes("UTF-8"));
                }
                if (path.equals("api/demos")) {
                    String manifest = readAssetText("demos/manifest.json");
                    if (manifest == null) {
                        return bytesResponse(500, "Error", "application/json",
                                "{\"error\":\"manifest missing\"}".getBytes("UTF-8"));
                    }
                    return bytesResponse(200, "OK", "application/json",
                            ("{\"demos\":" + manifest + "}").getBytes("UTF-8"));
                }
                if (path.startsWith("api/demos/")) {
                    String id = path.substring("api/demos/".length());
                    if (!id.matches("[A-Za-z0-9_-]+")) {
                        return bytesResponse(400, "Bad Request", "application/json",
                                "{\"error\":\"bad id\"}".getBytes("UTF-8"));
                    }
                    String json = readAssetText("demos/" + id + ".json");
                    if (json == null) {
                        return bytesResponse(404, "Not Found", "application/json",
                                ("{\"error\":\"Demo '" + id + "' not found\"}").getBytes("UTF-8"));
                    }
                    return bytesResponse(200, "OK", "application/json", json.getBytes("UTF-8"));
                }
                if (path.startsWith("demos/")) {
                    String name = path.substring("demos/".length());
                    if (!name.matches("[A-Za-z0-9_.-]+")) {
                        return bytesResponse(400, "Bad Request", "application/json",
                                "{\"error\":\"bad name\"}".getBytes("UTF-8"));
                    }
                    return rangedAssetResponse("demos/" + name, mimeFor(name), request);
                }
                return bytesResponse(404, "Not Found", "application/json",
                        "{\"error\":\"not found\"}".getBytes("UTF-8"));
            } catch (Exception e) {
                Log.e(TAG, "intercept failed", e);
                return bytesResponse(500, "Error", "application/json",
                        ("{\"error\":\"" + e.getMessage() + "\"}").getBytes());
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return false;
        }
    }

    // ------------------------------------------------------------------
    // WebChromeClient: pass RECORD_AUDIO through to getUserMedia (Live Mic)
    // ------------------------------------------------------------------

    private class KeySenseChromeClient extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            List<String> granted = new ArrayList<>();
            for (String res : request.getResources()) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        granted.add(res);
                    }
                } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) {
                    // camera not used by KeySense
                } else {
                    granted.add(res);
                }
            }
            if (!granted.isEmpty()) {
                request.grant(granted.toArray(new String[0]));
            } else {
                request.deny();
            }
        }

        // File picker for <input type="file"> (song upload) — without this the
        // system never calls back and the upload button appears dead.
        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback,
                                         WebChromeClient.FileChooserParams fileChooserParams) {
            if (fileChooserCallback != null) {
                fileChooserCallback.onReceiveValue(null);
            }
            fileChooserCallback = filePathCallback;
            try {
                Intent intent = fileChooserParams.createIntent();
                startActivityForResult(intent, REQUEST_FILE_CHOOSER);
            } catch (Exception e) {
                Log.e(TAG, "file chooser failed", e);
                fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = null;
            }
            return true;
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
            Log.d(TAG, "JS[" + consoleMessage.sourceId() + ":" + consoleMessage.lineNumber() + "] "
                    + consoleMessage.message());
            return true;
        }
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE_CHOOSER) {
            ValueCallback<Uri[]> cb = fileChooserCallback;
            fileChooserCallback = null;
            if (cb == null) return;
            if (resultCode != RESULT_OK || data == null) {
                cb.onReceiveValue(null);
                return;
            }
            if (data.getClipData() != null && data.getClipData().getItemCount() > 0) {
                int n = data.getClipData().getItemCount();
                Uri[] uris = new Uri[n];
                for (int i = 0; i < n; i++) uris[i] = data.getClipData().getItemAt(i).getUri();
                cb.onReceiveValue(uris);
            } else if (data.getData() != null) {
                cb.onReceiveValue(new Uri[]{data.getData()});
            } else {
                cb.onReceiveValue(null);
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (midiController != null) midiController.stop();
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /** Evaluate JS on the UI thread (safe to call from any thread). */
    public void pushJs(final String js) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (webView != null) {
                    webView.evaluateJavascript(js, null);
                }
            }
        });
    }
}
