import { useState, useCallback, useRef, useEffect } from 'react';
import GpsDeviceManager from '../plugins/GpsDeviceManager/index';
import { isCapacitorApp } from '../utils/platform';
import type { GpsPositionUpdate } from '../types';

interface NativeGpsManagerOptions {
  onPosition?: (position: GpsPositionUpdate) => void;
  onError?: (error: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

interface NativeGpsDevice {
  id: string;
  name: string;
  address: string;
  connectionType: 'bluetooth' | 'wifi' | 'serial';
  manufacturer?: string;
  model?: string;
  isConnected: boolean;
}

/**
 * Hook for native GPS device management (Android only)
 * Uses the comprehensive GPS Device Manager plugin
 * Handles Bluetooth, WiFi/TCP, and Serial/USB GPS devices
 */
export function useNativeGpsManager(options: NativeGpsManagerOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [lastPosition, setLastPosition] = useState<GpsPositionUpdate | null>(null);
  const [connectedDevice, setConnectedDevice] = useState<NativeGpsDevice | null>(null);
  const [discoveredDevices, setDiscoveredDevices] = useState<NativeGpsDevice[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  
  const isNative = isCapacitorApp();
  const listenerRefs = useRef<any[]>([]);
  const callbacksRef = useRef<NativeGpsManagerOptions>(options);

  useEffect(() => {
    callbacksRef.current = options;
  }, [options]);

  // Setup event listeners
  useEffect(() => {
    if (!isNative) return;

    const setupListeners = async () => {
      try {
        // Device connection events
        const deviceConnectedListener = await GpsDeviceManager.addListener('deviceConnected', (data: any) => {
          console.log('📱 Native GPS device connected:', data);
          setIsConnected(true);
          setIsConnecting(false);
          setConnectedDevice(data?.device || data);
          callbacksRef.current.onConnect?.();
        });

        const deviceDisconnectedListener = await GpsDeviceManager.addListener('deviceDisconnected', (data: any) => {
          console.log('📱 Native GPS device disconnected:', data);
          setIsConnected(false);
          setIsConnecting(false);
          setConnectedDevice(null);
          setLastPosition(null);
          setIsStreaming(false);
          callbacksRef.current.onDisconnect?.();
        });

        // Position updates
        const positionUpdateListener = await GpsDeviceManager.addListener('positionUpdate', (data: any) => {
          const position: GpsPositionUpdate = {
            latitude: data.position.latitude,
            longitude: data.position.longitude,
            altitude: data.position.altitude,
            accuracy: data.position.accuracy,
            timestamp: data.position.timestamp,
            heading: data.position.heading,
            speed: data.position.speed,
            hdop: data.position.hdop,
            satellites: data.position.satellites,
            fix_type: data.position.fixType
          };
          
          setLastPosition(position);
          callbacksRef.current.onPosition?.(position);
        });

        // Error events
        const errorListener = await GpsDeviceManager.addListener('error', (data: any) => {
          console.error('📱 Native GPS error:', data.error);
          callbacksRef.current.onError?.(data.error);
        });

        // Device discovery events
        const deviceFoundListener = await GpsDeviceManager.addListener('deviceFound', (data: any) => {
          console.log('📱 GPS device found:', data);
          setDiscoveredDevices(prev => {
            // Avoid duplicates
            const device = data?.device || data;
            const exists = prev.some(d => d.id === device.id);
            return exists ? prev : [...prev, device];
          });
        });

        listenerRefs.current = [
          deviceConnectedListener,
          deviceDisconnectedListener,
          positionUpdateListener,
          errorListener,
          deviceFoundListener
        ];

      } catch (error) {
        console.error('Failed to setup native GPS listeners:', error);
      }
    };

    setupListeners();

    return () => {
      // Cleanup listeners
      listenerRefs.current.forEach(listener => {
        if (listener && listener.remove) {
          listener.remove();
        }
      });
      listenerRefs.current = [];
    };
  }, [isNative]);

  /**
   * Request runtime permissions (Bluetooth, Location)
   */
  const requestPermissions = useCallback(async (): Promise<boolean> => {
    if (!isNative) {
      console.log('Permissions not needed on web platform');
      return true;
    }

    try {
      console.log('Requesting GPS device permissions...');
      
      // Check current permissions first
      const currentPerms = await GpsDeviceManager.checkPermissions();
      if (currentPerms.granted) {
        console.log('Permissions already granted');
        return true;
      }

      // Request permissions
      const result = await GpsDeviceManager.requestPermissions();
      
      if (result.granted) {
        console.log('✅ Permissions granted');
        return true;
      } else {
        console.error('❌ Permissions denied:', result);
        callbacksRef.current.onError?.('GPS device permissions denied. Please enable Bluetooth and Location in Settings.');
        return false;
      }
    } catch (error) {
      console.error('Failed to request permissions:', error);
      callbacksRef.current.onError?.('Failed to request permissions: ' + error);
      return false;
    }
  }, [isNative]);

  /**
   * Scan for GPS devices
   */
  const scanDevices = useCallback(async (connectionTypes?: ('bluetooth' | 'wifi' | 'serial')[]) => {
    if (!isNative) {
      callbacksRef.current.onError?.('GPS device scanning requires native Android app');
      return [];
    }

    // Check/request permissions before scanning
    const hasPermissions = await requestPermissions();
    if (!hasPermissions) {
      return [];
    }

    setIsScanning(true);
    setDiscoveredDevices([]);
    
    try {
      console.log('📡 Scanning for GPS devices...', connectionTypes);
      
      const result = await GpsDeviceManager.scanDevices({
        connectionTypes: connectionTypes || ['bluetooth', 'wifi', 'serial'],
        timeout: 10000
      });
      
      console.log('📱 Scan completed, found devices:', result.devices);
      setDiscoveredDevices(result.devices);
      setIsScanning(false);
      
      return result.devices;
      
    } catch (error) {
      console.error('GPS device scan failed:', error);
      setIsScanning(false);
      callbacksRef.current.onError?.(`Device scan failed: ${error}`);
      return [];
    }
  }, [isNative, requestPermissions]);

  /**
   * Connect to a GPS device
   */
  const connectDevice = useCallback(async (device: Partial<NativeGpsDevice>) => {
    if (!isNative) {
      const message = 'GPS device connection requires native Android app. Use browser geolocation instead.';
      callbacksRef.current.onError?.(message);
      return false;
    }

    if (!device.address || !device.connectionType) {
      callbacksRef.current.onError?.('Device address and connection type are required');
      return false;
    }

    setIsConnecting(true);
    
    try {
      console.log('🔌 Connecting to GPS device:', device);
      
      const result = await GpsDeviceManager.connectDevice({
        deviceId: device.id,
        address: device.address,
        connectionType: device.connectionType,
        port: (device as any).port || 9001,
        name: device.name || 'GPS Device'
      });
      
      console.log('✅ GPS device connected successfully:', result.device);
      return true;
      
    } catch (error) {
      console.error('GPS device connection failed:', error);
      setIsConnecting(false);
      
      // Provide user-friendly error messages
      const errorMessage = error instanceof Error ? error.message : String(error);
      let friendlyMessage = `Connection failed: ${errorMessage}`;
      
      if (errorMessage.includes('not implemented') || errorMessage.includes('plugin')) {
        friendlyMessage = 'GPS Manager plugin is not available. Please restart the app.';
      } else if (errorMessage.includes('permission')) {
        friendlyMessage = 'Location permissions are required. Please enable location access.';
      } else if (errorMessage.includes('timeout') || errorMessage.includes('unreachable')) {
        friendlyMessage = 'Cannot reach GPS device. Check device IP address and network connection.';
      } else if (errorMessage.includes('Bluetooth')) {
        friendlyMessage = 'Bluetooth connection failed. Make sure device is paired and in range.';
      }
      
      callbacksRef.current.onError?.(friendlyMessage);
      return false;
    }
  }, [isNative]);

  /**
   * Disconnect from current GPS device
   */
  const disconnect = useCallback(async () => {
    if (!isNative) {
      return;
    }

    try {
      await GpsDeviceManager.disconnectDevice();
      console.log('📱 GPS device disconnected');
    } catch (error) {
      console.error('GPS disconnect failed:', error);
    }
  }, [isNative]);

  /**
   * Start GPS position streaming
   */
  const startPositionStream = useCallback(async () => {
    if (!isNative || !isConnected) {
      return false;
    }

    try {
      await GpsDeviceManager.startPositionStream();
      setIsStreaming(true);
      console.log('📡 GPS position streaming started');
      return true;
    } catch (error) {
      console.error('Failed to start GPS streaming:', error);
      callbacksRef.current.onError?.(`Failed to start streaming: ${error}`);
      return false;
    }
  }, [isNative, isConnected]);

  /**
   * Stop GPS position streaming
   */
  const stopPositionStream = useCallback(async () => {
    if (!isNative) {
      return;
    }

    try {
      await GpsDeviceManager.stopPositionStream();
      setIsStreaming(false);
      console.log('📡 GPS position streaming stopped');
    } catch (error) {
      console.error('Failed to stop GPS streaming:', error);
    }
  }, [isNative]);

  /**
   * Get current GPS device status
   */
  const getStatus = useCallback(async () => {
    if (!isNative) {
      return { isConnected: false, isStreaming: false };
    }

    try {
      return await GpsDeviceManager.getStatus();
    } catch (error) {
      console.error('Failed to get GPS status:', error);
      return { isConnected: false, isStreaming: false };
    }
  }, [isNative]);

  /**
   * Quick connect to known device (Emlid Reach RS3)
   */
  const connectToReachRS3 = useCallback(async (connectionType: 'bluetooth' | 'wifi' = 'wifi') => {
    const device: Partial<NativeGpsDevice> = {
      id: 'reach_rs3',
      name: 'Emlid Reach RS3',
      address: connectionType === 'wifi' ? '192.168.42.1' : '', // Bluetooth address would be provided by user
      connectionType,
      manufacturer: 'Emlid',
      model: 'Reach RS3'
    };
    
    return await connectDevice(device);
  }, [connectDevice]);

  return {
    // State
    isConnected,
    isConnecting,
    isScanning,
    isStreaming,
    lastPosition,
    connectedDevice,
    discoveredDevices,
    isNative,
    
    // Methods
    scanDevices,
    connectDevice,
    disconnect,
    startPositionStream,
    stopPositionStream,
    getStatus,
    connectToReachRS3,
    requestPermissions
  };
}