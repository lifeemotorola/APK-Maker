package com.fingerlock.app;

import android.app.Activity;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

/**
 * Fingerprint authentication helper, no androidx (offline toolchain):
 *
 *  - API 28+ : platform android.hardware.biometrics.BiometricPrompt
 *              (API 30+ additionally restricts to BIOMETRIC_STRONG |
 *              DEVICE_CREDENTIAL so the device PIN/pattern works as fallback)
 *  - API 23-27: legacy android.hardware.fingerprint.FingerprintManager with an
 *              AndroidKeyStore AES key wrapped in a CryptoObject
 *
 * All entry points are guarded with try/catch (Throwable) so a missing or
 * HAL-disabled sensor degrades to a clean error instead of a crash.
 */
public final class FingerprintAuth {

    public interface Callback {
        void onSuccess();
        void onError(String message);
    }

    /** keep a strong reference while the system dialog is showing */
    private static Object activePrompt; // BiometricPrompt or FingerprintManager.CryptoObject holder

    private FingerprintAuth() {
    }

    /** true when at least one fingerprint is enrolled and usable. */
    public static boolean canAuthenticate(Context ctx) {
        try {
            if (Build.VERSION.SDK_INT >= 28) {
                android.hardware.biometrics.BiometricManager bm =
                        (android.hardware.biometrics.BiometricManager)
                                ctx.getSystemService(android.hardware.biometrics.BiometricManager.class);
                int r;
                if (Build.VERSION.SDK_INT >= 30) {
                    r = bm.canAuthenticate(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_STRONG
                            | android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL);
                } else {
                    r = bm.canAuthenticate();
                }
                return r == android.hardware.biometrics.BiometricManager.BIOMETRIC_SUCCESS;
            } else {
                android.hardware.fingerprint.FingerprintManager fm =
                        (android.hardware.fingerprint.FingerprintManager)
                                ctx.getSystemService(Context.FINGERPRINT_SERVICE);
                return fm != null && fm.hasEnrolledFingerprints();
            }
        } catch (Throwable t) {
            android.util.Log.e(MainActivity.TAG, "canAuthenticate failed", t);
            return false;
        }
    }

    /** Show the system fingerprint prompt. Callback runs on the main thread. */
    public static void showPrompt(final Activity activity, final Callback cb) {
        final Handler main = new Handler(Looper.getMainLooper());
        try {
            if (Build.VERSION.SDK_INT >= 28) {
                showBiometricPrompt(activity, cb, main);
            } else {
                showLegacyFingerprint(activity, cb, main);
            }
        } catch (Throwable t) {
            android.util.Log.e(MainActivity.TAG, "showPrompt failed", t);
            main.post(new Runnable() {
                @Override
                public void run() {
                    cb.onError("fingerprint prompt unavailable: " + t.getMessage());
                }
            });
        }
    }

    private static void showBiometricPrompt(final Activity activity, final Callback cb, Handler main) {
        android.hardware.biometrics.BiometricPrompt.Builder b =
                new android.hardware.biometrics.BiometricPrompt.Builder(activity)
                        .setTitle("Unlock FingerLock")
                        .setSubtitle("Use your fingerprint or device credential")
                        .setDescription("FingerLock protects this screen");
        if (Build.VERSION.SDK_INT >= 30) {
            b.setAllowedAuthenticators(
                    android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_STRONG
                            | android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL);
        }
        b.setNegativeButton("Cancel", activity.getMainExecutor(),
                new android.content.DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(android.content.DialogInterface dialog, int which) {
                        cb.onError("cancelled");
                    }
                });
        final android.hardware.biometrics.BiometricPrompt prompt = b.build();
        activePrompt = prompt;
        // 4-arg overload exists since API 28 (CryptoObject may be null)
        prompt.authenticate(null, null, activity.getMainExecutor(),
                new android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(android.hardware.biometrics.BiometricPrompt.AuthenticationResult result) {
                activePrompt = null;
                cb.onSuccess();
            }

            @Override
            public void onAuthenticationError(int errorCode, CharSequence errString) {
                activePrompt = null;
                cb.onError(errString == null ? "error " + errorCode : errString.toString());
            }

            @Override
            public void onAuthenticationFailed() {
                cb.onError("not recognized — try again");
            }
        });
    }

    @SuppressWarnings("deprecation")
    private static void showLegacyFingerprint(final Activity activity, final Callback cb, Handler main) {
        final android.hardware.fingerprint.FingerprintManager fm =
                (android.hardware.fingerprint.FingerprintManager)
                        activity.getSystemService(Context.FINGERPRINT_SERVICE);
        if (fm == null || !fm.hasEnrolledFingerprints()) {
            cb.onError("no fingerprint enrolled on this device");
            return;
        }
        try {
            javax.crypto.Cipher cipher = createCipher();
            android.hardware.fingerprint.FingerprintManager.CryptoObject crypto =
                    new android.hardware.fingerprint.FingerprintManager.CryptoObject(cipher);
            activePrompt = crypto;
            fm.authenticate(crypto, new android.os.CancellationSignal(), 0,
                    new android.hardware.fingerprint.FingerprintManager.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(
                                android.hardware.fingerprint.FingerprintManager.AuthenticationResult result) {
                            activePrompt = null;
                            cb.onSuccess();
                        }

                        @Override
                        public void onAuthenticationError(int errorCode, CharSequence errString) {
                            activePrompt = null;
                            cb.onError(errString == null ? "error " + errorCode : errString.toString());
                        }

                        @Override
                        public void onAuthenticationFailed() {
                            cb.onError("not recognized — try again");
                        }
                    }, main);
        } catch (Throwable t) {
            cb.onError("fingerprint prompt unavailable: " + t.getMessage());
        }
    }

    @SuppressWarnings("deprecation")
    private static javax.crypto.Cipher createCipher() throws Exception {
        java.security.KeyStore ks = java.security.KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        javax.crypto.KeyGenerator kg = javax.crypto.KeyGenerator.getInstance(
                android.security.keystore.KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        if (Build.VERSION.SDK_INT >= 23) {
            android.security.keystore.KeyGenParameterSpec spec =
                    new android.security.keystore.KeyGenParameterSpec.Builder(
                            "fingerlock_key",
                            android.security.keystore.KeyProperties.PURPOSE_ENCRYPT
                                    | android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
                            .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_CBC)
                            .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_PKCS7)
                            .setUserAuthenticationRequired(false)
                            .build();
            kg.init(spec);
        } else {
            kg.init(256);
        }
        java.security.Key key = kg.generateKey();
        javax.crypto.Cipher cipher = javax.crypto.Cipher.getInstance(
                android.security.keystore.KeyProperties.KEY_ALGORITHM_AES + "/"
                        + android.security.keystore.KeyProperties.BLOCK_MODE_CBC + "/"
                        + android.security.keystore.KeyProperties.ENCRYPTION_PADDING_PKCS7);
        cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, key);
        return cipher;
    }
}
