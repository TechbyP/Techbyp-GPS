package io.gpsapp.tracker;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.util.Log;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class BluetoothGpsManager {
    private static final String TAG = "BluetoothGpsManager";
    
    // Standard SPP UUID for Serial Port Profile
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    
    private Context context;
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothSocket bluetoothSocket;
    private BluetoothDevice connectedDevice;
    private ExecutorService executorService;
    private GpsCallback gpsCallback;
    private boolean isScanning = false;
    private boolean isConnected = false;
    private boolean isStreamingPosition = false;
    private Thread dataReaderThread;
    
    private List<BluetoothDevice> discoveredDevices = new ArrayList<>();
    
    public BluetoothGpsManager(Context context) {
        this.context = context;
        this.bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();
        this.executorService = Executors.newSingleThreadExecutor();
    }
    
    public void setGpsCallback(GpsCallback callback) {
        this.gpsCallback = callback;
    }
    
    public boolean isBluetoothSupported() {
        return bluetoothAdapter != null;
    }
    
    public boolean isBluetoothEnabled() {
        return bluetoothAdapter != null && bluetoothAdapter.isEnabled();
    }
    
    /**
     * Get list of already paired/bonded Bluetooth devices
     * This returns devices that are already connected via Bluetooth settings
     */
    public List<GpsDevice> getPairedDevices() {
        List<GpsDevice> pairedDevices = new ArrayList<>();
        
        if (!isBluetoothEnabled()) {
            Log.w(TAG, "Bluetooth not enabled, cannot get paired devices");
            return pairedDevices;
        }
        
        try {
            Set<BluetoothDevice> bondedDevices = bluetoothAdapter.getBondedDevices();
            Log.d(TAG, "Found " + bondedDevices.size() + " paired Bluetooth devices");
            
            for (BluetoothDevice device : bondedDevices) {
                String deviceName = device.getName();
                if (deviceName == null) {
                    deviceName = "Unknown Device";
                }
                
                GpsDevice gpsDevice = new GpsDevice(
                    "bt_" + device.getAddress().replace(":", ""),
                    deviceName,
                    device.getAddress(),
                    "bluetooth"
                );
                pairedDevices.add(gpsDevice);
                
                Log.d(TAG, "Paired device: " + deviceName + " (" + device.getAddress() + ")");
            }
        } catch (SecurityException e) {
            Log.e(TAG, "Permission denied to access paired devices", e);
        } catch (Exception e) {
            Log.e(TAG, "Failed to get paired devices", e);
        }
        
        return pairedDevices;
    }
    
    public void scanDevices(int timeout, GpsDeviceManager.ScanCallback callback) {
        scanDevices();
        
        // Set a timeout for the scan
        executorService.execute(() -> {
            try {
                Thread.sleep(timeout);
                if (isScanning) {
                    stopScan();
                    List<GpsDevice> devices = new ArrayList<>();
                    for (BluetoothDevice btDevice : discoveredDevices) {
                        GpsDevice gpsDevice = new GpsDevice(
                            "bt_" + btDevice.getAddress().replace(":", ""),
                            btDevice.getName() != null ? btDevice.getName() : "Unknown Device",
                            btDevice.getAddress(),
                            "bluetooth"
                        );
                        devices.add(gpsDevice);
                    }
                    callback.onScanComplete(devices);
                }
            } catch (InterruptedException e) {
                callback.onScanError("Scan interrupted");
            }
        });
    }
    
    public void scanDevices() {
        if (!isBluetoothEnabled()) {
            Log.w(TAG, "Bluetooth not enabled, cannot scan for devices");
            if (gpsCallback != null) {
                gpsCallback.onError("Bluetooth is not enabled");
            }
            return;
        }
        
        if (isScanning) {
            Log.d(TAG, "Already scanning for devices");
            return;
        }
        
        isScanning = true;
        discoveredDevices.clear();
        
        // Register receiver for discovered devices
        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
        context.registerReceiver(discoveryReceiver, filter);
        
        // Start discovery
        if (bluetoothAdapter.startDiscovery()) {
            Log.d(TAG, "Started Bluetooth device discovery");
            // Scan started - no specific callback needed
        } else {
            Log.e(TAG, "Failed to start Bluetooth discovery");
            isScanning = false;
            if (gpsCallback != null) {
                gpsCallback.onError("Failed to start Bluetooth scan");
            }
        }
        
        // Also add paired devices
        Set<BluetoothDevice> pairedDevices = bluetoothAdapter.getBondedDevices();
        if (pairedDevices.size() > 0) {
            for (BluetoothDevice device : pairedDevices) {
                if (!discoveredDevices.contains(device)) {
                    discoveredDevices.add(device);
                    if (gpsCallback != null) {
                        GpsDevice gpsDevice = new GpsDevice(
                            "bt_" + device.getAddress().replace(":", ""),
                            device.getName() != null ? device.getName() : "Unknown Device",
                            device.getAddress(),
                            "bluetooth"
                        );
                        gpsCallback.onDeviceFound(gpsDevice);
                    }
                }
            }
        }
    }
    
    public void stopScan() {
        if (isScanning) {
            bluetoothAdapter.cancelDiscovery();
            isScanning = false;
            try {
                context.unregisterReceiver(discoveryReceiver);
            } catch (IllegalArgumentException e) {
                Log.w(TAG, "Discovery receiver was not registered");
            }
        }
    }
    
    public void connectDevice(GpsDevice device, GpsDeviceManager.ConnectCallback callback) {
        connectDevice(device.getAddress(), callback);
    }
    
    public void connectDevice(String deviceAddress) {
        connectDevice(deviceAddress, null);
    }
    
    public void connectDevice(String deviceAddress, GpsDeviceManager.ConnectCallback callback) {
        if (isConnected) {
            Log.w(TAG, "Already connected to a device");
            return;
        }
        
        BluetoothDevice device = bluetoothAdapter.getRemoteDevice(deviceAddress);
        if (device == null) {
            Log.e(TAG, "Device not found: " + deviceAddress);
            if (gpsCallback != null) {
                gpsCallback.onError("Device not found: " + deviceAddress);
            }
            return;
        }
        
        executorService.execute(() -> {
            try {
                // Stop discovery to improve connection performance
                if (bluetoothAdapter.isDiscovering()) {
                    bluetoothAdapter.cancelDiscovery();
                }
                
                // Create socket
                bluetoothSocket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                
                Log.d(TAG, "Connecting to device: " + device.getName() + " (" + deviceAddress + ")");
                
                // Connect to the device
                bluetoothSocket.connect();
                
                connectedDevice = device;
                isConnected = true;
                
                Log.i(TAG, "Successfully connected to " + device.getName());
                
                // Build a GpsDevice representation for callbacks
                GpsDevice gpsDevice = new GpsDevice(
                    "bt_" + device.getAddress().replace(":", ""),
                    device.getName() != null ? device.getName() : "Unknown Device",
                    device.getAddress(),
                    "bluetooth"
                );
                
                // Notify native callbacks
                if (gpsCallback != null) {
                    gpsCallback.onDeviceConnected(gpsDevice);
                }
                if (callback != null) {
                    callback.onConnectSuccess(gpsDevice);
                }
                
            } catch (IOException e) {
                Log.e(TAG, "Failed to connect to device: " + e.getMessage());
                closeSocket();
                if (gpsCallback != null) {
                    gpsCallback.onError("Failed to connect: " + e.getMessage());
                }
                if (callback != null) {
                    callback.onConnectError("Failed to connect: " + e.getMessage());
                }
            }
        });
    }
    
    public boolean startPositionStream() {
        if (!isConnected || bluetoothSocket == null) {
            Log.w(TAG, "Not connected to any device");
            if (gpsCallback != null) {
                gpsCallback.onError("Not connected to any device");
            }
            return false;
        }
        
        if (isStreamingPosition) {
            Log.d(TAG, "Already streaming position data");
            return true;
        }
        
        isStreamingPosition = true;
        
        dataReaderThread = new Thread(() -> {
            BufferedReader reader = null;
            try {
                InputStream inputStream = bluetoothSocket.getInputStream();
                reader = new BufferedReader(new InputStreamReader(inputStream));
                
                String line;
                while (isStreamingPosition && !Thread.currentThread().isInterrupted()) {
                    line = reader.readLine();
                    if (line != null && line.trim().length() > 0) {
                        Log.v(TAG, "Received NMEA: " + line);
                        
                        // Process NMEA sentence
                        if (gpsCallback != null) {
                            GpsPosition position = parseNmeaPosition(line);
                            if (position != null) {
                                gpsCallback.onPositionUpdate(position);
                            }
                        }
                    }
                }
            } catch (IOException e) {
                Log.e(TAG, "Error reading from Bluetooth socket: " + e.getMessage());
                if (gpsCallback != null) {
                    gpsCallback.onError("Connection lost: " + e.getMessage());
                }
                disconnect();
            } finally {
                if (reader != null) {
                    try {
                        reader.close();
                    } catch (IOException e) {
                        Log.w(TAG, "Error closing reader: " + e.getMessage());
                    }
                }
            }
        });
        
        dataReaderThread.start();
        
        Log.i(TAG, "Started GPS position streaming");
        return true;
    }
    
    private GpsPosition parseNmeaPosition(String nmeaSentence) {
        return NmeaParser.parseNmeaSentence(nmeaSentence);
    }
    
    private double parseCoordinate(String coord, String hemisphere) {
        if (coord.isEmpty() || hemisphere.isEmpty()) return 0.0;
        
        // Latitude (N/S) uses DDMM.MMMM format (2 digits for degrees)
        // Longitude (E/W) uses DDDMM.MMMM format (3 digits for degrees)
        int degreeDigits = (hemisphere.equals("N") || hemisphere.equals("S")) ? 2 : 3;
        
        double degrees = Double.parseDouble(coord.substring(0, degreeDigits));
        double minutes = Double.parseDouble(coord.substring(degreeDigits));
        double decimal = degrees + (minutes / 60.0);
        
        if (hemisphere.equals("S") || hemisphere.equals("W")) {
            decimal = -decimal;
        }
        
        return decimal;
    }
    
    public void stopPositionStream() {
        if (!isStreamingPosition) {
            return;
        }
        
        isStreamingPosition = false;
        
        if (dataReaderThread != null) {
            dataReaderThread.interrupt();
            try {
                dataReaderThread.join(1000); // Wait up to 1 second
            } catch (InterruptedException e) {
                Log.w(TAG, "Interrupted while waiting for data reader thread to stop");
            }
            dataReaderThread = null;
        }
        
        // Stream stopped - no specific callback needed
        
        Log.i(TAG, "Stopped GPS position streaming");
    }
    
    public void disconnect() {
        stopPositionStream();
        
        if (isConnected) {
            BluetoothDevice device = connectedDevice;
            closeSocket();
            isConnected = false;
            
            if (gpsCallback != null && device != null) {
                GpsDevice gpsDevice = new GpsDevice(
                    "bt_" + device.getAddress().replace(":", ""),
                    device.getName() != null ? device.getName() : "Unknown Device",
                    device.getAddress(),
                    "bluetooth"
                );
                gpsCallback.onDeviceDisconnected(gpsDevice);
            }
            connectedDevice = null;
            
            Log.i(TAG, "Disconnected from Bluetooth GPS device");
        }
    }
    
    public boolean isConnected() {
        return isConnected;
    }
    
    public boolean isStreaming() {
        return isStreamingPosition;
    }
    
    public String getConnectedDeviceName() {
        return connectedDevice != null ? connectedDevice.getName() : null;
    }
    
    public String getConnectedDeviceAddress() {
        return connectedDevice != null ? connectedDevice.getAddress() : null;
    }
    
    private void closeSocket() {
        if (bluetoothSocket != null) {
            try {
                bluetoothSocket.close();
            } catch (IOException e) {
                Log.w(TAG, "Error closing Bluetooth socket: " + e.getMessage());
            }
            bluetoothSocket = null;
        }
    }
    
    public void cleanup() {
        disconnect();
        stopScan();
        
        if (executorService != null && !executorService.isShutdown()) {
            executorService.shutdown();
        }
    }
    
    private final BroadcastReceiver discoveryReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            
            if (BluetoothDevice.ACTION_FOUND.equals(action)) {
                BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                if (device != null && !discoveredDevices.contains(device)) {
                    discoveredDevices.add(device);
                    String deviceName = device.getName();
                    if (deviceName == null) {
                        deviceName = "Unknown Device";
                    }
                    
                    Log.d(TAG, "Found Bluetooth device: " + deviceName + " (" + device.getAddress() + ")");
                    
                    if (gpsCallback != null) {
                        GpsDevice gpsDevice = new GpsDevice(
                            "bt_" + device.getAddress().replace(":", ""),
                            deviceName,
                            device.getAddress(),
                            "bluetooth"
                        );
                        gpsCallback.onDeviceFound(gpsDevice);
                    }
                }
            } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(action)) {
                isScanning = false;
                Log.d(TAG, "Bluetooth discovery finished. Found " + discoveredDevices.size() + " devices");
                
                // Scan finished - no specific callback needed
                
                try {
                    context.unregisterReceiver(this);
                } catch (IllegalArgumentException e) {
                    Log.w(TAG, "Discovery receiver was already unregistered");
                }
            }
        }
    };
}