package com.fingerlock.app;

import android.webkit.JavascriptInterface;

/**
 * JS <-> native bridge for FingerLock (exposed to the page as window.FingerLock).
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

    /** true when the device has a usable fingerprint (or device credential) enrolled. */
    @JavascriptInterface
    public boolean isEnrolled() {
        return FingerprintAuth.canAuthenticate(activity);
    }

    /** Show the system fingerprint prompt; result goes to window.FingerLockEvents.onResult. */
    @JavascriptInterface
    public void authenticate() {
        activity.startAuth();
    }

    /** Lock the screen again (persisted). */
    @JavascriptInterface
    public void lock() {
        activity.lockNow();
    }

    /** JSON state for the page: {locked, attempts, maxAttempts, lockoutLeftSec, enrolled} */
    @JavascriptInterface
    public String getState() {
        return activity.stateJson();
    }
}
