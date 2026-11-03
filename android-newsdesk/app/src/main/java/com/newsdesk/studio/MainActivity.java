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
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * NewsDesk Studio — Android shell.
 *
 * Hosts the full NewsDesk web app (bundled in assets/www, extracted from
 * obs-news-desk.zip) inside a WebView under the fake origin
 * https://newsdesk.local/ . Every request is intercepted and served from the
 * APK:
 *
 *   / , /control   -> control/index.html   (the control panel)
 *   /overlay       -> overlay/overlay.html (the 1920x1080 broadcast overlay)
 *   /demo , /cam   -> their pages
 *   /shell         -> shell.html           (app chrome: Panel / Overlay tabs)
 *   /assets|scripture|bible|uploads|... -> static files
 *   /uploads/x     -> user uploads (filesDir) first, then bundled assets,
 *                     with HTTP Range support for video
 *
 * Every served HTML page gets <script src="/__shim.js"> injected right after
 * <head>; the shim implements the whole server.py backend (/api/* + /ws) in
 * JavaScript inside the page, so the panel and the overlay stay live-synced
 * through BroadcastChannel. /api/* and /ws only reach this interceptor as a
 * fallback (they get a JSON 404 — the shim owns them in-page).
 */
public class MainActivity extends Activity {

    public static final String TAG = "NewsDesk";
    /** Fake origin used as the WebView base URL; every request is intercepted. */
    public static final String BASE_URL = "https://newsdesk.local/";

    private WebView webView;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private static final Map<String, String> ROUTES = new HashMap<>();
    static {
        ROUTES.put("/", "control/index.html");
        ROUTES.put("/control", "control/index.html");
        ROUTES.put("/control/", "control/index.html");
        ROUTES.put("/overlay", "overlay/overlay.html");
        ROUTES.put("/overlay/", "overlay/overlay.html");
        ROUTES.put("/demo", "demo/demo.html");
        ROUTES.put("/demo/", "demo/demo.html");
        ROUTES.put("/cam", "camera/index.html");
        ROUTES.put("/cam/", "camera/index.html");
        ROUTES.put("/cam/index.html", "camera/index.html");
        ROUTES.put("/shell", "shell.html");
        ROUTES.put("/shell/", "shell.html");
    }

    private static final String[] VIDEO_EXTS = {".mp4", ".webm", ".m4v", ".mov", ".ogv"};

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

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

        webView.setWebViewClient(new AssetWebViewClient());
        webView.setWebChromeClient(new NewsDeskChromeClient());
        webView.addJavascriptInterface(new NewsDeskBridge(this), "NewsDeskBridge");

        webView.loadUrl(BASE_URL + "shell");
    }

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
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    // ------------------------------------------------------------------
    // Storage shared with the bridge (user uploads + "deleted" bundled files)
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

    // ------------------------------------------------------------------
    // Assets
    // ------------------------------------------------------------------

    /** Opens a bundled asset after validating the path (no traversal). */
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

    /** Reads a bundled asset as UTF-8 text. */
    public String readAssetText(String path) {
        byte[] data = assetBytes(path);
        if (data == null) return null;
        try {
            return new String(data, "UTF-8");
        } catch (Exception e) {
            return null;
        }
    }

    /** Reads a whole bundled asset into memory (null if missing). */
    public byte[] assetBytes(String path) {
        InputStream in = openAsset(path);
        if (in == null) return null;
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        } catch (IOException e) {
            Log.e(TAG, "assetBytes failed: " + path, e);
            return null;
        } finally {
            try { in.close(); } catch (IOException ignored) {}
        }
    }

    // ------------------------------------------------------------------
    // MIME
    // ------------------------------------------------------------------

    public static String mimeFor(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript; charset=utf-8";
        if (p.endsWith(".json")) return "application/json; charset=utf-8";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".otf")) return "font/otf";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".mp4") || p.endsWith(".m4v")) return "video/mp4";
        if (p.endsWith(".webm")) return "video/webm";
        if (p.endsWith(".mov")) return "video/quicktime";
        if (p.endsWith(".ogv")) return "video/ogg";
        if (p.endsWith(".md")) return "text/markdown; charset=utf-8";
        if (p.endsWith(".wav")) return "audio/wav";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".txt")) return "text/plain; charset=utf-8";
        if (p.endsWith(".xml")) return "application/xml";
        return "application/octet-stream";
    }

    private static boolean isVideoExt(String ext) {
        for (String v : VIDEO_EXTS) if (v.equals(ext)) return true;
        return false;
    }

    private static String extOf(String path) {
        int i = path.lastIndexOf('.');
        return i >= 0 ? path.substring(i).toLowerCase() : "";
    }

    // ------------------------------------------------------------------
    // Responses
    // ------------------------------------------------------------------

    private WebResourceResponse jsonResponse(int status, String reason, String body) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse("application/json; charset=utf-8", "UTF-8",
                status, reason, headers, new ByteArrayInputStream(body.getBytes()));
    }

    private WebResourceResponse bytesResponse(int status, String reason, String mime, byte[] data, String cache) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Cache-Control", cache);
        return new WebResourceResponse(mime, "UTF-8", status, reason, headers,
                new ByteArrayInputStream(data));
    }

    private WebResourceResponse streamResponse(String mime, InputStream in, String cache) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Cache-Control", cache);
        return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, in);
    }

    private WebResourceResponse notFound(String path) {
        String body = "<h1 style='font:600 22px system-ui;padding:40px'>404 — " + path + "</h1>"
                + "<p style='font:15px system-ui;padding:0 40px'>"
                + "The control panel lives at <a href='/'>/</a>. "
                + "Overlay URL: <code>/overlay/overlay.html</code></p>";
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Type", "text/html; charset=utf-8");
        return new WebResourceResponse("text/html; charset=utf-8", "UTF-8", 404, "Not Found",
                headers, new ByteArrayInputStream(body.getBytes()));
    }

    /** Serves a byte[] honouring a Range request (video). */
    private WebResourceResponse rangedBytesResponse(byte[] data, String mime, WebResourceRequest request) {
        long size = data.length;
        long start = 0, end = size - 1;
        int status = 200;
        String range = header(request, "Range");
        if (range != null && range.startsWith("bytes=")) {
            try {
                String spec = range.substring(6).split(",")[0].trim();
                int dash = spec.indexOf('-');
                String a = dash >= 0 ? spec.substring(0, dash) : spec;
                String b = dash >= 0 ? spec.substring(dash + 1) : "";
                if (a.isEmpty() && !b.isEmpty()) {
                    start = Math.max(0, size - Long.parseLong(b));
                } else {
                    start = Long.parseLong(a.isEmpty() ? "0" : a);
                    if (!b.isEmpty()) end = Math.min(size - 1, Long.parseLong(b));
                }
                if (start > end || start >= size) throw new NumberFormatException();
                status = 206;
            } catch (Exception e) {
                Map<String, String> headers = new HashMap<>();
                headers.put("Content-Range", "bytes */" + size);
                return new WebResourceResponse(mime, "UTF-8", 416, "Range Not Satisfiable",
                        headers, new ByteArrayInputStream(new byte[0]));
            }
        }
        long length = end - start + 1;
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Cache-Control", "max-age=3600");
        headers.put("Accept-Ranges", "bytes");
        headers.put("Content-Length", String.valueOf(length));
        if (status == 206) headers.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
        return new WebResourceResponse(mime, "UTF-8", status, status == 206 ? "Partial Content" : "OK",
                headers, new ByteArrayInputStream(data, (int) start, (int) length));
    }

    /** Serves an open stream honouring a Range request (user video files). */
    private WebResourceResponse rangedStreamResponse(String mime, InputStream in, long size,
                                                     WebResourceRequest request) {
        long start = 0, end = size - 1;
        int status = 200;
        String range = header(request, "Range");
        if (range != null && range.startsWith("bytes=")) {
            try {
                String spec = range.substring(6).split(",")[0].trim();
                int dash = spec.indexOf('-');
                String a = dash >= 0 ? spec.substring(0, dash) : spec;
                String b = dash >= 0 ? spec.substring(dash + 1) : "";
                if (a.isEmpty() && !b.isEmpty()) {
                    start = Math.max(0, size - Long.parseLong(b));
                } else {
                    start = Long.parseLong(a.isEmpty() ? "0" : a);
                    if (!b.isEmpty()) end = Math.min(size - 1, Long.parseLong(b));
                }
                if (start > end || start >= size) throw new NumberFormatException();
                status = 206;
            } catch (Exception e) {
                try { in.close(); } catch (IOException ignored) {}
                Map<String, String> headers = new HashMap<>();
                headers.put("Content-Range", "bytes */" + size);
                return new WebResourceResponse(mime, "UTF-8", 416, "Range Not Satisfiable",
                        headers, new ByteArrayInputStream(new byte[0]));
            }
        }
        long length = end - start + 1;
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Cache-Control", "max-age=3600");
        headers.put("Accept-Ranges", "bytes");
        headers.put("Content-Length", String.valueOf(length));
        if (status == 206) headers.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
        try {
            return new WebResourceResponse(mime, "UTF-8",
                    status, status == 206 ? "Partial Content" : "OK",
                    headers, new RangeInputStream(in, start, length));
        } catch (IOException e) {
            try { in.close(); } catch (IOException ignored) {}
            return jsonResponse(500, "Error", "{\"ok\":false,\"error\":\"read error\"}");
        }
    }

    private static String header(WebResourceRequest request, String name) {
        Map<String, String> h = request.getRequestHeaders();
        if (h == null) return null;
        for (Map.Entry<String, String> e : h.entrySet()) {
            if (e.getKey() != null && e.getKey().equalsIgnoreCase(name)) return e.getValue();
        }
        return null;
    }

    /** Injects the backend shim into an HTML page (right after <head>). */
    private static byte[] injectShim(byte[] html) {
        String s;
        try {
            s = new String(html, "UTF-8");
        } catch (Exception e) {
            return html;
        }
        if (s.contains("__shim.js")) return html;
        String tag = "<script src=\"/__shim.js\"></script>";
        Matcher m = Pattern.compile("<head[^>]*>", Pattern.CASE_INSENSITIVE).matcher(s);
        String out;
        if (m.find()) {
            out = s.substring(0, m.end()) + tag + s.substring(m.end());
        } else {
            out = tag + s;
        }
        return out.getBytes();
    }

    // ------------------------------------------------------------------
    // Request interceptor
    // ------------------------------------------------------------------

    private class AssetWebViewClient extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            try {
                String method = request.getMethod();
                Uri uri = request.getUrl();
                String path = uri.getPath() == null ? "/" : uri.getPath();

                // The in-page shim owns the API + websocket; these are only a
                // fallback if JS injection ever failed.
                if (path.startsWith("/api/") || path.equals("/ws")) {
                    if (!"GET".equalsIgnoreCase(method)) return null;
                    return jsonResponse(404, "Not Found",
                            "{\"ok\":false,\"error\":\"api handled in-page by __shim.js\"}");
                }

                if (!"GET".equalsIgnoreCase(method)) return null;

                if (path.equals("/favicon.ico")) {
                    byte[] svg = ("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'>"
                            + "<rect width='40' height='40' rx='8' fill='#E01B22'/>"
                            + "<path d='M9 29V11h4.6l8.2 11.2V11H26v18h-4.4L13.4 17.6V29H9z' fill='#fff'/></svg>")
                            .getBytes();
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Cache-Control", "max-age=86400");
                    return new WebResourceResponse("image/svg+xml", "UTF-8", 200, "OK",
                            headers, new ByteArrayInputStream(svg));
                }

                // user uploads first, then the bundled demo media
                if (path.startsWith("/uploads/")) {
                    return uploadResponse(path.substring("/uploads/".length()), request);
                }

                String rel = ROUTES.containsKey(path) ? ROUTES.get(path) : path.substring(1);
                if (!rel.matches("[A-Za-z0-9_./-]+") || rel.contains("..")) {
                    return jsonResponse(403, "Forbidden", "{\"ok\":false,\"error\":\"forbidden\"}");
                }
                if (rel.isEmpty() || rel.endsWith("/")) rel += "index.html";

                String assetPath = "www/" + rel;
                String ext = extOf(rel);

                if (ext.equals(".html")) {
                    byte[] data = assetBytes(assetPath);
                    if (data == null) return notFound(path);
                    return bytesResponse(200, "OK", mimeFor(rel), injectShim(data), "no-cache");
                }
                if (isVideoExt(ext)) {
                    byte[] data = assetBytes(assetPath);
                    if (data == null) return notFound(path);
                    return rangedBytesResponse(data, mimeFor(rel), request);
                }
                InputStream in = openAsset(assetPath);
                if (in == null) {
                    // directory-style path: try index.html inside
                    InputStream in2 = openAsset(assetPath + "/index.html");
                    if (in2 == null) return notFound(path);
                    String mime = assetPath.endsWith(".html") ? mimeFor(assetPath) : "text/html; charset=utf-8";
                    if (assetPath.endsWith(".html")) {
                        byte[] data = assetBytes(assetPath + "/index.html");
                        return bytesResponse(200, "OK", mime, injectShim(data), "no-cache");
                    }
                    return streamResponse(mime, in2, "max-age=3600");
                }
                String cache = (ext.equals(".css") || ext.equals(".js") || ext.equals(".json"))
                        ? "no-cache" : "max-age=3600";
                return streamResponse(mimeFor(rel), in, cache);
            } catch (Exception e) {
                Log.e(TAG, "intercept failed", e);
                return jsonResponse(500, "Error",
                        "{\"ok\":false,\"error\":\"" + String.valueOf(e.getMessage()) + "\"}");
            }
        }

        private WebResourceResponse uploadResponse(String name, WebResourceRequest request) {
            if (!name.matches("[A-Za-z0-9_.-]+") || name.contains("..")) {
                return jsonResponse(400, "Bad Request", "{\"ok\":false,\"error\":\"bad name\"}");
            }
            if (deletedUploads().contains(name)) return notFound("/uploads/" + name);

            File f = new File(uploadsDir(), name);
            if (f.isFile()) {
                try {
                    return rangedStreamResponse(mimeFor(name), new FileInputStream(f), f.length(), request);
                } catch (IOException e) {
                    return jsonResponse(500, "Error", "{\"ok\":false,\"error\":\"read error\"}");
                }
            }
            byte[] data = assetBytes("www/uploads/" + name);
            if (data == null) return notFound("/uploads/" + name);
            return rangedBytesResponse(data, mimeFor(name), request);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return false;   // keep everything inside the WebView
        }
    }

    // ------------------------------------------------------------------
    // WebChromeClient
    // ------------------------------------------------------------------

    private class NewsDeskChromeClient extends WebChromeClient {
        @Override
        public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
            Log.d(TAG, "JS[" + consoleMessage.sourceId() + ":" + consoleMessage.lineNumber() + "] "
                    + consoleMessage.message());
            return true;
        }
    }

    /** InputStream wrapper that skips `skip` bytes then reads at most `length`. */
    static class RangeInputStream extends InputStream {
        private final InputStream in;
        private long remaining;

        RangeInputStream(InputStream in, long skip, long length) throws IOException {
            this.in = in;
            long left = skip;
            while (left > 0) {
                long s = in.skip(left);
                if (s <= 0) {
                    if (in.read() == -1) throw new IOException("unexpected EOF while skipping");
                    s = 1;
                }
                left -= s;
            }
            this.remaining = length;
        }

        @Override
        public int read() throws IOException {
            if (remaining <= 0) return -1;
            int b = in.read();
            if (b >= 0) remaining--;
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (remaining <= 0) return -1;
            int n = in.read(b, off, (int) Math.min(len, remaining));
            if (n > 0) remaining -= n;
            return n;
        }

        @Override
        public void close() throws IOException {
            in.close();
        }
    }
}
