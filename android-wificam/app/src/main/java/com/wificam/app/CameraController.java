package com.wificam.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.ImageFormat;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Log;
import android.util.Size;
import android.view.Surface;

import java.util.Collections;
import java.util.List;

/**
 * Camera2 JPEG capture loop. Opens the requested camera, grabs JPEG frames
 * from an ImageReader at the requested resolution, and pushes them into
 * {@link FrameBus} for the MJPEG stream.
 */
public class CameraController {

    public interface StateListener {
        void onError(String message);
    }

    private final Context context;
    private final StateListener listener;

    private HandlerThread thread;
    private Handler handler;
    private CameraDevice cameraDevice;
    private CameraCaptureSession session;
    private ImageReader reader;
    private CameraManager manager;

    private volatile boolean running;
    private volatile boolean torch;
    private int width = 640;
    private int height = 480;
    private int fps = 15;
    private String cameraId;

    public CameraController(Context context, StateListener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
        this.manager = (CameraManager) this.context.getSystemService(Context.CAMERA_SERVICE);
    }

    public synchronized boolean start(String which, int w, int h, int f) {
        if (running) return true;
        try {
            String want = "0"; // back
            if ("front".equals(which)) {
                String[] ids = manager.getCameraIdList();
                for (String id : ids) {
                    Integer facing = manager.getCameraCharacteristics(id)
                            .get(CameraCharacteristics.LENS_FACING);
                    if (facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT) {
                        want = id;
                        break;
                    }
                }
            }
            cameraId = want;
            // pick the closest supported size
            CameraCharacteristics ch = manager.getCameraCharacteristics(cameraId);
            StreamConfigurationMap map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
            Size[] sizes = map == null ? null : map.getOutputSizes(ImageFormat.JPEG);
            Size best = null;
            if (sizes != null) {
                for (Size s : sizes) {
                    if (s.getWidth() <= w && s.getHeight() <= h) {
                        if (best == null || s.getWidth() * s.getHeight() > best.getWidth() * best.getHeight()) {
                            best = s;
                        }
                    }
                }
            }
            if (best != null) {
                width = best.getWidth();
                height = best.getHeight();
            } else {
                width = w;
                height = h;
            }
            fps = f;

            thread = new HandlerThread("wificam-camera");
            thread.start();
            handler = new Handler(thread.getLooper());

            reader = ImageReader.newInstance(width, height, ImageFormat.JPEG, 2);
            reader.setOnImageAvailableListener(new ImageReader.OnImageAvailableListener() {
                @Override
                public void onImageAvailable(ImageReader r) {
                    Image image = null;
                    try {
                        image = r.acquireLatestImage();
                        if (image == null) return;
                        java.nio.ByteBuffer buf = image.getPlanes()[0].getBuffer();
                        byte[] jpeg = new byte[buf.remaining()];
                        buf.get(jpeg);
                        FrameBus.put(jpeg);
                    } catch (Exception e) {
                        Log.e(MainActivity.TAG, "frame failed", e);
                    } finally {
                        if (image != null) image.close();
                    }
                }
            }, handler);

            final Surface surface = reader.getSurface();
            @SuppressLint("MissingPermission")
            CameraDevice[] holder = new CameraDevice[1];
            manager.openCamera(cameraId, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(CameraDevice camera) {
                    holder[0] = camera;
                    try {
                        cameraDevice = camera;
                        final CaptureRequest.Builder req = camera.createCaptureRequest(
                                CameraDevice.TEMPLATE_RECORD);
                        req.addTarget(surface);
                        req.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE,
                                new android.util.Range<Integer>(fps, fps));
                        camera.createCaptureSession(
                                Collections.singletonList(surface),
                                new CameraCaptureSession.StateCallback() {
                                    @Override
                                    public void onConfigured(CameraCaptureSession s) {
                                        session = s;
                                        try {
                                            s.setRepeatingRequest(req.build(), null, handler);
                                            running = true;
                                            FrameBus.clear();
                                            Log.d(MainActivity.TAG, "camera streaming " + width + "x" + height + "@" + fps);
                                        } catch (CameraAccessException e) {
                                            fail("start repeating failed: " + e.getMessage());
                                        }
                                    }

                                    @Override
                                    public void onConfigureFailed(CameraCaptureSession s) {
                                        fail("session configure failed");
                                    }
                                }, handler);
                    } catch (CameraAccessException e) {
                        fail("capture session failed: " + e.getMessage());
                    }
                }

                @Override
                public void onDisconnected(CameraDevice camera) {
                    camera.close();
                    fail("camera disconnected");
                }

                @Override
                public void onError(CameraDevice camera, int error) {
                    camera.close();
                    fail("camera error " + error);
                }
            }, handler);
            // wait briefly for the session to come up
            long deadline = System.currentTimeMillis() + 4000;
            while (!running && System.currentTimeMillis() < deadline) {
                try {
                    Thread.sleep(50);
                } catch (InterruptedException ignored) {
                }
            }
            return running;
        } catch (Exception e) {
            Log.e(MainActivity.TAG, "camera start failed", e);
            fail("camera start failed: " + e.getMessage());
            return false;
        }
    }

    private void fail(String msg) {
        running = false;
        if (listener != null) listener.onError(msg);
    }

    public synchronized void setTorch(boolean on) {
        torch = on;
        if (session != null && cameraDevice != null) {
            try {
                CaptureRequest.Builder req = cameraDevice.createCaptureRequest(CameraDevice.TEMPLATE_RECORD);
                req.addTarget(reader.getSurface());
                req.set(CaptureRequest.FLASH_MODE,
                        on ? CaptureRequest.FLASH_MODE_TORCH : CaptureRequest.FLASH_MODE_OFF);
                session.setRepeatingRequest(req.build(), null, handler);
            } catch (Exception e) {
                Log.e(MainActivity.TAG, "torch failed", e);
            }
        }
    }

    public synchronized void stop() {
        running = false;
        try {
            if (session != null) session.close();
        } catch (Exception ignored) {
        }
        try {
            if (cameraDevice != null) cameraDevice.close();
        } catch (Exception ignored) {
        }
        try {
            if (reader != null) reader.close();
        } catch (Exception ignored) {
        }
        session = null;
        cameraDevice = null;
        reader = null;
        FrameBus.clear();
        if (thread != null) {
            thread.quitSafely();
            thread = null;
        }
    }

    public boolean isRunning() {
        return running;
    }

    public String getInfo() {
        return width + "x" + height + "@" + fps + " cam=" + cameraId;
    }

    public List<Size> getJpegSizes() {
        try {
            CameraCharacteristics ch = manager.getCameraCharacteristics(cameraId == null ? "0" : cameraId);
            StreamConfigurationMap map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
            Size[] sizes = map == null ? null : map.getOutputSizes(ImageFormat.JPEG);
            if (sizes == null) return Collections.emptyList();
            return java.util.Arrays.asList(sizes);
        } catch (Exception e) {
            return Collections.emptyList();
        }
    }
}
