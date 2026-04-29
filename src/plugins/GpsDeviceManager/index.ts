import { registerPlugin } from '@capacitor/core';

export interface GpsDevice {
  id: string;
  name: string;
  address: string; // MAC address, IP address, or COM port
  connectionType: 'bluetooth' | 'wifi' | 'serial';
  manufacturer?: string;
  model?: string;
  isConnected: boolean;
}

export interface GpsPosition {
  latitude: number;
  longitude: number;
  altitude?: number;
  accuracy: number;
  timestamp: number;
  heading?: number;
  speed?: number;
  hdop?: number;
  satellites?: number;
  fixType?: 'none' | 'gps' | 'dgps' | 'rtk_float' | 'rtk_fixed';
}

export interface GpsDeviceManagerPlugin {
  /**
   * Scan for available GPS devices
   */
  scanDevices(options?: {
    connectionTypes?: ('bluetooth' | 'wifi' | 'serial')[];
    timeout?: number;
  }): Promise<{ devices: GpsDevice[] }>;

  /**
   * Get paired/bonded Bluetooth devices
   * Returns devices already connected via Android Bluetooth settings
   */
  getPairedBluetoothDevices(): Promise<{ devices: GpsDevice[] }>;

  /**
   * Connect to a GPS device
   */
  connectDevice(options: {
    deviceId?: string;
    address: string;
    connectionType: 'bluetooth' | 'wifi' | 'serial';
    port?: number;
    name?: string;
  }): Promise<{ device: GpsDevice }>;

  /**
   * Disconnect from GPS device
   */
  disconnectDevice(): Promise<void>;

  /**
   * Get current GPS position
   */
  getCurrentPosition(): Promise<{ position: GpsPosition | null }>;

  /**
   * Start GPS data streaming
   */
  startPositionStream(): Promise<void>;

  /**
   * Stop GPS data streaming
   */
  stopPositionStream(): Promise<void>;

  /**
   * Get connection status
   */
  getStatus(): Promise<{
    isConnected: boolean;
    connectedDevice?: GpsDevice;
    isStreaming: boolean;
  }>;

  /**
   * Check if permissions are granted
   */
  checkPermissions(): Promise<{
    bluetooth: boolean;
    location: boolean;
    granted: boolean;
  }>;

  /**
   * Request necessary permissions for GPS device connections
   */
  requestPermissions(): Promise<{
    bluetooth: boolean;
    location: boolean;
    granted: boolean;
  }>;

  /**
   * Listen to GPS events
   */
  addListener(
    eventName: 'deviceConnected' | 'deviceDisconnected' | 'positionUpdate' | 'error' | 'deviceFound',
    listenerFunc: (data: any) => void
  ): Promise<any>;

  /**
   * Remove all listeners
   */
  removeAllListeners(): Promise<void>;
}

const GpsDeviceManager = registerPlugin<GpsDeviceManagerPlugin>('GpsDeviceManager', {
  web: () => import('./web').then(m => new m.GpsDeviceManagerWeb()),
});

export default GpsDeviceManager;
