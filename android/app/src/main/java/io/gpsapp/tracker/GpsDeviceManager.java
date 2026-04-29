package io.gpsapp.tracker;

import android.content.Context;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Main coordinator for all GPS connection types (Bluetooth, TCP, Serial) in a Capacitor Android project.
 * Manages device discovery, connection, and position streaming across different connection types.
 */
public class GpsDeviceManager {
    private static final String TAG = "GpsDeviceManager";
    
    private final Context context;
    private GpsDeviceCallback callback;
    private final ExecutorService executor;
    
    // Individual connection managers
    private BluetoothGpsManager bluetoothManager;
    private TcpGpsManager tcpManager;
    private SerialGpsManager serialManager;
    
    // Current connection state
    private GpsDevice connectedDevice;
    private GpsPosition lastPosition;
    private boolean isStreaming = false;
    private final AtomicBoolean isScanning = new AtomicBoolean(false);
    
    // Scanning state
    private Future<?> scanTask;
    private final List<GpsDevice> discoveredDevices = new ArrayList<>();
    
    /**
     * Main callback interface for GPS device operations
     */
    public interface GpsDeviceCallback {
        void onDeviceFound(GpsDevice device);
        void onScanComplete(List<GpsDevice> devices);
        void onScanError(String error);
        void onDeviceConnected(GpsDevice device);
        void onDeviceDisconnected(GpsDevice device);
        void onPositionUpdate(GpsPosition position);
        void onError(String error);
    }
    
    /**
     * Callback interface for scanning operations
     */
    public interface ScanCallback {
        void onScanComplete(List<GpsDevice> devices);
        void onScanError(String error);
    }
    
    /**
     * Callback interface for connection operations
     */
    public interface ConnectCallback {
        void onConnectSuccess(GpsDevice device);
        void onConnectError(String error);
    }
    
    /**
     * Constructor
     */
    public GpsDeviceManager(Context context) {
        this.context = context;
        this.executor = Executors.newCachedThreadPool();
        
        // Initialize connection managers
        this.bluetoothManager = new BluetoothGpsManager(context);
        this.tcpManager = new TcpGpsManager(context);
        this.serialManager = new SerialGpsManager(context);
        
        // Set callbacks for each manager
        this.bluetoothManager.setGpsCallback(new ConnectionManagerCallback());
        this.tcpManager.setGpsCallback(new ConnectionManagerCallback());
        this.serialManager.setGpsCallback(new ConnectionManagerCallback());
        
        Log.d(TAG, "GPS Device Manager initialized");
    }
    
    /**
     * Set the main callback for GPS operations
     */
    public void setCallback(GpsDeviceCallback callback) {
        this.callback = callback;
    }

