import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useDarkMode } from '../../hooks/useDarkMode';
import { useLanguage } from '../../hooks/useLanguage';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import Button from '../ui/Button';
import { 
  Bluetooth, 
  Wifi, 
  Cable, 
  Plus, 
  Trash2, 
  Settings, 
  Loader,
  Satellite,
  HelpCircle,
  X
} from 'lucide-react';
import { GpsDevice, DeviceScanResult } from '../../types';
import { gpsAPI } from '../../services/api';
import ReachRS3Config from './ReachRS3Config';
import { GpsDeviceManager as GpsDeviceManagerPlugin } from '../../plugins/GpsDeviceManager';
import { isCapacitorApp } from '../../utils/platform';

interface GPSDeviceManagerProps {
  onDeviceConnected?: (device: GpsDevice) => void;
  onDeviceDisconnected?: () => void;
  connectedDevice?: GpsDevice | null;
  onClose?: () => void;
}

export default function GPSDeviceManager({ onDeviceConnected, onDeviceDisconnected, connectedDevice, onClose }: GPSDeviceManagerProps) {
  const [isDark] = useDarkMode();
  const { t } = useLanguage();
  const { user, loading: authLoading } = useAuth();
  
  const [savedDevices, setSavedDevices] = useState<GpsDevice[]>([]);
  const [pairedDevices, setPairedDevices] = useState<GpsDevice[]>([]);
  const [scanResults, setScanResults] = useState<DeviceScanResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanType, setScanType] = useState<'bluetooth' | 'wifi' | 'serial'>('bluetooth');
  const [loading, setLoading] = useState(true);
  const [loadingPaired, setLoadingPaired] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [showAddManual, setShowAddManual] = useState(false);
  const [showReachConfig, setShowReachConfig] = useState<GpsDevice | null>(null);
  const backendDeviceApiEnabled = import.meta.env.VITE_ENABLE_DEVICE_BACKEND === 'true';
  
  // Manual add form
  const [manualName, setManualName] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [manualType, setManualType] = useState<'bluetooth' | 'wifi' | 'serial'>('wifi');
  const [manualDeviceType, setManualDeviceType] = useState<'reach_rs3' | 'generic_bluetooth' | 'serial' | 'network'>('reach_rs3');
  const [showHelp, setShowHelp] = useState(false);

  // Detect iPad/iOS Safari (including PWA mode)
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isPWA = window.matchMedia('(display-mode: standalone)').matches;
  const isIOSPWA = isIOS && isPWA;
  // Detect tablet screen size (8-inch tablets are typically 768-1024px wide)
  const isTablet = window.innerWidth >= 768 && window.innerWidth <= 1024;
  // Check if Web Bluetooth is actually available (works on Android tablets, Chrome on desktop, etc.)
  const supportsWebBluetooth = 'bluetooth' in navigator && typeof (navigator as any).bluetooth?.requestDevice === 'function';
  // Track available scan options so we can hide the section entirely when none apply (e.g., Android WebView without Web Bluetooth and backend disabled)
  const hasBluetoothScan = supportsWebBluetooth;
  const hasWifiScan = backendDeviceApiEnabled;
  const hasSerialScan = !isIOS && backendDeviceApiEnabled;
  const hasAnyScanOption = hasBluetoothScan || hasWifiScan || hasSerialScan;

  const STORAGE_KEY = 'gps_devices_local';

  const loadDevicesFromLocalStorage = useCallback(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        let devices = JSON.parse(stored);
        
        // Filter out Serial devices if backend is disabled (WiFi and Bluetooth work without backend)
        if (!backendDeviceApiEnabled) {
          devices = devices.filter(d => d.connection_type !== 'serial');
        }
        
        setSavedDevices(devices);
      }
    } catch (error) {
      console.error('Failed to load devices from local storage:', error);
    }
  }, [backendDeviceApiEnabled]);

  const saveDevicesToLocalStorage = useCallback((devices: GpsDevice[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(devices));
    } catch (error) {
      console.error('Failed to save devices to local storage:', error);
    }
  }, []);

  const loadSavedDevices = useCallback(async () => {
    try {
      setLoading(true);
      let devices = await gpsAPI.getDevices();
      
      // Filter out Serial devices if backend is disabled (WiFi and Bluetooth work without backend)
      if (!backendDeviceApiEnabled) {
        devices = devices.filter(d => d.connection_type !== 'serial');
      }
      
      setSavedDevices(devices);
      // Also save to local storage as backup
      saveDevicesToLocalStorage(devices);
    } catch (error: any) {
      // Handle various backend error cases gracefully
      if (error.response?.status === 401) {
        console.log('📱 Not authenticated - using local storage for devices');
        loadDevicesFromLocalStorage();
      } else if (error.code === 'NETWORK_ERROR' || error.message.includes('Network Error') || !error.response) {
        // Backend offline - silently fall back to local storage
        console.log('🔌 Backend offline - using local storage for devices');
        loadDevicesFromLocalStorage();
      } else {
        // Only log and show error for other issues
        console.error('Failed to load devices from backend:', error);
        // Don't show toast error on tablets/mobile for better UX
        if (window.innerWidth >= 1024) {
          toast.error(t('gps.devices.loadFailed') || 'Failed to load saved devices');
        }
        loadDevicesFromLocalStorage();
      }
    } finally {
      setLoading(false);
    }
  }, [backendDeviceApiEnabled, loadDevicesFromLocalStorage, saveDevicesToLocalStorage, t]);

  const loadPairedBluetoothDevices = useCallback(async () => {
    // Only available on Android Capacitor app
    if (!isCapacitorApp()) {
      console.log('⚠️ Not running on Android - auto-detect not available (web mode)');
      return;
    }
    
    try {
      setLoadingPaired(true);
      console.log('🔍 Fetching paired Bluetooth devices from Android...');
      const result = await GpsDeviceManagerPlugin.getPairedBluetoothDevices();
      
      console.log('📡 Paired devices result:', result);
      
      if (result.devices && result.devices.length > 0) {
        console.log(`✅ Found ${result.devices.length} paired Bluetooth device(s):`);
        result.devices.forEach(dev => {
          console.log(`   - ${dev.name} (${dev.address})`);
        });
        
        // Convert to GpsDevice format
        const paired: GpsDevice[] = result.devices.map(dev => ({
          id: dev.id,
          name: dev.name || 'Unknown Device',
          address: dev.address,
          connection_type: 'bluetooth',
          device_type: dev.name?.toLowerCase().includes('reach') ? 'reach_rs3' : 'generic_bluetooth',
          manufacturer: dev.name?.toLowerCase().includes('emlid') || dev.name?.toLowerCase().includes('reach') ? 'Emlid' : undefined,
          is_active: false,
          created_at: new Date().toISOString(),
          last_connected: null,
        }));
        
        setPairedDevices(paired);
      } else {
        console.log('📱 No paired Bluetooth devices found in Android settings');
        setPairedDevices([]);
      }
    } catch (error: any) {
      console.error('❌ Failed to load paired Bluetooth devices:', error);
      console.error('Error details:', error.message);
      // Silently fail - this is an optional feature
      setPairedDevices([]);
    } finally {
      setLoadingPaired(false);
    }
  }, []);

  useEffect(() => {
    // Only load devices after auth is ready and user is logged in
    if (!authLoading && user) {
      void loadSavedDevices();
    } else if (!authLoading && !user) {
      // User not logged in - use local storage only
      setLoading(false);
      loadDevicesFromLocalStorage();
    }
    
    // Load paired Bluetooth devices on Android
    void loadPairedBluetoothDevices();
  }, [authLoading, user, loadSavedDevices, loadDevicesFromLocalStorage, loadPairedBluetoothDevices]);

  const handleScan = async (type: 'bluetooth' | 'wifi' | 'serial') => {
    setScanning(true);
    setScanType(type);
    setScanResults([]);

    // Only Bluetooth is usable in frontend-only mode. WiFi/serial require backend sockets.
    if (!backendDeviceApiEnabled && type !== 'bluetooth') {
      toast.error(t('gps.devices.scanBackendDisabled') || 'Backend device scanning is disabled in Firebase-only mode');
      setScanning(false);
      return;
    }
    
    // For Bluetooth on browsers/tablets, use Web Bluetooth API
    if (type === 'bluetooth' && 'bluetooth' in navigator) {
      try {
        console.log('🔍 Starting Web Bluetooth scan...');
        console.log('📱 Platform:', navigator.userAgent);
        
        // Check if Web Bluetooth is actually supported
        if (typeof (navigator.bluetooth as any)?.requestDevice !== 'function') {
          throw new Error('Web Bluetooth API not available on this browser/device');
        }
        
        console.log('✅ Web Bluetooth API is available');
        
        // Request Bluetooth device - accept all devices to allow user to see everything
        // Reach RS3 may appear as "reach:XX:XX" or just show MAC address
        console.log('🔎 Requesting Bluetooth device...');
        const device = await (navigator.bluetooth as any).requestDevice({
          acceptAllDevices: true,
          optionalServices: [
            '00001101-0000-1000-8000-00805f9b34fb', // Serial Port Profile (SPP)
            '0000fff0-0000-1000-8000-00805f9b34fb', // NMEA service (common)
            '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip Transparent UART
            '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART Service
            '00001819-0000-1000-8000-00805f9b34fb', // Location and Navigation
            '0000180a-0000-1000-8000-00805f9b34fb', // Device Information
          ]
        });

        console.log('📡 Device selected:', device);
        console.log('📡 Device ID:', device.id);
        console.log('📡 Device Name:', device.name);

        if (device) {
          // IMPORTANT: device.id is NOT the MAC address, it's a browser-generated identifier
          // For pairing, we need to get the GATT server and connect
          // The actual MAC address is not exposed by Web Bluetooth API for privacy reasons
          const result: DeviceScanResult = {
            name: device.name || 'Bluetooth GPS Device',
            address: device.id, // This is browser ID, not MAC address
            connection_type: 'bluetooth',
            manufacturer: device.name?.toLowerCase().includes('emlid') || device.name?.toLowerCase().includes('reach') ? 'Emlid' : undefined
          };
          
          console.log('✅ Scan result:', result);
          setScanResults([result]);
          toast.success(t('gps.devices.scanComplete') || 'Device selected');
          
          // Show instructions for Reach RS3
          if (result.manufacturer === 'Emlid') {
            toast((t as any)('gps.devices.reachBluetoothTip') || 
              'Tip: Make sure Bluetooth is enabled on Reach RS3 and Position Streaming is set to Bluetooth/NMEA in Reach settings.', 
              { duration: 6000, icon: '💡' }
            );
          }
        } else {
          console.warn('⚠️ No device returned from requestDevice');
          toast.error(t('gps.devices.noDevicesFound') || 'No device selected');
        }
      } catch (error: any) {
        console.error('❌ Web Bluetooth scan failed:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        
        if (error.name === 'NotFoundError') {
          toast.error(t('gps.devices.noDevicesFound') || 'No devices found or scan cancelled');
        } else if (error.name === 'NotSupportedError') {
          toast.error(t('gps.devices.bluetoothNotSupported') || 'Web Bluetooth not supported on this device/browser. Try using Chrome on Android.');
        } else if (error.name === 'SecurityError') {
          toast.error(t('gps.devices.bluetoothPermissionDenied'));
        } else if (error.message?.includes('not available')) {
          toast.error(t('gps.devices.bluetoothApiNotAvailable'));
        } else {
          toast.error(error.message || t('gps.devices.bluetoothScanFailed'));
        }
      } finally {
        setScanning(false);
      }
      return;
    }
    
    // For desktop/server-side scanning (WiFi, Serial, or Bluetooth on desktop)
    try {
      // Backend scan disabled for standalone mode
      await new Promise(resolve => setTimeout(resolve, 800));
      setScanResults([]);
      toast(t('gps.devices.noDevicesFound') || 'No devices found (Backend scan disabled)', { icon: '🔍' });

    } catch (error: any) {
      console.error('Scan failed:', error);
      
      // Provide helpful error messages
      let message = 'Scan failed';
      if (type === 'bluetooth') {
        message = t('gps.devices.bluetoothScanTip') || 'Bluetooth scanning requires pairing devices in system settings first, or use a desktop browser with backend support.';
      } else if (type === 'serial') {
        message = t('gps.devices.serialScanTip') || 'Serial scanning is only available on desktop with backend support.';
      }
      
      toast.error(error.response?.data?.detail || message);
    } finally {
      setScanning(false);
    }
  };

  const toGpsDevice = (d: GpsDevice | DeviceScanResult): GpsDevice => ({
    id: 'id' in d ? d.id : Date.now(),
    name: d.name,
    address: d.address,
    connection_type: d.connection_type,
    device_type: 'device_type' in d
      ? (d as GpsDevice).device_type
      : d.manufacturer === 'Emlid' ? 'reach_rs3' : 'generic_bluetooth',
    manufacturer: 'manufacturer' in d ? d.manufacturer : undefined,
    model: 'model' in d ? (d as any).model : undefined,
    capabilities: 'capabilities' in d ? (d as any).capabilities : undefined,
    config: 'config' in d ? (d as any).config : undefined,
  });

  const handleConnect = async (device: GpsDevice | DeviceScanResult, isScanned: boolean = false) => {
    const address = device.address;
    setConnecting(address);

    // Frontend-only mode: allow Bluetooth and WiFi (direct to device), block Serial
    if (!backendDeviceApiEnabled && device.connection_type === 'serial') {
      toast.error(t('gps.devices.connectBackendDisabled') || 'Serial/USB connections require the backend API and are disabled in Firebase-only mode');
      setConnecting(null);
      return;
    }

    // If backend is disabled, handle Bluetooth and WiFi directly (no backend API needed)
    if (!backendDeviceApiEnabled && (device.connection_type === 'bluetooth' || device.connection_type === 'wifi')) {
      const gpsDevice = toGpsDevice(device);
      await saveScannedDevice(gpsDevice); // persist locally/Firestore
      onDeviceConnected?.(gpsDevice);
      toast.success(t('gps.devices.connected') || 'Device connected successfully');
      setConnecting(null);
      return;
    }
    
    try {
      // const response = await api.post('/api/gps-devices/devices/connect', payload);
      
      // Mock connection for standalone mode
      await new Promise(resolve => setTimeout(resolve, 1000));
      const response = { data: { status: 'ok', device: { ...device, id: 'mock_id_' + Date.now() } } };
      
      if (response.data.status === 'ok') {
        toast.success(t('gps.devices.connected') || 'Device connected successfully');
        const normalized = toGpsDevice(device as any);
        // If this is a scanned device, save it
        if (isScanned) {
          await saveScannedDevice(device as DeviceScanResult);
        }
        
        // Notify parent component
        onDeviceConnected?.(normalized);
      } else {
        toast.error(response.data.message || 'Connection failed');
      }
    } catch (error: any) {
      console.error('Connection failed:', error);
      const message = error.response?.data?.detail || error.message || 'Failed to connect';
      toast.error(message);
    } finally {
      setConnecting(null);
    }
  };

  const saveScannedDevice = async (device: DeviceScanResult | GpsDevice) => {
    try {
      const newDevice: GpsDevice = 'device_type' in device
        ? device as GpsDevice
        : {
            id: Date.now(),
            name: device.name,
            address: device.address,
            connection_type: device.connection_type,
            device_type: (device as any).manufacturer === 'Emlid' ? 'reach_rs3' : 'generic_bluetooth',
            manufacturer: (device as any).manufacturer,
          };

      if (user) {
        await gpsAPI.saveDevice(newDevice);
        await loadSavedDevices();
      } else {
        // Save to local storage if not authenticated
        const updated = [...savedDevices, newDevice];
        setSavedDevices(updated);
        saveDevicesToLocalStorage(updated);
      }
    } catch (error) {
      console.error('Failed to save device:', error);
      // Fallback to local storage
      const normalized = toGpsDevice(device as any);
      const updated = [...savedDevices, normalized];
      setSavedDevices(updated);
      saveDevicesToLocalStorage(updated);
    }
  };

  const handleAddManual = async () => {
    if (!manualName.trim() || !manualAddress.trim()) {
      toast.error(t('gps.devices.nameAddressRequired') || 'Name and address are required');
      return;
    }

    try {
      const newDevice: GpsDevice = {
        id: Date.now(),
        name: manualName,
        address: manualAddress,
        connection_type: manualType,
        device_type: manualDeviceType,
      };

      if (user) {
        const { id, ...deviceToSave } = newDevice;
        await gpsAPI.saveDevice(deviceToSave);
        await loadSavedDevices();
      } else {
        // Save to local storage if not authenticated
        const updated = [...savedDevices, newDevice];
        setSavedDevices(updated);
        saveDevicesToLocalStorage(updated);
      }
      
      toast.success(t('gps.devices.saved') || 'Device saved successfully');
      setShowAddManual(false);
      setManualName('');
      setManualAddress('');
    } catch (error) {
      console.error('Failed to save device to backend:', error);
      // Fallback to local storage
      const newDevice: GpsDevice = {
        id: Date.now(),
        name: manualName,
        address: manualAddress,
        connection_type: manualType,
        device_type: manualDeviceType,
      };
      const updated = [...savedDevices, newDevice];
      setSavedDevices(updated);
      saveDevicesToLocalStorage(updated);
      toast.success(t('gps.devices.saved') || 'Device saved locally');
      setShowAddManual(false);
      setManualName('');
      setManualAddress('');
    }
  };

  const handleDeleteDevice = async (deviceId: number | string) => {
    try {
      if (user) {
        await gpsAPI.deleteDevice(deviceId);
        await loadSavedDevices();
      } else {
        // Delete from local storage if not authenticated
        const updated = savedDevices.filter(d => d.id !== deviceId);
        setSavedDevices(updated);
        saveDevicesToLocalStorage(updated);
      }
      toast.success(t('gps.devices.deleted') || 'Device deleted');
    } catch (error) {
      console.error('Failed to delete device from backend:', error);
      // Fallback to local storage
      const updated = savedDevices.filter(d => d.id !== deviceId);
      setSavedDevices(updated);
      saveDevicesToLocalStorage(updated);
      toast.success(t('gps.devices.deleted') || 'Device deleted locally');
    }
  };

  const getDeviceIcon = (type: string) => {
    switch (type) {
      case 'bluetooth':
        return <Bluetooth className="w-5 h-5" />;
      case 'wifi':
      case 'network':
        return <Wifi className="w-5 h-5" />;
      case 'serial':
        return <Cable className="w-5 h-5" />;
      default:
        return <Satellite className="w-5 h-5" />;
    }
  };



  return (
    <>
      {/* Sticky Header with Close Button */}
      <div className={`sticky top-0 z-10 backdrop-blur-md border-b border-gray-200/20 dark:border-gray-700/20 ${isDark ? 'bg-gray-900/80' : 'bg-white/80'} rounded-t-2xl`}>
        <div className={`flex flex-col ${isTablet ? 'md:flex-row' : 'sm:flex-row'} items-start ${isTablet ? 'md:items-center' : 'sm:items-center'} justify-between gap-2 ${isTablet ? 'p-3 md:px-4' : 'p-3 sm:px-3'}`}>
          <div className="flex-1 min-w-0">
            <h2 className={`${isTablet ? 'text-base md:text-lg' : 'text-base sm:text-lg'} font-bold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {t('gps.devices.title') || 'GPS Devices'}
            </h2>
            <p className={`${isTablet ? 'text-[10px] md:text-xs' : 'text-[10px] sm:text-xs'} mt-0.5 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              {t('gps.devices.subtitle') || 'Connect to external GPS devices for high-precision tracking'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button 
              onClick={() => setShowHelp(true)} 
              variant="secondary" 
              size="sm"
              className={`${isTablet ? 'px-2 py-1.5 min-h-[32px]' : 'px-2 py-1.5'} shadow-sm`}
              title={t('common.help') || 'Help'}
            >
              <HelpCircle className="w-4 h-4" />
            </Button>
            {onClose && (
              <Button 
                onClick={onClose} 
                variant="secondary" 
                size="sm"
                className={`w-full ${isTablet ? 'md:w-auto md:px-3 md:py-1.5' : 'sm:w-auto'} ${isTablet ? 'text-xs min-h-[32px]' : 'text-xs'} shadow-sm`}
              >
                {t('common.close') || 'Close'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content Container */}
      <div className={`${isTablet ? 'px-2 pb-3' : 'px-2 pb-4'}`}>

        {/* Quick Add Device Button */}
        <div className={`${isTablet ? 'mb-3 mt-3 mx-2 md:mx-3' : 'mb-4 mt-6 mx-3 sm:mx-4'}`}>
          <Button
            size="lg"
            onClick={() => {
              if (isIOS) {
                setManualType('wifi');
              } else if (isTablet && supportsWebBluetooth) {
                setManualType('bluetooth');
              }
              setShowAddManual(true);
            }}
            variant="secondary"
            className={`flex items-center justify-center gap-2 w-full ${isTablet ? 'py-3 text-base' : 'py-3 text-base'}`}
          >
            <Plus className="w-5 h-5" />
            {t('gps.devices.addManualDevice') || 'Add Device Manually'}
          </Button>
        </div>

        {/* Scan Controls - hidden entirely if no scan option is available (e.g., tablet WebView without Web Bluetooth and backend disabled) */}
        {hasAnyScanOption && (
          <div className={`rounded-2xl bg-white/50 dark:bg-gray-900/50 backdrop-blur-md border border-gray-200/30 dark:border-gray-700/30 shadow-lg ${isTablet ? 'mb-3 mx-2 md:mx-3' : 'mb-6 mx-3 sm:mx-4'}`} style={{
          WebkitBackdropFilter: 'blur(12px)',
          backdropFilter: 'blur(12px)',
          WebkitTransform: 'translateZ(0)',
          transform: 'translateZ(0)'
        }}>
        <div className={`${isTablet ? 'p-3 md:p-4' : 'p-3 sm:p-4'}`}>
          <h3 className={`${isTablet ? 'text-base md:text-lg mb-3' : 'text-base mb-3'} font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {t('gps.devices.scanForDevices') || 'Or Scan for Devices'}
          </h3>
        
          <div className={`grid ${isTablet ? 'grid-cols-1 gap-3 mb-4' : `grid-cols-1 ${isIOS ? 'sm:grid-cols-2' : 'sm:grid-cols-3'} gap-2 sm:gap-2 mb-3`}`}>
          {/* Bluetooth button - Primary option for tablets */}
          {hasBluetoothScan && (
            <Button
              onClick={() => handleScan('bluetooth')}
              disabled={scanning}
              size={isTablet ? 'lg' : 'sm'}
              className={`flex items-center justify-center gap-2 w-full ${isTablet ? 'py-4 px-4 text-base font-semibold bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800' : 'text-xs'}`}
            >
              {scanning && scanType === 'bluetooth' ? (
                <Loader className={`${isTablet ? 'w-5 h-5' : 'w-4 h-4'} animate-spin`} />
              ) : (
                <Bluetooth className={isTablet ? 'w-5 h-5' : 'w-4 h-4'} />
              )}
              {t('gps.devices.scanBluetooth') || 'Scan Bluetooth'}
            </Button>
          )}
          
          {hasWifiScan && (
            <Button
              onClick={() => handleScan('wifi')}
              disabled={scanning}
              size="sm"
              variant="secondary"
              className={`flex items-center justify-center gap-1 w-full ${isTablet ? 'py-2.5 px-3 text-sm' : 'text-xs'}`}
            >
              {scanning && scanType === 'wifi' ? (
                <Loader className="w-4 h-4 animate-spin" />
              ) : (
                <Wifi className="w-4 h-4" />
              )}
              {t('gps.devices.scanWifi') || 'Scan WiFi'}
            </Button>
          )}
          
          {hasSerialScan && (
            <Button
              onClick={() => handleScan('serial')}
              disabled={scanning}
              size="sm"
              variant="secondary"
              className={`flex items-center justify-center gap-1 w-full ${isTablet ? 'py-2.5 px-3 text-sm' : 'text-xs'}`}
            >
              {scanning && scanType === 'serial' ? (
                <Loader className="w-4 h-4 animate-spin" />
              ) : (
                <Cable className="w-4 h-4" />
              )}
              {t('gps.devices.scanSerial') || 'Scan Serial'}
            </Button>
          )}
        </div>

          {/* Scan Results */}
          {scanResults.length > 0 && (
            <div className={`${isTablet ? 'space-y-2 mt-4' : 'space-y-2 mt-3'}`}>
              <h4 className={`font-medium ${isTablet ? 'text-sm ml-2' : 'text-sm ml-1'} ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('gps.devices.foundDevices') || 'Found Devices'}:
              </h4>
              {scanResults.map((device, idx) => (
                <div
                  key={idx}
                  className={`flex flex-col ${isTablet ? 'md:flex-row' : 'sm:flex-row'} items-start ${isTablet ? 'md:items-center' : 'sm:items-center'} gap-2 ${isTablet ? 'p-3 md:p-4' : 'p-2 sm:p-3'} rounded-xl bg-white/30 dark:bg-gray-800/30 backdrop-blur-sm border border-gray-200/20 dark:border-gray-600/20`}
                  style={{
                    WebkitBackdropFilter: 'blur(8px)',
                    backdropFilter: 'blur(8px)'
                  }}
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className={`${isDark ? 'text-gray-300' : 'text-gray-600'} ${isTablet ? 'text-lg' : ''}`}>
                      {getDeviceIcon(device.connection_type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`font-medium truncate ${isTablet ? 'text-sm' : ''} ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {device.name}
                      </div>
                      <div className={`${isTablet ? 'text-[10px]' : 'text-xs'} mt-0.5 truncate ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                        {device.address}
                        {device.manufacturer && ` • ${device.manufacturer}`}
                        {device.rssi && ` • Signal: ${device.rssi} dBm`}
                      </div>
                    </div>
                  </div>
                <Button
                  size="sm"
                  onClick={() => handleConnect(device, true)}
                  disabled={connecting === device.address}
                  className={`w-full ${isTablet ? 'md:w-auto md:min-w-[90px] md:px-3 py-2 text-xs min-h-[32px]' : 'sm:w-auto min-w-[100px]'}`}
                >
                  {connecting === device.address ? (
                    <Loader className="w-4 h-4 animate-spin" />
                  ) : (
                    t('gps.devices.connect') || 'Connect'
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
        )}

        {/* Auto-Detected Devices (Paired Bluetooth) */}
        {pairedDevices.length > 0 && (
          <div className={`rounded-2xl bg-white/50 dark:bg-gray-900/50 backdrop-blur-md border border-blue-300/40 dark:border-blue-700/40 shadow-lg ${isTablet ? 'mt-3 mx-2 md:mx-3' : 'mt-6 mx-3 sm:mx-4'}`} style={{
            WebkitBackdropFilter: 'blur(12px)',
            backdropFilter: 'blur(12px)',
            WebkitTransform: 'translateZ(0)',
            transform: 'translateZ(0)'
          }}>
            <div className={`${isTablet ? 'p-3 md:p-3' : 'p-3 sm:p-4'}`}>
              <div className={`flex flex-col ${isTablet ? 'md:flex-row' : 'sm:flex-row'} items-start ${isTablet ? 'md:items-center' : 'sm:items-center'} justify-between gap-2 ${isTablet ? 'mb-2' : 'mb-3'}`}>
                <h3 className={`${isTablet ? 'text-sm md:text-base' : 'text-base'} font-semibold ${isDark ? 'text-white' : 'text-gray-900'} flex items-center gap-2`}>
                  <Bluetooth className="w-4 h-4 text-blue-500" />
                  {t('gps.devices.autoDetectedDevices') || 'Auto-Detected Devices'}
                  <span className={`text-xs font-normal ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
                    ({pairedDevices.length})
                  </span>
                </h3>
              </div>

              {loadingPaired ? (
                <div className={`flex items-center justify-center py-4 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  <Loader className="w-5 h-5 animate-spin" />
                </div>
              ) : (
                <>
                  <div className={`mb-3 p-2 rounded-lg text-xs ${isDark ? 'bg-blue-900/20 text-blue-300' : 'bg-blue-50 text-blue-700'} border ${isDark ? 'border-blue-700/30' : 'border-blue-200'}`}>
                    💡 {t('gps.devices.pairedDevicesInfo') || 'These devices are connected via Bluetooth settings. Tap Connect to use them.'}
                  </div>
                  
                  <div className={`space-y-${isTablet ? '2' : '2'}`}>
                    {pairedDevices.map((device) => (
                      <div
                        key={device.id}
                        className={`flex flex-col ${isTablet ? 'md:flex-row' : 'sm:flex-row'} items-start ${isTablet ? 'md:items-center' : 'sm:items-center'} gap-3 ${isTablet ? 'p-3 md:p-3' : 'p-2 sm:p-3'} rounded-xl backdrop-blur-sm bg-blue-50/50 dark:bg-blue-900/20 border border-blue-200/40 dark:border-blue-700/40 hover:shadow-md transition-shadow`}
                        style={{
                          WebkitBackdropFilter: 'blur(8px)',
                          backdropFilter: 'blur(8px)'
                        }}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0 w-full sm:w-auto">
                          <div className={`${isTablet ? 'text-xl' : ''} text-blue-500 dark:text-blue-400`}>
                            <Bluetooth className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`font-medium truncate ${isTablet ? 'text-base' : 'text-sm'} ${isDark ? 'text-white' : 'text-gray-900'}`}>
                              {device.name}
                              {device.device_type === 'reach_rs3' && (
                                <span className={`ml-2 ${isTablet ? 'text-xs' : 'text-[10px]'} px-2 py-0.5 rounded backdrop-blur-sm`} style={{ 
                                  backgroundColor: isDark ? 'rgba(6, 95, 70, 0.25)' : 'rgba(209, 250, 229, 0.95)', 
                                  color: isDark ? '#6ee7b7' : '#065f46',
                                  border: `1px solid ${isDark ? 'rgba(16, 185, 129, 0.3)' : 'rgba(6, 95, 70, 0.3)'}`
                                }}>
                                  RTK
                                </span>
                              )}
                            </div>
                            <div className={`${isTablet ? 'text-sm' : 'text-xs'} mt-1 truncate ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                              {device.address}
                              {device.manufacturer && ` • ${device.manufacturer}`}
                            </div>
                          </div>
                        </div>
                        
                        <div className={`flex items-center gap-2 w-full ${isTablet ? 'md:w-auto' : 'sm:w-auto'} justify-end`}>
                          <Button
                            size={isTablet ? 'sm' : 'sm'}
                            variant="primary"
                            onClick={() => handleConnect(device)}
                            disabled={connecting === device.address}
                            className={`flex-1 ${isTablet ? 'md:flex-initial md:min-w-[100px] md:px-4 text-sm py-2.5 font-medium' : 'sm:flex-initial min-w-[90px] text-xs'}`}
                          >
                            {connecting === device.address ? (
                              <Loader className={isTablet ? 'w-5 h-5 animate-spin' : 'w-4 h-4 animate-spin'} />
                            ) : (
                              t('gps.devices.connect') || 'Connect'
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Saved Devices */}
        <div className={`rounded-2xl bg-white/50 dark:bg-gray-900/50 backdrop-blur-md border border-gray-200/30 dark:border-gray-700/30 shadow-lg ${isTablet ? 'mt-3 mx-2 md:mx-3' : 'mt-6 mx-3 sm:mx-4'}`} style={{
        WebkitBackdropFilter: 'blur(12px)',
        backdropFilter: 'blur(12px)',
        WebkitTransform: 'translateZ(0)',
        transform: 'translateZ(0)'
      }}>
        <div className={`${isTablet ? 'p-3 md:p-3' : 'p-3 sm:p-4'}`}>
        <div className={`flex flex-col ${isTablet ? 'md:flex-row' : 'sm:flex-row'} items-start ${isTablet ? 'md:items-center' : 'sm:items-center'} justify-between gap-2 ${isTablet ? 'mb-2' : 'mb-3'}`}>
          <h3 className={`${isTablet ? 'text-sm md:text-base' : 'text-base'} font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {t('gps.devices.savedDevices') || 'Saved Devices'}
          </h3>
        </div>

        {loading ? (
          <div className={`flex items-center justify-center py-8 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            <Loader className="w-6 h-6 animate-spin" />
          </div>
        ) : savedDevices.length === 0 ? (
          <div className={`text-center py-8 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            {t('gps.devices.noSavedDevices') || 'No saved devices. Scan or add manually.'}
          </div>
        ) : (
          <div className={`space-y-${isTablet ? '3' : '3'}`}>
            {savedDevices.map((device) => (
              <div
                key={device.id}
                className={`flex flex-col ${isTablet ? 'md:flex-row' : 'sm:flex-row'} items-start ${isTablet ? 'md:items-center' : 'sm:items-center'} gap-3 ${isTablet ? 'p-4 md:p-4' : 'p-2 sm:p-3'} rounded-xl backdrop-blur-sm ${
                  connectedDevice?.id === device.id 
                    ? 'bg-green-100/50 dark:bg-green-900/30 border-2 border-green-400/60 dark:border-green-600/60' 
                    : 'bg-white/30 dark:bg-gray-800/30 border border-gray-200/20 dark:border-gray-600/20'
                } hover:shadow-md transition-shadow`}
                style={{
                  WebkitBackdropFilter: 'blur(8px)',
                  backdropFilter: 'blur(8px)'
                }}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0 w-full sm:w-auto">
                  <div className={`${isTablet ? 'text-xl' : ''} ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                    {getDeviceIcon(device.connection_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium truncate ${isTablet ? 'text-base' : 'text-sm'} ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {device.name}
                      {connectedDevice?.id === device.id && (
                        <span className={`ml-2 ${isTablet ? 'text-sm' : 'text-xs'} font-normal ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                          ● {t('gps.devices.connected') || 'Connected'}
                        </span>
                      )}
                      {device.device_type === 'reach_rs3' && (
                        <span className={`ml-2 ${isTablet ? 'text-xs' : 'text-[10px]'} px-2 py-0.5 rounded backdrop-blur-sm`} style={{ 
                          backgroundColor: isDark ? 'rgba(6, 95, 70, 0.25)' : 'rgba(209, 250, 229, 0.95)', 
                          color: isDark ? '#6ee7b7' : '#065f46',
                          border: `1px solid ${isDark ? 'rgba(16, 185, 129, 0.3)' : 'rgba(6, 95, 70, 0.3)'}`
                        }}>
                          RTK
                        </span>
                      )}
                    </div>
                    <div className={`${isTablet ? 'text-sm' : 'text-xs'} mt-1 truncate ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                      {device.address}
                      {device.manufacturer && ` • ${device.manufacturer}`}
                      {device.last_connected && (
                        <span className="ml-2 hidden sm:inline">
                          {new Date(device.last_connected).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className={`flex items-center gap-2 w-full ${isTablet ? 'md:w-auto' : 'sm:w-auto'} justify-end`}>
                  {device.device_type === 'reach_rs3' && (
                    <Button
                      size={isTablet ? 'sm' : 'sm'}
                      variant="secondary"
                      onClick={() => setShowReachConfig(device)}
                      className={`flex items-center justify-center gap-1 flex-shrink-0 ${isTablet ? 'px-3 py-2.5 text-sm' : 'px-2 py-1'}`}
                      title={t('gps.devices.configure') || 'Configure'}
                    >
                      <Settings className={isTablet ? 'w-4 h-4' : 'w-4 h-4'} />
                      {isTablet && <span className="hidden md:inline">{t('gps.devices.configure')}</span>}
                    </Button>
                  )}
                  <Button
                    size={isTablet ? 'sm' : 'sm'}
                    variant={connectedDevice?.id === device.id ? 'danger' : 'primary'}
                    onClick={() => {
                      if (connectedDevice?.id === device.id) {
                        onDeviceDisconnected?.();
                      } else {
                        handleConnect(device);
                      }
                    }}
                    disabled={connecting === device.address}
                    className={`flex-1 ${isTablet ? 'md:flex-initial md:min-w-[100px] md:px-4 text-sm py-2.5 font-medium' : 'sm:flex-initial min-w-[70px] text-xs'}`}
                  >
                    {connecting === device.address ? (
                      <Loader className={isTablet ? 'w-5 h-5 animate-spin' : 'w-4 h-4 animate-spin'} />
                    ) : connectedDevice?.id === device.id ? (
                      t('gps.devices.disconnect') || 'Disconnect'
                    ) : (
                      t('gps.devices.connect') || 'Connect'
                    )}
                  </Button>
                  <Button
                    size={isTablet ? 'sm' : 'sm'}
                    variant="secondary"
                    onClick={() => device.id && handleDeleteDevice(device.id)}
                    className={`flex items-center justify-center flex-shrink-0 ${isTablet ? 'px-3 py-2.5 text-sm' : 'px-2 py-1'}`}
                    title={t('common.delete') || 'Delete'}
                  >
                    <Trash2 className={isTablet ? 'w-4 h-4' : 'w-4 h-4'} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>

        {/* Manual Add Modal */}
        {showAddManual && createPortal(
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm overflow-y-auto">
          <div className="max-w-md w-full my-8 rounded-2xl bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border border-gray-200/30 dark:border-gray-700/30 shadow-2xl" style={{
            WebkitBackdropFilter: 'blur(16px)',
            backdropFilter: 'blur(16px)',
            WebkitTransform: 'translateZ(0)',
            transform: 'translateZ(0)'
          }}>
            <div className="p-4 sm:p-6">
              <h3 className={`text-lg font-semibold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {t('gps.devices.addManualDevice') || 'Add Device Manually'}
              </h3>
              
              {/* iPad/iOS Specific Note */}
              {isIOS && (
                <div className="mb-4 p-3 rounded-lg text-xs backdrop-blur-sm" style={{ 
                  backgroundColor: isDark ? 'rgba(30, 58, 138, 0.3)' : 'rgba(219, 234, 254, 0.95)', 
                  color: isDark ? '#bfdbfe' : '#1e40af',
                  border: `1px solid ${isDark ? 'rgba(59, 130, 246, 0.3)' : 'rgba(37, 99, 235, 0.3)'}`
                }}>
                  <strong>💡 {t('gps.devices.iosQuickNoteTitle')}</strong> {t('gps.devices.iosPwaNote')}
                </div>
              )}
              
              <div className="space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('gps.devices.deviceName') || 'Device Name'}
                </label>
                <input
                  type="text"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  style={{
                    backgroundColor: isDark ? 'rgba(55, 65, 81, 0.8)' : '#fff',
                    color: isDark ? '#fff' : '#111827',
                    border: `1px solid ${isDark ? 'rgba(75, 85, 99, 0.5)' : '#d1d5db'}`
                  }}
                  placeholder={t('gps.devices.deviceNamePlaceholder') || 'My Reach RS3'}
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('gps.devices.deviceType') || 'Device Type'}
                </label>
                <select
                  value={manualDeviceType}
                  onChange={(e) => setManualDeviceType(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  style={{
                    backgroundColor: isDark ? 'rgba(55, 65, 81, 0.8)' : '#fff',
                    color: isDark ? '#fff' : '#111827',
                    border: `1px solid ${isDark ? 'rgba(75, 85, 99, 0.5)' : '#d1d5db'}`
                  }}
                >
                  <option value="reach_rs3">{t('gps.devices.optionReachRs3')}</option>
                  <option value="generic_bluetooth">{t('gps.devices.optionGenericBluetooth')}</option>
                  <option value="serial">{t('gps.devices.optionSerialGps')}</option>
                  <option value="network">{t('gps.devices.optionNetworkGps')}</option>
                </select>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('gps.devices.connectionType') || 'Connection Type'}
                </label>
                <select
                  value={manualType}
                  onChange={(e) => setManualType(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  style={{
                    backgroundColor: isDark ? 'rgba(55, 65, 81, 0.8)' : '#fff',
                    color: isDark ? '#fff' : '#111827',
                    border: `1px solid ${isDark ? 'rgba(75, 85, 99, 0.5)' : '#d1d5db'}`
                  }}
                >
                  <option value="wifi">{t('common.wifiNetwork') || 'WiFi/Network'}</option>
                  <option value="bluetooth">{t('common.bluetooth') || 'Bluetooth'}</option>
                  <option value="serial">{t('common.serialUsb') || 'Serial/USB'}</option>
                </select>
                {isIOS && manualType === 'wifi' && (
                  <p className="text-xs mt-2 p-2 rounded" style={{ 
                    backgroundColor: isDark ? 'rgba(6, 95, 70, 0.25)' : 'rgba(209, 250, 229, 0.95)', 
                    color: isDark ? '#6ee7b7' : '#065f46',
                    border: `1px solid ${isDark ? 'rgba(16, 185, 129, 0.3)' : 'rgba(6, 95, 70, 0.3)'}`
                  }}>
                    ✓ iOS/Safari compatible! WiFi GPS will use HTTP polling for reliable data streaming on your device.
                  </p>
                )}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('gps.devices.address') || 'Address'}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualAddress}
                    onChange={(e) => setManualAddress(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    style={{
                      backgroundColor: isDark ? 'rgba(55, 65, 81, 0.8)' : '#fff',
                      color: isDark ? '#fff' : '#111827',
                      border: `1px solid ${isDark ? 'rgba(75, 85, 99, 0.5)' : '#d1d5db'}`
                    }}
                    placeholder={manualType === 'wifi' ? '192.168.42.1' : manualType === 'bluetooth' ? 'AA:BB:CC:DD:EE:FF' : 'COM3'}
                  />
                  {manualType === 'bluetooth' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        // Check if Web Bluetooth API is available
                        if ('bluetooth' in navigator && typeof (navigator as any).bluetooth?.requestDevice === 'function') {
                          try {
                            const device = await (navigator.bluetooth as any).requestDevice({
                              acceptAllDevices: true,
                              optionalServices: [
                                '00001101-0000-1000-8000-00805f9b34fb', // Serial Port Profile (SPP)
                                '0000fff0-0000-1000-8000-00805f9b34fb', // NMEA service (common)
                                '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip Transparent UART
                                '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART Service
                                '00001819-0000-1000-8000-00805f9b34fb', // Location and Navigation
                                '0000180a-0000-1000-8000-00805f9b34fb', // Device Information
                              ]
                            });
                            if (device && device.id) {
                              setManualAddress(device.id);
                              if (device.name && !manualName) {
                                setManualName(device.name);
                              }
                              toast.success(t('gps.devices.deviceSelected') || 'Device selected');
                            }
                          } catch (error: any) {
                            if (error.name !== 'NotFoundError') {
                              console.error('Bluetooth selection failed:', error);
                              toast.error(t('gps.devices.bluetoothSelectFailed') || 'Failed to select Bluetooth device');
                            }
                          }
                        } else {
                          // Fallback for platforms without Web Bluetooth API
                          toast.error(
                            isIOS 
                              ? t('gps.devices.webBluetoothIosUnsupported')
                              : t('gps.devices.webBluetoothUnsupported'),
                            { duration: 6000 }
                          );
                        }
                      }}
                      className="flex items-center gap-1 whitespace-nowrap"
                      title={t('gps.devices.selectBluetoothDevice') || 'Select from connected devices'}
                    >
                      <Bluetooth className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <p className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {manualType === 'wifi' && 'Enter IP address (e.g., 192.168.42.1 for Reach hotspot)'}
                  {manualType === 'bluetooth' && 'Enter Bluetooth MAC address or click the button to select from connected devices'}
                  {manualType === 'serial' && 'Enter serial port (e.g., COM3, /dev/ttyUSB0)'}
                </p>
              </div>
            </div>

              <div className="flex flex-col sm:flex-row gap-2 mt-6">
                <Button onClick={handleAddManual} className="flex-1 w-full">
                  {t('common.save') || 'Save'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowAddManual(false);
                    setManualName('');
                    setManualAddress('');
                  }}
                  className="flex-1 w-full"
                >
                  {t('common.cancel') || 'Cancel'}
                </Button>
              </div>
            </div>
          </div>
        </div>, document.body
      )}

        {/* Reach RS3 Config Modal */}
        {showReachConfig && (
        <div 
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm overflow-y-auto"
          onClick={() => setShowReachConfig(null)}
        >
          <div 
            className="w-full max-w-4xl my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div 
              className="overflow-y-auto max-h-[85vh] rounded-2xl bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border border-gray-200/30 dark:border-gray-700/30 shadow-2xl" 
              style={{
                WebkitBackdropFilter: 'blur(16px)',
                backdropFilter: 'blur(16px)',
                WebkitTransform: 'translateZ(0)',
                transform: 'translateZ(0)'
              }}
            >
              <div className="p-6">
                <ReachRS3Config
                  device={showReachConfig}
                  onSave={async (config: Record<string, any>) => {
                    // Persist config through hybridDB/Firestore when possible
                    try {
                      const updatedDevice: GpsDevice = { ...showReachConfig, config } as GpsDevice;
                      await gpsAPI.saveDevice(updatedDevice);
                      await loadSavedDevices();

                      // Update local state immediately
                      const updated = savedDevices.map(d => 
                        d.id === showReachConfig.id ? { ...d, config } : d
                      );
                      setSavedDevices(updated);
                      saveDevicesToLocalStorage(updated);

                      toast.success(t('gps.devices.configSaved') || 'Configuration saved');
                      setShowReachConfig(null);
                    } catch (error) {
                      console.error('Failed to save config:', error);
                      toast.error(t('common.failedToSaveConfig'));
                    }
                  }}
                  onCancel={() => setShowReachConfig(null)}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Help Modal */}
      {showHelp && createPortal(
        <div 
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-3 z-[10000] backdrop-blur-sm overflow-y-auto"
          onClick={() => setShowHelp(false)}
        >
          <div 
            className={`w-full ${isTablet ? 'max-w-2xl' : 'max-w-3xl'} my-8 rounded-2xl backdrop-blur-xl border shadow-2xl ${isDark ? 'bg-gray-900/95 border-gray-700/30' : 'bg-white/95 border-gray-200/30'}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              WebkitBackdropFilter: 'blur(16px)',
              backdropFilter: 'blur(16px)',
            }}
          >
            {/* Header */}
            <div className={`sticky top-0 z-10 flex items-center justify-between p-4 border-b backdrop-blur-md ${isDark ? 'bg-gray-900/80 border-gray-700/50' : 'bg-white/80 border-gray-200/50'}`}>
              <h2 className={`${isTablet ? 'text-lg' : 'text-xl'} font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {t('gps.devices.helpTitle') || 'GPS Devices Help'}
              </h2>
              <Button 
                onClick={() => setShowHelp(false)} 
                variant="ghost" 
                size="sm"
                className="p-2"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Content */}
            <div className={`p-4 space-y-4 ${isTablet ? 'text-xs' : 'text-sm'}`}>
              
              {/* Local Mode Info */}
              {!user && (
                <div className="p-3 rounded-lg backdrop-blur-sm" style={{ 
                  backgroundColor: isDark ? 'rgba(59, 130, 246, 0.2)' : 'rgba(219, 234, 254, 0.95)', 
                  color: isDark ? '#93c5fd' : '#1e40af',
                  border: `1px solid ${isDark ? 'rgba(59, 130, 246, 0.3)' : 'rgba(37, 99, 235, 0.3)'}`
                }}>
                  <strong>📱 {t('gps.devices.localModeTitle')}</strong> {t('gps.devices.localModeDescription')}
                </div>
              )}

              {/* iOS/iPad Specific Help */}
              {isIOS && (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg backdrop-blur-sm" style={{ 
                    backgroundColor: isDark ? 'rgba(30, 58, 138, 0.3)' : 'rgba(219, 234, 254, 0.95)', 
                    color: isDark ? '#bfdbfe' : '#1e40af', 
                    border: `2px solid ${isDark ? 'rgba(59, 130, 246, 0.5)' : 'rgba(37, 99, 235, 0.5)'}` 
                  }}>
                    <strong>📱 {t('gps.devices.iosPwaDetected') || 'iPad/iOS Mode Detected'}</strong>
                    <p className="mt-2">
                      {isIOSPWA 
                        ? (t('gps.devices.iosPwaMessage') || 'Running as installed app - Safari does not support Bluetooth scanning.') 
                        : (t('gps.devices.iosSafariMessage') || 'Safari does not support Web Bluetooth API.')
                      }
                    </p>
                  </div>

                  <div className="p-3 rounded-lg backdrop-blur-sm" style={{ 
                    backgroundColor: isDark ? 'rgba(6, 78, 59, 0.2)' : 'rgba(209, 250, 229, 0.95)', 
                    color: isDark ? '#a7f3d0' : '#065f46',
                    border: `1px solid ${isDark ? 'rgba(110, 231, 183, 0.3)' : 'rgba(6, 95, 70, 0.3)'}`
                  }}>
                    <strong>✅ {t('gps.devices.iosRecommendedTitle') || 'Recommended: Use WiFi Connection'}</strong>
                    <ol className="list-decimal pl-5 mt-2 space-y-1">
                      <li>{t('gps.devices.iosStep1') || 'Connect your iPad to your WiFi network (e.g., home/office WiFi)'}</li>
                      <li>{t('gps.devices.iosStep2') || 'Power on Reach RS3, connect to its hotspot (reach:XX:XX) from another device'}</li>
                      <li>{t('gps.devices.iosStep3') || 'Open browser → 192.168.42.1 → Settings → WiFi'}</li>
                      <li>{t('gps.devices.iosStep4') || 'Set mode to Client, enter your WiFi credentials, save & reboot'}</li>
                      <li>{t('gps.devices.iosStep5') || 'After ~30 seconds, check ReachView for the IP address (e.g., 192.168.1.X)'}</li>
                      <li>{t('gps.devices.iosStep6') || 'Click "Add Manually" → WiFi → enter the IP address'}</li>
                    </ol>
                  </div>
                </div>
              )}

              {/* Android Specific Help */}
              {!isIOS && /Android/i.test(navigator.userAgent) && (
                <div className="p-3 rounded-lg backdrop-blur-sm" style={{ 
                  backgroundColor: isDark ? 'rgba(146, 64, 14, 0.3)' : 'rgba(254, 243, 199, 0.95)', 
                  color: isDark ? '#fcd34d' : '#92400e',
                  border: `1px solid ${isDark ? 'rgba(251, 191, 36, 0.3)' : 'rgba(146, 64, 14, 0.3)'}`
                }}>
                  <strong>⚠️ {t('gps.devices.androidBrowserTitle') || 'Android Browser'}</strong>
                  <p className="mt-1">{t('gps.devices.androidBrowserMessage') || 'Web Bluetooth works best on Chrome. If scanning fails, try pairing in Settings first or use WiFi connection.'}</p>
                </div>
              )}

              {/* Connection Methods */}
              <div className="space-y-3">
                <div className="p-4 rounded-lg backdrop-blur-sm" style={{ 
                  backgroundColor: isDark ? 'rgba(30, 58, 138, 0.3)' : 'rgba(219, 234, 254, 0.95)', 
                  color: isDark ? '#93c5fd' : '#1e40af',
                  border: `1px solid ${isDark ? 'rgba(59, 130, 246, 0.3)' : 'rgba(37, 99, 235, 0.3)'}`
                }}>
                  <strong>💡 {t('gps.devices.connectExternalGPS') || 'How to Connect External GPS'}</strong>
                  <div className="mt-3 space-y-3">
                    {supportsWebBluetooth && (
                      <div>
                        <p><strong>📱 {t('device.bluetooth')}:</strong> {t('gps.devices.scanBluetooth')} {t('common.or')} {t('gps.devices.addManual')}</p>
                        <p className="text-xs opacity-80 pl-4 mt-1">
                          Make sure your GPS device has Bluetooth enabled and is in pairing mode
                        </p>
                      </div>
                    )}
                    {!supportsWebBluetooth && (
                      <div>
                        <p><strong>📱 {t('device.bluetooth')}:</strong> Pair device in system settings first, then use "{t('gps.devices.addManual')}"</p>
                      </div>
                    )}
                    <div>
                      <p><strong>📡 {t('gps.devices.wifiDirectTitle')}:</strong> {t('gps.devices.wifiDirectDescription', { action: t('gps.devices.addManual') })}</p>
                      <p className="text-xs opacity-80 pl-4 mt-1">
                        For Reach RS3: Connect to "reach:XX:XX" WiFi network, then add device with address 192.168.42.1
                      </p>
                    </div>
                    {backendDeviceApiEnabled && (
                      <div>
                        <p><strong>🔌 {t('gps.devices.usbSerialTitle')}:</strong> {t('gps.devices.scanSerial')}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Bluetooth Scanning Info */}
              {supportsWebBluetooth && (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg backdrop-blur-sm" style={{ 
                    backgroundColor: isDark ? 'rgba(30, 58, 138, 0.9)' : 'rgba(219, 234, 254, 0.95)', 
                    color: isDark ? '#93c5fd' : '#1e40af',
                    border: `1px solid ${isDark ? 'rgba(59, 130, 246, 0.3)' : 'rgba(37, 99, 235, 0.3)'}`
                  }}>
                    <strong>📱 {t('gps.devices.mobileBluetoothInfo') || 'Bluetooth Scanning'}</strong>
                    <p className="mt-1">{t('gps.devices.mobileBluetoothTip') || 'Click "Scan Bluetooth" to discover nearby GPS devices. Your Reach RS3 should appear in the list.'}</p>
                  </div>

                  {/* Troubleshooting */}
                  <div className="p-4 rounded-lg" style={{ 
                    backgroundColor: isDark ? 'rgba(55, 65, 81, 0.6)' : 'rgba(243, 244, 246, 0.95)',
                    border: `1px solid ${isDark ? 'rgba(75, 85, 99, 0.3)' : 'rgba(209, 213, 219, 0.4)'}`
                  }}>
                    <strong className={isDark ? 'text-gray-200' : 'text-gray-900'}>🔧 {t('gps.devices.troubleshooting') || 'Troubleshooting'}</strong>
                    <div className="mt-2 space-y-2">
                      <div>
                        <strong className={isDark ? 'text-gray-300' : 'text-gray-700'}>{t('gps.devices.troubleshootingReachRS3Title') || 'For Reach RS3:'}</strong>
                        <ol className={`list-decimal pl-4 space-y-1 mt-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                          <li>{t('gps.devices.troubleshootingReachRS3Step1') || 'Power on Reach RS3 (hold power ~5 sec, wait for LEDs to stabilize)'}</li>
                          <li>{t('gps.devices.troubleshootingReachRS3Step2') || 'Connect to Reach hotspot (reach:XX:XX) from another device temporarily'}</li>
                          <li>{t('gps.devices.troubleshootingReachRS3Step3') || 'Open browser → go to 192.168.42.1'}</li>
                          <li>{t('gps.devices.troubleshootingReachRS3Step4') || 'Settings → Bluetooth → Enable'}</li>
                          <li>{t('gps.devices.troubleshootingReachRS3Step5') || 'Settings → Position output → Enable (NMEA format)'}</li>
                          <li>{t('gps.devices.troubleshootingReachRS3Step8') || 'Wait ~30 seconds for Bluetooth to activate'}</li>
                        </ol>
                      </div>
                      <div>
                        <strong className={isDark ? 'text-gray-300' : 'text-gray-700'}>{t('gps.devices.troubleshootingGeneralTitle') || 'General Bluetooth devices:'}</strong>
                        <ul className={`list-disc pl-4 space-y-1 mt-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                          <li>{t('gps.devices.troubleshootingGeneralTip1') || 'Make sure device Bluetooth is ON and discoverable'}</li>
                          <li>{t('gps.devices.troubleshootingGeneralTip2') || 'Device should be within 10 meters (30 feet)'}</li>
                          <li>{t('gps.devices.troubleshootingGeneralTip3') || 'Try turning device Bluetooth off and on'}</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>, document.body
      )}
      </div>
    </>
  );
}
