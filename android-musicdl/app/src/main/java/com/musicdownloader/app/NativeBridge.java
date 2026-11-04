package com.musicdownloader.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * JS <-> native bridge for Music Downloader.
 *
 * Downloads run on a background thread with HttpURLConnection and are saved
 * into the public Music folder:
 *   - API 29+: MediaStore.Audio (RELATIVE_PATH Music/MusicDownloader), no
 *     storage permission needed.
 *   - API 23-28: WRITE_EXTERNAL_STORAGE (requested at runtime) + legacy
 *     file path + MediaScanner notification.
 *
 * Every download is tracked in a SharedPreferences JSON registry so the page
 * can list/progress/play/delete it across restarts; finished files are served
 * back to the page by LocalServer at /dl/<id>.
 */
public class NativeBridge {

    public static final String PREFS_NAME = "musicdl";
    public static final String PREFS_KEY = "downloads";

    private final MainActivity activity;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, Boolean> cancelFlags = new ConcurrentHashMap<String, Boolean>();

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

    /* ------------------------- registry ------------------------- */

    private JSONObject registry() {
        try {
            SharedPreferences prefs = activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            return new JSONObject(prefs.getString(PREFS_KEY, "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private void saveRegistry(JSONObject reg) {
        SharedPreferences prefs = activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(PREFS_KEY, reg.toString()).apply();
    }

    private void putRecord(JSONObject reg, String id, JSONObject rec) throws Exception {
        reg.put(id, rec);
        saveRegistry(reg);
    }

    private void emit(JSONObject ev) {
        activity.pushJs("if(window.MusicDL){window.MusicDL.onEvent(" + ev.toString() + ")}");
    }

    /* ------------------------- downloads ------------------------- */

    @JavascriptInterface
    public String startDownload(final String id, final String url, final String filename,
                                final String title, final String creator, final String mime,
                                final String identifier) {
        if (Build.VERSION.SDK_INT < 29
                && activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                        != PackageManager.PERMISSION_GRANTED) {
            activity.requestWriteStorageAndRun(id, url, filename, title, creator, mime, identifier);
            return "pending-permission";
        }
        pool.execute(new Runnable() {
            @Override
            public void run() {
                runDownload(id, url, filename, title, creator, mime, identifier);
            }
        });
        return "started";
    }

    @JavascriptInterface
    public void cancelDownload(String id) {
        cancelFlags.put(id, Boolean.TRUE);
    }

    @JavascriptInterface
    public String listDownloads() {
        return registry().toString();
    }

    @JavascriptInterface
    public boolean deleteDownload(String id) {
        try {
            JSONObject reg = registry();
            JSONObject rec = reg.optJSONObject(id);
            if (rec == null) return false;
            String uriStr = rec.optString("uri", "");
            if (!uriStr.isEmpty() && Build.VERSION.SDK_INT >= 29) {
                try {
                    activity.getContentResolver().delete(Uri.parse(uriStr), null, null);
                } catch (Exception ignored) {
                }
            } else if (!uriStr.isEmpty()) {
                try {
                    new File(Uri.parse(uriStr).getPath()).delete();
                } catch (Exception ignored) {
                }
            }
            reg.remove(id);
            saveRegistry(reg);
            cancelFlags.remove(id);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void runDownload(String id, String url, String filename, String title, String creator, String mime, String identifier) {
        ContentResolver resolver = activity.getContentResolver();
        Uri outUri = null;
        File legacyFile = null;
        try {
            String safeName = sanitize(filename);
            JSONObject reg = registry();
            JSONObject rec = new JSONObject();
            rec.put("id", id);
            rec.put("url", url);
            rec.put("filename", safeName);
            rec.put("title", title == null ? "" : title);
            rec.put("creator", creator == null ? "" : creator);
            rec.put("mime", mime == null ? "audio/mpeg" : mime);
            rec.put("identifier", identifier == null ? "" : identifier);
            rec.put("status", "downloading");
            rec.put("pct", 0);
            putRecord(reg, id, rec);
            emit(event("progress", rec));

            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(30000);
            conn.setRequestProperty("User-Agent", "MusicDownloader/1.0 (Android)");
            conn.connect();
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
            long total = conn.getContentLength();
            rec.put("size", total);
            InputStream in = conn.getInputStream();

            ContentValues values = new ContentValues();
            values.put(MediaStore.Audio.Media.DISPLAY_NAME, safeName);
            values.put(MediaStore.Audio.Media.MIME_TYPE, mime == null ? "audio/mpeg" : mime);
            if (title != null && !title.isEmpty()) values.put(MediaStore.Audio.Media.TITLE, title);
            if (creator != null && !creator.isEmpty()) values.put(MediaStore.Audio.Media.ARTIST, creator);
            if (Build.VERSION.SDK_INT >= 29) {
                values.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/MusicDownloader");
                values.put(MediaStore.Audio.Media.IS_PENDING, 1);
                outUri = resolver.insert(MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL), values);
            } else {
                outUri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC), "MusicDownloader");
                if (!dir.exists()) dir.mkdirs();
                legacyFile = new File(dir, safeName);
                outUri = Uri.fromFile(legacyFile);
            }
            if (outUri == null) throw new IOException("could not create output");
            OutputStream out = Build.VERSION.SDK_INT >= 29
                    ? resolver.openOutputStream(outUri) : new FileOutputStream(legacyFile);

            byte[] buf = new byte[16384];
            long done = 0;
            int n;
            int lastPct = -1;
            while ((n = in.read(buf)) != -1) {
                if (Boolean.TRUE.equals(cancelFlags.get(id))) {
                    out.close(); in.close();
                    if (Build.VERSION.SDK_INT >= 29) resolver.delete(outUri, null, null);
                    else if (legacyFile != null) legacyFile.delete();
                    rec.put("status", "cancelled");
                    putRecord(registry(), id, rec);
                    emit(event("progress", rec));
                    return;
                }
                out.write(buf, 0, n);
                done += n;
                int pct = total > 0 ? (int) (done * 100 / total) : -1;
                if (pct != lastPct) {
                    lastPct = pct;
                    rec.put("pct", pct);
                    rec.put("done", done);
                    putRecord(registry(), id, rec);
                    emit(event("progress", rec));
                }
            }
            out.close();
            in.close();
            conn.disconnect();

            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues done1 = new ContentValues();
                done1.put(MediaStore.Audio.Media.IS_PENDING, 0);
                resolver.update(outUri, done1, null, null);
            } else {
                MediaScannerConnection.scanFile(activity,
                        new String[]{legacyFile.getAbsolutePath()},
                        new String[]{mime}, null);
            }

            rec.put("status", "done");
            rec.put("pct", 100);
            rec.put("done", done);
            rec.put("size", total > 0 ? total : done);
            rec.put("uri", outUri.toString());
            putRecord(registry(), id, rec);
            cancelFlags.remove(id);
            emit(event("progress", rec));
            emit(event("done", rec));
        } catch (Exception e) {
            android.util.Log.e(MainActivity.TAG, "download failed: " + id, e);
            try {
                JSONObject rec = new JSONObject();
                rec.put("id", id);
                rec.put("status", "error");
                rec.put("message", e.getMessage() == null ? e.toString() : e.getMessage());
                putRecord(registry(), id, rec);
                emit(event("error", rec));
            } catch (Exception ignored) {
            }
            if (outUri != null && Build.VERSION.SDK_INT >= 29) {
                try { activity.getContentResolver().delete(outUri, null, null); } catch (Exception ignored) {}
            }
            if (legacyFile != null) legacyFile.delete();
        }
    }

    private static JSONObject event(String type, JSONObject rec) throws Exception {
        JSONObject ev = new JSONObject();
        ev.put("type", type);
        ev.put("id", rec.optString("id"));
        ev.put("status", rec.optString("status"));
        ev.put("pct", rec.optInt("pct"));
        ev.put("done", rec.optLong("done"));
        ev.put("size", rec.optLong("size"));
        ev.put("filename", rec.optString("filename"));
        ev.put("title", rec.optString("title"));
        ev.put("creator", rec.optString("creator"));
        ev.put("message", rec.optString("message"));
        return ev;
    }

    private static String sanitize(String name) {
        if (name == null || name.trim().isEmpty()) return "song.mp3";
        String s = name.trim().replaceAll("[\\\\/:*?\"<>|]", "_");
        return s.length() > 120 ? s.substring(s.length() - 120) : s;
    }
}