    /**
     * Scan for GPS devices of specified types
     */
    public void scanDevices(List<String> connectionTypes, int timeout, ScanCallback callback) {
        Log.d(TAG, "Starting device scan for types: " + connectionTypes);
        
        if (isScanning.get()) {
            callback.onScanError("Scan already in progress");
            return;
        }
        
        isScanning.set(true);
        discoveredDevices.clear();
        
        executor.execute(() -> {
            List<GpsDevice> allDevices = new ArrayList<>();
            List<String> errors = new ArrayList<>();
            AtomicInteger completedScans = new AtomicInteger(0);
            
            // Track scan completion
            final Object lock = new Object();
            
            for (String type : connectionTypes) {
                switch (type.toLowerCase()) {
                    case "bluetooth":
                        bluetoothManager.scanDevices(timeout, new ScanCallback() {
                            @Override
                            public void onScanComplete(List<GpsDevice> devices) {
                                synchronized (lock) {
                                    allDevices.addAll(devices);
                                    int completed = completedScans.incrementAndGet();
                                    if (completed >= connectionTypes.size()) {
                                        isScanning.set(false);
                                        callback.onScanComplete(allDevices);
                                    }
                                }
                            }

                            @Override
                            public void onScanError(String error) {
                                synchronized (lock) {
                                    errors.add("Bluetooth: " + error);
                                    int completed = completedScans.incrementAndGet();
                                    if (completed >= connectionTypes.size()) {
                                        isScanning.set(false);
                                        if (allDevices.isEmpty() && !errors.isEmpty()) {
                                            callback.onScanError(String.join("; ", errors));
                                        } else {
                                            callback.onScanComplete(allDevices);
                                        }
                                    }
                                }
                            }
                        });
                        break;
                        
                    case "wifi":
                    case "tcp":
                        tcpManager.scanDevices(timeout, new ScanCallback() {
                            @Override
                            public void onScanComplete(List<GpsDevice> devices) {
                                synchronized (lock) {
                                    allDevices.addAll(devices);
                                    int completed = completedScans.incrementAndGet();
                                    if (completed >= connectionTypes.size()) {
                                        isScanning.set(false);
                                        callback.onScanComplete(allDevices);
                                    }
                                }
                            }

                            @Override
                            public void onScanError(String error) {
                                synchronized (lock) {
                                    errors.add("WiFi/TCP: " + error);
                                    int completed = completedScans.incrementAndGet();
                                    if (completed >= connectionTypes.size()) {
                                        isScanning.set(false);
                                        if (allDevices.isEmpty() && !errors.isEmpty()) {
                                            callback.onScanError(String.join("; ", errors));
                                        } else {
                                            callback.onScanComplete(allDevices);
                                        }
                                    }
                                }
                            }
                        });
                        break;
                        
                    case "serial":
                    case "usb":
                        serialManager.scanDevices(timeout, new ScanCallback() {
                            @Override
                            public void onScanComplete(List<GpsDevice> devices) {
                                synchronized (lock) {
                                    allDevices.addAll(devices);
                                    int completed = completedScans.incrementAndGet();
                                    if (completed >= connectionTypes.size()) {
                                        isScanning.set(false);
                                        callback.onScanComplete(allDevices);
                                    }
                                }
                            }

                            @Override
                            public void onScanError(String error) {
                                synchronized (lock) {
                                    errors.add("Serial: " + error);
                                    int completed = completedScans.incrementAndGet();
                                    if (completed >= connectionTypes.size()) {
                                        isScanning.set(false);
                                        if (allDevices.isEmpty() && !errors.isEmpty()) {
                                            callback.onScanError(String.join("; ", errors));
                                        } else {
                                            callback.onScanComplete(allDevices);
                                        }
                                    }
                                }
                            }
                        });
                        break;
                        
                    default:
                        synchronized (lock) {
                            int completed = completedScans.incrementAndGet();
                            errors.add("Unknown connection type: " + type);
                            if (completed >= connectionTypes.size()) {
                                isScanning.set(false);
                                if (allDevices.isEmpty() && !errors.isEmpty()) {
                                    callback.onScanError(String.join("; ", errors));
                                } else {
                                    callback.onScanComplete(allDevices);
                                }
                            }
                        }
                        break;
                }
            }
        });
    }

    /**
     * Stop device scanning
     */
    public void stopScan() {
        if (isScanning.get()) {
            Log.d(TAG, "Stopping device scan");
            isScanning.set(false);
            
            // Cancel the scan task if running
            if (scanTask != null && !scanTask.isDone()) {
                scanTask.cancel(true);
            }
            
            // Stop individual manager scans
            bluetoothManager.stopScan();
            tcpManager.stopScan();
            serialManager.stopScan();
        }
    }

    /**
     * Connect to a GPS device
     */
    public void connectDevice(GpsDevice device, ConnectCallback callback) {
        Log.d(TAG, "Connecting to device: " + device);
        
        // Disconnect any existing connection first
        if (connectedDevice != null) {
            disconnect();
        }
        
        executor.execute(() -> {
            try {
                switch (device.getConnectionType().toLowerCase()) {
                    case "bluetooth":
                        bluetoothManager.connectDevice(device, callback);
                        break;
                    case "wifi":
                    case "tcp":
                        tcpManager.connectDevice(device, callback);
                        break;
                    case "serial":
                    case "usb":
                        serialManager.connectDevice(device, callback);
                        break;
                    default:
                        callback.onConnectError("Unsupported connection type: " + device.getConnectionType());
                        break;
                }
            } catch (Exception e) {
                callback.onConnectError("Connection failed: " + e.getMessage());
            }
        });
    }

    /**
     * Disconnect from current device
     */
    public void disconnect() {
        if (connectedDevice != null) {
            Log.d(TAG, "Disconnecting from device: " + connectedDevice);
            
            // Save reference before clearing
            GpsDevice oldDevice = connectedDevice;
            
            switch (oldDevice.getConnectionType().toLowerCase()) {
                case "bluetooth":
                    bluetoothManager.disconnect();
                    break;
                case "wifi":
                case "tcp":
                    tcpManager.disconnect();
                    break;
                case "serial":
                case "usb":
                    serialManager.disconnect();
                    break;
            }
            
            // Set connected flag before clearing reference
            oldDevice.setConnected(false);
            connectedDevice = null;
            lastPosition = null;
            isStreaming = false;
            
            if (callback != null) {
                callback.onDeviceDisconnected(oldDevice);
            }
        }
    }

