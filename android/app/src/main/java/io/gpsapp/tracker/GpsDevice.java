package io.gpsapp.tracker;

import java.util.UUID;

/**
 * Represents a GPS device that can be connected to
 * Supports Bluetooth, WiFi/TCP, and Serial/USB connections
 */
public class GpsDevice {
    private String id;
    private String name;
    private String address;
    private String connectionType;
    private String manufacturer;
    private String model;
    private boolean isConnected;
    private int port = 9001;
    private long lastSeen;

    public GpsDevice(String id, String name, String address, String connectionType) {
        this.id = id != null ? id : UUID.randomUUID().toString();
        this.name = name;
        this.address = address;
        this.connectionType = connectionType;
        this.isConnected = false;
        this.lastSeen = System.currentTimeMillis();
    }

    // Getters
    public String getId() { return id; }
    public String getName() { return name; }
    public String getAddress() { return address; }
    public String getConnectionType() { return connectionType; }
    public String getManufacturer() { return manufacturer; }
    public String getModel() { return model; }
    public boolean isConnected() { return isConnected; }
    public int getPort() { return port; }
    public long getLastSeen() { return lastSeen; }

    // Setters
    public void setName(String name) { this.name = name; }
    public void setManufacturer(String manufacturer) { this.manufacturer = manufacturer; }
    public void setModel(String model) { this.model = model; }
    public void setConnected(boolean connected) { this.isConnected = connected; }
    public void setPort(int port) { this.port = port; }
    public void setLastSeen(long lastSeen) { this.lastSeen = lastSeen; }

    @Override
    public String toString() {
        return String.format("GpsDevice{id='%s', name='%s', address='%s', type='%s', connected=%s}",
                id, name, address, connectionType, isConnected);
    }

    @Override
    public boolean equals(Object obj) {
        if (this == obj) return true;
        if (obj == null || getClass() != obj.getClass()) return false;
        GpsDevice device = (GpsDevice) obj;
        return address.equals(device.address) && connectionType.equals(device.connectionType);
    }

    @Override
    public int hashCode() {
        return (address + connectionType).hashCode();
    }
}