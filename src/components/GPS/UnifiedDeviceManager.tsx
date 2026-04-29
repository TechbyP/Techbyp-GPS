/**
 * Unified GPS Device Manager
 * Optimized for tablet use with direct device connections (no backend required)
 * Supports: TCP/WiFi (Emlid Reach RS3), Bluetooth LE (GPS devices), USB Serial GPS
 */

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useDarkMode } from '../../hooks/useDarkMode';
import { useLanguage } from '../../hooks/useLanguage';
import { useAuth } from '../../context/AuthContext';
import { useTcpGPS } from '../../hooks/useTcpGPS';
import { useBluetoothGPS } from '../../hooks/useBluetoothGPS';
import { useSerialGPS } from '../../hooks/useSerialGPS';
import { useNativeGpsManager } from '../../hooks/useNativeGpsManager';
import { isCapacitorApp } from '../../utils/platform';
import toast from 'react-hot-toast';
import Button from '../ui/Button';
import { 
  Bluetooth, 
  Wifi, 
  Usb,
  Plus, 
  Trash2, 
  X,
  Power,
  Loader,
  Satellite,
  CheckCircle,
  AlertCircle,
  Edit,
  Save
} from 'lucide-react';
import { GpsDevice, GpsPositionUpdate } from '../../types';
import { hybridDB } from '../../services/hybridDatabase';
import MockLocationDetector from '../../plugins/MockLocationDetector';
import { getCurrentPosition } from '../../utils/geolocation';

interface UnifiedDeviceManagerProps {
  onClose: () => void;
  onDeviceConnected?: (device: GpsDevice, positionCallback: (pos: GpsPositionUpdate) => void) => void;
  currentDevice?: GpsDevice | null;
  serialGPS?: ReturnType<typeof useSerialGPS>;
  tcpGPS?: ReturnType<typeof useTcpGPS>;
  bluetoothGPS?: ReturnType<typeof useBluetoothGPS>;
}

