import { useState, useCallback, useRef, useEffect } from 'react';
import { GpsPositionUpdate } from '../types';
import { isCapacitorApp } from '../utils/platform';
import { BleClient, BleDevice } from '@capacitor-community/bluetooth-le';
import { useNativeGpsManager } from './useNativeGpsManager';
import { GpsConnectionValidator, NotificationDebouncer } from '../utils/gpsValidation';

// NMEA service UUIDs - common GPS device services
const NMEA_SERVICE_UUIDS = [
  '00001101-0000-1000-8000-00805f9b34fb', // Serial Port Profile (SPP)
  '0000fff0-0000-1000-8000-00805f9b34fb', // Generic NMEA
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip Transparent UART
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART Service (NUS)
];

// Characteristic UUIDs for reading NMEA data
const NMEA_RX_CHARACTERISTIC_UUIDS = [
  '49535343-1e4d-4bd9-ba61-23c647249616', // Microchip RX
  '6e400003-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART RX
  '0000fff4-0000-1000-8000-00805f9b34fb', // Generic NMEA RX
];

interface BluetoothGPSOptions {
  onPosition?: (position: GpsPositionUpdate) => void;
  onError?: (error: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

/**
 * Hook for connecting to external GPS devices via Bluetooth
 * - Web: Uses Web Bluetooth API (browser only)
 * - Android: Uses native Bluetooth Serial (capacitor-bluetooth-serial)
 * Works with Emlid Reach RS3 and other Bluetooth GPS devices that stream NMEA
 */
export function useBluetoothGPS(options: BluetoothGPSOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [lastPosition, setLastPosition] = useState<GpsPositionUpdate | null>(null);
  const [deviceName, setDeviceName] = useState<string>('');
  
  const deviceRef = useRef<any>(null);
  const characteristicRef = useRef<any>(null);
  const nmeaBufferRef = useRef<string>('');
  const usingNativeRef = useRef<boolean>(false);
  const connectionValidatedRef = useRef<boolean>(false);
  const dataTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const notificationDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const validatorRef = useRef<GpsConnectionValidator>(new GpsConnectionValidator());
  const notificationDebouncerRef = useRef<NotificationDebouncer>(new NotificationDebouncer());
  
  // Use native GPS manager when available (Android app)
  const nativeGpsManager = useNativeGpsManager({
    onPosition: (position) => {
      if (usingNativeRef.current) {
        setLastPosition(position);
        options.onPosition?.(position);
        
        // Add to validator
        validatorRef.current.addDataPoint(position);
        
        // Validate native connection on first GPS data
        if (!connectionValidatedRef.current && !isConnected) {
          const validation = validatorRef.current.validateConnection();
          
          if (validation.isValid) {
            connectionValidatedRef.current = true;
            setIsConnected(true);
            
            if (dataTimeoutRef.current) {
              clearTimeout(dataTimeoutRef.current);
              dataTimeoutRef.current = null;
            }
            
            // Use debounced notification
            notificationDebouncerRef.current.notify('native-connect', () => {
              console.log(`🎯 Native GPS Connection Validated:`, validation);
              options.onConnect?.();
            }, 1000);
          }
        }
      }
    },
    onConnect: () => {
      if (usingNativeRef.current) {
        setIsConnecting(false);
        connectionValidatedRef.current = false;
        
        // Set validation timeout for native connections
        dataTimeoutRef.current = setTimeout(() => {
          if (!connectionValidatedRef.current) {
            console.warn('⚠️ Native GPS: No data received within 30 seconds');
            options.onError?.('Connected but no GPS data received from native GPS.');
          }
        }, 30000);
        
        console.log('✅ Native GPS connected - waiting for data validation...');
      }
    },
    onDisconnect: () => {
      if (usingNativeRef.current) {
        setIsConnected(false);
        setIsConnecting(false);
        setLastPosition(null);
        setDeviceName('');
        options.onDisconnect?.();
      }
    },
    onError: (error) => {
      if (usingNativeRef.current) {
        options.onError?.(error);
      }
    }
  });

  /**
   * Parse NMEA sentence to GPS position
   */
  const parseNMEA = useCallback((sentence: string): GpsPositionUpdate | null => {
    if (!sentence.startsWith('$')) return null;

    try {
      const parts = sentence.split(',');
      const type = parts[0].substring(3); // Remove $GP or $GN prefix

      // Parse GGA sentence (most common for position)
      if (type === 'GGA') {
        // $GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47
        const latRaw = parseFloat(parts[2]);
        const latDir = parts[3];
        const lonRaw = parseFloat(parts[4]);
        const lonDir = parts[5];
        const quality = parseInt(parts[6]); // 0=invalid, 1=GPS, 2=DGPS, 4=RTK fix, 5=RTK float
        const satellites = parseInt(parts[7]);
        const hdop = parseFloat(parts[8]);
        const altitude = parseFloat(parts[9]);

        if (isNaN(latRaw) || isNaN(lonRaw)) return null;

        // Convert NMEA format to decimal degrees
        const latDeg = Math.floor(latRaw / 100);
        const latMin = latRaw - (latDeg * 100);
        const latitude = (latDeg + latMin / 60) * (latDir === 'S' ? -1 : 1);

        const lonDeg = Math.floor(lonRaw / 100);
        const lonMin = lonRaw - (lonDeg * 100);
        const longitude = (lonDeg + lonMin / 60) * (lonDir === 'W' ? -1 : 1);

        // Determine fix type
        let fixType: 'none' | 'single' | 'float' | 'fix' = 'none';
        if (quality === 1) fixType = 'single';
        else if (quality === 2) fixType = 'single'; // DGPS
        else if (quality === 5) fixType = 'float'; // RTK float
        else if (quality === 4) fixType = 'fix'; // RTK fixed

        // Log parsed coordinates for debugging
        console.log('[GPS] GGA parsed:', {
          raw: `${latRaw},${latDir} ${lonRaw},${lonDir}`,
          decimal: `${latitude.toFixed(6)}°${latDir} ${longitude.toFixed(6)}°${lonDir}`,
          quality,
          fixType,
          satellites,
          hdop,
          altitude
        });

        // Estimate accuracy based on HDOP and fix type
        let accuracy = 50; // default
        if (fixType === 'fix') accuracy = 0.05; // RTK fixed: ~2-5cm
        else if (fixType === 'float') accuracy = 0.5; // RTK float: ~50cm
        else if (fixType === 'single') accuracy = hdop * 5; // GPS: HDOP * 5m

        return {
          latitude,
          longitude,
          altitude: !isNaN(altitude) ? altitude : undefined,
          accuracy,
          fix_type: fixType,
          satellites,
          timestamp: Date.now(),
        };
      }

      // Parse RMC sentence (alternative with speed/heading)
      if (type === 'RMC') {
        // $GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A
        const status = parts[2]; // A=active, V=void
        if (status !== 'A') return null;

        const latRaw = parseFloat(parts[3]);
        const latDir = parts[4];
        const lonRaw = parseFloat(parts[5]);
        const lonDir = parts[6];
        // parts[7] = speed in knots
        // parts[8] = heading in degrees

        if (isNaN(latRaw) || isNaN(lonRaw)) return null;

        const latDeg = Math.floor(latRaw / 100);
        const latMin = latRaw - (latDeg * 100);
        const latitude = (latDeg + latMin / 60) * (latDir === 'S' ? -1 : 1);

        const lonDeg = Math.floor(lonRaw / 100);
        const lonMin = lonRaw - (lonDeg * 100);
        const longitude = (lonDeg + lonMin / 60) * (lonDir === 'W' ? -1 : 1);

        return {
          latitude,
          longitude,
          accuracy: 10, // RMC doesn't provide accuracy
          fix_type: 'single',
          timestamp: Date.now(),
        };
      }

      return null;
    } catch (error) {
      console.error('NMEA parse error:', error);
      return null;
    }
  }, []);

  /**
   * Check if Bluetooth LE is available on this device
   */
  const checkBluetoothSupport = useCallback(async (): Promise<boolean> => {
    try {
      // Check if running on supported platform
      if (!isCapacitorApp() && !('bluetooth' in navigator)) {
        console.warn('❌ Bluetooth LE not supported: Not on native app and no Web Bluetooth');
        return false;
      }
      
      await BleClient.initialize({ androidNeverForLocation: false });
      
      // Check if Bluetooth is available
      const isAvailable = await BleClient.isEnabled();
      if (!isAvailable) {
        console.warn('❌ Bluetooth is disabled on this device');
        return false;
      }
      
      console.log('✅ Bluetooth LE is supported and enabled');
      return true;
    } catch (error: any) {
      console.error('❌ Bluetooth LE check failed:', error);
      return false;
    }
  }, []);

  /**
   * Connect to a Bluetooth GPS device using Bluetooth LE
   * Works on both Android (native) and Web (Chrome/Edge)
   * @param deviceAddress - Device ID from previous scan
   * @param deviceName - Device name for display
   */
  /* eslint-disable react-hooks/exhaustive-deps */
  const connect = useCallback(async (deviceAddress?: string, deviceName?: string): Promise<BleDevice | null> => {
    setIsConnecting(true);

    // Use native GPS manager when available (Android app) for better Bluetooth support
    if (isCapacitorApp() && nativeGpsManager.isNative && deviceAddress) {
      console.log('📱 Using native GPS manager for Bluetooth connection');
      console.log('🔗 Connecting to:', deviceAddress);
      
      usingNativeRef.current = true;
      
      const success = await nativeGpsManager.connectDevice({
        id: `bluetooth_${deviceAddress}`,
        name: deviceName || 'Bluetooth GPS Device',
        address: deviceAddress,
        connectionType: 'bluetooth' as const
      });
      
      if (success) {
        setDeviceName(deviceName || 'Bluetooth GPS Device');
        // Start streaming if connection successful
        await nativeGpsManager.startPositionStream();
        return { deviceId: deviceAddress, name: deviceName || 'Bluetooth GPS Device' };
      } else {
        usingNativeRef.current = false;
        setIsConnecting(false);
        return null;
      }
    }
    
    // Fallback to Web Bluetooth API
    usingNativeRef.current = false;
    console.log('🌐 Using Web Bluetooth API (legacy mode)');

    // Check Bluetooth support first
    const isSupported = await checkBluetoothSupport();
    if (!isSupported) {
      setIsConnecting(false);
      const errorMsg = isCapacitorApp() 
        ? 'Bluetooth LE not supported or disabled on this device. Please enable Bluetooth in device settings.'
        : 'Bluetooth LE not supported. Use a compatible browser (Chrome/Edge) or the native Android app.';
      options.onError?.(errorMsg);
      return null;
    }

    // Initialize Bluetooth LE client
    try {
      await BleClient.initialize({ androidNeverForLocation: false });
      console.log('✅ Bluetooth LE initialized and ready');
    } catch (e: any) {
      console.warn('Bluetooth LE initialization warning:', e.message);
      // Continue - might already be initialized
    }

    try {
      let device: BleDevice;

      // If we have a device address from previous scan, try to connect directly
      if (deviceAddress) {
        console.log('📱 Connecting to saved device:', deviceAddress);
        
        // On Capacitor/Android, we can connect directly
        await BleClient.connect(deviceAddress, (disconnectedId) => {
          console.log('Device disconnected:', disconnectedId);
          setIsConnected(false);
          setDeviceName('');
          options.onDisconnect?.();
        });

        device = { deviceId: deviceAddress, name: deviceName || 'GPS Device' };
        setDeviceName(device.name);
      } else {
        // Scan and request device selection
        console.log('🔍 Requesting Bluetooth device...');
        
        device = await BleClient.requestDevice({
          optionalServices: NMEA_SERVICE_UUIDS,
        });

        console.log('📱 Device selected:', device.name || device.deviceId);
        setDeviceName(device.name || 'GPS Device');

        // Connect to the device
        await BleClient.connect(device.deviceId, (disconnectedId) => {
          console.log('Device disconnected:', disconnectedId);
          setIsConnected(false);
          setDeviceName('');
          options.onDisconnect?.();
        });
      }

      console.log('✅ Connected to device:', device.deviceId);

      // Find NMEA service and characteristic
      const services = await BleClient.getServices(device.deviceId);
      console.log(`Found ${services.length} services on device`);

      let nmeaCharacteristic: { service: string; characteristic: string } | null = null;

      // Try each known service UUID
      for (const serviceUUID of NMEA_SERVICE_UUIDS) {
        const service = services.find(s => s.uuid.toLowerCase() === serviceUUID.toLowerCase());
        if (service) {
          console.log(`Found NMEA service: ${service.uuid}`);
          
          // Try each known RX characteristic UUID
          for (const charUUID of NMEA_RX_CHARACTERISTIC_UUIDS) {
            const char = service.characteristics.find(c => c.uuid.toLowerCase() === charUUID.toLowerCase());
            if (char && (char.properties.notify || char.properties.read)) {
              console.log(`Found NMEA characteristic: ${char.uuid}`);
              nmeaCharacteristic = { service: service.uuid, characteristic: char.uuid };
              break;
            }
          }

          // If not found, try any characteristic with notify
          if (!nmeaCharacteristic) {
            const notifyChar = service.characteristics.find(c => c.properties.notify);
            if (notifyChar) {
              console.log(`Using notify characteristic: ${notifyChar.uuid}`);
              nmeaCharacteristic = { service: service.uuid, characteristic: notifyChar.uuid };
            }
          }

          if (nmeaCharacteristic) break;
        }
      }

      if (!nmeaCharacteristic) {
        throw new Error('Could not find NMEA data characteristic. Ensure device is streaming NMEA data.');
      }

      // Start notifications on the NMEA characteristic
      await BleClient.startNotifications(
        device.deviceId,
        nmeaCharacteristic.service,
        nmeaCharacteristic.characteristic,
        (value) => {
          // Convert DataView to string
          const decoder = new TextDecoder('utf-8');
          const chunk = decoder.decode(value);
          
          // Add to buffer
          nmeaBufferRef.current += chunk;

          // Process complete NMEA sentences
          const lines = nmeaBufferRef.current.split('\n');
          nmeaBufferRef.current = lines.pop() || '';

          for (const line of lines) {
            const sentence = line.trim();
            if (sentence.startsWith('$')) {
              const position = parseNMEA(sentence);
              if (position) {
                setLastPosition(position);
                options.onPosition?.(position);
                
                // Add to validator
                validatorRef.current.addDataPoint(position, sentence);
                
                // Validate connection on first GPS data received
                if (!connectionValidatedRef.current && !isConnected) {
                  const validation = validatorRef.current.validateConnection();
                  
                  if (validation.isValid) {
                    connectionValidatedRef.current = true;
                    setIsConnected(true);
                    
                    // Clear validation timeout
                    if (dataTimeoutRef.current) {
                      clearTimeout(dataTimeoutRef.current);
                      dataTimeoutRef.current = null;
                    }
                    
                    // Use debounced notification
                    notificationDebouncerRef.current.notify('connect', () => {
                      console.log(`🎯 GPS Connection Validated:`, validation);
                      options.onConnect?.();
                    }, 1000);
                  }
                }
              }
            }
          }
        }
      );

      deviceRef.current = device;
      setIsConnecting(false);
      
      // Don't call onConnect immediately - wait for GPS data validation
      connectionValidatedRef.current = false;
      
      // Set timeout to validate connection with actual GPS data
      dataTimeoutRef.current = setTimeout(() => {
        if (!connectionValidatedRef.current) {
          console.warn('⚠️ No GPS data received within 30 seconds - connection may be invalid');
          options.onError?.('Connected but no GPS data received. Check device NMEA output settings.');
          disconnect();
        }
      }, 30000); // 30 second timeout
      
      console.log('✅ Bluetooth connected - waiting for GPS data validation...');
      return device;
    } catch (error: any) {
      console.error('❌ Bluetooth LE connection failed:', error);
      setIsConnecting(false);
      setIsConnected(false);
      
      let errorMsg = 'Bluetooth connection failed';
      
      if (error.message?.includes('User cancelled')) {
        errorMsg = 'Device selection cancelled';
      } else if (error.message?.includes('not available')) {
        errorMsg = 'Bluetooth not available. Enable Bluetooth in device settings.';
      } else if (error.message) {
        errorMsg = error.message;
      }
      
      options.onError?.(errorMsg);
      return null;
    }
  }, [parseNMEA, options]);
  /* eslint-enable react-hooks/exhaustive-deps */

  /**
   * Disconnect from GPS device
   */
  const disconnect = useCallback(async () => {
    try {
      if (usingNativeRef.current && nativeGpsManager.isNative) {
        console.log('📱 Disconnecting native Bluetooth GPS manager');
        await nativeGpsManager.disconnect();
        usingNativeRef.current = false;
        return;
      }
      
      // Legacy Web Bluetooth disconnect
      if (deviceRef.current) {
        const deviceId = typeof deviceRef.current === 'object' && 'deviceId' in deviceRef.current 
          ? deviceRef.current.deviceId 
          : deviceRef.current;
          
        await BleClient.disconnect(deviceId);
        console.log('✅ Bluetooth LE disconnected');
      }

      // Clear validation timers
      if (dataTimeoutRef.current) {
        clearTimeout(dataTimeoutRef.current);
        dataTimeoutRef.current = null;
      }
      if (notificationDebounceRef.current) {
        clearTimeout(notificationDebounceRef.current);
        notificationDebounceRef.current = null;
      }
      
      // Reset validation
      validatorRef.current.reset();
      notificationDebouncerRef.current.cancelAll();
      
      deviceRef.current = null;
      characteristicRef.current = null;
      nmeaBufferRef.current = '';
      connectionValidatedRef.current = false;
      
      setIsConnected(false);
      setDeviceName('');
      setLastPosition(null);
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  }, [nativeGpsManager]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  /**
   * Scan for nearby Bluetooth GPS devices
   */
  const scanDevices = useCallback(async (): Promise<BleDevice[]> => {
    try {
      // Check support first
      const isSupported = await checkBluetoothSupport();
      if (!isSupported) {
        throw new Error('Bluetooth LE not supported on this device');
      }

      console.log('🔍 Scanning for Bluetooth GPS devices...');
      
      // Request devices with GPS-related services
      await BleClient.requestLEScan({
        services: NMEA_SERVICE_UUIDS,
        allowDuplicates: false,
      }, (result) => {
        console.log('📱 Found GPS device:', result.device.name || result.device.deviceId);
      });

      // Stop scan after 10 seconds
      setTimeout(async () => {
        await BleClient.stopLEScan();
        console.log('🔍 Scan completed');
      }, 10000);

      return [];
    } catch (error: any) {
      console.error('❌ Bluetooth scan failed:', error);
      throw error;
    }
  }, [checkBluetoothSupport]);

  /**
   * Get available/paired devices (Android only)
   */
  const getAvailableDevices = useCallback(async (): Promise<BleDevice[]> => {
    try {
      if (!isCapacitorApp()) {
        // Web: Use requestDevice for device selection
        const device = await BleClient.requestDevice({
          optionalServices: NMEA_SERVICE_UUIDS,
        });
        return [device];
      }
      
      // Android: Could implement getBondedDevices if needed
      return [];
    } catch (error) {
      console.error('❌ Failed to get available devices:', error);
      return [];
    }
  }, []);

  return {
    isConnected: usingNativeRef.current ? nativeGpsManager.isConnected : isConnected,
    isConnecting: usingNativeRef.current ? nativeGpsManager.isConnecting : isConnecting,
    lastPosition: usingNativeRef.current ? nativeGpsManager.lastPosition : lastPosition,
    deviceName: usingNativeRef.current ? nativeGpsManager.connectedDevice?.name || '' : deviceName,
    connect,
    disconnect,
    scanDevices,
    getAvailableDevices,
    checkBluetoothSupport,
    isUsingNative: usingNativeRef.current,
    nativeCapabilities: nativeGpsManager.isNative ? {
      canScanDevices: true,
      canAutoReconnect: true,
      betterPerformance: true,
      nativeBluetoothSupport: true
    } : null
  };
}
