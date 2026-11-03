package com.biblequiz.app;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Tiny HTTP/1.1 server bound to 127.0.0.1 that serves the bundled Bible Quiz web
 * app to the WebView at http://127.0.0.1:&lt;port&gt;/ .
 *
 * Why a real server instead of WebViewClient.shouldInterceptRequest: responses
 * returned from shouldInterceptRequest for *frame navigations* are not always
 * honoured with their Content-Type on every WebView version (the page then
 * renders as raw text), and Range/keep-alive handling is quirky. A real
 * loopback socket gives the WebView completely standard HTTP semantics.
 *
 * Routes (single-page quiz app):
 *   / , /index.html -> index.html
 *   /app.js, /styles.css, /questions.js, /books.js, /bibles/..., /fonts/...
 *                     -> static files under assets/www
 *   /uploads/x     -> user uploads (uploadsDir) first, then bundled assets,
 *                     with HTTP Range support for video
 *   /api/* , /ws   -> JSON 404 fallback only (the in-page __shim.js owns them)
 *
 * Every served HTML page gets <script src="/__shim.js"> injected after <head>.
 *
 * The class is deliberately Android-light (AssetStore/DeletedStore interfaces)
 * so the exact request-handling code can be exercised on a desktop JVM.
 */
public class LocalServer {

    public interface AssetStore {
        /** Opens a bundled asset ("www/..."), or returns null if missing. */
        InputStream open(String path);
    }

    public interface DeletedStore {
        Set<String> all();
        void mark(String name);
    }

    private static final Map<String, String> ROUTES = new HashMap<>();
    static {
        ROUTES.put("/", "index.html");
        ROUTES.put("/index.html", "index.html");
    }

    private static final String[] VIDEO_EXTS = {".mp4", ".webm", ".m4v", ".mov", ".ogv"};

    private final AssetStore assets;
    private final DeletedStore deleted;
    private final File uploadsDir;

    private ServerSocket serverSocket;
    private int port = -1;
    private boolean shimPresent = false;
    private Thread acceptThread;
    private ExecutorService pool;
    private volatile boolean running = false;

    // ------------------------------------------------------------------
    // construction
    // ------------------------------------------------------------------

    public LocalServer(AssetStore assets, DeletedStore deleted, File uploadsDir) {
        this.assets = assets;
        this.deleted = deleted;
        this.uploadsDir = uploadsDir;
        if (uploadsDir != null && !uploadsDir.exists()) uploadsDir.mkdirs();
    }

    /** Android wiring: assets from the APK, tombstones in SharedPreferences. */
    public LocalServer(final Context ctx) {
        this(new AssetStore() {
            @Override
            public InputStream open(String path) {
                String clean = sanitize(path);
                if (clean == null) return null;
                try {
                    return ctx.getAssets().open(clean);
                } catch (IOException e) {
                    return null;
                }
            }
        }, new DeletedStore() {
            private SharedPreferences prefs() {
                return ctx.getSharedPreferences("bq", Context.MODE_PRIVATE);
            }
            @Override
            public Set<String> all() {
                return new HashSet<>(prefs().getStringSet("deleted_uploads", new HashSet<String>()));
            }
            @Override
            public void mark(String name) {
                Set<String> s = all();
                s.add(name);
                prefs().edit().putStringSet("deleted_uploads", s).apply();
            }
        }, new File(ctx.getFilesDir(), "uploads"));
    }

    // ------------------------------------------------------------------
    // lifecycle
    // ------------------------------------------------------------------

