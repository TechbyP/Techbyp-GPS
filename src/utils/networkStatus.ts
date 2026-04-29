/**
 * Enhanced Network Status Detection
 * Supports cellular data, WiFi, and ethernet with proper Capacitor integration
 */

import { Network } from '@capacitor/network';
import { isCapacitor } from './geolocation';

export interface NetworkStatus {
  connected: boolean;
  connectionType: 'wifi' | 'cellular' | 'ethernet' | 'unknown' | 'none';
  hasInternet: boolean;
}

// Cache for network status to avoid excessive checks
let cachedStatus: NetworkStatus | null = null;
let lastCheckTime = 0;
const CACHE_DURATION = 2000; // 2 seconds

/**
 * Get current network status with cellular data support
 * Works on both web and native (Android/iOS) platforms
 */
export async function getNetworkStatus(): Promise<NetworkStatus> {
  // Return cached status if recent
  const now = Date.now();
  if (cachedStatus && (now - lastCheckTime) < CACHE_DURATION) {
    return cachedStatus;
  }

  try {
    if (isCapacitor()) {
      // Use Capacitor Network plugin for native platforms
      const status = await Network.getStatus();
      
      const networkStatus: NetworkStatus = {
        connected: status.connected,
        connectionType: status.connectionType as any,
        hasInternet: status.connected
      };
      
      cachedStatus = networkStatus;
      lastCheckTime = now;
      
      console.log('📡 Network status (native):', networkStatus);
      return networkStatus;
    } else {
      // Web fallback - use navigator.onLine and connection API
      const connected = navigator.onLine;
      
      // Try to detect connection type on web (limited support)
      let connectionType: NetworkStatus['connectionType'] = 'unknown';
      if ((navigator as any).connection) {
        const conn = (navigator as any).connection;
        const effectiveType = conn.effectiveType || conn.type;
        
        if (effectiveType === 'wifi') connectionType = 'wifi';
        else if (effectiveType === 'cellular' || effectiveType.includes('g')) connectionType = 'cellular';
        else if (effectiveType === 'ethernet') connectionType = 'ethernet';
      }
      
      const networkStatus: NetworkStatus = {
        connected,
        connectionType: connected ? connectionType : 'none',
        hasInternet: connected
      };
      
      cachedStatus = networkStatus;
      lastCheckTime = now;
      
      // Network status updated
      return networkStatus;
    }
  } catch (error) {
    console.error('📡 Network status check failed:', error);
    
    // Fallback to basic navigator.onLine
    const fallbackStatus: NetworkStatus = {
      connected: navigator.onLine,
      connectionType: navigator.onLine ? 'unknown' : 'none',
      hasInternet: navigator.onLine
    };
    
    return fallbackStatus;
  }
}

/**
 * Simple check if device is online (WiFi or cellular)
 * This is the preferred method to replace navigator.onLine
 */
export async function isOnline(): Promise<boolean> {
  const status = await getNetworkStatus();
  return status.connected;
}

/**
 * Check if device has cellular connection specifically
 */
export async function hasCellular(): Promise<boolean> {
  const status = await getNetworkStatus();
  return status.connectionType === 'cellular';
}

/**
 * Check if device has WiFi connection specifically
 */
export async function hasWiFi(): Promise<boolean> {
  const status = await getNetworkStatus();
  return status.connectionType === 'wifi';
}

/**
 * Clear the network status cache
 * Useful when you need an immediate fresh check
 */
export function clearNetworkCache(): void {
  cachedStatus = null;
  lastCheckTime = 0;
}

/**
 * Add network status change listener
 * Returns a cleanup function to remove the listener
 */
export function addNetworkListener(callback: (status: NetworkStatus) => void): () => void {
  if (!isCapacitor()) {
    // Web fallback - use online/offline events
    const handleOnline = async () => {
      clearNetworkCache();
      const status = await getNetworkStatus();
      callback(status);
    };
    
    const handleOffline = async () => {
      clearNetworkCache();
      const status = await getNetworkStatus();
      callback(status);
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }
  
  // Native - use Capacitor Network plugin listener
  const listenerPromise = Network.addListener('networkStatusChange', async (status) => {
    clearNetworkCache();
    
    const networkStatus: NetworkStatus = {
      connected: status.connected,
      connectionType: status.connectionType as any,
      hasInternet: status.connected
    };
    
    console.log('📡 Network status changed:', networkStatus);
    callback(networkStatus);
  });
  
  return async () => {
    const listener = await listenerPromise;
    listener.remove();
  };
}
