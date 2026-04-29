/**
 * Device Validation and Management Utilities
 * Fixes Issue #22: Device management validation and state tracking
 */

import { DEVICE_TYPES, CONNECTION_TYPES } from '../config/constants';

export interface DeviceCapabilities {
  hasGPS?: boolean;
  hasBluetooth?: boolean;
  hasWiFi?: boolean;
  hasUSB?: boolean;
  supportsRTK?: boolean; // Real-Time Kinematic positioning
  supportsNMEA?: boolean;
  maxUpdateRate?: number; // Hz
  accuracy?: string; // e.g., "sub-meter", "centimeter"
}

export interface DeviceConfig {
  baudRate?: number;
  dataBits?: number;
  stopBits?: number;
  parity?: 'none' | 'even' | 'odd';
  autoConnect?: boolean;
  reconnectInterval?: number; // ms
  timeout?: number; // ms
}

export interface DeviceConnectionState {
  connected: boolean;
  lastConnected?: string; // ISO timestamp
  lastDisconnected?: string;
  connectionAttempts?: number;
  lastError?: string;
  signalStrength?: number; // 0-100
  batteryLevel?: number; // 0-100
}

export interface GPSDevice {
  id: string;
  name: string;
  device_type: keyof typeof DEVICE_TYPES;
  connection_type: keyof typeof CONNECTION_TYPES;
  address?: string; // MAC address for Bluetooth, IP for WiFi
  manufacturer?: string;
  model?: string;
  capabilities?: DeviceCapabilities | string; // Can be JSON string
  config?: DeviceConfig | string; // Can be JSON string
  connectionState?: DeviceConnectionState;
  is_active?: boolean;
  created_at: string;
  updated_at?: string;
  last_connected?: string;
}

/**
 * Validate device object structure
 */
