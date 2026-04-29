package io.gpsapp.tracker;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.List;
import java.util.ArrayList;

/**
 * Capacitor Plugin for GPS Device Management
 * Provides unified interface for Bluetooth, WiFi/TCP, and Serial GPS devices
 */
@CapacitorPlugin(name = "GpsDeviceManager")
public class GpsDeviceManagerPlugin extends Plugin {
    private static final String TAG = "GpsDeviceManagerPlugin";
    
    private GpsDeviceManager gpsManager;
    
    @Override
    public void load() {
        super.load();
        gpsManager = new GpsDeviceManager(getContext());
        gpsManager.setCallback(new GpsDeviceManager.GpsDeviceCallback() {
            @Override
            public void onDeviceConnected(GpsDevice device) {
                Log.d(TAG, "Device connected: " + device.getName());
                JSObject data = new JSObject();
                data.put("device", deviceToJSObject(device));
                notifyListeners("deviceConnected", data);
            }
            
            @Override
            public void onDeviceDisconnected(GpsDevice device) {
                Log.d(TAG, "Device disconnected: " + device.getName());
                JSObject data = new JSObject();
                data.put("device", deviceToJSObject(device));
                notifyListeners("deviceDisconnected", data);
            }
            
            @Override
            public void onPositionUpdate(GpsPosition position) {
                // Validate position before sending to JavaScript
                if (!isValidPosition(position)) {
                    return; // Silently ignore invalid positions
                }
                
                JSObject data = new JSObject();
                data.put("position", positionToJSObject(position));
                notifyListeners("positionUpdate", data);
            }
            
            @Override
            public void onError(String error) {
                Log.e(TAG, "GPS error: " + error);
                JSObject data = new JSObject();
                data.put("error", error);
                notifyListeners("error", data);
            }
            
            @Override
            public void onDeviceFound(GpsDevice device) {
                Log.d(TAG, "Device found: " + device.getName());
                JSObject data = new JSObject();
                data.put("device", deviceToJSObject(device));
                notifyListeners("deviceFound", data);
            }
            
            @Override
            public void onScanComplete(List<GpsDevice> devices) {
                Log.d(TAG, "Scan complete: " + devices.size() + " devices found");
            }
            
            @Override
            public void onScanError(String error) {
                Log.e(TAG, "Scan error: " + error);
            }
        });
    }
    
    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject result = new JSObject();
        
        try {
            boolean hasBluetooth = false;
            boolean hasLocation = false;
            
            // Check location permission (required for Bluetooth scan)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                hasLocation = getContext().checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) 
                    == android.content.pm.PackageManager.PERMISSION_GRANTED;
            } else {
                hasLocation = true; // Automatically granted on older versions
            }
            
