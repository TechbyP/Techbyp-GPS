package io.gpsapp.tracker;

/**
 * Callback interface for GPS device events
 */
public interface GpsCallback {
    /**
     * Called when a GPS device connects
     */
    void onDeviceConnected(GpsDevice device);
    
    /**
     * Called when a GPS device disconnects
     */
    void onDeviceDisconnected(GpsDevice device);
    
    /**
     * Called when a new GPS position is received
     */
    void onPositionUpdate(GpsPosition position);
    
    /**
     * Called when an error occurs
     */
    void onError(String error);
    
    /**
     * Called when a device is found during scanning
     */
    void onDeviceFound(GpsDevice device);
}