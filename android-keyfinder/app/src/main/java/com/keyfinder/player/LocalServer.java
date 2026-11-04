package com.keyfinder.player;

import android.content.Context;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Tiny HTTP/1.1 server bound to 127.0.0.1 that serves the bundled KeyFinder
 * Player web app (assets/www) to the WebView at http://127.0.0.1:&lt;port&gt;/ .
 *
 * A real loopback socket is used instead of WebViewClient.shouldInterceptRequest
 * because intercepted frame-navigation responses are not reliably honoured with
 * their Content-Type on every WebView version (the page then renders as raw
 * text). Standard HTTP semantics also make fetch('demos/....wav') for the
 * in-page key analysis work everywhere.
 */
public class LocalServer {

    private final Context context;
    private ServerSocket serverSocket;
    private ExecutorService pool;
    private volatile boolean running;

    public LocalServer(Context context) {
        this.context = context.getApplicationContext();
    }

    public int start() throws IOException {
        serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        pool = Executors.newCachedThreadPool();
        running = true;
        final int port = serverSocket.getLocalPort();
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
                        if (running) {
                            android.util.Log.e(MainActivity.TAG, "accept failed", e);
                        }
                    }
                }
            }
        }, "keyfinder-http-accept");
        accept.setDaemon(true);
        accept.start();
        return port;
    }

    public void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
        if (pool != null) pool.shutdownNow();
    }

    private void handle(Socket client) {
        try {
            client.setSoTimeout(15000);
            InputStream in = client.getInputStream();
            OutputStream out = client.getOutputStream();

            // read request line + headers (we only need the path)
            String requestLine = readLine(in);
            if (requestLine == null) {
                client.close();
                return;
            }
            String path = requestLine.split(" ")[1];
            // drain headers
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                // ignore
            }

            if (path.contains("..")) {
                writeResponse(out, 403, "text/plain", "forbidden".getBytes("UTF-8"));
                client.close();
                return;
            }
            if (path.equals("/") || path.equals("/index.html")) path = "/index.html";
            if (path.startsWith("/?")) path = "/index.html";

            String assetPath = "www" + path;
            try {
                InputStream asset = context.getAssets().open(assetPath);
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = asset.read(buf)) != -1) bos.write(buf, 0, n);
                asset.close();
                byte[] body = bos.toByteArray();
                writeResponse(out, 200, contentType(path), body);
            } catch (IOException notFound) {
                writeResponse(out, 404, "text/plain", "not found".getBytes("UTF-8"));
            }
            client.close();
        } catch (Exception e) {
            try {
                client.close();
            } catch (IOException ignored) {
            }
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

    private static void writeResponse(OutputStream out, int code, String type, byte[] body)
            throws IOException {
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
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".json")) return "application/json; charset=utf-8";
        if (p.endsWith(".wav")) return "audio/wav";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".ogg")) return "audio/ogg";
        if (p.endsWith(".m4a")) return "audio/mp4";
        if (p.endsWith(".flac")) return "audio/flac";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }
}