export function validateDevice(device: Partial<GPSDevice>): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!device.name || device.name.trim().length === 0) {
    errors.push('Device name is required');
  }

  if (!device.device_type) {
    errors.push('Device type is required');
  } else if (!Object.keys(DEVICE_TYPES).includes(device.device_type)) {
    errors.push(`Invalid device type: ${device.device_type}`);
  }

  if (!device.connection_type) {
    errors.push('Connection type is required');
  } else if (!Object.keys(CONNECTION_TYPES).includes(device.connection_type)) {
    errors.push(`Invalid connection type: ${device.connection_type}`);
  }

  // Bluetooth devices need MAC address
  if (device.connection_type === 'bluetooth' || device.connection_type === 'BLUETOOTH') {
    if (!device.address) {
      warnings.push('Bluetooth device should have MAC address');
    } else if (!isValidMACAddress(device.address)) {
      warnings.push('Invalid MAC address format');
    }
  }

  // WiFi devices need IP address
  if (device.connection_type === 'wifi' || device.connection_type === 'WIFI') {
    if (!device.address) {
      warnings.push('WiFi device should have IP address');
    } else if (!isValidIPAddress(device.address)) {
      warnings.push('Invalid IP address format');
    }
  }

  // Validate capabilities if provided
  if (device.capabilities) {
    try {
      const caps = typeof device.capabilities === 'string' 
        ? JSON.parse(device.capabilities)
        : device.capabilities;
      
      if (typeof caps !== 'object') {
        warnings.push('Capabilities should be an object');
      }
    } catch (e) {
      warnings.push('Invalid capabilities JSON');
    }
  }

  // Validate config if provided
  if (device.config) {
    try {
      const config = typeof device.config === 'string'
        ? JSON.parse(device.config)
        : device.config;
      
      if (typeof config !== 'object') {
        warnings.push('Config should be an object');
      }
    } catch (e) {
      warnings.push('Invalid config JSON');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate MAC address format
 */
function isValidMACAddress(address: string): boolean {
  // Match formats: AA:BB:CC:DD:EE:FF or AA-BB-CC-DD-EE-FF
  const macPattern = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
  return macPattern.test(address);
}

/**
 * Validate IP address format (IPv4)
 */
function isValidIPAddress(address: string): boolean {
  const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipPattern.test(address)) return false;
  
  const parts = address.split('.');
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
}

/**
 * Parse capabilities from string or object
 */
export function parseCapabilities(capabilities?: DeviceCapabilities | string): DeviceCapabilities {
  if (!capabilities) {
    return {};
  }

  if (typeof capabilities === 'string') {
    try {
      return JSON.parse(capabilities);
    } catch (e) {
      console.warn('Failed to parse capabilities:', e);
      return {};
    }
  }

  return capabilities;
}

/**
 * Parse config from string or object
 */
export function parseConfig(config?: DeviceConfig | string): DeviceConfig {
  if (!config) {
    return {};
  }

  if (typeof config === 'string') {
    try {
      return JSON.parse(config);
    } catch (e) {
      console.warn('Failed to parse config:', e);
      return {};
    }
  }

  return config;
}

/**
 * Check if device is currently connected
 */
export function isDeviceConnected(device: GPSDevice): boolean {
  return device.connectionState?.connected || false;
}

/**
 * Check if device should attempt auto-reconnect
 */
export function shouldAutoReconnect(device: GPSDevice): boolean {
  const config = parseConfig(device.config);
  return config.autoConnect !== false; // Default to true
}

/**
 * Get default config for device type
 */
export function getDefaultConfig(deviceType: keyof typeof DEVICE_TYPES): DeviceConfig {
  const defaults: DeviceConfig = {
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    autoConnect: true,
    reconnectInterval: 5000,
    timeout: 10000
  };

  // USB GPS devices often use higher baud rates
  if (deviceType === 'usb_gps' || deviceType === 'USB_GPS') {
    defaults.baudRate = 115200;
  }

  return defaults;
}

/**
 * Update device connection state
 */
export function updateConnectionState(
  device: GPSDevice,
  connected: boolean,
  error?: string
): GPSDevice {
  const now = new Date().toISOString();
  
  const connectionState: DeviceConnectionState = {
    ...device.connectionState,
    connected,
    lastError: error,
    connectionAttempts: connected 
      ? 0 
      : (device.connectionState?.connectionAttempts || 0) + 1
  };

  if (connected) {
    connectionState.lastConnected = now;
  } else {
    connectionState.lastDisconnected = now;
  }

  return {
    ...device,
    connectionState,
    last_connected: connected ? now : device.last_connected,
    updated_at: now
  };
}

/**
 * Sanitize device for storage
 */
export function sanitizeDevice(device: Partial<GPSDevice>): Partial<GPSDevice> {
  const sanitized: Partial<GPSDevice> = {
    name: device.name?.trim(),
    device_type: device.device_type,
    connection_type: device.connection_type,
    address: device.address?.trim(),
    manufacturer: device.manufacturer?.trim(),
    model: device.model?.trim(),
  };

  // Convert capabilities to string for storage
  if (device.capabilities) {
    sanitized.capabilities = typeof device.capabilities === 'string'
      ? device.capabilities
      : JSON.stringify(device.capabilities);
  }

  // Convert config to string for storage
  if (device.config) {
    sanitized.config = typeof device.config === 'string'
      ? device.config
      : JSON.stringify(device.config);
  }

  // Preserve timestamps
  if (device.created_at) sanitized.created_at = device.created_at;
  if (device.updated_at) sanitized.updated_at = device.updated_at;
  if (device.last_connected) sanitized.last_connected = device.last_connected;
  if (device.is_active !== undefined) sanitized.is_active = device.is_active;

  return sanitized;
}

/**
 * Check if device needs reconnection attempt
 */
export function needsReconnect(device: GPSDevice): boolean {
  if (isDeviceConnected(device)) return false;
  if (!shouldAutoReconnect(device)) return false;
  
  const config = parseConfig(device.config);
  const reconnectInterval = config.reconnectInterval || 5000;
  
  const lastAttempt = device.connectionState?.lastDisconnected;
  if (!lastAttempt) return true;
  
  const timeSinceLastAttempt = Date.now() - new Date(lastAttempt).getTime();
  return timeSinceLastAttempt >= reconnectInterval;
}
