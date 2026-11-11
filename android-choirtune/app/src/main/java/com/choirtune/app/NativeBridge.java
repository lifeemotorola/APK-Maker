package com.choirtune.app;

import android.webkit.JavascriptInterface;

/**
 * JS <-> native bridge for Choir Tune Finder (exposed as window.ChoirTune).
 * App state (saved tunes library) lives in the app-private files dir as
 * state.json; exports (.txt tune sheet via share sheet, .mid via saveFile)
 * go to the public Downloads/ChoirTune folder.
 */
public class NativeBridge {

    private final MainActivity activity;

    public NativeBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public void startMicrophone() { activity.startMicrophone(); }

    @JavascriptInterface
    public void stopMicrophone() { activity.stopMicrophone(); }

    @JavascriptInterface
    public String platform() {
        return "android";
    }

    @JavascriptInterface
    public String appVersion() {
        return "1.6.2";
    }

    @JavascriptInterface
    public void log(String msg) {
        android.util.Log.d(MainActivity.TAG, "page: " + msg);
    }

    @JavascriptInterface
    public boolean demucsAvailable() { return activity.demucs().available(); }
    @JavascriptInterface
    public String demucsBegin(int bytes) { return activity.demucs().begin(bytes); }
    @JavascriptInterface
    public String demucsAppend(String chunk) { return activity.demucs().append(chunk); }
    @JavascriptInterface
    public String demucsStart() {
        String error = activity.demucs().start();
        activity.keepDemucsAwake(activity.demucs().isRunning());
        return error;
    }
    @JavascriptInterface
    public String demucsStatus() {
        String status = activity.demucs().status();
        activity.keepDemucsAwake(activity.demucs().isRunning());
        return status;
    }
    @JavascriptInterface
    public void demucsCancel() { activity.demucs().cancel(); activity.keepDemucsAwake(false); }

    @JavascriptInterface
    public void demucsExport() { activity.exportDemucsVocals(); }

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

    /** Open the system share sheet with plain text (tune sheet export). */
    @JavascriptInterface
    public void shareText(String title, String text) {
        activity.shareText(title, text);
    }

    /**
     * Save exported bytes to public Downloads/ChoirTune (MediaStore on API 29+,
     * legacy external storage on older devices). Returns the saved path or null.
     * On API <= 28 without the storage permission the save is queued and
     * completed after the user grants it (see MainActivity).
     */
    @JavascriptInterface
    public String saveFile(String filename, String base64Data, String mime) {
        return activity.saveFile(filename, base64Data, mime);
    }
}
