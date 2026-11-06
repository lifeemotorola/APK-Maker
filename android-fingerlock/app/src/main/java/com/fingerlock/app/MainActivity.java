package com.fingerlock.app;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ConsoleMessage;

/**
 * FingerLock — fingerprint lock-screen APK.
 *
 * The UI is a bundled web page (assets/www, loaded via file://) that talks to
 * the native side through window.FingerLock. Unlocking uses the system
 * fingerprint prompt (BiometricPrompt on API 28+, legacy FingerprintManager on
 * 23-27). The app always starts LOCKED; failed attempts are counted and after
 * MAX_ATTEMPTS the prompt is locked out for LOCKOUT_SECONDS.
 */
public class MainActivity extends Activity {

    public static final String TAG = "FingerLock";

    private static final int MAX_ATTEMPTS = 5;
    private static final int LOCKOUT_SECONDS = 30;
    private static final String PREFS = "fingerlock";

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
        webView.addJavascriptInterface(bridge, "FingerLock");
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

    @Override
    protected void onResume() {
        super.onResume();
        // always come back locked; page re-reads state via getState()
        pushJs("if(window.FingerLockEvents){window.FingerLockEvents.onState(" + stateJson() + ")}");
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    public String stateJson() {
        SharedPreferences p = prefs();
        long lockoutLeft = Math.max(0, p.getLong("lockoutUntil", 0) - System.currentTimeMillis()) / 1000;
        boolean locked = p.getBoolean("locked", true);
        return "{\"locked\":" + locked
                + ",\"attempts\":" + p.getInt("attempts", 0)
                + ",\"maxAttempts\":" + MAX_ATTEMPTS
                + ",\"lockoutLeftSec\":" + lockoutLeft
                + ",\"enrolled\":" + FingerprintAuth.canAuthenticate(this) + "}";
    }

    /** Called by the bridge: show the fingerprint prompt (with lockout guard). */
    public void startAuth() {
        long now = System.currentTimeMillis();
        long lockoutUntil = prefs().getLong("lockoutUntil", 0);
        if (now < lockoutUntil) {
            long left = (lockoutUntil - now) / 1000;
            pushJs("if(window.FingerLockEvents){window.FingerLockEvents.onResult(false,'too many attempts — wait " + left + "s'," + stateJson() + ")}");
            return;
        }
        FingerprintAuth.showPrompt(this, new FingerprintAuth.Callback() {
            @Override
            public void onSuccess() {
                SharedPreferences.Editor e = prefs().edit();
                e.putBoolean("locked", false);
                e.putInt("attempts", 0);
                e.putLong("lockoutUntil", 0);
                e.apply();
                pushJs("if(window.FingerLockEvents){window.FingerLockEvents.onResult(true,'unlocked'," + stateJson() + ")}");
            }

            @Override
            public void onError(String message) {
                SharedPreferences p = prefs();
                int attempts = p.getInt("attempts", 0) + 1;
                SharedPreferences.Editor e = p.edit();
                e.putInt("attempts", attempts);
                if (attempts >= MAX_ATTEMPTS) {
                    e.putLong("lockoutUntil", System.currentTimeMillis() + LOCKOUT_SECONDS * 1000L);
                    e.putInt("attempts", 0);
                }
                e.apply();
                pushJs("if(window.FingerLockEvents){window.FingerLockEvents.onResult(false,"
                        + org.json.JSONObject.quote(message) + "," + stateJson() + ")}");
            }
        });
    }

    /** Called by the bridge: lock again. */
    public void lockNow() {
        prefs().edit().putBoolean("locked", true).putInt("attempts", 0).apply();
        pushJs("if(window.FingerLockEvents){window.FingerLockEvents.onState(" + stateJson() + ")}");
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
