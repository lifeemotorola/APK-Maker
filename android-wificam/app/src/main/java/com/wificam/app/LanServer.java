package com.wificam.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.Enumeration;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * LAN HTTP server bound to 0.0.0.0:8080.
 *
 * Routes:
 *   / , /index.html, /app.js, /styles.css, /img/*  -> bundled web UI (assets/www)
 *   /stream   -> MJPEG stream (multipart/x-mixed-replace) fed by FrameBus
 *   /status   -> JSON status (ip, port, streaming, resolution, fps, clients)
 *   /api/start?cam=back&w=1280&h=720&fps=15 -> start camera + stream (JSON)
 *   /api/stop                              -> stop camera (JSON)
 *   /api/torch?on=1                        -> torch on/off (JSON)
 */
public class LanServer {

    public static final int PORT = 8080;

    private final Context context;
    private ServerSocket serverSocket;
    private ExecutorService pool;
    private volatile boolean running;
    private final AtomicInteger streamClients = new AtomicInteger(0);

    public LanServer(Context context) {
        this.context = context.getApplicationContext();
    }

    public int start() throws IOException {
        serverSocket = new ServerSocket(PORT, 50, InetAddress.getByName("0.0.0.0"));
        pool = Executors.newCachedThreadPool();
        running = true;
        Thread accept = new Thread(new Runnable() {
            @Override
            public void run() {
                while (running) {
                    try {
                        final Socket client = serverSocket.accept();
                        pool.execute(new Runnable() {
                            @Override
                            public void run() {
                                handle(client);
                            }
                        });
                    } catch (IOException e) {
                        if (running) Log2.e("accept failed", e);
                    }
                }
            }
        }, "wificam-accept");
        accept.setDaemon(true);
        accept.start();
        return serverSocket.getLocalPort();
    }

