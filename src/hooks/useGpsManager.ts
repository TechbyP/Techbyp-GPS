/**
 * Enhanced GPS Manager Hook
 * Manages multiple GPS devices with auto-reconnection and persistence
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { GpsDevice, GpsPosition } from '../types';
import { gpsDevicePersistence } from '../services/gpsDevicePersistence';
import { useAuth } from '../context/AuthContext';
import { useBluetoothGPS } from './useBluetoothGPS';
import { useTcpGPS } from './useTcpGPS';
import { useLanguage } from './useLanguage';
import toast from 'react-hot-toast';

interface DeviceConnection {
  device: GpsDevice;
  position: GpsPosition | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  reconnectAttempts: number;
  hook: any; // GPS hook instance
}

interface UseGpsManagerOptions {
  autoLoadDevices?: boolean;
  autoConnectFavorites?: boolean;
}

export function useGpsManager(options: UseGpsManagerOptions = {}) {
  const { autoLoadDevices = true, autoConnectFavorites = false } = options;
  const { user } = useAuth();
  const { t } = useLanguage();
  const [devices, setDevices] = useState<GpsDevice[]>([]);
  const [connections, setConnections] = useState<Map<string, DeviceConnection>>(new Map());
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const reconnectTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const uptimeIntervals = useRef<Map<string, NodeJS.Timeout>>(new Map());

  /**
   * Load all user devices from Firestore
   */
  const loadDevices = useCallback(async () => {
    if (!user?.uid) return;
    
    setIsLoading(true);
    try {
      const userDevices = await gpsDevicePersistence.getUserDevices(user.uid);
      setDevices(userDevices);
      
      // Auto-connect to favorites if enabled
      if (autoConnectFavorites) {
        const favorites = userDevices.filter(d => d.is_favorite);
        for (const device of favorites) {
          await connectToDevice(device);
        }
      }
    } catch (error) {
      console.error('[GPSManager] Error loading devices:', error);
      toast.error(t('common.failedToLoadGpsDevices'));
    } finally {
      setIsLoading(false);
    }
  }, [user?.uid, autoConnectFavorites]);

  /**
   * Save a new device
   */
  const saveDevice = useCallback(async (device: Partial<GpsDevice>) => {
    if (!user?.uid) return null;
    
    try {
      const deviceId = await gpsDevicePersistence.saveDevice(user.uid, device);
      await loadDevices();
      toast.success(t('common.deviceSavedSuccess', { name: device.name }));
      return deviceId;
    } catch (error) {
      console.error('[GPSManager] Error saving device:', error);
      toast.error(t('common.failedToSaveDevice'));
      return null;
    }
  }, [user?.uid, loadDevices]);

  /**
   * Update device
   */
  const updateDevice = useCallback(async (deviceId: string, updates: Partial<GpsDevice>) => {
    if (!user?.uid) return;
    
    try {
      await gpsDevicePersistence.updateDevice(user.uid, deviceId, updates);
      await loadDevices();
      toast.success(t('common.deviceUpdated'));
    } catch (error) {
      console.error('[GPSManager] Error updating device:', error);
      toast.error(t('common.failedToUpdateDevice'));
    }
  }, [user?.uid, loadDevices]);

  /**
   * Delete device
   */
  const deleteDevice = useCallback(async (deviceId: string) => {
    if (!user?.uid) return;
    
    // Disconnect first if connected
    if (connections.has(deviceId)) {
      await disconnectDevice(deviceId);
    }
    
    try {
      await gpsDevicePersistence.deleteDevice(user.uid, deviceId);
      await loadDevices();
      toast.success(t('common.deviceDeleted'));
    } catch (error) {
      console.error('[GPSManager] Error deleting device:', error);
      toast.error(t('common.failedToDeleteDevice'));
    }
  }, [user?.uid, connections, loadDevices]);

  /**
   * Connect to a GPS device
   */
  const connectToDevice = useCallback(async (device: GpsDevice) => {
    if (!user?.uid || !device.id) return;
    
    console.log('[GPSManager] Connecting to device:', device.name);
    
    // Update connection state
    setConnections(prev => {
      const newMap = new Map(prev);
      newMap.set(device.id as string, {
        device,
        position: null,
        isConnected: false,
        isConnecting: true,
        error: null,
        reconnectAttempts: 0,
        hook: null,
      });
      return newMap;
    });

    try {
      await gpsDevicePersistence.updateConnectionState(user.uid, device.id as string, 'connecting');
      
      // Create appropriate GPS hook based on connection type
      let hook: any;
      
      if (device.connection_type === 'bluetooth') {
        hook = useBluetoothGPS({
          onPosition: (position) => handleDevicePosition(device.id as string, position),
          onConnect: () => handleDeviceConnect(device.id as string),
          onDisconnect: () => handleDeviceDisconnect(device.id as string),
          onError: (error) => handleDeviceError(device.id as string, error),
        });
      } else if (device.connection_type === 'wifi' || device.connection_type === 'tcp') {
        hook = useTcpGPS({
          onPosition: (position) => handleDevicePosition(device.id as string, position),
          onConnect: () => handleDeviceConnect(device.id as string),
          onDisconnect: () => handleDeviceDisconnect(device.id as string),
          onError: (error) => handleDeviceError(device.id as string, error),
        });
      }

      // Attempt connection
      if (hook) {
        if (device.connection_type === 'bluetooth') {
          await hook.connect(device.address);
        } else {
          await hook.connect(device.address, device.config?.tcp_port || 9001);
        }
        
        // Start uptime tracking
        const interval = setInterval(() => {
          gpsDevicePersistence.incrementUptime(user.uid, device.id as string, 10);
        }, 10000); // Update every 10 seconds
        
        uptimeIntervals.current.set(device.id as string, interval);
      }
    } catch (error: any) {
      console.error('[GPSManager] Connection failed:', error);
      await handleDeviceError(device.id as string, error.message || 'Connection failed');
    }
  }, [user?.uid]);

  /**
   * Disconnect from a GPS device
   */
  const disconnectDevice = useCallback(async (deviceId: string) => {
    if (!user?.uid) return;
    
    const connection = connections.get(deviceId);
    if (!connection) return;

    console.log('[GPSManager] Disconnecting from device:', connection.device.name);
    
    // Clear reconnect timer
    const timer = reconnectTimers.current.get(deviceId);
    if (timer) {
      clearTimeout(timer);
      reconnectTimers.current.delete(deviceId);
    }
    
    // Clear uptime interval
    const interval = uptimeIntervals.current.get(deviceId);
    if (interval) {
      clearInterval(interval);
      uptimeIntervals.current.delete(deviceId);
    }

    // Disconnect hook
    if (connection.hook?.disconnect) {
      connection.hook.disconnect();
    }

    // Update state
    setConnections(prev => {
      const newMap = new Map(prev);
      newMap.delete(deviceId);
      return newMap;
    });

    await gpsDevicePersistence.updateConnectionState(user.uid, deviceId, 'disconnected');
    
    // Unset as active if it was active
    if (activeDeviceId === deviceId) {
      setActiveDeviceId(null);
    }
  }, [user?.uid, connections, activeDeviceId]);

  /**
   * Handle device position update
   */
  const handleDevicePosition = useCallback(async (deviceId: string, position: GpsPosition) => {
    if (!user?.uid) return;
    
    setConnections(prev => {
      const newMap = new Map(prev);
      const conn = newMap.get(deviceId);
      if (conn) {
        newMap.set(deviceId, { ...conn, position });
      }
      return newMap;
    });

    // Update position in Firestore (throttled)
    await gpsDevicePersistence.updateDevicePosition(user.uid, deviceId, position);
  }, [user?.uid]);

  /**
   * Handle device connected
   */
  const handleDeviceConnect = useCallback(async (deviceId: string) => {
    if (!user?.uid) return;
    
    console.log('[GPSManager] Device connected:', deviceId);
    
    setConnections(prev => {
      const newMap = new Map(prev);
      const conn = newMap.get(deviceId);
      if (conn) {
        newMap.set(deviceId, { 
          ...conn, 
          isConnected: true, 
          isConnecting: false,
          error: null,
          reconnectAttempts: 0,
        });
      }
      return newMap;
    });

    await gpsDevicePersistence.updateConnectionState(user.uid, deviceId, 'connected');
    
    // Set as active if no active device
    if (!activeDeviceId) {
      setActiveDeviceId(deviceId);
    }
    
    const device = devices.find(d => d.id === deviceId);
    if (device) {
      console.log(`[GPSManager] ${device.name} connected - notifications handled by GPSTracker`);
      // No toast here - GPSTracker handles all user notifications
    }
  }, [user?.uid, activeDeviceId, devices]);

  /**
   * Handle device disconnected
   */
  const handleDeviceDisconnect = useCallback(async (deviceId: string) => {
    if (!user?.uid) return;
    
    const connection = connections.get(deviceId);
    if (!connection) return;

    console.log('[GPSManager] Device disconnected:', connection.device.name);
    
    setConnections(prev => {
      const newMap = new Map(prev);
      const conn = newMap.get(deviceId);
      if (conn) {
        newMap.set(deviceId, { 
          ...conn, 
          isConnected: false, 
          isConnecting: false,
        });
      }
      return newMap;
    });

    await gpsDevicePersistence.updateConnectionState(user.uid, deviceId, 'disconnected');
    
    // Attempt auto-reconnect if enabled
    if (connection.device.auto_reconnect) {
      scheduleReconnect(deviceId, connection.device);
    }
    
    toast(`${connection.device.name} disconnected`, { icon: '📱' });
  }, [user?.uid, connections]);

  /**
   * Handle device error
   */
  const handleDeviceError = useCallback(async (deviceId: string, errorMessage: string) => {
    if (!user?.uid) return;
    
    const connection = connections.get(deviceId);
    if (!connection) return;

    console.error('[GPSManager] Device error:', connection.device.name, errorMessage);
    
    const newReconnectAttempts = connection.reconnectAttempts + 1;
    
    setConnections(prev => {
      const newMap = new Map(prev);
      const conn = newMap.get(deviceId);
      if (conn) {
        newMap.set(deviceId, { 
          ...conn, 
          isConnected: false,
          isConnecting: false,
          error: errorMessage,
          reconnectAttempts: newReconnectAttempts,
        });
      }
      return newMap;
    });

    await gpsDevicePersistence.updateConnectionState(user.uid, deviceId, 'error', errorMessage);
    
    // Attempt auto-reconnect if enabled and under max attempts
    const maxAttempts = connection.device.max_reconnect_attempts || 5;
    if (connection.device.auto_reconnect && newReconnectAttempts < maxAttempts) {
      scheduleReconnect(deviceId, connection.device);
    } else if (newReconnectAttempts >= maxAttempts) {
      toast.error(t('common.maxReconnectAttempts', { name: connection.device.name }));
    }
  }, [user?.uid, connections, t]);

  /**
   * Schedule auto-reconnect
   */
  const scheduleReconnect = useCallback((deviceId: string, device: GpsDevice) => {
    // Clear existing timer
    const existingTimer = reconnectTimers.current.get(deviceId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const delay = device.reconnect_delay_ms || 5000;
    console.log(`[GPSManager] Scheduling reconnect for ${device.name} in ${delay}ms`);
    
    const timer = setTimeout(() => {
      console.log(`[GPSManager] Auto-reconnecting to ${device.name}`);
      connectToDevice(device);
      reconnectTimers.current.delete(deviceId);
    }, delay);
    
    reconnectTimers.current.set(deviceId, timer);
  }, [connectToDevice]);

  /**
   * Get active device position
   */
  const getActivePosition = useCallback((): GpsPosition | null => {
    if (!activeDeviceId) return null;
    const conn = connections.get(activeDeviceId);
    return conn?.position || null;
  }, [activeDeviceId, connections]);

  /**
   * Get all connected positions (for multi-device mode)
   */
  const getAllPositions = useCallback((): Map<string, GpsPosition> => {
    const positions = new Map<string, GpsPosition>();
    connections.forEach((conn, deviceId) => {
      if (conn.position && conn.isConnected) {
        positions.set(deviceId, conn.position);
      }
    });
    return positions;
  }, [connections]);

  /**
   * Get best position (highest accuracy among connected devices)
   */
  const getBestPosition = useCallback((): GpsPosition | null => {
    let bestPosition: GpsPosition | null = null;
    let bestAccuracy = Infinity;

    connections.forEach(conn => {
      if (conn.position && conn.isConnected && conn.position.accuracy < bestAccuracy) {
        bestPosition = conn.position;
        bestAccuracy = conn.position.accuracy;
      }
    });

    return bestPosition;
  }, [connections]);

  // Load devices on mount
  useEffect(() => {
    if (autoLoadDevices && user?.uid) {
      loadDevices();
    }
  }, [autoLoadDevices, user?.uid, loadDevices]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear all timers and intervals
      reconnectTimers.current.forEach(timer => clearTimeout(timer));
      uptimeIntervals.current.forEach(interval => clearInterval(interval));
      reconnectTimers.current.clear();
      uptimeIntervals.current.clear();
    };
  }, []);

  return {
    // Device management
    devices,
    loadDevices,
    saveDevice,
    updateDevice,
    deleteDevice,
    isLoading,

    // Connection management
    connections: Array.from(connections.values()),
    connectToDevice,
    disconnectDevice,
    activeDeviceId,
    setActiveDeviceId,

    // Position access
    getActivePosition,
    getAllPositions,
    getBestPosition,

    // Utility
    isAnyDeviceConnected: connections.size > 0 && Array.from(connections.values()).some(c => c.isConnected),
    connectedCount: Array.from(connections.values()).filter(c => c.isConnected).length,
  };
}
