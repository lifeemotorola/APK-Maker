package com.keyfinder.player;

import android.webkit.JavascriptInterface;

/**
 * Minimal JS <-> native bridge for the KeyFinder Player shell.
 * The heavy lifting (audio decode + key/chord/key-signature analysis) runs
 * in JavaScript inside the WebView — window.KeyFinder from keyfinder.js.
 */
public class NativeBridge {

    private final MainActivity activity;

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
}