    /**
     * Get current GPS position
     */
    public GpsPosition getCurrentPosition() {
        return lastPosition;
    }

    /**
     * Start GPS position streaming
     */
    public boolean startPositionStream() {
        if (connectedDevice != null && !isStreaming) {
            Log.d(TAG, "Starting position stream");
            isStreaming = true;
            
            boolean success = false;
            switch (connectedDevice.getConnectionType().toLowerCase()) {
                case "bluetooth":
                    success = bluetoothManager.startPositionStream();
                    break;
                case "wifi":
                case "tcp":
                    success = tcpManager.startPositionStream();
                    break;
                case "serial":
                case "usb":
                    success = serialManager.startPositionStream();
                    break;
            }
            
            if (!success) {
                isStreaming = false;
            }
            
            if (callback != null) {
                Log.d(TAG, "Position streaming " + (success ? "started" : "failed"));
            }
            
            return success;
        }
        return false;
    }

    /**
     * Stop GPS position streaming
     */
    public void stopPositionStream() {
        if (isStreaming) {
            Log.d(TAG, "Stopping position stream");
            isStreaming = false;
            
            if (connectedDevice != null) {
                switch (connectedDevice.getConnectionType().toLowerCase()) {
                    case "bluetooth":
                        bluetoothManager.stopPositionStream();
                        break;
                    case "wifi":
                    case "tcp":
                        tcpManager.stopPositionStream();
                        break;
                    case "serial":
                    case "usb":
                        serialManager.stopPositionStream();
                        break;
                }
            }
        }
    }

    // Status methods
    public boolean isConnected() {
        return connectedDevice != null && connectedDevice.isConnected();
    }

    public boolean isStreaming() {
        return isStreaming;
    }

    public boolean isScanning() {
        return isScanning.get();
    }

    public GpsDevice getConnectedDevice() {
        return connectedDevice;
    }

    public List<GpsDevice> getDiscoveredDevices() {
        return new ArrayList<>(discoveredDevices);
    }
    
    /**
     * Get list of paired/bonded Bluetooth devices
     * Returns devices that are already paired in Android Bluetooth settings
     */
    public List<GpsDevice> getPairedBluetoothDevices() {
        return bluetoothManager.getPairedDevices();
    }

    // Manager-specific getters
    public BluetoothGpsManager getBluetoothManager() {
        return bluetoothManager;
    }
    
    public TcpGpsManager getTcpManager() {
        return tcpManager;
    }
    
    public SerialGpsManager getSerialManager() {
        return serialManager;
    }

    /**
     * Cleanup resources
     */
    public void cleanup() {
        Log.d(TAG, "Cleaning up GPS Device Manager");
        
        // Stop any ongoing operations
        stopScan();
        disconnect();
        
        // Cleanup individual managers
        if (bluetoothManager != null) {
            bluetoothManager.cleanup();
        }
        if (tcpManager != null) {
            tcpManager.cleanup();
        }
        if (serialManager != null) {
            serialManager.cleanup();
        }
        
        // Shutdown executor service
        if (executor != null && !executor.isShutdown()) {
            executor.shutdown();
        }
    }

    /**
     * Common callback implementation for all connection managers
     */
    private class ConnectionManagerCallback implements GpsCallback {
        @Override
        public void onDeviceConnected(GpsDevice device) {
            connectedDevice = device;
            device.setConnected(true);
            Log.d(TAG, "Device connected: " + device);
            if (callback != null) {
                callback.onDeviceConnected(device);
            }
        }

        @Override
        public void onDeviceDisconnected(GpsDevice device) {
            if (connectedDevice != null && connectedDevice.equals(device)) {
                connectedDevice.setConnected(false);
                connectedDevice = null;
                lastPosition = null;
                isStreaming = false;
            }
            Log.d(TAG, "Device disconnected: " + device);
            if (callback != null) {
                callback.onDeviceDisconnected(device);
            }
        }

        @Override
        public void onPositionUpdate(GpsPosition position) {
            lastPosition = position;
            if (callback != null) {
                callback.onPositionUpdate(position);
            }
        }

        @Override
        public void onError(String error) {
            Log.e(TAG, "GPS Manager error: " + error);
            if (callback != null) {
                callback.onError(error);
            }
        }

        @Override
        public void onDeviceFound(GpsDevice device) {
            synchronized (discoveredDevices) {
                discoveredDevices.add(device);
            }
            Log.d(TAG, "Device found: " + device);
            if (callback != null) {
                callback.onDeviceFound(device);
            }
        }
    }
}