package io.gpsapp.tracker;

/**
 * Represents a GPS position with all standard NMEA data fields
 */
public class GpsPosition {
    private double latitude;
    private double longitude;
    private Double altitude;
    private double accuracy;
    private long timestamp;
    private Double heading;
    private Double speed;
    private Double hdop;
    private Integer satellites;
    private String fixType;

    public GpsPosition(double latitude, double longitude, double accuracy) {
        this.latitude = latitude;
        this.longitude = longitude;
        this.accuracy = accuracy;
        this.timestamp = System.currentTimeMillis();
        this.fixType = "gps";
    }

    public GpsPosition(double latitude, double longitude, Double altitude, double accuracy, 
                      Double heading, Double speed, Double hdop, Integer satellites, String fixType) {
        this.latitude = latitude;
        this.longitude = longitude;
        this.altitude = altitude;
        this.accuracy = accuracy;
        this.heading = heading;
        this.speed = speed;
        this.hdop = hdop;
        this.satellites = satellites;
        this.fixType = fixType != null ? fixType : "gps";
        this.timestamp = System.currentTimeMillis();
    }

    // Getters
    public double getLatitude() { return latitude; }
    public double getLongitude() { return longitude; }
    public Double getAltitude() { return altitude; }
    public double getAccuracy() { return accuracy; }
    public long getTimestamp() { return timestamp; }
    public Double getHeading() { return heading; }
    public Double getSpeed() { return speed; }
    public Double getHdop() { return hdop; }
    public Integer getSatellites() { return satellites; }
    public String getFixType() { return fixType; }

    // Setters
    public void setLatitude(double latitude) { this.latitude = latitude; }
    public void setLongitude(double longitude) { this.longitude = longitude; }
    public void setAltitude(Double altitude) { this.altitude = altitude; }
    public void setAccuracy(double accuracy) { this.accuracy = accuracy; }
    public void setTimestamp(long timestamp) { this.timestamp = timestamp; }
    public void setHeading(Double heading) { this.heading = heading; }
    public void setSpeed(Double speed) { this.speed = speed; }
    public void setHdop(Double hdop) { this.hdop = hdop; }
    public void setSatellites(Integer satellites) { this.satellites = satellites; }
    public void setFixType(String fixType) { this.fixType = fixType; }

    @Override
    public String toString() {
        return String.format("GpsPosition{lat=%.6f, lon=%.6f, alt=%.1f, acc=%.2f, fix=%s, sats=%d}",
                latitude, longitude, altitude != null ? altitude : 0.0, accuracy, fixType, satellites != null ? satellites : 0);
    }
}