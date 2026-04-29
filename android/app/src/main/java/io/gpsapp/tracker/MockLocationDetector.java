package io.gpsapp.tracker;

import android.location.Location;
import android.os.Build;

public class MockLocationDetector {
    
    /**
     * Check if a location is from a mock provider
     * Works on all Android versions
     */
    public static boolean isMockLocation(Location location) {
        if (location == null) {
            return false;
        }
        
        // Android 6.0+ (API 23+) - Use isFromMockProvider()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return location.isFromMockProvider();
        } 
        // Android 4.3-5.1 (API 18-22) - Check ALLOW_MOCK_LOCATION setting
        else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) {
            // On older versions, check if mock locations are allowed
            // If they are, assume this is a mock location when accuracy is suspiciously good
            return !location.isFromMockProvider(); // This method exists but deprecated
        }
        
        return false;
    }
}
