package com.choirtune.app;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * Choir Tune Finder — APK shell.
 *
 * Bundled web app (assets/www, loaded via file:// — fully offline) that
 * extracts the main melody ("the choir's tune") from an uploaded song.
 * window.ChoirTune bridge: state persistence (state.json in filesDir),
 * ACTION_SEND text sharing, and saveFile() for exports (Downloads/ChoirTune).
 * <input type="file"> works via onShowFileChooser (system document picker).
 */
public class MainActivity extends Activity {

    public static final String TAG = "ChoirTune";

    private static final String STATE_FILE = "state.json";
    private static final int REQUEST_FILE_CHOOSER = 1001;
    private static final int REQUEST_STORAGE_PERMISSION = 1002;

    private WebView webView;
    private NativeBridge bridge;
    private ValueCallback<Uri[]> fileChooserCallback;
    private String pendingSaveName;
    private String pendingSaveData;
    private String pendingSaveMime;

    public void pushJs(final String js) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView != null) webView.evaluateJavascript(js, null);
            }
        });
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true); // picked song files are content:// URIs
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        bridge = new NativeBridge(this);
        webView.addJavascriptInterface(bridge, "ChoirTune");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !url.startsWith("file:///android_asset/www/");
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, "JS[" + m.sourceId() + ":" + m.lineNumber() + "] " + m.message());
                return true;
            }

            // File picker for <input type="file"> (song upload)
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
        });
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE_CHOOSER) {
            ValueCallback<Uri[]> cb = fileChooserCallback;
            fileChooserCallback = null;
            if (cb == null) return;
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                Uri uri = data.getData();
                if (uri != null) {
                    results = new Uri[]{uri};
                } else if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    results = new Uri[n];
                    for (int i = 0; i < n; i++) results[i] = data.getClipData().getItemAt(i).getUri();
                }
            }
            cb.onReceiveValue(results);
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQUEST_STORAGE_PERMISSION) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED
                    && pendingSaveName != null) {
                String name = pendingSaveName, data = pendingSaveData, mime = pendingSaveMime;
                pendingSaveName = null;
                pendingSaveData = null;
                pendingSaveMime = null;
                String path = saveFileNow(name, data, mime);
                pushJs("if(window.ChoirTuneEvents){window.ChoirTuneEvents.onSaved("
                    + org.json.JSONObject.quote(path == null ? "Export failed" : "Export saved: " + path) + ")}");
            } else {
                pendingSaveName = null;
                pendingSaveData = null;
                pendingSaveMime = null;
                pushJs("if(window.ChoirTuneEvents){window.ChoirTuneEvents.onError("
                        + org.json.JSONObject.quote("storage permission denied — export not saved") + ")}");
            }
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    // ------------------------------------------------------------------
    // State (app-private files dir)
    // ------------------------------------------------------------------

    private File stateFile() {
        return new File(getFilesDir(), STATE_FILE);
    }

    public String loadState() {
        File f = stateFile();
        if (!f.exists()) return "{}";
        try {
            FileInputStream in = new FileInputStream(f);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) != -1) bos.write(buf, 0, n);
            in.close();
            return new String(bos.toByteArray(), "UTF-8");
        } catch (IOException e) {
            Log.e(TAG, "loadState failed", e);
            return "{}";
        }
    }

    public boolean saveState(String json) {
        try {
            FileOutputStream out = new FileOutputStream(stateFile());
            out.write(json.getBytes("UTF-8"));
            out.close();
            return true;
        } catch (IOException e) {
            Log.e(TAG, "saveState failed", e);
            return false;
        }
    }

    // ------------------------------------------------------------------
    // Sharing + saving exports
    // ------------------------------------------------------------------

    public void shareText(String title, String text) {
        runOnUiThread(new Runnable() { public void run() {
        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_SUBJECT, title);
            send.putExtra(Intent.EXTRA_TEXT, text);
            startActivity(Intent.createChooser(send, title));
        } catch (Exception e) {
            Log.e(TAG, "share failed", e);
            pushJs("if(window.ChoirTuneEvents){window.ChoirTuneEvents.onError("
                    + org.json.JSONObject.quote("share failed: " + e.getMessage()) + ")}");
        }
        }});
    }

    public String saveFile(String filename, String base64Data, String mime) {
        if (Build.VERSION.SDK_INT < 29
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                        != PackageManager.PERMISSION_GRANTED) {
            pendingSaveName = filename;
            pendingSaveData = base64Data;
            pendingSaveMime = mime;
            try {
                runOnUiThread(new Runnable() { public void run() {
                    requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},
                        REQUEST_STORAGE_PERMISSION);
                }});
            } catch (Exception e) {
                pendingSaveName = null;
                pendingSaveData = null;
                pendingSaveMime = null;
                return null;
            }
            return "pending-permission";
        }
        return saveFileNow(filename, base64Data, mime);
    }

    private String saveFileNow(String filename, String base64Data, String mime) {
        try {
            String safeName = filename.replaceAll("[^A-Za-z0-9_.-]", "_");
            if (safeName.isEmpty()) safeName = "choirtune_export.bin";
            byte[] data = Base64.decode(base64Data, Base64.DEFAULT);
            String displayMime = (mime == null || mime.isEmpty()) ? "application/octet-stream" : mime;

            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                cv.put(MediaStore.Downloads.MIME_TYPE, displayMime);
                cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/ChoirTune");
                cv.put(MediaStore.Downloads.IS_PENDING, 1);
                ContentResolver resolver = getContentResolver();
                Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) return null;
                try (OutputStream os = resolver.openOutputStream(uri)) {
                    if (os == null) return null;
                    os.write(data);
                    os.flush();
                }
                cv.clear();
                cv.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(uri, cv, null, null);
                return "Downloads/ChoirTune/" + safeName;
            } else {
                //noinspection deprecation
                File dir = new File(Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_DOWNLOADS), "ChoirTune");
                if (!dir.exists() && !dir.mkdirs()) return null;
                File f = new File(dir, safeName);
                try (FileOutputStream fos = new FileOutputStream(f)) {
                    fos.write(data);
                    fos.flush();
                }
                android.media.MediaScannerConnection.scanFile(this,
                        new String[]{f.getAbsolutePath()},
                        new String[]{displayMime}, null);
                return f.getAbsolutePath();
            }
        } catch (Exception e) {
            Log.e(TAG, "saveFile failed", e);
            pushJs("if(window.ChoirTuneEvents){window.ChoirTuneEvents.onError("
                    + org.json.JSONObject.quote("save failed: " + e.getMessage()) + ")}");
            return null;
        }
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
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
