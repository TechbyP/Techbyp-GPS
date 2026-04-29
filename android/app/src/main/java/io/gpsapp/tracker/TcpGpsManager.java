package io.gpsapp.tracker;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.util.Log;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * TCP/WiFi GPS Manager
 * Handles direct TCP connections to GPS devices like Emlid Reach RS3
 */
public class TcpGpsManager {
    private static final String TAG = "TcpGpsManager";
    
    private Context context;
    private GpsCallback callback;
    private ExecutorService executor;
    
    // Network binding for WiFi
    private ConnectivityManager connectivityManager;
    private Network boundNetwork;
    private ConnectivityManager.NetworkCallback networkCallback;
    
    // Connection state
    private Socket socket;
    private BufferedReader reader;
    private boolean isConnected = false;
    private boolean isStreaming = false;
    private GpsDevice connectedDevice;
    
    // Common GPS device IPs and ports
    private static final String[] DEFAULT_IPS = {
        "192.168.42.1",    // Emlid Reach hotspot
        "192.168.1.1",     // Common router IP
        "192.168.0.1",     // Another common router IP
        "10.0.0.1"         // Yet another common IP
    };
    
    private static final int[] DEFAULT_PORTS = {
        9001,  // Emlid Reach default
        2101,  // NTRIP standard
        8080,  // HTTP alternative
        80     // HTTP standard
    };
    
    public TcpGpsManager(Context context) {
        this.context = context;
        this.executor = Executors.newCachedThreadPool();
        this.connectivityManager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        
        // Bind to WiFi network to prevent auto-disconnect
        bindToWifiNetwork();
        
        Log.d(TAG, "TCP GPS Manager initialized");
    }
    
    /**
     * Bind process to WiFi network to prevent Android from switching to cellular
     * This is critical for GPS device hotspot connections that have no internet
     */
    private void bindToWifiNetwork() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            try {
                NetworkRequest request = new NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                    .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) // KEY: Allow no internet
                    .build();
                
                networkCallback = new ConnectivityManager.NetworkCallback() {
                    @Override
                    public void onAvailable(Network network) {
                        Log.d(TAG, "WiFi network available, binding to network");
                        boundNetwork = network;
                        
                        // Bind process to this WiFi network
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            connectivityManager.bindProcessToNetwork(network);
                        } else {
                            ConnectivityManager.setProcessDefaultNetwork(network);
                        }
                        
                        Log.d(TAG, "Process bound to WiFi network (no internet required)");
                    }
                    
