package io.gpsapp.tracker;

import android.util.Log;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

/**
 * NMEA sentence parser for GPS data
 * Parses common NMEA sentences (GPGGA, GPRMC, GPGLL, etc.)
 */
public class NmeaParser {
    private static final String TAG = "NmeaParser";
    
    // NMEA sentence patterns
    private static final Pattern GPGGA_PATTERN = Pattern.compile(
        "\\$[A-Z]{2}(GGA|GNS),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*)\\*([0-9A-Fa-f]{2})"
    );
    
    private static final Pattern GPRMC_PATTERN = Pattern.compile(
        "\\$[A-Z]{2}(RMC),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*)\\*([0-9A-Fa-f]{2})"
    );

    /**
     * Parse NMEA sentence and extract GPS position
     * @param sentence Raw NMEA sentence
     * @return GpsPosition or null if parsing failed
     */
    public static GpsPosition parseNmeaSentence(String sentence) {
        if (sentence == null || sentence.trim().isEmpty()) {
            return null;
        }

        sentence = sentence.trim();
        
        // Validate checksum first
        if (!validateChecksum(sentence)) {
            Log.w(TAG, "Invalid NMEA checksum: " + sentence);
            return null;
        }

        try {
            // Try parsing as GPGGA (Global Positioning System Fix Data)
            GpsPosition position = parseGPGGA(sentence);
            if (position != null) {
                return position;
            }

            // Try parsing as GPRMC (Recommended Minimum Course)
            position = parseGPRMC(sentence);
            if (position != null) {
                return position;
            }

            // Add support for other sentence types as needed
            // GPGLL, GPVTG, etc.

        } catch (Exception e) {
            Log.e(TAG, "Error parsing NMEA sentence: " + sentence, e);
        }

        return null;
    }

    /**
     * Parse GPGGA sentence (Global Positioning System Fix Data)
     * Format: $GPGGA,hhmmss.ss,llll.ll,a,yyyyy.yy,a,x,xx,x.x,x.x,M,x.x,M,x.x,xxxx*hh
     */
    private static GpsPosition parseGPGGA(String sentence) {
        Matcher matcher = GPGGA_PATTERN.matcher(sentence);
        if (!matcher.matches()) {
            return null;
        }

        try {
            // Extract fields
            String time = matcher.group(2);
            String latStr = matcher.group(3);
            String latDir = matcher.group(4);
            String lonStr = matcher.group(5);
            String lonDir = matcher.group(6);
            String quality = matcher.group(7);
            String satellites = matcher.group(8);
            String hdop = matcher.group(9);
            String altitude = matcher.group(10);

            // Check if we have valid position data
            if (latStr.isEmpty() || lonStr.isEmpty() || quality.equals("0")) {
                return null; // No fix
            }

            // Parse coordinates
            double latitude = parseCoordinate(latStr, latDir);
            double longitude = parseCoordinate(lonStr, lonDir);
            
            if (Double.isNaN(latitude) || Double.isNaN(longitude)) {
                return null;
            }
            
            // Reject invalid (0,0) coordinates - device has no valid fix
            if (Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001) {
                Log.w(TAG, "GPGGA: Ignoring (0,0) coordinates - no valid GPS fix");
                return null;
            }

            // Parse other fields
            Double alt = altitude.isEmpty() ? null : Double.parseDouble(altitude);
            Double hdopVal = hdop.isEmpty() ? null : Double.parseDouble(hdop);
            Integer sats = satellites.isEmpty() ? null : Integer.parseInt(satellites);

            // Determine fix type and accuracy
            String fixType = "gps";
            double accuracy = 5.0; // Default GPS accuracy
            
            if (!quality.isEmpty()) {
                int qual = Integer.parseInt(quality);
                switch (qual) {
                    case 1:
                        fixType = "gps";
                        accuracy = hdopVal != null ? hdopVal * 5.0 : 5.0;
                        break;
                    case 2:
                        fixType = "dgps";
                        accuracy = hdopVal != null ? hdopVal * 2.5 : 2.5;
                        break;
                    case 4:
                        fixType = "rtk_fixed";
                        accuracy = 0.02; // 2cm
                        break;
                    case 5:
                        fixType = "rtk_float";
                        accuracy = 0.5; // 50cm
                        break;
                    default:
                        fixType = "gps";
                        break;
                }
            }

            return new GpsPosition(latitude, longitude, alt, accuracy, null, null, hdopVal, sats, fixType);

        } catch (NumberFormatException | ArrayIndexOutOfBoundsException e) {
            Log.w(TAG, "Failed to parse GPGGA: " + sentence, e);
            return null;
        }
    }

