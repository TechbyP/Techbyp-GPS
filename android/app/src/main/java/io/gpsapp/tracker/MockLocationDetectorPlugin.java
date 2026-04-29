package io.gpsapp.tracker;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import android.Manifest;
import android.location.Location;
import android.location.LocationManager;
import android.location.LocationListener;
import android.content.Context;
import android.os.Bundle;
import android.os.Build;

@CapacitorPlugin(
    name = "MockLocationDetector",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, alias = "location")
    }
)
public class MockLocationDetectorPlugin extends Plugin {
    
    private LocationManager locationManager;
    private Location lastLocation = null;
    
    @Override
    public void load() {
        locationManager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        
        // Start listening for location updates from ALL providers
        try {
            LocationListener locationListener = new LocationListener() {
                @Override
                public void onLocationChanged(Location location) {
                    // Always update to the latest location from any provider
                    if (lastLocation == null || location.getTime() > lastLocation.getTime()) {
                        lastLocation = location;
                        android.util.Log.d("MockLocationDetector", "Location updated from provider: " + location.getProvider() + 
                            " | isMock: " + (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? location.isFromMockProvider() : "unknown") +
                            " | accuracy: " + location.getAccuracy());
                    }
                }
                
                @Override
                public void onStatusChanged(String provider, int status, Bundle extras) {}
                
                @Override
                public void onProviderEnabled(String provider) {}
                
                @Override
                public void onProviderDisabled(String provider) {}
            };
            
            // Listen to ALL available location providers
            java.util.List<String> providers = locationManager.getAllProviders();
            android.util.Log.d("MockLocationDetector", "Available providers: " + providers.toString());
            
            for (String provider : providers) {
                try {
                    locationManager.requestLocationUpdates(provider, 1000, 0, locationListener);
                    android.util.Log.d("MockLocationDetector", "Listening to provider: " + provider);
                } catch (SecurityException | IllegalArgumentException e) {
                    android.util.Log.w("MockLocationDetector", "Cannot listen to provider: " + provider + " - " + e.getMessage());
                }
            }
        } catch (SecurityException e) {
            android.util.Log.e("MockLocationDetector", "Location permission not granted", e);
        }
    }
    
    @PluginMethod
    public void isMockLocation(PluginCall call) {
        JSObject ret = new JSObject();
        
        try {
            // Get the most recent location from any provider
            Location bestLocation = lastLocation;
            
            // Also check last known locations from all providers
            java.util.List<String> providers = locationManager.getAllProviders();
            for (String provider : providers) {
                try {
                    Location providerLocation = locationManager.getLastKnownLocation(provider);
                    if (providerLocation != null) {
                        android.util.Log.d("MockLocationDetector", "Provider " + provider + " location: " + 
                            " | isMock: " + (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? providerLocation.isFromMockProvider() : "unknown") +
                            " | time: " + providerLocation.getTime());
                        
                        if (bestLocation == null || providerLocation.getTime() > bestLocation.getTime()) {
                            bestLocation = providerLocation;
                        }
                    }
                } catch (SecurityException e) {
                    android.util.Log.w("MockLocationDetector", "Cannot access location from provider: " + provider);
                }
            }
            
            if (bestLocation != null) {
                boolean isMock = MockLocationDetector.isMockLocation(bestLocation);
                ret.put("isMock", isMock);
                ret.put("provider", bestLocation.getProvider());
                ret.put("accuracy", bestLocation.getAccuracy());
                ret.put("latitude", bestLocation.getLatitude());
                ret.put("longitude", bestLocation.getLongitude());
                ret.put("time", bestLocation.getTime());
                
                android.util.Log.d("MockLocationDetector", "Returning location check: isMock=" + isMock + 
                    " provider=" + bestLocation.getProvider() + 
                    " accuracy=" + bestLocation.getAccuracy());
            } else {
                ret.put("isMock", false);
                ret.put("error", "No location available yet");
                android.util.Log.w("MockLocationDetector", "No location available from any provider");
            }
        } catch (Exception e) {
            ret.put("isMock", false);
            ret.put("error", e.getMessage());
            android.util.Log.e("MockLocationDetector", "Error checking mock location", e);
        }
        
        call.resolve(ret);
    }
}