export default function UnifiedDeviceManager({ 
  onClose, 
  onDeviceConnected, 
  currentDevice,
  serialGPS: externalSerialGPS,
  tcpGPS: externalTcpGPS,
  bluetoothGPS: externalBluetoothGPS
}: UnifiedDeviceManagerProps) {
  const [isDark] = useDarkMode();
  const { t } = useLanguage();
  const { user } = useAuth();
  
  // State
  const [savedDevices, setSavedDevices] = useState<GpsDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [activeDevice, setActiveDevice] = useState<GpsDevice | null>(currentDevice || null);
  const [editingDevice, setEditingDevice] = useState<GpsDevice | null>(null);
  const [showAddDevice, setShowAddDevice] = useState(false);
  
  // Form state for add/edit
  const [deviceName, setDeviceName] = useState('');
  const [deviceType, setDeviceType] = useState<'wifi' | 'bluetooth' | 'usb'>('wifi');
  const [ipAddress, setIpAddress] = useState('');
  const [port, setPort] = useState('9001'); // Default NMEA port for Reach RS3
  const [bluetoothId, setBluetoothId] = useState('');
  const [mockLocationActive, setMockLocationActive] = useState(false);
  const [mockLocationProvider, setMockLocationProvider] = useState<string>('');
  const [autoDetectedDevices, setAutoDetectedDevices] = useState<Array<{
    id: string;
    name: string;
    type: 'mock' | 'bluetooth' | 'usb';
    address?: string;
    deviceId?: string;
    vendorId?: number;
    productId?: number;
  }>>([]);

  const REACH_RS3_PRESET = {
    name: 'Emlid Reach RS3',
    ip: '192.168.42.1',
    port: '9001'
  };

  // TCP GPS Hook - always call hook, but use external if provided
  const internalTcpGPS = useTcpGPS({
    onPosition: (pos) => {
      if (!externalTcpGPS) console.log('TCP GPS Position:', pos);
    },
    onConnect: () => {
      if (!externalTcpGPS) {
        console.log('UnifiedDeviceManager: TCP connected');
        setConnecting(null);
      }
    },
    onDisconnect: () => {
      if (!externalTcpGPS) console.log('UnifiedDeviceManager: TCP disconnected');
    },
    onError: (error) => {
      if (!externalTcpGPS) {
        console.error('UnifiedDeviceManager TCP Error:', error);
        setConnecting(null);
      }
    }
  });
  const tcpGPS = externalTcpGPS || internalTcpGPS;

  // Bluetooth GPS Hook - always call hook, but use external if provided
  const internalBluetoothGPS = useBluetoothGPS({
    onPosition: (pos) => {
      if (!externalBluetoothGPS) console.log('Bluetooth GPS Position:', pos);
    },
    onConnect: () => {
      if (!externalBluetoothGPS) {
        console.log('UnifiedDeviceManager: Bluetooth connected');
        setConnecting(null);
      }
    },
    onDisconnect: () => {
      if (!externalBluetoothGPS) console.log('UnifiedDeviceManager: Bluetooth disconnected');
    },
    onError: (error) => {
      if (!externalBluetoothGPS) {
        console.error('UnifiedDeviceManager Bluetooth Error:', error);
        setConnecting(null);
      }
    }
  });
  const bluetoothGPS = externalBluetoothGPS || internalBluetoothGPS;

  // USB Serial GPS Hook - always call hook, but use external if provided
  const internalSerialGPS = useSerialGPS({
    onPosition: (pos) => {
      if (!externalSerialGPS) console.log('USB Serial GPS Position:', pos);
    },
    onConnect: () => {
      if (!externalSerialGPS) {
        console.log('UnifiedDeviceManager: USB Serial connected');
        setConnecting(null);
      }
    },
    onDisconnect: () => {
      if (!externalSerialGPS) console.log('UnifiedDeviceManager: USB Serial disconnected');
    },
    onError: (error) => {
      if (!externalSerialGPS) {
        console.error('UnifiedDeviceManager USB Serial Error:', error);
        setConnecting(null);
      }
    }
  });
  const serialGPS = externalSerialGPS || internalSerialGPS;

  // Native GPS Manager (for Android APK - handles USB/Serial natively)
  const isNativeApp = isCapacitorApp();
  const nativeGpsManager = useNativeGpsManager({
    onPosition: (pos) => {
      console.log('Native GPS Position:', pos);
    },
    onConnect: () => {
      console.log('UnifiedDeviceManager: Native GPS connected');
      setConnecting(null);
    },
    onDisconnect: () => {
      console.log('UnifiedDeviceManager: Native GPS disconnected');
    },
    onError: (error) => {
      console.error('UnifiedDeviceManager Native GPS Error:', error);
      setConnecting(null);
    }
  });

  const loadDevices = useCallback(async () => {
    try {
      setLoading(true);
      if (user) {
        // Safe database operation with graceful fallback handling
        try {
          const devices = await hybridDB.getDevices();
          setSavedDevices(devices);
        } catch (dbError: any) {
          console.warn('Database error loading devices, using fallback:', dbError);
          
          // Gracefully fall back to localStorage without annoying messages
          const stored = localStorage.getItem('gps_devices_fallback') || localStorage.getItem('gps_devices_local');
          if (stored) {
            setSavedDevices(JSON.parse(stored));
            console.log('✅ Loaded devices from fallback storage');
          } else {
            console.log('📱 No saved devices found in fallback storage');
          }
        }
      } else {
        // Load from localStorage for non-authenticated users
        const stored = localStorage.getItem('gps_devices_local');
        if (stored) {
          setSavedDevices(JSON.parse(stored));
        }
      }
    } catch (error: any) {
      console.error('Failed to load devices:', error);
      toast.error(t('common.failedToLoadDevices'));
      // Always try localStorage as final fallback
      try {
        const fallback = localStorage.getItem('gps_devices_fallback') || localStorage.getItem('gps_devices_local');
        if (fallback) {
          setSavedDevices(JSON.parse(fallback));
        }
      } catch (e) {
        console.warn('Fallback storage also failed:', e);
      }
    } finally {
      setLoading(false);
    }
  }, [user, t]);

  // Load saved devices and check for SQLite conflicts
  useEffect(() => {
    const initializeWithConflictCheck = async () => {
      // Database initialization is now handled by hybridDB (IndexedDB only)
      // No need to initialize SQLite localDB which causes transaction errors
      console.log('📱 Device manager: Using IndexedDB for device storage');
      
      // Load devices (will use IndexedDB via hybridDB)
      loadDevices();
    };
    
    initializeWithConflictCheck();
  }, [loadDevices]);

  // Keep local active device in sync with parent-provided current device
  useEffect(() => {
    if (currentDevice) {
      setActiveDevice(currentDevice);
    }
  }, [currentDevice]);

  // Detect mock location (external GNSS) status
  useEffect(() => {
    let isCancelled = false;
    
    const checkMockLocation = async () => {
      // Skip if already cancelled
      if (isCancelled) return;
      
      try {
        console.log('🔍 Starting mock location check...');
        
        // First, try to use the native mock location detector directly
        let isMockFromPlugin = false;
        let pluginDetails = null;
        
        try {
          pluginDetails = await MockLocationDetector.isMockLocation();
          console.log('🔌 Native plugin result:', pluginDetails);
          isMockFromPlugin = pluginDetails.isMock;
          
          if (pluginDetails.error) {
            console.warn('⚠️ Plugin returned error:', pluginDetails.error);
          }
        } catch (pluginError) {
          console.log('⚠️ Could not use native plugin:', pluginError);
        }
        
        // If we can determine mock status from plugin alone, use it
        if (isMockFromPlugin) {
          if (isCancelled) return;
          
          console.log('✅ Mock location detected from plugin');
          setMockLocationActive(true);
          
          const providerInfo = pluginDetails?.provider ? ` (${pluginDetails.provider})` : '';
          const accuracyInfo = pluginDetails?.accuracy ? ` - ${pluginDetails.accuracy.toFixed(1)}m accuracy` : '';
          const providerName = `External GNSS Device${providerInfo}${accuracyInfo}`;
          setMockLocationProvider(providerName);
          
          setAutoDetectedDevices(prev => {
            const existing = prev.find(d => d.type === 'mock');
            if (!existing) {
              return [{
                id: 'mock-location-provider',
                name: providerName,
                type: 'mock' as const,
                address: pluginDetails?.provider || 'Mock Location API'
              }, ...prev];
            }
            return prev;
          });
          return;
        }
        
        // Only try position check if plugin didn't confirm mock location
        // Use shorter timeout to avoid blocking UI
        try {
          const position = await getCurrentPosition({ 
            timeout: 5000,  // Short 5 second timeout to avoid blocking
            maximumAge: 30000  // Accept cached positions up to 30 seconds old
          });
          
          if (isCancelled) return;
          
          console.log('📍 Position received:', {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            mocked: (position as any).mocked
          });
          
          const isMock = (position as any).mocked === true;
          setMockLocationActive(isMock);
          
          if (isMock) {
            const providerName = 'External GNSS Device';
            setMockLocationProvider(providerName);
            
            setAutoDetectedDevices(prev => {
              const existing = prev.find(d => d.type === 'mock');
              if (!existing) {
                return [{
                  id: 'mock-location-provider',
                  name: providerName,
                  type: 'mock' as const,
                  address: 'Mock Location API'
                }, ...prev];
              }
              return prev;
            });
          } else {
            setMockLocationProvider('');
            setAutoDetectedDevices(prev => prev.filter(d => d.type !== 'mock'));
          }
        } catch (posError: any) {
          // Position check failed, but that's okay - just skip it
          console.log('⚠️ Position check skipped:', posError?.message || posError);
          if (!isCancelled) {
            setMockLocationActive(false);
          }
        }
      } catch (error: any) {
        console.error('❌ Mock location check error:', error);
        if (!isCancelled) {
          setMockLocationActive(false);
        }
      }
    };
    
    // Start check immediately in background (non-blocking)
    checkMockLocation().catch(err => console.warn('Mock location check failed:', err));
    
    // Check periodically (every 30 seconds to reduce overhead)
    const interval = setInterval(() => {
      if (!isCancelled) {
        console.log('🔄 Periodic mock location check...');
        checkMockLocation().catch(err => console.warn('Periodic mock check failed:', err));
      }
    }, 30000);
    
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, []);

  const saveDevice = async (device: GpsDevice) => {
    try {
      if (user) {
        try {
          await hybridDB.saveDevice(device);
        } catch (dbError: any) {
          console.warn('Database save failed, using fallback storage:', dbError);
          // Save to fallback localStorage
          const stored = localStorage.getItem('gps_devices_fallback');
          const devices = stored ? JSON.parse(stored) : [];
          const updated = [...devices.filter((d: any) => d.id !== device.id), device];
          localStorage.setItem('gps_devices_fallback', JSON.stringify(updated));
          
          // Gracefully handle database issues without restart message
          console.log('📱 Database save failed, device saved to local storage instead');
        }
      } else {
        // Save to localStorage
        const updated = [...savedDevices.filter(d => d.id !== device.id), device];
        localStorage.setItem('gps_devices_local', JSON.stringify(updated));
      }
      await loadDevices();
      toast.success(t('common.deviceSaved') || 'Device saved');
    } catch (error: any) {
      console.error('Failed to save device:', error);
      toast.error(t('common.failedToSaveDevice') || 'Failed to save device');
    }
  };

  const deleteDevice = async (deviceId: string | number) => {
    try {
      if (user) {
        try {
          await hybridDB.deleteDevice(String(deviceId));
        } catch (dbError: any) {
          console.warn('Database delete failed, using fallback storage:', dbError);
          // Delete from fallback localStorage
          const stored = localStorage.getItem('gps_devices_fallback');
          if (stored) {
            const devices = JSON.parse(stored);
            const updated = devices.filter((d: any) => d.id !== deviceId);
            localStorage.setItem('gps_devices_fallback', JSON.stringify(updated));
          }
          
          // Gracefully handle database issues without restart message
          console.log('📱 Database delete failed, device deleted from local storage instead');
        }
      } else {
        const updated = savedDevices.filter(d => d.id !== deviceId);
        localStorage.setItem('gps_devices_local', JSON.stringify(updated));
      }
      await loadDevices();
      toast.success(t('common.deviceDeleted'));
    } catch (error: any) {
      console.error('Failed to delete device:', error);
      toast.error(t('common.failedToDeleteDevice') || 'Failed to delete device');
    }
  };

  const handleConnect = async (device: GpsDevice) => {
    setConnecting(device.address);
    
    try {
      if (device.connection_type === 'wifi') {
        // Extract IP and port from address (format: "192.168.42.1:9001")
        const [ip, portStr] = device.address.split(':');
        const portNum = parseInt(portStr || '9001', 10);
        
        const wifiConnected = await tcpGPS.connect(ip, portNum);
        if (!wifiConnected) {
          throw new Error(t('gps.devices.wifiConnectFailed') || 'WiFi GPS connection failed');
        }
        setActiveDevice(device);
        
        // Pass the position callback to parent
        if (onDeviceConnected) {
          onDeviceConnected(device, (pos: GpsPositionUpdate) => {
            // This callback will be called by useTcpGPS hook
          });
        }
      } else if (device.connection_type === 'bluetooth') {
        const bluetoothConnected = await bluetoothGPS.connect(device.address, device.name);
        if (!bluetoothConnected) {
          throw new Error(t('gps.devices.bluetoothConnectFailed') || 'Bluetooth GPS connection failed');
        }
        setActiveDevice(device);
        
        // Pass the position callback to parent
        if (onDeviceConnected) {
          onDeviceConnected(device, (pos: GpsPositionUpdate) => {
            // This callback will be called by useBluetoothGPS hook
          });
        }
      } else if (device.connection_type === 'usb') {
        // On Android, use native GPS manager
        if (isNativeApp) {
          console.log('Connecting USB device via native manager:', device);
          const usbConnected = await nativeGpsManager.connectDevice({
            address: device.address,
            connectionType: 'serial',
            deviceId: device.id?.toString(),
            name: device.name
          });
          if (!usbConnected) {
            throw new Error(t('gps.devices.usbConnectFailed') || 'USB GPS connection failed');
          }

          await nativeGpsManager.startPositionStream();
          
          setActiveDevice(device);
          
          if (onDeviceConnected) {
            onDeviceConnected(device, (pos: GpsPositionUpdate) => {
              // Position updates handled by native manager callbacks
            });
          }
          return;
        }
        
        // On desktop, use Web Serial API
        // If already connected to this device, don't reconnect
        if (serialGPS.isConnected && activeDevice?.id === device.id) {
          console.log('USB device already connected');
          return;
        }
        
        // Disconnect any existing connection first
        if (serialGPS.isConnected) {
          await serialGPS.disconnect();
        }
        
        // For USB, try to get authorized ports and connect to matching one
        const ports = await serialGPS.getAuthorizedPorts();
        const matchingPort = ports.find(p => 
          device.address.includes(`${p.vendorId}:${p.productId}`)
        );
        
        if (matchingPort) {
          await serialGPS.connect(matchingPort.port);
        } else {
          // Port not found, prompt user
          await serialGPS.connect();
        }
        
        setActiveDevice(device);
        
        // Pass the position callback to parent
        if (onDeviceConnected) {
          onDeviceConnected(device, (pos: GpsPositionUpdate) => {
            // This callback will be called by useSerialGPS hook
          });
        }
      }
    } catch (error: any) {
      console.error('Connection failed:', error);
      toast.error(error.message || t('common.failedToConnect') || 'Failed to connect to device');
      setConnecting(null);
    }
  };

  const handleDisconnect = async () => {
    try {
      // Disconnect native GPS manager if on Android
      if (isNativeApp && nativeGpsManager.isConnected) {
        await nativeGpsManager.disconnect();
      }
      
      if (tcpGPS.isConnected) {
        tcpGPS.disconnect();
      }
      if (bluetoothGPS.isConnected) {
        bluetoothGPS.disconnect();
      }
      if (serialGPS.isConnected) {
        serialGPS.disconnect();
      }
      setActiveDevice(null);
    } catch (error) {
      console.error('Disconnect failed:', error);
    }
  };

  const handleScanBluetooth = async () => {
    try {
      // First check if Bluetooth LE is supported
      const isSupported = await bluetoothGPS.checkBluetoothSupport();
      if (!isSupported) {
        toast.error(t('gps.devices.bluetoothNotSupported') || 'Bluetooth LE not supported or disabled on this device');
        return;
      }

      toast(t('gps.devices.scanningDevices') || 'Scanning for GPS devices...', { icon: '🔍' });
      
      // Try to get available devices or scan
      const devices = await bluetoothGPS.getAvailableDevices();
      
      if (devices.length > 0) {
        // Add all found devices to auto-detected list
        const detectedDevices = devices.map(device => ({
          id: `bluetooth-${device.deviceId}`,
          name: device.name || t('gps.bluetoothGps') || 'Bluetooth GPS',
          type: 'bluetooth' as const,
          address: device.name || t('gps.bluetoothDevice') || 'Bluetooth Device',
          deviceId: device.deviceId
        }));
        
        setAutoDetectedDevices(prev => {
          // Remove old bluetooth devices and add new ones
          const nonBluetooth = prev.filter(d => d.type !== 'bluetooth');
          return [...nonBluetooth, ...detectedDevices];
        });
        
        toast.success(t('gps.devices.bluetoothDevicesFound', { count: devices.length }) || `Found ${devices.length} device(s)! Click to add them.`);
      } else {
        toast(t('gps.devices.bluetoothNoDevices') || 'No GPS devices found. Make sure device is in pairing mode.', { icon: '🔍' });
      }
    } catch (error: any) {
      if (error.name === 'NotFoundError') {
        toast(t('gps.devices.noDeviceSelected') || 'No device selected', { icon: '🔍' });
      } else {
        console.error('Bluetooth scan failed:', error);
        toast.error(error.message || t('gps.devices.bluetoothScanFailed') || 'Bluetooth scan failed');
      }
    }
  };

  const handleScanMockLocation = async () => {
    try {
      console.log('🔍 Manual mock location scan triggered');
      toast.loading(t('gps.devices.checkingMockLocation') || 'Checking for mock location...', { duration: 2000 });
      
      const position = await getCurrentPosition({ 
        timeout: 10000,
        maximumAge: 0  // Force fresh position
      });
      
      const isMock = (position as any).mocked === true;
      console.log('📍 Manual scan result - Mock location:', isMock);
      
      if (isMock) {
        const providerName = 'External GNSS Device (Mock Location)';
        setMockLocationActive(true);
        setMockLocationProvider(providerName);
        
        setAutoDetectedDevices(prev => {
          const existing = prev.find(d => d.type === 'mock');
          if (!existing) {
            return [{
              id: 'mock-location-provider',
              name: providerName,
              type: 'mock' as const,
              address: 'Mock Location API'
            }, ...prev];
          }
          return prev;
        });
        
        toast.success(t('gps.devices.mockLocationDetected') || 'Mock location detected! External GNSS device is active.');
      } else {
        toast.error(t('gps.devices.mockLocationNotDetected') || 'No mock location detected. Make sure:\n1. Mock locations enabled in Developer Options\n2. External GNSS app is running\n3. App has location permissions');
      }
    } catch (error: any) {
      console.error('Manual mock location scan error:', error);
      toast.error(error.message || t('gps.devices.mockLocationCheckFailed') || 'Failed to check for mock location');
    }
  };

  const handleScanUSB = async () => {
    try {
      // On Android, use native GPS manager
      if (isNativeApp) {
        toast(t('gps.devices.scanningDevices') || 'Scanning for USB GPS devices...', { icon: '🔍' });
        
        // Use native scanner
        const devices = await nativeGpsManager.scanDevices(['serial'], 5000);
        
        if (devices.length > 0) {
          const detectedDevices = devices.map(device => ({
            id: device.id,
            name: device.name,
            type: 'usb' as const,
            address: device.address,
            deviceId: device.id
          }));
          
          setAutoDetectedDevices(prev => {
            const nonUSB = prev.filter(d => d.type !== 'usb');
            return [...nonUSB, ...detectedDevices];
          });
          
          toast.success(t('gps.devices.usbScanSuccess', { count: devices.length }) || `Found ${devices.length} USB device(s)! Click to add them.`);
        } else {
          toast(t('gps.devices.noUsbDevices') || 'No USB GPS devices found. Make sure device is connected.', { icon: '🔌' });
        }
        return;
      }
      
      // On desktop, use Web Serial API
      if (!serialGPS.isSupported) {
        toast.error(t('gps.devices.usbNotSupported') || 'USB Serial not supported in this browser. Try Chrome/Edge on desktop.');
        return;
      }

      toast(t('gps.devices.scanningDevices') || 'Checking for USB GPS devices...', { icon: '🔍' });
      
      // Get previously authorized ports
      const ports = await serialGPS.getAuthorizedPorts();
      
      if (ports.length > 0) {
        // Add authorized devices to auto-detected list
        const detectedDevices = ports.map(port => ({
          id: `usb-${port.vendorId}-${port.productId}`,
          name: port.name,
          type: 'usb' as const,
          address: `USB:${port.vendorId}:${port.productId}`,
          vendorId: port.vendorId,
          productId: port.productId
        }));
        
        setAutoDetectedDevices(prev => {
          // Remove old USB devices and add new ones
          const nonUSB = prev.filter(d => d.type !== 'usb');
          return [...nonUSB, ...detectedDevices];
        });
        
        toast.success(t('gps.devices.usbScanSuccess', { count: ports.length }) || `Found ${ports.length} authorized USB device(s)! Click to add them.`);
      } else {
        // No authorized ports, prompt user to connect
        toast(t('gps.devices.usbScanPrompt') || 'Click "Connect USB Device" to select a USB GPS device', { icon: '🔌' });
      }
    } catch (error: any) {
      console.error('USB scan failed:', error);
      toast.error(error.message || t('gps.devices.usbScanFailed') || 'Failed to scan USB devices');
    }
  };

  const handleConnectUSB = async () => {
    try {
      if (!serialGPS.isSupported) {
        toast.error(t('gps.devices.usbNotSupported') || 'USB Serial not supported in this browser. Try Chrome/Edge on desktop or Android.');
        return;
      }

      // First check if there are already authorized ports
      const ports = await serialGPS.getAuthorizedPorts();
      
      if (ports.length > 0) {
        // Connect to the first authorized port without prompting
        toast(t('gps.devices.connectingUsb') || 'Connecting to USB GPS device...', { icon: '🔌' });
        await serialGPS.connect(ports[0].port);
        
        // Create and save device entry
        const portInfo = ports[0];
        const newDevice: GpsDevice = {
          id: Date.now(),
          name: portInfo.name,
          address: `USB:${portInfo.vendorId}:${portInfo.productId}`,
          connection_type: 'usb',
          device_type: 'usb_serial',
        };
        
        await saveDevice(newDevice);
        setActiveDevice(newDevice);
        
        toast.success(t('gps.devices.usbConnected') || 'USB GPS device connected!');
      } else {
        // No authorized ports, prompt user to select a device
        await serialGPS.connect();
        
        // After connection, get the newly authorized port and save it
        const newPorts = await serialGPS.getAuthorizedPorts();
        if (newPorts.length > 0) {
          const portInfo = newPorts[newPorts.length - 1]; // Get the most recently added
          const newDevice: GpsDevice = {
            id: Date.now(),
            name: portInfo.name,
            address: `USB:${portInfo.vendorId}:${portInfo.productId}`,
            connection_type: 'usb',
            device_type: 'usb_serial',
          };
          
          await saveDevice(newDevice);
          setActiveDevice(newDevice);
        }
        
        toast.success(t('gps.devices.usbConnected') || 'USB GPS device connected!');
      }
      
      // Refresh the device list
      await handleScanUSB();
      
    } catch (error: any) {
      if (error.name === 'NotFoundError') {
        toast(t('gps.devices.noDeviceSelected') || 'No device selected', { icon: '🔌' });
      } else {
        console.error('USB connection failed:', error);
        toast.error(error.message || t('gps.devices.usbConnectFailed') || 'Failed to connect USB device');
      }
    }
  };

  const handleAddDevice = async () => {
    // Validate form
    if (!deviceName.trim()) {
      toast.error(t('gps.devices.deviceNameRequired') || 'Device name is required');
      return;
    }

    if (deviceType === 'wifi') {
      if (!ipAddress.trim() || !port.trim()) {
        toast.error(t('gps.devices.ipAddressRequired') || 'IP address and port are required');
        return;
      }
    } else if (deviceType === 'bluetooth') {
      if (!bluetoothId.trim()) {
        toast.error(t('gps.devices.bluetoothDeviceRequired') || 'Please scan for a Bluetooth device first');
        return;
      }
    } else if (deviceType === 'usb') {
      // USB devices don't need additional validation
      // Connection happens through Web Serial API
    }

    const isReachWifi = deviceType === 'wifi';

    const newDevice: GpsDevice = {
      id: editingDevice?.id || Date.now(),
      name: deviceName,
      address: deviceType === 'wifi' ? `${ipAddress}:${port}` : deviceType === 'usb' ? 'USB' : bluetoothId,
      connection_type: deviceType,
      device_type: deviceType === 'wifi' ? 'reach_rs3' : deviceType === 'usb' ? 'usb_serial' : 'generic_bluetooth',
      ...(isReachWifi ? {
        manufacturer: 'Emlid',
        model: 'Reach RS3',
        profile: 'reach_rs3_rtk' as const,
        auto_reconnect: true,
        reconnect_delay_ms: 3000,
        max_reconnect_attempts: 10,
        use_for_tracking: true,
        use_for_samples: true,
        priority: 1,
        config: {
          tcp_host: ipAddress,
          tcp_port: parseInt(port, 10),
          output_format: 'nmea' as const,
          nmea_sentences: ['GGA', 'RMC', 'GSA', 'GSV'],
          nmea_output_rate_hz: 1,
          correction_input: 'none' as const,
          coordinate_system: 'WGS84' as const
        },
        profile_settings: {
          connectionPreset: 'reach_rs3_hotspot_default',
          hotspotSsidPattern: 'Reach*',
          expectedHost: ipAddress,
          expectedPort: parseInt(port, 10)
        }
      } : {})
    };

    await saveDevice(newDevice);
    
    // Reset form
    setShowAddDevice(false);
    setEditingDevice(null);
    setDeviceName('');
    setIpAddress('');
    setPort('9001');
    setBluetoothId('');
  };

  const applyReachRs3PresetToForm = () => {
    setDeviceName(REACH_RS3_PRESET.name);
    setDeviceType('wifi');
    setIpAddress(REACH_RS3_PRESET.ip);
    setPort(REACH_RS3_PRESET.port);
    setBluetoothId('');
    setShowAddDevice(true);
    setEditingDevice(null);
  };

  const handleAddReachRs3Preset = async () => {
    const newDevice: GpsDevice = {
      id: Date.now(),
      name: REACH_RS3_PRESET.name,
      address: `${REACH_RS3_PRESET.ip}:${REACH_RS3_PRESET.port}`,
      connection_type: 'wifi',
      device_type: 'reach_rs3',
      manufacturer: 'Emlid',
      model: 'Reach RS3',
      profile: 'reach_rs3_rtk',
      auto_reconnect: true,
      reconnect_delay_ms: 3000,
      max_reconnect_attempts: 10,
      use_for_tracking: true,
      use_for_samples: true,
      priority: 1,
      config: {
        tcp_host: REACH_RS3_PRESET.ip,
        tcp_port: parseInt(REACH_RS3_PRESET.port, 10),
        output_format: 'nmea',
        nmea_sentences: ['GGA', 'RMC', 'GSA', 'GSV'],
        nmea_output_rate_hz: 1,
        correction_input: 'none',
        coordinate_system: 'WGS84'
      },
      profile_settings: {
        connectionPreset: 'reach_rs3_hotspot_default',
        hotspotSsidPattern: 'Reach*',
        expectedHost: REACH_RS3_PRESET.ip,
        expectedPort: parseInt(REACH_RS3_PRESET.port, 10)
      }
    };

    await saveDevice(newDevice);
    setActiveDevice(newDevice);
    toast.success(t('gps.devices.reachPresetAdded') || 'Reach RS3 preset added (192.168.42.1:9001)');
  };

  const handleEditDevice = (device: GpsDevice) => {
    setEditingDevice(device);
    setDeviceName(device.name);
    setDeviceType(device.connection_type as 'wifi' | 'bluetooth' | 'usb');
    
    if (device.connection_type === 'wifi') {
      const [ip, portStr] = device.address.split(':');
      setIpAddress(ip);
      setPort(portStr || '9001');
    } else if (device.connection_type === 'bluetooth') {
      setBluetoothId(device.address);
    }
    // USB devices don't need pre-fill
    
    setShowAddDevice(true);
  };

  const cancelEdit = () => {
    setShowAddDevice(false);
    setEditingDevice(null);
    setDeviceName('');
    setIpAddress('');
    setPort('9001');
    setBluetoothId('');
  };

  const handleAddAutoDetectedDevice = (device: typeof autoDetectedDevices[0]) => {
    if (device.type === 'bluetooth' && device.deviceId) {
      setDeviceName(device.name);
      setDeviceType('bluetooth');
      setBluetoothId(device.deviceId);
      setShowAddDevice(true);
    } else if (device.type === 'usb') {
      setDeviceName(device.name);
      setDeviceType('usb');
      setShowAddDevice(true);
    }
  };

  const isConnected = nativeGpsManager.isConnected || tcpGPS.isConnected || bluetoothGPS.isConnected || serialGPS.isConnected;
  const isConnecting = connecting !== null;
  const activePosition = nativeGpsManager.lastPosition || tcpGPS.lastPosition || bluetoothGPS.lastPosition || serialGPS.lastPosition;
  const connectionSource = nativeGpsManager.isConnected
    ? (t('gps.devices.nativeGps') || 'Native GPS')
    : tcpGPS.isConnected
    ? (t('gps.devices.wifiTcp') || 'WiFi/TCP')
    : bluetoothGPS.isConnected
      ? (t('gps.devices.bluetooth') || 'Bluetooth')
      : serialGPS.isConnected
        ? (t('gps.devices.usb') || 'USB Serial')
        : activeDevice?.connection_type === 'wifi'
          ? (t('gps.devices.wifiTcp') || 'WiFi/TCP')
          : activeDevice?.connection_type === 'bluetooth'
            ? (t('gps.devices.bluetooth') || 'Bluetooth')
            : activeDevice?.connection_type === 'usb'
              ? (t('gps.devices.usb') || 'USB Serial')
              : (t('gps.devices.sourceUnknown') || 'Unknown');
  const lastUpdateSeconds = activePosition ? Math.max(0, Math.floor((Date.now() - activePosition.timestamp) / 1000)) : null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 bg-black/50 backdrop-blur-sm">
      <div className={`w-full max-w-2xl md:max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden ${
        isDark ? 'bg-gray-800' : 'bg-white'
      }`}>
        {/* Header */}
        <div className={`flex-shrink-0 px-6 md:px-8 py-4 md:py-6 border-b flex items-center justify-between ${
          isDark ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-200'
        }`}>
          <div className="flex items-center gap-3 md:gap-4">
            <Satellite className="w-6 h-6 md:w-8 md:h-8 text-blue-500" />
            <div>
              <h2 className={`text-xl md:text-2xl font-bold ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}>
                {t('gps.devices.title') || 'GPS Devices'}
              </h2>
              <p className={`text-sm md:text-base ${
                isDark ? 'text-gray-400' : 'text-gray-600'
              }`}>
                {t('gps.devices.subtitle') || 'Connect to external GPS devices for high-precision tracking'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-2 md:p-3 rounded-lg transition-colors ${
              isDark ? 'hover:bg-gray-700 text-gray-300 hover:text-white' : 'hover:bg-gray-200 text-gray-600 hover:text-gray-900'
            }`}
          >
            <X className="w-5 h-5 md:w-6 md:h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 md:p-8">
          {/* Add/Edit Device Form */}
          {showAddDevice && (
            <div className={`mb-6 p-4 md:p-6 rounded-xl border-2 ${
              isDark ? 'bg-gray-900 border-blue-500' : 'bg-blue-50 border-blue-300'
            }`}>
              <h3 className={`text-lg md:text-xl font-semibold mb-4 md:mb-6 ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}>
                {editingDevice ? (t('gps.devices.editDevice') || 'Edit Device') : (t('gps.devices.addManualDevice') || 'Add New Device')}
              </h3>
              
              {/* Device Name */}
              <div className="mb-4 md:mb-6">
                <label className={`block text-sm md:text-base font-medium mb-2 md:mb-3 ${
                  isDark ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  {t('gps.devices.deviceName') || 'Device Name'}
                </label>
                <input
                  type="text"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder={t('gps.devices.deviceNamePlaceholder') || 'e.g., Emlid Reach RS3'}
                  className={`w-full px-4 md:px-5 py-3 md:py-4 rounded-lg border text-base md:text-lg ${
                    isDark 
                      ? 'bg-gray-800 border-gray-700 focus:border-blue-500 text-white' 
                      : 'bg-white border-gray-300 focus:border-blue-500 text-gray-900'
                  } focus:outline-none focus:ring-2 focus:ring-blue-500/50`}
                />
              </div>

              {/* Connection Type */}
              <div className="mb-4 md:mb-6">
                <label className={`block text-sm md:text-base font-medium mb-2 md:mb-3 ${
                  isDark ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  {t('gps.devices.connectionType') || 'Connection Type'}
                </label>
                <p className={`text-xs md:text-sm mb-3 md:mb-4 ${
                  isDark ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  {t('gps.devices.mockLocationNote') || '💡 If you\'re using Mock Location (external GNSS app), you don\'t need to add devices here'}
                </p>
                <div className="grid grid-cols-3 gap-3 md:gap-4">
                  <button
                    onClick={() => setDeviceType('wifi')}
                    className={`p-4 md:p-6 rounded-lg border-2 transition-all ${
                      deviceType === 'wifi'
                        ? 'border-blue-500 bg-blue-500/10'
                        : isDark ? 'border-gray-700 hover:border-gray-600' : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    <Wifi className={`w-6 h-6 md:w-8 md:h-8 mx-auto mb-2 ${
                      deviceType === 'wifi' ? 'text-blue-500' : (isDark ? 'text-gray-400' : 'text-gray-600')
                    }`} />
                    <div className={`text-sm md:text-base font-medium ${
                      isDark ? 'text-white' : 'text-gray-900'
                    }`}>
                      {t('gps.devices.wifiTcp') || 'WiFi / TCP'}
                    </div>
                  </button>
                  <button
                    onClick={() => setDeviceType('bluetooth')}
                    className={`p-4 md:p-6 rounded-lg border-2 transition-all ${
                      deviceType === 'bluetooth'
                        ? 'border-blue-500 bg-blue-500/10'
                        : isDark ? 'border-gray-700 hover:border-gray-600' : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    <Bluetooth className={`w-6 h-6 md:w-8 md:h-8 mx-auto mb-2 ${
                      deviceType === 'bluetooth' ? 'text-blue-500' : (isDark ? 'text-gray-400' : 'text-gray-600')
                    }`} />
                    <div className={`text-sm md:text-base font-medium ${
                      isDark ? 'text-white' : 'text-gray-900'
                    }`}>
                      {t('gps.devices.bluetooth') || 'Bluetooth'}
                    </div>
                  </button>
                  <button
                    onClick={() => setDeviceType('usb')}
                    className={`p-4 md:p-6 rounded-lg border-2 transition-all ${
                      deviceType === 'usb'
                        ? 'border-blue-500 bg-blue-500/10'
                        : isDark ? 'border-gray-700 hover:border-gray-600' : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    <Usb className={`w-6 h-6 md:w-8 md:h-8 mx-auto mb-2 ${
                      deviceType === 'usb' ? 'text-blue-500' : (isDark ? 'text-gray-400' : 'text-gray-600')
                    }`} />
                    <div className={`text-sm md:text-base font-medium ${
                      isDark ? 'text-white' : 'text-gray-900'
                    }`}>
                      {t('gps.devices.usb') || 'USB Serial'}
                    </div>
                  </button>
                </div>
              </div>

              {/* WiFi Fields */}
              {deviceType === 'wifi' && (
                <>
                  <div className="mb-4">
                    <label className={`block text-sm font-medium mb-2 ${
                      isDark ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                      {t('gps.devices.ipAddress') || 'IP Address'}
                    </label>
                    <input
                      type="text"
                      value={ipAddress}
                      onChange={(e) => setIpAddress(e.target.value)}
                      placeholder="192.168.42.1"
                      className={`w-full px-4 py-3 rounded-lg border text-lg ${
                        isDark 
                          ? 'bg-gray-800 border-gray-700 focus:border-blue-500 text-white placeholder-gray-400' 
                          : 'bg-white border-gray-300 focus:border-blue-500 text-gray-900 placeholder-gray-500'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500/50`}
                    />
                  </div>
                  <div className="mb-4">
                    <label className={`block text-sm font-medium mb-2 ${
                      isDark ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                      {t('gps.devices.port') || 'Port'}
                    </label>
                    <input
                      type="text"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      placeholder="9001"
                      className={`w-full px-4 py-3 rounded-lg border text-lg ${
                        isDark 
                          ? 'bg-gray-800 border-gray-700 focus:border-blue-500 text-white placeholder-gray-400' 
                          : 'bg-white border-gray-300 focus:border-blue-500 text-gray-900 placeholder-gray-500'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500/50`}
                    />
                  </div>
                  <div className={`p-3 rounded-lg text-sm ${
                    isDark ? 'bg-blue-900/30 text-blue-300' : 'bg-blue-100 text-blue-800'
                  }`}>
                    💡 {t('gps.devices.wifiTip') || 'For Emlid Reach RS3: Connect to its WiFi hotspot, then use IP 192.168.42.1 and port 9001'}
                  </div>
                </>
              )}

              {/* Bluetooth Fields */}
              {deviceType === 'bluetooth' && (
                <>
                  <Button
                    onClick={handleScanBluetooth}
                    className="w-full mb-4"
                    size="lg"
                  >
                    <Bluetooth className="w-5 h-5 mr-2" />
                    {t('gps.devices.scanBluetooth') || 'Scan for Bluetooth Devices'}
                  </Button>
                  {bluetoothId && (
                    <div className={`p-3 rounded-lg text-sm ${
                      isDark ? 'bg-green-900/30 text-green-300' : 'bg-green-100 text-green-800'
                    }`}>
                      ✓ {t('gps.devices.deviceSelected') || 'Device selected'}: {bluetoothId}
                    </div>
                  )}
                </>
              )}

              {/* USB Serial Fields */}
              {deviceType === 'usb' && (
                <>
                  <div className="space-y-3 mb-4">
                    <Button
                      onClick={handleConnectUSB}
                      className="w-full"
                      size="lg"
                      variant="primary"
                    >
                      <Usb className="w-5 h-5 mr-2" />
                      {t('gps.devices.connectUsb') || 'Connect USB Device'}
                    </Button>
                    <Button
                      onClick={handleScanUSB}
                      className="w-full"
                      size="lg"
                      variant="secondary"
                    >
                      <Satellite className="w-5 h-5 mr-2" />
                      {t('gps.devices.scanUsb') || 'Auto-Detect USB Devices'}
                    </Button>
                  </div>
                  {!serialGPS.isSupported && (
                    <div className={`p-3 rounded-lg text-sm ${
                      isDark ? 'bg-yellow-900/30 text-yellow-300' : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {t('gps.devices.usbNotSupported') || '⚠️ USB Serial not supported in this browser. Try Chrome/Edge on desktop or Android.'}
                    </div>
                  )}
                  <div className={`p-3 rounded-lg text-sm ${
                    isDark ? 'bg-blue-900/30 text-blue-300' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {t('gps.devices.usbTip') || '💡 Connect a USB GPS device (NMEA 0183 protocol) via cable. Most GPS receivers with USB are supported.'}
                  </div>
                </>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 mt-4">
                <Button
                  onClick={handleAddDevice}
                  variant="primary"
                  size="lg"
                  className="flex-1"
                >
                  <Save className="w-5 h-5 mr-2" />
                  {editingDevice ? (t('gps.devices.saveChanges') || 'Save Changes') : (t('gps.devices.addDevice') || 'Add Device')}
                </Button>
                <Button
                  onClick={cancelEdit}
                  variant="secondary"
                  size="lg"
                >
                  {t('common.cancel') || 'Cancel'}
                </Button>
              </div>
            </div>
          )}

          {/* Add Device Button (when not showing form) */}
          {!showAddDevice && (
            <>
              <Button
                onClick={handleAddReachRs3Preset}
                variant="primary"
                size="lg"
                className="w-full mb-3 text-left justify-start whitespace-normal leading-tight"
              >
                <Wifi className="w-5 h-5 mr-2" />
                {t('gps.devices.addReachPreset') || 'Add Reach RS3 Preset (WiFi)'}
              </Button>

              <Button
                onClick={applyReachRs3PresetToForm}
                variant="secondary"
                size="lg"
                className="w-full mb-4 text-left justify-start whitespace-normal leading-tight"
              >
                <Edit className="w-5 h-5 mr-2" />
                {t('gps.devices.customizeReachPreset') || 'Customize Reach RS3 Preset'}
              </Button>

              <Button
                onClick={() => setShowAddDevice(true)}
                variant="primary"
                size="lg"
                className="w-full mb-4 text-left justify-start whitespace-normal leading-tight"
              >
                <Plus className="w-5 h-5 mr-2" />
                {t('gps.devices.addManualDevice') || 'Add New Device'}
              </Button>
              
              {/* Scan for Mock Location Button */}
              <Button
                onClick={handleScanMockLocation}
                variant="secondary"
                size="lg"
                className="w-full mb-6 text-left justify-start whitespace-normal leading-tight"
              >
                <Satellite className="w-5 h-5 mr-2" />
                {t('gps.devices.scanMockLocation') || 'Scan for Mock Location (External GNSS)'}
              </Button>
            </>
          )}

          {/* Auto-Detected Devices Section */}
          {autoDetectedDevices.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Satellite className="w-5 h-5 text-green-500" />
                <h3 className={`text-sm font-semibold uppercase tracking-wider ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('gps.devices.autoDetectedDevices', { count: autoDetectedDevices.length }) || `Auto-Detected Devices (${autoDetectedDevices.length})`}
                </h3>
              </div>
              <div className="space-y-3">
                {autoDetectedDevices.map((device) => (
                  <div
                    key={device.id}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      device.type === 'mock'
                        ? isDark ? 'border-green-500 bg-green-900/20' : 'border-green-500 bg-green-50'
                        : isDark ? 'border-blue-500 bg-blue-900/20' : 'border-blue-500 bg-blue-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {device.type === 'mock' ? (
                            <div className="text-2xl">🛰️</div>
                          ) : (
                            <Bluetooth className="w-5 h-5 text-blue-500 flex-shrink-0" />
                          )}
                          <h4 className={`font-semibold text-lg truncate ${
                            isDark ? 'text-white' : 'text-gray-900'
                          }`}>{device.name}</h4>
                          <div className={`text-xs px-2 py-0.5 rounded-full ${
                            device.type === 'mock'
                              ? 'bg-green-500/20 text-green-600 border border-green-500/30'
                              : 'bg-blue-500/20 text-blue-600 border border-blue-500/30'
                          }`}>
                            {device.type === 'mock' ? (t('gps.devices.deviceStatusActive') || 'Active') : (t('gps.devices.deviceStatusDetected') || 'Detected')}
                          </div>
                        </div>
                        <p className={`text-sm truncate ${
                          isDark ? 'text-gray-400' : 'text-gray-600'
                        }`}>{device.address}</p>
                        {device.type === 'mock' && (
                          <p className={`text-xs mt-2 ${
                            isDark ? 'text-gray-400' : 'text-gray-600'
                          }`}>
                            {t('gps.devices.mockLocationNoConnectNeeded') || '💡 This device is currently providing location data via Mock Location. No connection needed.'}
                          </p>
                        )}
                      </div>

                      <div className="flex gap-2 flex-shrink-0">
                        {device.type === 'mock' ? (
                          <div className={`px-3 py-2 rounded-lg flex items-center gap-2 ${
                            isDark ? 'bg-green-900/50 text-green-300' : 'bg-green-100 text-green-800'
                          }`}>
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            <span className="text-sm font-medium">{t('gps.devices.inUse') || 'In Use'}</span>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleAddAutoDetectedDevice(device)}
                            className={`px-4 py-2 rounded-lg transition-colors ${
                              isDark 
                                ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                                : 'bg-blue-500 hover:bg-blue-600 text-white'
                            }`}
                          >
                            <Plus className="w-4 h-4 inline mr-1" />
                            {t('common.add') || 'Add'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mock Location Status Card */}
          {mockLocationActive && (
            <div className={`mb-6 p-4 rounded-xl border-2 ${
              isDark ? 'bg-blue-900/30 border-blue-500' : 'bg-blue-50 border-blue-300'
            }`}>
              <div className="flex items-start gap-3">
                <div className="text-3xl">🛰️</div>
                <div className="flex-1">
                  <h3 className={`text-lg font-semibold mb-1 ${
                    isDark ? 'text-white' : 'text-gray-900'
                  }`}>
                    {t('gps.devices.externalGnssActiveTitle') || 'External GNSS Active'}
                  </h3>
                  <p className={`text-sm mb-2 ${
                    isDark ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    {t('gps.devices.externalGnssActiveDesc') || 'Your device is receiving high-precision GPS data from an external GNSS provider via Mock Location.'}
                  </p>
                  <div className={`text-xs px-3 py-1.5 rounded-full inline-flex items-center gap-2 ${
                    isDark ? 'bg-green-900/50 text-green-300' : 'bg-green-100 text-green-800'
                  }`}>
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="font-medium">{mockLocationProvider || (t('gps.mockLocationActive') || 'Mock Location Active')}</span>
                  </div>
                  <p className={`text-xs mt-3 opacity-70 ${
                    isDark ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    {t('gps.devices.mockLocationNoConnectNeeded') || '💡 This device is currently providing location data via Mock Location. No connection needed.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Saved Devices List */}
          <div className="space-y-3">
            <h3 className={`text-sm font-semibold uppercase tracking-wider opacity-60 mb-3 ${
              isDark ? 'text-gray-300' : 'text-gray-700'
            }`}>
              {t('gps.devices.savedDevicesCount', { count: savedDevices.length }) || `Saved Devices (${savedDevices.length})`}
            </h3>
            
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader className="w-8 h-8 animate-spin text-blue-500" />
              </div>
            ) : savedDevices.length === 0 ? (
              <div className={`p-8 rounded-xl border-2 border-dashed text-center ${
                isDark ? 'border-gray-700' : 'border-gray-300'
              }`}>
                <Satellite className={`w-12 h-12 mx-auto mb-3 opacity-40 ${
                  isDark ? 'text-gray-600' : 'text-gray-400'
                }`} />
                <p className={`text-sm opacity-60 ${
                  isDark ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  {t('gps.devices.noSavedDevicesYet') || 'No saved devices yet'}
                </p>
                <p className={`text-xs opacity-40 mt-1 ${
                  isDark ? 'text-gray-500' : 'text-gray-500'
                }`}>
                  {t('gps.devices.addDeviceToStart') || 'Add a device to get started'}
                </p>
              </div>
            ) : (
              savedDevices.map((device) => {
                const isThisDeviceConnected = currentDevice?.id === device.id && isConnected;
                const isThisDeviceConnecting = connecting === device.address;
                
                return (
                  <div
                    key={device.id}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      isThisDeviceConnected
                        ? isDark ? 'border-green-500 bg-green-900/20' : 'border-green-500 bg-green-50'
                        : isDark ? 'border-gray-700 bg-gray-900/50' : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {device.connection_type === 'wifi' ? (
                            <Wifi className="w-5 h-5 text-blue-500 flex-shrink-0" />
                          ) : device.connection_type === 'usb' ? (
                            <Usb className="w-5 h-5 text-blue-500 flex-shrink-0" />
                          ) : (
                            <Bluetooth className="w-5 h-5 text-blue-500 flex-shrink-0" />
                          )}
                          <h4 className={`font-semibold text-lg truncate ${
                            isDark ? 'text-white' : 'text-gray-900'
                          }`}>{device.name}</h4>
                          {isThisDeviceConnected && (
                            <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                          )}
                        </div>
                        <p className={`text-sm truncate ${
                          isDark ? 'text-gray-400' : 'text-gray-600'
                        }`}>{device.address}</p>
                        {device.device_type && (
                          <p className={`text-xs mt-1 ${
                            isDark ? 'text-gray-500' : 'text-gray-500'
                          }`}>{device.device_type}</p>
                        )}
                      </div>

                      <div className="flex gap-2 flex-shrink-0">
                        {isThisDeviceConnected ? (
                          <button
                            onClick={handleDisconnect}
                            className="p-2 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors"
                            title={t('common.disconnect') || 'Disconnect'}
                          >
                            <Power className="w-5 h-5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleConnect(device)}
                            disabled={isConnecting}
                            className={`p-2 rounded-lg transition-colors ${
                              isThisDeviceConnecting
                                ? 'bg-blue-500 text-white cursor-wait'
                                : isDark 
                                  ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                                  : 'bg-blue-500 hover:bg-blue-600 text-white'
                            }`}
                            title={t('common.connect') || 'Connect'}
                          >
                            {isThisDeviceConnecting ? (
                              <Loader className="w-5 h-5 animate-spin" />
                            ) : (
                              <Power className="w-5 h-5" />
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => handleEditDevice(device)}
                          disabled={isConnecting}
                          className={`p-2 rounded-lg transition-colors ${
                            isDark ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'
                          }`}
                          title={t('common.edit') || 'Edit'}
                        >
                          <Edit className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => device.id && deleteDevice(device.id)}
                          disabled={isConnecting || isThisDeviceConnected || !device.id}
                          className={`p-2 rounded-lg transition-colors ${
                            isConnecting || isThisDeviceConnected
                              ? 'opacity-40 cursor-not-allowed'
                              : isDark ? 'bg-red-900/50 hover:bg-red-900' : 'bg-red-100 hover:bg-red-200'
                          }`}
                          title={t('common.delete') || 'Delete'}
                        >
                          <Trash2 className="w-5 h-5 text-red-500" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Connection Status & Live Telemetry */}
          <div className={`mt-6 p-4 rounded-xl border ${
            isConnected || mockLocationActive
              ? isDark ? 'bg-green-900/30 border-green-800' : 'bg-green-100 border-green-200'
              : isDark ? 'bg-gray-900/40 border-gray-800' : 'bg-gray-50 border-gray-200'
          }`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className={`flex items-center gap-2 ${
                isConnected || mockLocationActive
                  ? isDark ? 'text-green-400' : 'text-green-700'
                  : isDark ? 'text-gray-300' : 'text-gray-700'
              }`}>
                <CheckCircle className="w-5 h-5" />
                <span className="font-medium">
                  {mockLocationActive
                    ? t('gps.externalGnssMock') || '🛰️ External GNSS (Mock Location)'
                    : isConnected
                      ? (t('gps.devices.connectedToGps') || 'Connected to GPS device')
                      : (t('gps.notConnected') || 'Not connected')}
                </span>
              </div>
              <div className={`text-xs px-2 py-1 rounded-full ${
                isDark ? 'bg-blue-900/40 text-blue-200' : 'bg-blue-50 text-blue-700'
              }`}>
                {t('gps.connectionSource') || 'Source'}: {mockLocationActive ? (t('gps.mockLocation') || 'Mock Location') : connectionSource}
              </div>
            </div>

            {activeDevice && (
              <div className={`mt-2 text-sm ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t('gps.device') || 'Device'}:</span>
                  <span className="truncate">{activeDevice.name}</span>
                </div>
                <div className="text-xs opacity-70">{activeDevice.address}</div>
              </div>
            )}

            {activePosition ? (
              <div className={`mt-3 grid grid-cols-2 gap-3 text-sm ${
                isDark ? 'text-gray-200' : 'text-gray-800'
              }`}>
                <div>
                  <div className="text-xs opacity-70">{t('gps.devices.fixType') || 'Fix type'}</div>
                  <div className="font-semibold uppercase">{activePosition.fix_type || 'n/a'}</div>
                </div>
                <div>
                  <div className="text-xs opacity-70">{t('gps.devices.satellites') || 'Satellites'}</div>
                  <div className="font-semibold">{activePosition.satellites ?? '—'}</div>
                </div>
                <div>
                  <div className="text-xs opacity-70">{t('gps.devices.rangeEstimated') || 'Range (est.)'}</div>
                  <div className="font-semibold">{activePosition.accuracy ? `${activePosition.accuracy.toFixed(2)} m` : '—'}</div>
                </div>
                <div>
                  <div className="text-xs opacity-70">{t('gps.devices.lastUpdate') || 'Last update'}</div>
                  <div className="font-semibold">{lastUpdateSeconds !== null ? (t('gps.devices.secondsAgo', { seconds: lastUpdateSeconds }) || `${lastUpdateSeconds}s ago`) : '—'}</div>
                </div>
              </div>
            ) : (
              <div className={`mt-3 text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                {t('gps.devices.noTelemetry') || 'No live telemetry yet. Connect a device and wait for position data.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