            // Check Bluetooth permissions (Android 12+)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                boolean hasScan = getContext().checkSelfPermission(android.Manifest.permission.BLUETOOTH_SCAN)
                    == android.content.pm.PackageManager.PERMISSION_GRANTED;
                boolean hasConnect = getContext().checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
                    == android.content.pm.PackageManager.PERMISSION_GRANTED;
                hasBluetooth = hasScan && hasConnect;
            } else {
                hasBluetooth = true; // Legacy Bluetooth permissions handled in manifest
            }
            
            result.put("bluetooth", hasBluetooth);
            result.put("location", hasLocation);
            result.put("granted", hasBluetooth && hasLocation);
            
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Check permissions error", e);
            call.reject("Failed to check permissions: " + e.getMessage());
        }
    }
    
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        try {
            List<String> permissionsNeeded = new ArrayList<>();
            
            // Always need location for Bluetooth scan
            permissionsNeeded.add(android.Manifest.permission.ACCESS_FINE_LOCATION);
            
            // Android 12+ needs explicit Bluetooth permissions
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                permissionsNeeded.add(android.Manifest.permission.BLUETOOTH_SCAN);
                permissionsNeeded.add(android.Manifest.permission.BLUETOOTH_CONNECT);
            }
            
            // Request permissions
            requestPermissionForAliases(
                permissionsNeeded.toArray(new String[0]),
                call,
                "permissionsCallback"
            );
            
        } catch (Exception e) {
            Log.e(TAG, "Request permissions error", e);
            call.reject("Failed to request permissions: " + e.getMessage());
        }
    }
    
    @PluginMethod
    public void scanDevices(PluginCall call) {
        try {
            JSONArray connectionTypesArray = call.getArray("connectionTypes");
            List<String> connectionTypes = new java.util.ArrayList<>();
            
            if (connectionTypesArray != null) {
                for (int i = 0; i < connectionTypesArray.length(); i++) {
                    connectionTypes.add(connectionTypesArray.getString(i));
                }
            } else {
                // Default to all connection types
                connectionTypes.add("bluetooth");
                connectionTypes.add("wifi");
                connectionTypes.add("serial");
            }
            
            int timeout = call.getInt("timeout", 10000);
            
            gpsManager.scanDevices(connectionTypes, timeout, new GpsDeviceManager.ScanCallback() {
                @Override
                public void onScanComplete(List<GpsDevice> devices) {
                    JSObject result = new JSObject();
                    JSONArray devicesArray = new JSONArray();
                    
                    for (GpsDevice device : devices) {
                        devicesArray.put(deviceToJSObject(device));
                    }
                    
                    result.put("devices", devicesArray);
                    call.resolve(result);
                }
                
                @Override
                public void onScanError(String error) {
                    call.reject("Scan failed: " + error);
                }
            });
            
        } catch (Exception e) {
            Log.e(TAG, "Scan devices error", e);
            call.reject("Scan failed: " + e.getMessage());
        }
    }
    
    /**
     * Get list of paired/bonded Bluetooth devices
     * These are devices already connected via Android Bluetooth settings
     */
    @PluginMethod
    public void getPairedBluetoothDevices(PluginCall call) {
        try {
            List<GpsDevice> pairedDevices = gpsManager.getPairedBluetoothDevices();
            
            JSObject result = new JSObject();
            JSONArray devicesArray = new JSONArray();
            
            for (GpsDevice device : pairedDevices) {
                devicesArray.put(deviceToJSObject(device));
            }
            
            result.put("devices", devicesArray);
            call.resolve(result);
            
            Log.d(TAG, "Retrieved " + pairedDevices.size() + " paired Bluetooth devices");
        } catch (Exception e) {
            Log.e(TAG, "Get paired devices error", e);
            call.reject("Failed to get paired devices: " + e.getMessage());
        }
    }
    
    @PluginMethod
    public void connectDevice(PluginCall call) {
        try {
            String deviceId = call.getString("deviceId");
            String address = call.getString("address");
            String connectionType = call.getString("connectionType");
            int port = call.getInt("port", 9001);
            String name = call.getString("name", "GPS Device");
            
            if (address == null || connectionType == null) {
                call.reject("Address and connection type are required");
                return;
            }
            
            // Create device object
            GpsDevice device = new GpsDevice(deviceId, name, address, connectionType);
            device.setPort(port);
            
            gpsManager.connectDevice(device, new GpsDeviceManager.ConnectCallback() {
                @Override
                public void onConnectSuccess(GpsDevice connectedDevice) {
                    JSObject result = new JSObject();
                    result.put("device", deviceToJSObject(connectedDevice));
                    call.resolve(result);
                }
                
                @Override
                public void onConnectError(String error) {
                    call.reject("Connection failed: " + error);
                }
            });
            
        } catch (Exception e) {
            Log.e(TAG, "Connect device error", e);
            call.reject("Connection failed: " + e.getMessage());
        }
    }
    
    @PluginMethod
    public void disconnectDevice(PluginCall call) {
        try {
            gpsManager.disconnect();
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Disconnect device error", e);
            call.reject("Disconnect failed: " + e.getMessage());
        }
    }
    
    @PluginMethod
    public void startPositionStream(PluginCall call) {
        try {
            boolean success = gpsManager.startPositionStream();
            JSObject result = new JSObject();
            result.put("success", success);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Start position stream error", e);
            call.reject("Failed to start position stream: " + e.getMessage());
        }
    }
    
    @PluginMethod
    public void stopPositionStream(PluginCall call) {
        try {
            gpsManager.stopPositionStream();
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Stop position stream error", e);
            call.reject("Failed to stop position stream: " + e.getMessage());
        }
    }
    
    @PluginMethod
    public void getStatus(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("isConnected", gpsManager.isConnected());
            result.put("isStreaming", gpsManager.isStreaming());
            
            GpsDevice connectedDevice = gpsManager.getConnectedDevice();
            if (connectedDevice != null) {
                result.put("connectedDevice", deviceToJSObject(connectedDevice));
            }
            
            GpsPosition lastPosition = gpsManager.getCurrentPosition();
            if (lastPosition != null && isValidPosition(lastPosition)) {
                result.put("position", positionToJSObject(lastPosition));
            } else if (lastPosition != null) {
                Log.w(TAG, "Last position is invalid, not returning to JavaScript");
            }
            
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Get status error", e);
            call.reject("Failed to get status: " + e.getMessage());
        }
    }
    
    /**
     * Convert GpsDevice to JSObject for JavaScript
     */
    private JSObject deviceToJSObject(GpsDevice device) {
        JSObject obj = new JSObject();
        obj.put("id", device.getId());
        obj.put("name", device.getName());
        obj.put("address", device.getAddress());
        obj.put("connectionType", device.getConnectionType());
        obj.put("manufacturer", device.getManufacturer());
        obj.put("model", device.getModel());
        obj.put("isConnected", device.isConnected());
        return obj;
    }
    
    /**
     * Convert GpsPosition to JSObject for JavaScript
     */
    private JSObject positionToJSObject(GpsPosition position) {
        JSObject obj = new JSObject();
        obj.put("latitude", position.getLatitude());
        obj.put("longitude", position.getLongitude());
        obj.put("altitude", position.getAltitude());
        obj.put("accuracy", position.getAccuracy());
        obj.put("timestamp", position.getTimestamp());
        obj.put("heading", position.getHeading());
        obj.put("speed", position.getSpeed());
        obj.put("hdop", position.getHdop());
        obj.put("satellites", position.getSatellites());
        obj.put("fixType", position.getFixType());
        return obj;
    }
    
    /**
     * Validate GPS position before sending to JavaScript
     */
    private boolean isValidPosition(GpsPosition position) {
        if (position == null) {
            return false;
        }
        
        double lat = position.getLatitude();
        double lon = position.getLongitude();
        
        // Check for invalid coordinates
        if (Double.isNaN(lat) || Double.isNaN(lon)) {
            Log.w(TAG, "Invalid GPS position: NaN coordinates");
            return false;
        }
        
        // Check for uninitialized coordinates (0,0)
        if (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001) {
            Log.w(TAG, "Invalid GPS position: coordinates are (0,0) - device has no fix");
            return false;
        }
        
        // Check latitude range
        if (lat < -90.0 || lat > 90.0) {
            Log.w(TAG, "Invalid GPS position: latitude out of range: " + lat);
            return false;
        }
        
        // Check longitude range
        if (lon < -180.0 || lon > 180.0) {
            Log.w(TAG, "Invalid GPS position: longitude out of range: " + lon);
            return false;
        }
        
        return true;
    }
}