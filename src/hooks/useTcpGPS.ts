import { useCallback } from 'react';
import { GpsPositionUpdate } from '../types';
import { useNativeGpsManager } from './useNativeGpsManager';
import { safeConnectGpsDevice, fixGpsConnection } from '../utils/gpsConnectionFix';

interface TcpGPSOptions {
  onPosition?: (position: GpsPositionUpdate) => void;
  onError?: (error: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

/**
 * Legacy TCP GPS Hook - Now wraps the new native GPS manager
 * @deprecated Use useNativeGpsManager directly for new implementations
 * This wrapper maintains compatibility with existing components
 */
export function useTcpGPS(options: TcpGPSOptions = {}) {
  // Delegate to the new native GPS manager
  const nativeGps = useNativeGpsManager(options);
  
  // Legacy connect method that maps to new connectDevice with improved error handling
  const connect = useCallback(async (address: string, port: number = 9001) => {
    console.log('🔌 TCP GPS connect request:', { address, port });
    
    try {
      // First check if connection is possible
      const connectionCheck = await fixGpsConnection();
      if (!connectionCheck.success) {
        console.warn('❌ GPS connection check failed:', connectionCheck.message);
        if (options.onError) {
          options.onError(connectionCheck.message);
        }
        return false;
      }

      // Use safe connection method
      const result = await safeConnectGpsDevice({
        address,
        connectionType: 'wifi',
        port,
        name: `GPS Device (${address}:${port})`
      });

      if (!result.success) {
        console.warn('❌ Safe GPS connection failed:', result.message);
        if (options.onError) {
          options.onError(result.message);
        }
        return false;
      }

      // Start streaming immediately so data flows after connect
      try {
        const started = await nativeGps.startPositionStream();
        if (!started) {
          console.warn('⚠️ Failed to start GPS streaming after TCP connect');
          options.onError?.('Connected but could not start GPS data stream.');
          return false;
        }
      } catch (streamError) {
        const streamMessage = streamError instanceof Error ? streamError.message : String(streamError);
        console.error('❌ Error starting GPS stream:', streamMessage);
        options.onError?.(`Connected but could not start GPS stream: ${streamMessage}`);
        return false;
      }

      console.log('✅ TCP GPS connection successful');
      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ TCP GPS connection error:', errorMessage);
      
      // Provide user-friendly error message
      const friendlyMessage = errorMessage.includes('not implemented') || errorMessage.includes('plugin')
        ? 'GPS device connection requires the native Android app. Web browser cannot connect to external GPS devices.'
        : `Connection failed: ${errorMessage}`;
      
      if (options.onError) {
        options.onError(friendlyMessage);
      }
      return false;
    }
  }, [nativeGps, options]);

  // Legacy disconnect that maps to new disconnect
  const disconnect = useCallback(async () => {
    await nativeGps.disconnect();
  }, [nativeGps]);

  // Return legacy interface that maps to new implementation
  return {
    // State
    isConnected: nativeGps.isConnected,
    isConnecting: nativeGps.isConnecting,
    lastPosition: nativeGps.lastPosition,
    deviceAddress: nativeGps.connectedDevice?.address || '',
    
    // Methods
    connect,
    disconnect,
    
    // Additional state for compatibility
    isPolling: false, // Not used in new implementation
    connectionQuality: nativeGps.lastPosition?.accuracy ? 
      (nativeGps.lastPosition.accuracy < 5 ? 'excellent' : 
       nativeGps.lastPosition.accuracy < 10 ? 'good' : 
       nativeGps.lastPosition.accuracy < 20 ? 'fair' : 'poor') : 'unknown',
  };
}
