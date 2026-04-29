import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getNetworkStatus, addNetworkListener } from '../utils/networkStatus';

interface OfflineContextValue {
  isOffline: boolean;
  isCapacitorApp: boolean;
  forceOffline: boolean;
  germanyTilesAvailable: boolean;
  connectionType?: 'wifi' | 'cellular' | 'ethernet' | 'unknown' | 'none';
}

const OfflineContext = createContext<OfflineContextValue | undefined>(undefined);

// Check for Germany offline tiles at runtime
const checkGermanyTilesAvailable = (): boolean => {
  if ((window as any).__GERMANY_TILES_AVAILABLE__ === true) {
    return true;
  }
  if (typeof window !== 'undefined' && (window as any).Capacitor) {
    return true;
  }
  return false;
};

interface OfflineProviderProps {
  children: ReactNode;
}

export const OfflineProvider: React.FC<OfflineProviderProps> = ({ children }) => {
  const isCapacitorApp = !!(window as any).Capacitor;
  const germanyTilesAvailable = checkGermanyTilesAvailable();
  const [isOffline, setIsOffline] = useState(true);
  const [connectionType, setConnectionType] = useState<'wifi' | 'cellular' | 'ethernet' | 'unknown' | 'none'>('none');
  
  // CRITICAL FIX: Do NOT force offline for APKs - they should sync when connected to any internet
  // The HybridDatabase and sync queue will handle proper offline-first caching
  // Only use forceOffline if navigator.onLine says we're offline
  const forceOffline = isOffline;

  useEffect(() => {
    // Initial network status check
    getNetworkStatus().then(status => {
      console.log('🌐 [OfflineContext] Initial network status:', status);
      setIsOffline(!status.connected);
      setConnectionType(status.connectionType);
    });

    // Listen for network changes (supports cellular data detection)
    const cleanup = addNetworkListener((status) => {
      console.log('🌐 [OfflineContext] Network status changed:', status);
      setIsOffline(!status.connected);
      setConnectionType(status.connectionType);
      
      if (status.connectionType === 'cellular') {
        console.log('📱 [OfflineContext] Using cellular data - app should sync when ready');
      } else if (status.connectionType === 'wifi') {
        console.log('📶 [OfflineContext] Using WiFi - app should sync when ready');
      } else if (!status.connected) {
        console.log('📴 [OfflineContext] No connection - using local storage only');
      }
    });

    return cleanup;
  }, []);

  const value: OfflineContextValue = {
    isOffline,
    isCapacitorApp,
    forceOffline,
    germanyTilesAvailable,
    connectionType,
  };

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
};

export const useOffline = (): OfflineContextValue => {
  const context = useContext(OfflineContext);
  if (context === undefined) {
    throw new Error('useOffline must be used within an OfflineProvider');
  }
  return context;
};
