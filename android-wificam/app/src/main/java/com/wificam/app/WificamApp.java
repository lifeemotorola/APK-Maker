package com.wificam.app;

import android.app.Application;
import android.util.Log;

import java.io.IOException;

/**
 * Application entry point: starts the {@link LanServer} (0.0.0.0:8080) for the
 * whole process lifetime, so the phone stays reachable on the LAN even if the
 * activity is destroyed (rotation, recents swipe while the foreground service
 * keeps the process alive). The server needs no runtime permission (INTERNET
 * is install-time), so /status answers even before the camera permission is
 * granted — that is what the computer driver probes during discovery.
 */
public class WificamApp extends Application {

    public LanServer server;

    @Override
    public void onCreate() {
        super.onCreate();
        server = new LanServer(this);
        try {
            server.start();
            Log.d(MainActivity.TAG, "LAN server on 0.0.0.0:" + LanServer.PORT
                    + " ip=" + LanServer.lanIp() + " ips=" + LanServer.lanIps());
        } catch (IOException e) {
            Log.e(MainActivity.TAG, "LAN server failed to start", e);
        }
    }

    @Override
    public void onTerminate() {
        if (server != null) {
            server.stop();
            server = null;
        }
        super.onTerminate();
    }
}