                    @Override
                    public void onLost(Network network) {
                        Log.w(TAG, "WiFi network lost");
                        if (boundNetwork != null && boundNetwork.equals(network)) {
                            boundNetwork = null;
                        }
                    }
                };
                
                connectivityManager.requestNetwork(request, networkCallback);
                Log.d(TAG, "WiFi network binding requested");
                
            } catch (Exception e) {
                Log.w(TAG, "Failed to bind to WiFi network: " + e.getMessage());
            }
        }
    }
    
    public void setGpsCallback(GpsCallback callback) {
        this.callback = callback;
    }
    
    /**
     * Scan for GPS devices on network
     */
    public void scanDevices(int timeout, GpsDeviceManager.ScanCallback scanCallback) {
        Log.d(TAG, "Scanning for TCP/WiFi GPS devices...");
        
        executor.execute(() -> {
            List<GpsDevice> foundDevices = new ArrayList<>();
            
            // Check if we're connected to WiFi
            WifiManager wifiManager = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
            if (wifiManager == null || !wifiManager.isWifiEnabled()) {
                scanCallback.onScanError("WiFi not available");
                return;
            }
            
            // Try connecting to common GPS device addresses
            for (String ip : DEFAULT_IPS) {
                for (int port : DEFAULT_PORTS) {
                    try {
                        Socket testSocket = new Socket();
                        testSocket.connect(new java.net.InetSocketAddress(ip, port), 2000);
                        
                        // Found a responsive device
                        GpsDevice device = new GpsDevice(
                            "tcp_" + ip + "_" + port,
                            "GPS Device (" + ip + ":" + port + ")",
                            ip,
                            "wifi"
                        );
                        
                        // Try to detect specific device types
                        if (ip.equals("192.168.42.1") && port == 9001) {
                            device.setName("Emlid Reach RS3");
                            device.setManufacturer("Emlid");
                            device.setModel("Reach RS3");
                        }
                        
                        foundDevices.add(device);
                        testSocket.close();
                        
                        // Notify callback of found device
                        if (this.callback != null) {
                            this.callback.onDeviceFound(device);
                        }
                        
                        Log.d(TAG, "Found GPS device at " + ip + ":" + port);
                        
                    } catch (IOException e) {
                        // Device not found at this address/port
                    }
                }
            }
            
            if (foundDevices.isEmpty()) {
                scanCallback.onScanError("No TCP/WiFi GPS devices found");
            } else {
                scanCallback.onScanComplete(foundDevices);
            }
        });
    }
    
    /**
     * Connect to a GPS device via TCP
     */
    public void connectDevice(GpsDevice device, GpsDeviceManager.ConnectCallback connectCallback) {
        Log.d(TAG, "Connecting to TCP device: " + device);
        
        if (isConnected) {
            disconnect();
        }
        
        executor.execute(() -> {
            try {
                String address = device.getAddress();
                int port = device.getPort();
                
                // Create socket connection
                socket = new Socket();
                socket.connect(new java.net.InetSocketAddress(address, port), 10000);
                socket.setSoTimeout(30000); // 30 second read timeout
                
                reader = new BufferedReader(new InputStreamReader(socket.getInputStream()));
                
                isConnected = true;
                connectedDevice = device;
                
                Log.d(TAG, "Connected to GPS device at " + address + ":" + port);
                connectCallback.onConnectSuccess(device);
                
                if (this.callback != null) {
                    this.callback.onDeviceConnected(device);
                }

                // Start streaming immediately after successful connect
                boolean started = startPositionStream();
                if (!started) {
                    Log.w(TAG, "TCP connected but failed to start position stream");
                    if (this.callback != null) {
                        this.callback.onError("Connected but could not start GPS stream");
                    }
                }
                
            } catch (IOException e) {
                Log.e(TAG, "Failed to connect to GPS device", e);
                connectCallback.onConnectError("Connection failed: " + e.getMessage());
            }
        });
    }
    
    /**
     * Disconnect from GPS device
     */
    public void disconnect() {
        if (isConnected) {
            Log.d(TAG, "Disconnecting from TCP GPS device");
            
            isConnected = false;
            isStreaming = false;
            
            try {
                if (reader != null) {
                    reader.close();
                }
                if (socket != null) {
                    socket.close();
                }
            } catch (IOException e) {
                Log.w(TAG, "Error closing TCP connection", e);
            }
            
            if (callback != null && connectedDevice != null) {
                callback.onDeviceDisconnected(connectedDevice);
            }
            
            connectedDevice = null;
        }
    }
    
    /**
     * Start streaming GPS positions
     */
    public boolean startPositionStream() {
        if (isConnected && !isStreaming) {
            Log.d(TAG, "Starting TCP GPS position stream");
            isStreaming = true;
            
            executor.execute(() -> {
                String line;
                try {
                    while (isStreaming && isConnected && (line = reader.readLine()) != null) {
                        if (line.startsWith("$")) {
                            // Parse NMEA sentence
                            GpsPosition position = parseNmeaPosition(line);
                            if (position != null && callback != null) {
                                callback.onPositionUpdate(position);
                            }
                        }
                    }
                } catch (IOException e) {
                    if (isConnected) { // Only log if this wasn't intentional disconnect
                        Log.e(TAG, "Error reading GPS data", e);
                        if (callback != null) {
                            callback.onError("GPS data stream error: " + e.getMessage());
                        }
                    }
                }
                
                // Stream ended
                isStreaming = false;
                Log.d(TAG, "TCP GPS stream ended");
            });
            
            return true;
        }
        return false;
    }
    
    /**
     * Stop streaming GPS positions
     */
    public void stopPositionStream() {
        if (isStreaming) {
            Log.d(TAG, "Stopping TCP GPS position stream");
            isStreaming = false;
        }
    }
    
    /**
     * Check if connected to a device
     */
    public boolean isConnected() {
        return isConnected;
    }
    
    /**
     * Check if streaming positions
     */
    public boolean isStreaming() {
        return isStreaming;
    }
    
    /**
     * Get connected device
     */
    public GpsDevice getConnectedDevice() {
        return connectedDevice;
    }
    
    /**
     * Stop device scanning
     */
    public void stopScan() {
        // Stop any ongoing scan operations
        Log.d(TAG, "Stopping TCP/WiFi device scan");
    }
    
    /**
     * Parse NMEA sentence to GPS position
     */
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
    
    /**
     * Cleanup resources
     */
    public void cleanup() {
        disconnect();
        executor.shutdown();
    }
}