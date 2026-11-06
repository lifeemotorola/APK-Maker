package com.pastoral.app;

import android.webkit.JavascriptInterface;

/**
 * JS <-> native bridge for Pastoral (exposed to the page as window.Pastoral).
 * Storage lives in the app-private files dir (state.json); sharing uses the
 * system share sheet.
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

    /** The whole app state as a JSON string ("{}" when empty). */
    @JavascriptInterface
    public String loadState() {
        return activity.loadState();
    }

    /** Persist the whole app state (JSON string from the page). */
    @JavascriptInterface
    public boolean saveState(String json) {
        return activity.saveState(json);
    }

    /** Open the system share sheet with plain text (sermon export / backup). */
    @JavascriptInterface
    public void shareText(String title, String text) {
        activity.shareText(title, text);
    }
}