    public void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
        if (pool != null) pool.shutdownNow();
    }

    public static String lanIp() {
        try {
            Enumeration<NetworkInterface> nis = NetworkInterface.getNetworkInterfaces();
            while (nis != null && nis.hasMoreElements()) {
                NetworkInterface ni = nis.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress a = addrs.nextElement();
                    if (!a.isLoopbackAddress() && a.getAddress().length == 4) {
                        return a.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return "127.0.0.1";
    }

    private void handle(Socket client) {
        try {
            client.setSoTimeout(0);
            InputStream in = client.getInputStream();
            OutputStream out = client.getOutputStream();
            String requestLine = readLine(in);
            if (requestLine == null) {
                client.close();
                return;
            }
            String path = requestLine.split(" ")[1];
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                // drain headers
            }
            if (path.contains("..")) {
                write(out, 403, "text/plain", "forbidden".getBytes("UTF-8"));
                client.close();
                return;
            }
            if (path.startsWith("/stream")) {
                serveStream(out);
                client.close();
                return;
            }
            if (path.startsWith("/api/start")) {
                String cam = query(path, "cam", "back");
                int w = clampInt(query(path, "w", "1280"), 1280, 320, 3840);
                int h = clampInt(query(path, "h", "720"), 720, 240, 2160);
                int fps = clampInt(query(path, "fps", "15"), 15, 1, 60);
                boolean perm = context.checkSelfPermission(Manifest.permission.CAMERA)
                        == PackageManager.PERMISSION_GRANTED;
                boolean ok = false;
                if (perm) {
                    ok = CameraHolder.ensureStarted(context, cam, w, h, fps, null, null);
                }
                String body = "{\"ok\":" + (perm && ok)
                        + ",\"permission\":" + perm
                        + ",\"streaming\":" + (CameraHolder.controller != null && CameraHolder.controller.isRunning())
                        + "}";
                write(out, 200, "application/json", body.getBytes("UTF-8"));
                client.close();
                return;
            }
            if (path.startsWith("/api/stop")) {
                CameraHolder.stopAll(context);
                write(out, 200, "application/json", "{\"ok\":true}".getBytes("UTF-8"));
                client.close();
                return;
            }
            if (path.startsWith("/api/torch")) {
                String v = query(path, "on", "0");
                boolean on = "1".equals(v) || "true".equals(v);
                if (CameraHolder.controller != null) CameraHolder.controller.setTorch(on);
                write(out, 200, "application/json", ("{\"ok\":true,\"torch\":" + on + "}").getBytes("UTF-8"));
                client.close();
                return;
            }
            if (path.startsWith("/status")) {
                String body = "{"
                        + "\"ip\":\"" + lanIp() + "\""
                        + ",\"port\":" + PORT
                        + ",\"streaming\":" + (CameraHolder.controller != null && CameraHolder.controller.isRunning())
                        + ",\"info\":\"" + (CameraHolder.controller != null ? CameraHolder.controller.getInfo().replace("\"", "'") : "") + "\""
                        + ",\"clients\":" + streamClients.get()
                        + "}";
                write(out, 200, "application/json", body.getBytes("UTF-8"));
                client.close();
                return;
            }
            if (path.equals("/") || path.equals("/index.html")) path = "/index.html";
            String assetPath = "www" + path;
            try {
                InputStream asset = context.getAssets().open(assetPath);
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = asset.read(buf)) != -1) bos.write(buf, 0, n);
                asset.close();
                write(out, 200, contentType(path), bos.toByteArray());
            } catch (IOException notFound) {
                write(out, 404, "text/plain", "not found".getBytes("UTF-8"));
            }
            client.close();
        } catch (Exception e) {
            try {
                client.close();
            } catch (IOException ignored) {
            }
        }
    }

    /** MJPEG stream: multipart/x-mixed-replace, one part per JPEG frame. */
    private void serveStream(OutputStream out) throws IOException {
        streamClients.incrementAndGet();
        try {
            String head = "HTTP/1.1 200 OK\r\n"
                    + "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n"
                    + "Cache-Control: no-store\r\n"
                    + "Connection: close\r\n"
                    + "\r\n";
            out.write(head.getBytes("UTF-8"));
            out.flush();
            long lastSeq = FrameBus.currentSeq() - 1;
            while (running) {
                byte[] frame = FrameBus.awaitFrame(lastSeq, 2000);
                if (frame == null) {
                    // keep-alive comment part so proxies/browsers don't time out
                    out.write(": ping\r\n\r\n".getBytes("UTF-8"));
                    out.flush();
                    continue;
                }
                lastSeq = FrameBus.currentSeq();
                String part = "--frame\r\n"
                        + "Content-Type: image/jpeg\r\n"
                        + "Content-Length: " + frame.length + "\r\n"
                        + "\r\n";
                out.write(part.getBytes("UTF-8"));
                out.write(frame);
                out.write("\r\n".getBytes("UTF-8"));
                out.flush();
            }
        } catch (IOException e) {
            // client disconnected
        } finally {
            streamClients.decrementAndGet();
        }
    }

    private static String query(String path, String key, String def) {
        int q = path.indexOf('?');
        if (q < 0) return def;
        String qs = path.substring(q + 1);
        String[] pairs = qs.split("&");
        for (int i = 0; i < pairs.length; i++) {
            int eq = pairs[i].indexOf('=');
            if (eq > 0 && pairs[i].substring(0, eq).equals(key)) {
                try {
                    return java.net.URLDecoder.decode(pairs[i].substring(eq + 1), "UTF-8");
                } catch (Exception e) {
                    return pairs[i].substring(eq + 1);
                }
            }
        }
        return def;
    }

    private static int clampInt(String s, int def, int lo, int hi) {
        try {
            int v = Integer.parseInt(s.trim());
            if (v < lo) return lo;
            if (v > hi) return hi;
            return v;
        } catch (Exception e) {
            return def;
        }
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        int c;
        boolean sawAny = false;
        while ((c = in.read()) != -1) {
            sawAny = true;
            if (c == '\n') break;
            if (c != '\r') bos.write(c);
        }
        if (!sawAny && c == -1) return null;
        return new String(bos.toByteArray(), "UTF-8");
    }

    private static void write(OutputStream out, int code, String type, byte[] body) throws IOException {
        String reason = code == 200 ? "OK" : (code == 403 ? "Forbidden" : "Not Found");
        String head = "HTTP/1.1 " + code + " " + reason + "\r\n"
                + "Content-Type: " + type + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Connection: close\r\n"
                + "Cache-Control: no-store\r\n"
                + "\r\n";
        out.write(head.getBytes("UTF-8"));
        out.write(body);
        out.flush();
    }

    private static String contentType(String path) {
        String p = path.toLowerCase(Locale.US);
        if (p.endsWith(".html")) return "text/html; charset=utf-8";
        if (p.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".json")) return "application/json; charset=utf-8";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    /** tiny log shim so this file doesn't need android.util in tests */
    private static final class Log2 {
        static void e(String msg, Exception e) {
            android.util.Log.e(MainActivity.TAG, msg, e);
        }
    }
}