    /**
     * Parse GPRMC sentence (Recommended Minimum Course)
     * Format: $GPRMC,hhmmss.ss,A,llll.ll,a,yyyyy.yy,a,x.x,x.x,ddmmyy,x.x,a*hh
     */
    private static GpsPosition parseGPRMC(String sentence) {
        Matcher matcher = GPRMC_PATTERN.matcher(sentence);
        if (!matcher.matches()) {
            return null;
        }

        try {
            // Extract fields
            String time = matcher.group(2);
            String status = matcher.group(3);
            String latStr = matcher.group(4);
            String latDir = matcher.group(5);
            String lonStr = matcher.group(6);
            String lonDir = matcher.group(7);
            String speed = matcher.group(8);
            String heading = matcher.group(9);
            String date = matcher.group(10);

            // Check if data is valid
            if (!status.equals("A") || latStr.isEmpty() || lonStr.isEmpty()) {
                return null; // Invalid or no fix
            }

            // Parse coordinates
            double latitude = parseCoordinate(latStr, latDir);
            double longitude = parseCoordinate(lonStr, lonDir);
            
            if (Double.isNaN(latitude) || Double.isNaN(longitude)) {
                return null;
            }
            
            // Reject invalid (0,0) coordinates - device has no valid fix
            if (Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001) {
                Log.w(TAG, "GPRMC: Ignoring (0,0) coordinates - no valid GPS fix");
                return null;
            }

            // Parse speed and heading
            Double speedVal = speed.isEmpty() ? null : Double.parseDouble(speed) * 0.514444; // Convert knots to m/s
            Double headingVal = heading.isEmpty() ? null : Double.parseDouble(heading);

            // GPRMC doesn't provide accuracy info, use default GPS accuracy
            double accuracy = 5.0;

            return new GpsPosition(latitude, longitude, null, accuracy, headingVal, speedVal, null, null, "gps");

        } catch (NumberFormatException | ArrayIndexOutOfBoundsException e) {
            Log.w(TAG, "Failed to parse GPRMC: " + sentence, e);
            return null;
        }
    }

    /**
     * Parse NMEA coordinate format (ddmm.mmmm or dddmm.mmmm) to decimal degrees
     * Latitude: DDMM.MMMM (2 digits for degrees)
     * Longitude: DDDMM.MMMM (3 digits for degrees)
     */
    private static double parseCoordinate(String coord, String direction) {
        if (coord == null || coord.isEmpty() || direction == null || direction.isEmpty()) {
            return Double.NaN;
        }

        try {
            double raw = Double.parseDouble(coord);
            
            // Determine if this is latitude (N/S) or longitude (E/W)
            // Latitude uses 2 digits for degrees, longitude uses 3
            int degreeDigits = (direction.equals("N") || direction.equals("S")) ? 2 : 3;
            int divisor = (degreeDigits == 2) ? 100 : 1000;
            
            int degrees = (int) (raw / divisor);
            double minutes = raw - (degrees * divisor);
            double decimal = degrees + (minutes / 60.0);
            
            // Apply direction
            if (direction.equals("S") || direction.equals("W")) {
                decimal = -decimal;
            }
            
            return decimal;
        } catch (NumberFormatException e) {
            return Double.NaN;
        }
    }

    /**
     * Validate NMEA sentence checksum
     */
    private static boolean validateChecksum(String sentence) {
        if (!sentence.startsWith("$") || !sentence.contains("*")) {
            return false;
        }

        try {
            int asteriskIndex = sentence.lastIndexOf("*");
            String data = sentence.substring(1, asteriskIndex);
            String checksumStr = sentence.substring(asteriskIndex + 1);
            
            if (checksumStr.length() != 2) {
                return false;
            }

            // Calculate checksum
            int checksum = 0;
            for (char c : data.toCharArray()) {
                checksum ^= c;
            }

            // Compare with provided checksum
            int providedChecksum = Integer.parseInt(checksumStr, 16);
            return checksum == providedChecksum;

        } catch (Exception e) {
            return false;
        }
    }
}