    public synchronized int start() throws IOException {
        if (running) return port;
        serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        port = serverSocket.getLocalPort();
        // only inject __shim.js into HTML pages when the app actually bundles it
        InputStream probe = assets.open("www/__shim.js");
        shimPresent = probe != null;
        if (probe != null) { try { probe.close(); } catch (IOException ignored) {} }
        pool = Executors.newCachedThreadPool();
        running = true;
        acceptThread = new Thread(new Runnable() {
            @Override
            public void run() {
                acceptLoop();
            }
        }, "newsdesk-http-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();
        System.out.println("[BibleQuiz] local server on " + baseUrl());
        return port;
    }

    public synchronized void stop() {
        running = false;
        try { if (serverSocket != null) serverSocket.close(); } catch (IOException ignored) {}
        if (pool != null) pool.shutdownNow();
    }

    public String baseUrl() {
        return "http://127.0.0.1:" + port + "/";
    }

    public int port() {
        return port;
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket s = serverSocket.accept();
                s.setSoTimeout(30000);
                s.setTcpNoDelay(true);
                pool.execute(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            handle(s);
                        } catch (Exception e) {
                            // browsers drop connections constantly; not an error
                        } finally {
                            try { s.close(); } catch (IOException ignored) {}
                        }
                    }
                });
            } catch (IOException e) {
                if (running) System.out.println("[BibleQuiz] accept error: " + e);
            }
        }
    }

    // ------------------------------------------------------------------
    // request handling
    // ------------------------------------------------------------------

    private void handle(Socket s) throws IOException {
        InputStream in = new BufferedInputStream(s.getInputStream());
        OutputStream out = s.getOutputStream();
        String head = readHead(in, 64 * 1024);
        if (head == null) return;
        String[] lines = head.split("\r\n");
        if (lines.length == 0) return;
        String[] req = lines[0].split(" ");
        if (req.length < 2) {
            writeSimple(out, 400, "Bad Request", "text/plain; charset=utf-8", "bad request", false);
            return;
        }
        String method = req[0].toUpperCase(Locale.US);
        String target = req[1];
        Map<String, String> headers = new HashMap<>();
        for (int i = 1; i < lines.length; i++) {
            int c = lines[i].indexOf(':');
            if (c > 0) {
                headers.put(lines[i].substring(0, c).trim().toLowerCase(Locale.US),
                        lines[i].substring(c + 1).trim());
            }
        }
        // drain any body (the in-page shim owns /api, so bodies never matter)
        long cl = parseLong(headers.get("content-length"), 0);
        if (cl > 0) skipFully(in, Math.min(cl, 256L * 1024 * 1024));

        String path = target;
        int q = path.indexOf('?');
        if (q >= 0) path = path.substring(0, q);
        if (path.isEmpty()) path = "/";
        try {
            route(method, path, headers, out);
        } catch (Exception e) {
            System.out.println("[BibleQuiz] route error for " + method + " " + path + ": " + e);
            try {
                writeSimple(out, 500, "Internal Server Error", "application/json",
                        "{\"ok\":false,\"error\":\"server error\"}", false);
            } catch (IOException ignored) {}
        }
    }

    private void route(String method, String path, Map<String, String> reqHeaders, OutputStream out)
            throws IOException {
        boolean head = method.equals("HEAD");
        if (method.equals("OPTIONS")) {
            writeSimple(out, 204, "No Content", "text/plain", "", head);
            return;
        }
        // the in-page shim owns the API + websocket; fallback only
        if (path.equals("/ws") || path.startsWith("/api/")) {
            if (method.equals("GET")) {
                writeSimple(out, 404, "Not Found", "application/json; charset=utf-8",
                        "{\"ok\":false,\"error\":\"api handled in-page by __shim.js\"}", head);
            } else {
                writeSimple(out, 405, "Method Not Allowed", "application/json; charset=utf-8",
                        "{\"ok\":false,\"error\":\"method not allowed\"}", head);
            }
            return;
        }
        if (!method.equals("GET") && !method.equals("HEAD")) {
            writeSimple(out, 405, "Method Not Allowed", "application/json; charset=utf-8",
                    "{\"ok\":false}", head);
            return;
        }

        if (path.equals("/favicon.ico")) {
            byte[] svg = ("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'>"
                    + "<rect width='40' height='40' rx='9' fill='#312E81'/>"
                    + "<path d='M11 15c3-1.7 6-1.7 9 0v13c-3-1.7-6-1.7-9 0z' fill='#F8FAFF'/>"
                    + "<path d='M29 15c-3-1.7-6-1.7-9 0v13c3-1.7 6-1.7 9 0z' fill='#E0E7FF'/>"
                    + "<rect x='19' y='15' width='2' height='13' fill='#E8C468'/>"
                    + "<path d='M18 8h4v2h-1.4v4h-1.2v-4H18z' fill='#E8C468'/></svg>")
                    .getBytes("UTF-8");
            writeBytes(out, 200, "OK", "image/svg+xml", svg, "max-age=86400", null, head);
            return;
        }

        if (path.startsWith("/uploads/")) {
            serveUpload(path.substring("/uploads/".length()), reqHeaders, out, head);
            return;
        }

        String rel = ROUTES.containsKey(path) ? ROUTES.get(path) : path.substring(1);
        String clean = sanitize(rel);
        if (clean == null) {
            writeSimple(out, 403, "Forbidden", "application/json; charset=utf-8",
                    "{\"ok\":false,\"error\":\"forbidden\"}", head);
            return;
        }
        rel = clean;
        if (rel.isEmpty() || rel.endsWith("/")) rel += "index.html";

        String assetPath = "www/" + rel;
        String ext = extOf(rel);

        if (ext.equals(".html")) {
            byte[] data = assetBytes(assetPath);
            if (data == null) {
                writeSimple(out, 404, "Not Found", "text/html; charset=utf-8", notFoundPage(path), head);
                return;
            }
            writeBytes(out, 200, "OK", mimeFor(rel), shimPresent ? injectShim(data) : data, "no-cache", null, head);
            return;
        }
        if (isVideo(ext)) {
            serveAssetRanged(assetPath, mimeFor(rel), reqHeaders, out, head);
            return;
        }
        byte[] data = assetBytes(assetPath);
        if (data == null) {
            // directory-style path: try index.html inside
            byte[] idx = assetBytes(assetPath + "/index.html");
            if (idx == null) {
                writeSimple(out, 404, "Not Found", "text/html; charset=utf-8", notFoundPage(path), head);
                return;
            }
            writeBytes(out, 200, "OK", "text/html; charset=utf-8", shimPresent ? injectShim(idx) : idx, "no-cache", null, head);
            return;
        }
        String cache = (ext.equals(".css") || ext.equals(".js") || ext.equals(".json"))
                ? "no-cache" : "max-age=3600";
        writeBytes(out, 200, "OK", mimeFor(rel), data, cache, null, head);
    }

    // ------------------------------------------------------------------
    // /uploads/*  (user files first, then bundled demo media; Range for video)
    // ------------------------------------------------------------------

    private void serveUpload(String name, Map<String, String> reqHeaders, OutputStream out, boolean head)
            throws IOException {
        String clean = sanitize(name);
        if (clean == null || clean.contains("/")) {
            writeSimple(out, 400, "Bad Request", "application/json; charset=utf-8",
                    "{\"ok\":false,\"error\":\"bad name\"}", head);
            return;
        }
        if (deleted.all().contains(clean)) {
            writeSimple(out, 404, "Not Found", "text/html; charset=utf-8",
                    notFoundPage("/uploads/" + clean), head);
            return;
        }
        File f = uploadsDir != null ? new File(uploadsDir, clean) : null;
        if (f != null && f.isFile()) {
            serveFileRanged(f, mimeFor(clean), reqHeaders, out, head);
            return;
        }
        byte[] data = assetBytes("www/uploads/" + clean);
        if (data == null) {
            writeSimple(out, 404, "Not Found", "text/html; charset=utf-8",
                    notFoundPage("/uploads/" + clean), head);
            return;
        }
        serveBytesRanged(data, mimeFor(clean), reqHeaders, out, head);
    }

    private void serveFileRanged(File f, String mime, Map<String, String> reqHeaders, OutputStream out, boolean head)
            throws IOException {
        long size = f.length();
        long[] range = parseRange(reqHeaders.get("range"), size);
        if (range == null) {
            writeSimple(out, 416, "Range Not Satisfiable", mime, "", head,
                    "Content-Range: bytes */" + size);
            return;
        }
        long start = range[0], end = range[1];
        int status = (range[2] == 1) ? 206 : 200;
        Map<String, String> extra = new HashMap<>();
        extra.put("Accept-Ranges", "bytes");
        if (status == 206) extra.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
        FileInputStream in = new FileInputStream(f);
        try {
            writeStream(out, status, status == 206 ? "Partial Content" : "OK", mime, in,
                    end - start + 1, "max-age=3600", extra, head, start);
        } finally {
            try { in.close(); } catch (IOException ignored) {}
        }
    }

    private void serveAssetRanged(String assetPath, String mime, Map<String, String> reqHeaders,
                                  OutputStream out, boolean head) throws IOException {
        InputStream probe = assets.open(assetPath);
        if (probe == null) {
            writeSimple(out, 404, "Not Found", "text/html; charset=utf-8", notFoundPage("/" + assetPath), head);
            return;
        }
        // bundled videos are small; read once and serve from memory
        byte[] data;
        try {
            data = readAll(probe);
        } finally {
            try { probe.close(); } catch (IOException ignored) {}
        }
        serveBytesRanged(data, mime, reqHeaders, out, head);
    }

    private void serveBytesRanged(byte[] data, String mime, Map<String, String> reqHeaders,
                                  OutputStream out, boolean head) throws IOException {
        long size = data.length;
        long[] range = parseRange(reqHeaders.get("range"), size);
        if (range == null) {
            writeSimple(out, 416, "Range Not Satisfiable", mime, "", head,
                    "Content-Range: bytes */" + size);
            return;
        }
        long start = range[0], end = range[1];
        int status = (range[2] == 1) ? 206 : 200;
        Map<String, String> extra = new HashMap<>();
        extra.put("Accept-Ranges", "bytes");
        if (status == 206) extra.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
        long length = end - start + 1;
        writeBytes(out, status, status == 206 ? "Partial Content" : "OK", mime,
                data, (int) start, (int) length, "max-age=3600", extra, head);
    }

    /** @return {start, end, is206} or null if unsatisfiable. */
    private static long[] parseRange(String rangeHeader, long size) {
        if (rangeHeader == null || !rangeHeader.startsWith("bytes=") || size <= 0) {
            return new long[]{0, size - 1, 0};
        }
        try {
            String spec = rangeHeader.substring(6).split(",")[0].trim();
            int dash = spec.indexOf('-');
            String a = dash >= 0 ? spec.substring(0, dash) : spec;
            String b = dash >= 0 ? spec.substring(dash + 1) : "";
            long start, end;
            if (a.isEmpty() && !b.isEmpty()) {
                start = Math.max(0, size - Long.parseLong(b));
                end = size - 1;
            } else {
                start = Long.parseLong(a.isEmpty() ? "0" : a);
                end = b.isEmpty() ? size - 1 : Math.min(size - 1, Long.parseLong(b));
            }
            if (start > end || start >= size) return null;
            return new long[]{start, end, 1};
        } catch (Exception e) {
            return new long[]{0, size - 1, 0};
        }
    }

    // ------------------------------------------------------------------
    // response writers
    // ------------------------------------------------------------------

    private void writeSimple(OutputStream out, int status, String reason, String mime, String body, boolean head)
            throws IOException {
        writeSimple(out, status, reason, mime, body, head, null);
    }

    private void writeSimple(OutputStream out, int status, String reason, String mime, String body, boolean head,
                             String extraHeader) throws IOException {
        Map<String, String> extra = null;
        if (extraHeader != null) {
            int c = extraHeader.indexOf(':');
            extra = new HashMap<>();
            extra.put(extraHeader.substring(0, c).trim(), extraHeader.substring(c + 1).trim());
        }
        writeBytes(out, status, reason, mime, body.getBytes("UTF-8"), "no-store", extra, head);
    }

    private void writeBytes(OutputStream out, int status, String reason, String mime, byte[] data,
                            String cache, Map<String, String> extra, boolean head) throws IOException {
        writeBytes(out, status, reason, mime, data, 0, data.length, cache, extra, head);
    }

    private void writeBytes(OutputStream out, int status, String reason, String mime, byte[] data, int off, int len,
                            String cache, Map<String, String> extra, boolean head) throws IOException {
        StringBuilder h = new StringBuilder();
        h.append("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n");
        h.append("Content-Type: ").append(mime).append("\r\n");
        h.append("Content-Length: ").append(len).append("\r\n");
        h.append("Access-Control-Allow-Origin: *\r\n");
        if (cache != null) h.append("Cache-Control: ").append(cache).append("\r\n");
        if (extra != null) {
            for (Map.Entry<String, String> e : extra.entrySet()) {
                h.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
            }
        }
        h.append("Connection: close\r\n\r\n");
        out.write(h.toString().getBytes("ISO-8859-1"));
        if (!head && len > 0) out.write(data, off, len);
        out.flush();
    }

    private void writeStream(OutputStream out, int status, String reason, String mime, InputStream in, long length,
                             String cache, Map<String, String> extra, boolean head, long skip) throws IOException {
        StringBuilder h = new StringBuilder();
        h.append("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n");
        h.append("Content-Type: ").append(mime).append("\r\n");
        h.append("Content-Length: ").append(length).append("\r\n");
        h.append("Access-Control-Allow-Origin: *\r\n");
        if (cache != null) h.append("Cache-Control: ").append(cache).append("\r\n");
        if (extra != null) {
            for (Map.Entry<String, String> e : extra.entrySet()) {
                h.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
            }
        }
        h.append("Connection: close\r\n\r\n");
        out.write(h.toString().getBytes("ISO-8859-1"));
        if (!head) {
            skipFully(in, skip);
            byte[] buf = new byte[64 * 1024];
            long left = length;
            while (left > 0) {
                int n = in.read(buf, 0, (int) Math.min(buf.length, left));
                if (n < 0) break;
                out.write(buf, 0, n);
                left -= n;
            }
        }
        out.flush();
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    private static String readHead(InputStream in, int maxBytes) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int b;
        int matched = 0;   // consecutive bytes matching "\r\n\r\n"
        while (buf.size() < maxBytes && (b = in.read()) != -1) {
            buf.write(b);
            if ((matched == 0 || matched == 2) && b == '\r') matched++;
            else if ((matched == 1 || matched == 3) && b == '\n') matched++;
            else matched = (b == '\r') ? 1 : 0;
            if (matched == 4) break;
        }
        if (buf.size() == 0) return null;
        return new String(buf.toByteArray(), "ISO-8859-1");
    }

    private static long parseLong(String s, long def) {
        try { return s == null ? def : Long.parseLong(s.trim()); }
        catch (Exception e) { return def; }
    }

    private static void skipFully(InputStream in, long n) throws IOException {
        long left = n;
        while (left > 0) {
            long s = in.skip(left);
            if (s <= 0) {
                if (in.read() == -1) return;
                s = 1;
            }
            left -= s;
        }
    }

    private byte[] assetBytes(String path) {
        InputStream in = assets.open(path);
        if (in == null) return null;
        try {
            return readAll(in);
        } catch (IOException e) {
            return null;
        } finally {
            try { in.close(); } catch (IOException ignored) {}
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private static String sanitize(String path) {
        if (path == null) return null;
        String clean = path.replace('\\', '/');
        if (clean.startsWith("/")) clean = clean.substring(1);
        if (!clean.matches("[A-Za-z0-9_./-]+") || clean.contains("..")) return null;
        return clean;
    }

    /** Injects the backend shim into an HTML page (right after <head>). */
    static byte[] injectShim(byte[] html) {
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
        try {
            return out.getBytes("UTF-8");
        } catch (Exception e) {
            return html;
        }
    }

    private static String notFoundPage(String path) {
        return "<h1 style='font:600 22px system-ui;padding:40px'>404 — " + path + "</h1>"
                + "<p style='font:15px system-ui;padding:0 40px'>"
                + "The control panel lives at <a href='/'>/</a>. "
                + "Overlay URL: <code>/overlay/overlay.html</code></p>";
    }

    public static String mimeFor(String path) {
        String p = path.toLowerCase(Locale.US);
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

    private static boolean isVideo(String ext) {
        for (String v : VIDEO_EXTS) if (v.equals(ext)) return true;
        return false;
    }

    private static String extOf(String path) {
        int i = path.lastIndexOf('.');
        return i >= 0 ? path.substring(i).toLowerCase(Locale.US) : "";
    }
}
