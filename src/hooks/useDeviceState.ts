import { useState, useCallback, useRef, useEffect } from 'react';
import { GpsDevice, GpsPosition } from '../types';
import { useBluetoothGPS } from './useBluetoothGPS';
import { useTcpGPS } from './useTcpGPS';

interface DeviceStateOptions {
  onPositionUpdate?: (position: GpsPosition) => void;
  onConnectionStatusChange?: (isConnected: boolean, device?: GpsDevice) => void;
  onError?: (error: string) => void;
}

export function useDeviceState(options: DeviceStateOptions = {}) {
  const { onPositionUpdate, onConnectionStatusChange, onError } = options;
  const [connectedDevice, setConnectedDevice] = useState<GpsDevice | null>(null);
  const [externalGpsPosition, setExternalGpsPosition] = useState<GpsPosition | null>(null);
  const [isExternalGpsConnected, setIsExternalGpsConnected] = useState(false);
  const [lastTelemetryAt, setLastTelemetryAt] = useState<number | null>(null);
  const stalenessTimer = useRef<NodeJS.Timeout | null>(null);

  const handlePositionUpdate = useCallback((position: GpsPosition) => {
    setExternalGpsPosition(position);
    setLastTelemetryAt(position.timestamp || Date.now());
    setIsExternalGpsConnected(true);
    onPositionUpdate?.(position);
  }, [onPositionUpdate]);

  const handleConnect = useCallback((device?: GpsDevice) => {
    if (!isExternalGpsConnected) {
      setIsExternalGpsConnected(true);
      if (device) {
        setConnectedDevice(device);
      }
      onConnectionStatusChange?.(true, device);
    }
  }, [isExternalGpsConnected, onConnectionStatusChange]);

  const handleDisconnect = useCallback((device?: GpsDevice) => {
    setIsExternalGpsConnected(false);
    
    if (device && connectedDevice?.id === device.id) {
      setConnectedDevice(null);
      setExternalGpsPosition(null);
    }
    
    onConnectionStatusChange?.(false, device);
  }, [connectedDevice?.id, onConnectionStatusChange]);

  const handleError = useCallback((error: string) => {
    console.error('GPS Device Error:', error);
    setIsExternalGpsConnected(false);
    
    // Clear device connection state on critical errors
    if (error.includes('Failed to connect') || 
        error.includes('connection lost') || 
        error.includes('disconnected') ||
        error.includes('Cannot connect') ||
        error.includes('timeout')) {
      setConnectedDevice(null);
      setExternalGpsPosition(null);
    }
    
    onError?.(error);
  }, [onError]);

  // Bluetooth GPS hook
  const bluetoothGPS = useBluetoothGPS({
    onPosition: handlePositionUpdate,
    onConnect: () => handleConnect(),
    onDisconnect: () => handleDisconnect(),
    onError: handleError
  });

  // TCP/WiFi GPS hook
  const tcpGPS = useTcpGPS({
    onPosition: handlePositionUpdate,
    onConnect: () => handleConnect(),
    onDisconnect: () => handleDisconnect(),
    onError: handleError
  });

  // Guard against stale connections
  useEffect(() => {
    const lastTimestamp = externalGpsPosition?.timestamp;

    if (stalenessTimer.current) {
      clearTimeout(stalenessTimer.current);
    }

    if (!lastTimestamp) {
      setIsExternalGpsConnected(false);
      return;
    }

    const checkStaleness = () => {
      const ageMs = Date.now() - lastTimestamp;
      if (ageMs > 15000) {
        setIsExternalGpsConnected(false);
        if (ageMs > 45000) {
          setConnectedDevice(null);
          setExternalGpsPosition(null);
        }
      }
    };

    stalenessTimer.current = setTimeout(checkStaleness, 16000);

    return () => {
      if (stalenessTimer.current) {
        clearTimeout(stalenessTimer.current);
        stalenessTimer.current = null;
      }
    };
  }, [externalGpsPosition]);

  const connectDevice = useCallback(async (device: GpsDevice) => {
    try {
      if (device.connection_type === 'bluetooth') {
        await bluetoothGPS.connect(device.address, device.name);
      } else if (device.connection_type === 'wifi' || device.connection_type === 'tcp') {
        await tcpGPS.connect(device.address);
      }
      setConnectedDevice(device);
    } catch (error) {
      handleError(`Failed to connect to ${device.name}: ${error}`);
      throw error;
    }
  }, [bluetoothGPS, tcpGPS, handleError]);

  const disconnectDevice = useCallback(async () => {
    try {
      if (connectedDevice?.connection_type === 'bluetooth') {
        await bluetoothGPS.disconnect();
      } else if (connectedDevice?.connection_type === 'wifi' || connectedDevice?.connection_type === 'tcp') {
        await tcpGPS.disconnect();
      }
      setConnectedDevice(null);
      setExternalGpsPosition(null);
      setIsExternalGpsConnected(false);
    } catch (error) {
      handleError(`Failed to disconnect: ${error}`);
      throw error;
    }
  }, [connectedDevice?.connection_type, bluetoothGPS, tcpGPS, handleError]);

  const cleanup = useCallback(() => {
    if (stalenessTimer.current) {
      clearTimeout(stalenessTimer.current);
      stalenessTimer.current = null;
    }
  }, []);

  return {
    // State
    connectedDevice,
    externalGpsPosition,
    isExternalGpsConnected,
    lastTelemetryAt,
    
    // GPS Hooks (for advanced usage)
    bluetoothGPS,
    tcpGPS,
    
    // Actions
    connectDevice,
    disconnectDevice,
    cleanup
  };
}