package com.wificam.app;

/** Shared camera controller between the bridge, the server and the service. */
public final class CameraHolder {

    public static volatile CameraController controller;

    private CameraHolder() {
    }
}
