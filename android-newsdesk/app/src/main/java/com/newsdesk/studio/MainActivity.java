package com.newsdesk.studio;

import android.app.Activity;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashSet;
import java.util.Set;

/**
 * NewsDesk Studio — Android shell.
 *
 * Runs a real loopback HTTP server ({@link LocalServer} on 127.0.0.1, random
 * port) that serves the full bundled NewsDesk web app (assets/www, extracted
 * from obs-news-desk.zip + the repo's bibles/) and points the WebView at
 * http://127.0.0.1:&lt;port&gt;/shell — standard HTTP semantics, so pages
 * always render as HTML (shouldInterceptRequest frame responses are not
 * reliably honoured with their Content-Type on all WebView versions).
 *
 *   /shell         -> app chrome (Panel / Overlay tabs, both frames alive)
 *   / , /control   -> the control panel
 *   /overlay/...   -> the 1920x1080 broadcast overlay
 *
 * Every served HTML page gets __shim.js injected, which implements the whole
 * server.py backend (/api/* + /ws) inside the page, so panel and overlay stay
 * live-synced over BroadcastChannel. Uploads go through the NewsDeskBridge
 * into filesDir/uploads (served at /uploads/* with Range support).
 *
 * Cleartext is only permitted to 127.0.0.1/localhost (res/xml/
 * network_security_config.xml) and external navigations are blocked, so the
 * app stays fully offline.
 */
public class MainActivity extends Activity {

    public static final String TAG = "NewsDesk";

    private WebView webView;
    private LocalServer server;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        server = new LocalServer(this);
        int port = -1;
        try {
            port = server.start();
        } catch (IOException e) {
            Log.e(TAG, "local server failed to start", e);
        }

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);   // muted PiP video autoplays
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String scheme = u.getScheme();
                if (scheme != null && (scheme.equals("http") || scheme.equals("https"))) {
                    String host = u.getHost();
                    // stay fully offline: only the app's own loopback server
                    if (!"127.0.0.1".equals(host) && !"localhost".equals(host)) return true;
                }
                return false;
            }
        });
        webView.setWebChromeClient(new NewsDeskChromeClient());
        webView.addJavascriptInterface(new NewsDeskBridge(this), "NewsDeskBridge");

        if (port > 0) {
            webView.loadUrl("http://127.0.0.1:" + port + "/shell");
        } else {
            webView.loadData("<h1 style='font:600 22px system-ui;padding:40px'>"
                    + "The local server could not start.</h1>", "text/html", "UTF-8");
        }
    }

    // ------------------------------------------------------------------
    // Storage shared with the bridge + server (user uploads, tombstones)
    // ------------------------------------------------------------------

    public File uploadsDir() {
        File dir = new File(getFilesDir(), "uploads");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    public Set<String> deletedUploads() {
        SharedPreferences p = getSharedPreferences("nd", MODE_PRIVATE);
        return new HashSet<>(p.getStringSet("deleted_uploads", new HashSet<String>()));
    }

    public void saveDeletedUploads(Set<String> names) {
        getSharedPreferences("nd", MODE_PRIVATE)
                .edit()
                .putStringSet("deleted_uploads", names)
                .apply();
    }

    /** Reads a bundled asset as UTF-8 text (used by NewsDeskBridge). */
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

    private InputStream openAsset(String path) {
        if (path == null) return null;
        String clean = path.replace('\\', '/');
        if (clean.startsWith("/")) clean = clean.substring(1);
        if (!clean.matches("[A-Za-z0-9_./-]+") || clean.contains("..")) return null;
        try {
            return getAssets().open(clean);
        } catch (IOException e) {
            return null;
        }
    }

    // ------------------------------------------------------------------
    // WebChromeClient: forward console messages to logcat
    // ------------------------------------------------------------------

    private class NewsDeskChromeClient extends WebChromeClient {
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
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
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
