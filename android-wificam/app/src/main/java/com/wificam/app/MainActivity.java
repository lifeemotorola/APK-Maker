package com.wificam.app;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.SurfaceTexture;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * WiFi Cam — main screen.
 *
 * Opens like a normal camera app: a full-screen live preview (TextureView)
 * starts automatically as soon as the CAMERA permission is granted. While the
 * preview runs, the {@link LanServer} (0.0.0.0:8080) streams the same camera
 * as MJPEG at /stream, so a computer on the same WiFi can watch/record it
 * (driver in ../wificam-driver, or OBS Studio directly).
 *
 * Overlay controls: Start/Stop, flip camera, torch. The stream URL is shown
 * on screen for the computer driver / OBS.
 */
public class MainActivity extends Activity
        implements TextureView.SurfaceTextureListener, CameraController.StateListener {

    public static final String TAG = "WiFiCam";

    private static final int REQUEST_CAM_PERMS = 3001;

    private TextureView preview;
    private TextView statusView;
    private TextView urlView;
    private Button startStopBtn;
    private Button flipBtn;
    private Button torchBtn;
    private LanServer server;

    private String camWhich = "back";
    private int camW = 1280;
    private int camH = 720;
    private int camFps = 15;
    private boolean torchOn = false;
    private boolean wantStart = true; // auto-start like the normal camera app
    private Surface previewSurface;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        server = new LanServer(this);
        try {
            server.start();
            Log.d(TAG, "LAN server on 0.0.0.0:" + LanServer.PORT + " ip=" + LanServer.lanIp());
        } catch (IOException e) {
            Log.e(TAG, "LAN server failed to start", e);
        }

        buildUi();

        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestCameraPermission();
        } else {
            ensureCamera();
        }
    }

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        preview = new TextureView(this);
        preview.setSurfaceTextureListener(this);
        root.addView(preview, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setBackgroundColor(0x99000000);
        int pad = dp(10);
        top.setPadding(pad, pad, pad, pad);
        TextView title = new TextView(this);
        title.setText("WiFi Cam");
        title.setTextColor(Color.WHITE);
        title.setTextSize(18);
        title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        statusView = new TextView(this);
        statusView.setTextColor(0xFF8FB0BF);
        statusView.setTextSize(12);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        top.addView(title, titleLp);
        top.addView(statusView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(top, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));

        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setBackgroundColor(0x99000000);
        bottom.setPadding(pad, pad, pad, pad);
        urlView = new TextView(this);
        urlView.setTextColor(0xFF22D3EE);
        urlView.setTextSize(13);
        urlView.setTypeface(android.graphics.Typeface.MONOSPACE);
        bottom.addView(urlView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        TextView hint = new TextView(this);
        hint.setTextColor(0xFFF0B35C);
        hint.setTextSize(11);
        hint.setText("OBS Studio: add a Browser source with the URL above, or on the computer run "
                + "wificam_driver.py --host <phone-ip> --virtual-cam /dev/video0 and add a Video Capture Device");
        bottom.addView(hint, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        TextView hint2 = new TextView(this);
        hint2.setTextColor(0xFF8FB0BF);
        hint2.setTextSize(10);
        hint2.setText("If the PC cannot connect: both must be on the same WiFi (or join this phone's hotspot). "
                + "On the PC run: WificamDriver.exe --diag <phone-ip>   ·   check http://<phone-ip>:8080/status in a PC browser");
        bottom.addView(hint2, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setGravity(Gravity.CENTER);
        startStopBtn = makeButton("Stop");
        flipBtn = makeButton("Flip");
        torchBtn = makeButton("Torch: off");
        buttons.addView(startStopBtn);
        buttons.addView(flipBtn);
        buttons.addView(torchBtn);
        bottom.addView(buttons, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(bottom, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));

        setContentView(root);

        startStopBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (isStreaming()) {
                    wantStart = false;
                    CameraHolder.stopAll(MainActivity.this);
                } else {
                    wantStart = true;
                    ensureCamera();
                }
                updateUi();
            }
        });
        flipBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                camWhich = "back".equals(camWhich) ? "front" : "back";
                if (isStreaming()) {
                    CameraHolder.stopAll(MainActivity.this);
                    ensureCamera();
                }
                updateUi();
            }
        });
        torchBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                torchOn = !torchOn;
                if (CameraHolder.controller != null) CameraHolder.controller.setTorch(torchOn);
                updateUi();
            }
        });

        updateUi();
    }

    private Button makeButton(String text) {
        Button b = new Button(this);
        b.setText(text);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(dp(4), 0, dp(4), 0);
        b.setLayoutParams(lp);
        return b;
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    public void requestCameraPermission() {
        List<String> perms = new ArrayList<String>();
        perms.add(Manifest.permission.CAMERA);
        if (Build.VERSION.SDK_INT >= 33) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        requestPermissions(perms.toArray(new String[0]), REQUEST_CAM_PERMS);
    }

    /** Start the camera (if wanted and permitted) on the current preview surface. */
    private void ensureCamera() {
        if (!wantStart) return;
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestCameraPermission();
            return;
        }
        if (isStreaming()) {
            if (previewSurface != null && CameraHolder.controller != null) {
                CameraHolder.controller.attachPreview(previewSurface);
            }
            return;
        }
        final Surface surf = previewSurface;
        new Thread(new Runnable() {
            @Override
            public void run() {
                final boolean ok = CameraHolder.ensureStarted(
                        MainActivity.this, camWhich, camW, camH, camFps, surf, MainActivity.this);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (!ok) setStatus("camera failed to start", true);
                        updateUi();
                    }
                });
            }
        }, "wificam-start").start();
    }

    private boolean isStreaming() {
        return CameraHolder.controller != null && CameraHolder.controller.isRunning();
    }

    private String statusMsg = "";
    private boolean statusErr = false;

    private void setStatus(String msg, boolean err) {
        statusMsg = msg;
        statusErr = err;
        statusView.setText(msg);
        statusView.setTextColor(err ? 0xFFF87171 : (isStreaming() ? 0xFF34D399 : 0xFF8FB0BF));
    }

    private void updateUi() {
        boolean on = isStreaming();
        startStopBtn.setText(on ? "Stop" : "Start");
        torchBtn.setText("Torch: " + (torchOn ? "on" : "off"));
        String ip = LanServer.lanIp();
        urlView.setText("http://" + ip + ":" + LanServer.PORT + "/stream   (cam: " + camWhich + ")");
        if (on) {
            String info = CameraHolder.controller != null ? CameraHolder.controller.getInfo() : "";
            setStatus("streaming " + info, false);
        } else if (!statusErr) {
            setStatus("camera off", false);
        }
    }

    @Override
    public void onError(final String message) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                setStatus("error: " + message, true);
                updateUi();
            }
        });
    }

    // ---- TextureView.SurfaceTextureListener ----

    @Override
    public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) {
        previewSurface = new Surface(surface);
        ensureCamera();
    }

    @Override
    public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) {
        // preview scales automatically
    }

    @Override
    public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) {
        if (previewSurface != null) {
            previewSurface.release();
            previewSurface = null;
        }
        return true;
    }

    @Override
    public void onSurfaceTextureUpdated(SurfaceTexture surface) {
        // new frame shown
    }

    // ---- permissions ----

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQUEST_CAM_PERMS) {
            boolean denied = false;
            for (int r : grantResults) {
                if (r != PackageManager.PERMISSION_GRANTED) denied = true;
            }
            if (denied) {
                setStatus("camera permission denied", true);
            } else {
                ensureCamera();
            }
            updateUi();
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    @Override
    protected void onDestroy() {
        wantStart = false;
        CameraHolder.stopAll(this);
        if (server != null) {
            server.stop();
            server = null;
        }
        if (previewSurface != null) {
            previewSurface.release();
            previewSurface = null;
        }
        super.onDestroy();
    }
}
