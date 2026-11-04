package com.musicdownloader.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;

/**
 * Music Downloader — Android shell.
 *
 * Serves the bundled web app (assets/www) from a loopback LocalServer and
 * lets the page talk to the internet (archive.org search + downloads are done
 * from Java in NativeBridge, which saves songs into the public Music folder
 * via MediaStore). External http(s) navigation from the page is allowed only
 * for the app itself; cleartext is restricted to 127.0.0.1 (see
 * res/xml/network_security_config.xml).
 */
public class MainActivity extends Activity {

    public static final String TAG = "MusicDL";

    private static final int REQUEST_FILE_CHOOSER = 2001;
    private static final int REQUEST_WRITE_STORAGE = 1003;

    private WebView webView;
    private LocalServer server;
    private ValueCallback<Uri[]> fileChooserCallback;

    // pending legacy-storage download (API 23-28 only), retried after the
    // WRITE_EXTERNAL_STORAGE runtime grant
    private String pendingDlId, pendingDlUrl, pendingDlFile, pendingDlTitle, pendingDlCreator, pendingDlMime, pendingDlCover;

    public void pushJs(final String js) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView != null) webView.evaluateJavascript(js, null);
            }
        });
    }

    public void requestWriteStorageAndRun(String id, String url, String file, String title, String creator, String mime, String cover) {
        pendingDlId = id; pendingDlUrl = url; pendingDlFile = file;
        pendingDlTitle = title; pendingDlCreator = creator; pendingDlMime = mime; pendingDlCover = cover;
        try {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQUEST_WRITE_STORAGE);
        } catch (Exception e) {
            Log.e(TAG, "storage permission request failed", e);
            pushJs("if(window.MusicDL){window.MusicDL.onEvent({type:'error',id:" + org.json.JSONObject.quote(id) + ",message:'storage permission unavailable'})}");
        }
    }

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
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);

        webView.addJavascriptInterface(new NativeBridge(this), "MusicDLNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String scheme = u.getScheme();
                if (scheme != null && (scheme.equals("http") || scheme.equals("https"))) {
                    String host = u.getHost();
                    // the bundled app itself is served from loopback; the app
                    // only ever talks to archive.org over https from JS/Java
                    if (!"127.0.0.1".equals(host) && !"localhost".equals(host)
                            && !"archive.org".equals(host) && !host.endsWith(".archive.org")) {
                        return true;
                    }
                }
                return false;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback,
                                             FileChooserParams fileChooserParams) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = filePathCallback;
                try {
                    startActivityForResult(fileChooserParams.createIntent(), REQUEST_FILE_CHOOSER);
                } catch (Exception e) {
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
        });

        if (port > 0) {
            webView.loadUrl("http://127.0.0.1:" + port + "/");
        } else {
            webView.loadData("<h1 style='font:600 22px system-ui;padding:40px'>"
                    + "The local server could not start.</h1>", "text/html", "UTF-8");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE_CHOOSER) {
            ValueCallback<Uri[]> cb = fileChooserCallback;
            fileChooserCallback = null;
            if (cb != null) {
                Uri[] results = null;
                if (resultCode == Activity.RESULT_OK && data != null) {
                    if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        results = new Uri[count];
                        for (int i = 0; i < count; i++) results[i] = data.getClipData().getItemAt(i).getUri();
                    } else if (data.getData() != null) {
                        results = new Uri[]{data.getData()};
                    }
                }
                cb.onReceiveValue(results);
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQUEST_WRITE_STORAGE) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted && pendingDlId != null) {
                String id = pendingDlId, url = pendingDlUrl, file = pendingDlFile;
                String title = pendingDlTitle, creator = pendingDlCreator, mime = pendingDlMime, cover = pendingDlCover;
                pendingDlId = null;
                new NativeBridge(this).startDownload(id, url, file, title, creator, mime, cover);
            } else {
                pushJs("if(window.MusicDL){window.MusicDL.onEvent({type:'error',id:"
                        + org.json.JSONObject.quote(pendingDlId == null ? "" : pendingDlId)
                        + ",message:'storage permission denied'})}");
                pendingDlId = null;
            }
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
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
