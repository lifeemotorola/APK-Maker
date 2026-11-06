package com.pastoral.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

/**
 * Pastoral — sermon studio APK.
 *
 * Bundled web app (assets/www, loaded via file:// — fully offline, no network
 * permission) + window.Pastoral bridge for state persistence (state.json in
 * the app-private files dir) and text sharing (ACTION_SEND). The KJV Bible
 * (bibles/kjv.js) is bundled as www/bibles/kjv.js for the scripture browser.
 */
public class MainActivity extends Activity {

    public static final String TAG = "Pastoral";

    private static final String STATE_FILE = "state.json";

    private WebView webView;
    private NativeBridge bridge;

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
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        bridge = new NativeBridge(this);
        webView.addJavascriptInterface(bridge, "Pastoral");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, "JS[" + m.sourceId() + ":" + m.lineNumber() + "] " + m.message());
                return true;
            }
        });
        webView.loadUrl("file:///android_asset/www/index.html");
    }

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

    public void shareText(String title, String text) {
        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_SUBJECT, title);
            send.putExtra(Intent.EXTRA_TEXT, text);
            startActivity(Intent.createChooser(send, title));
        } catch (Exception e) {
            Log.e(TAG, "share failed", e);
            pushJs("if(window.PastoralEvents){window.PastoralEvents.onError("
                    + org.json.JSONObject.quote("share failed: " + e.getMessage()) + ")}");
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
}
