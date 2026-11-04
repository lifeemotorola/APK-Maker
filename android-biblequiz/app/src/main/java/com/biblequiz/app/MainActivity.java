package com.biblequiz.app;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;

/**
 * Bible Quiz — Android shell.
 *
 * Starts a real loopback HTTP server ({@link LocalServer} on 127.0.0.1, random
 * port) that serves the bundled quiz web app (assets/www) and points the
 * WebView at http://127.0.0.1:&lt;port&gt;/ . A real socket is used instead of
 * WebViewClient.shouldInterceptRequest because intercepted frame-navigation
 * responses are not reliably honoured with their Content-Type on every WebView
 * version (the page then renders as raw text).
 *
 * Cleartext is only permitted to 127.0.0.1/localhost (res/xml/
 * network_security_config.xml) and external navigations are blocked, so the
 * app is fully offline. All progress (XP, streaks, saved questions, settings)
 * lives in the page's localStorage.
 */
public class MainActivity extends Activity {

    public static final String TAG = "BibleQuiz";

    private WebView webView;
    private LocalServer server;

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
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);

        // Hardware BACK button -> in-app back stack (window.__back in app.js).
        // Returning false means "at the root screen", so the activity exits.
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void notifyBack() {
                webView.post(new Runnable() {
                    @Override
                    public void run() {
                        webView.evaluateJavascript(
                                "window.__back ? (window.__back() ? '1' : '0') : '0'", null);
                    }
                });
            }
        }, "AndroidBridge");

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
        webView.setWebChromeClient(new WebChromeClient() {
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
        if (webView != null) {
            // Let the web app walk its own screen stack first; only when it
            // reports "not handled" (root screen) do we fall back to the
            // WebView history and then exit the app like a normal APK.
            webView.evaluateJavascript(
                    "window.__back ? (window.__back() ? '1' : '0') : '0'",
                    new android.webkit.ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String value) {
                            boolean handled = "\"1\"".equals(value);
                            if (!handled) {
                                if (webView.canGoBack()) webView.goBack();
                                else MainActivity.super.onBackPressed();
                            }
                        }
                    });
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
