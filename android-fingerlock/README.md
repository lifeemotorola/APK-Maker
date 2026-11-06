# FingerLock (Android APK)

A **fingerprint lock-screen app** (`com.fingerlock.app`, built by
`android-fingerlock/build.sh` -> `FingerLock.apk`).

- Opens straight into a **lock screen**; the app is locked every time it starts
  (state persisted in SharedPreferences).
- **Unlock with fingerprint** via the system prompt — platform `BiometricPrompt`
  on API 28+ (with `BIOMETRIC_STRONG | DEVICE_CREDENTIAL`, so the device
  PIN/pattern works as fallback) and legacy `FingerprintManager` +
  AndroidKeyStore `CryptoObject` on API 23-27. No androidx needed (offline
  toolchain).
- After 5 failed attempts the prompt is **locked out for 30 s**; attempts and
  lock state survive restarts.
- After a successful authentication the app shows an **unlocked home screen**
  (live clock + protected-content demo) with a **Lock again** button.
- Enrollment check (`canAuthenticate`) — if no fingerprint is enrolled the page
  shows a hint to add one in Settings first.
- The UI is a bundled web page loaded via `file:///android_asset/www/` (no
  network permission needed) driving the native side through the
  `window.FingerLock` bridge (`isEnrolled`, `authenticate`, `lock`, `getState`).

## Layout

```
android-fingerlock/
  build.sh                  # offline APK build pipeline (6 steps)
  app/src/main/AndroidManifest.xml   # USE_BIOMETRIC + USE_FINGERPRINT
  app/src/main/java/com/fingerlock/app/
    MainActivity.java       # WebView shell, JS bridge wiring, attempts/lockout, persisted state
    NativeBridge.java       # window.FingerLock: isEnrolled/authenticate/lock/getState
    FingerprintAuth.java    # BiometricPrompt (28+) / FingerprintManager+CryptoObject (23-27)
  web/                      # lock screen page + unlocked home (icon, styles, logic, test_web.mjs)
```

## Test

```
node android-fingerlock/web/test_web.mjs
./android-fingerlock/build.sh
```
