/**
 * GPS Connection Fix Utility
 * Handles the "tcp proxy not installed" error by providing fallback mechanisms
 * and proper error handling for GPS device connections
 */

import { Capacitor } from '@capacitor/core';
import { isCapacitorApp } from './platform';
import GpsDeviceManager from '../plugins/GpsDeviceManager/index';

export interface GpsConnectionDiagnostics {
  isNative: boolean;
  hasGpsManager: boolean;
  capacitorVersion: string;
  platform: string;
  error?: string;
}

/**
 * Diagnose GPS connection capabilities and potential issues
 */
export async function diagnoseGpsConnection(): Promise<GpsConnectionDiagnostics> {
  const diagnostics: GpsConnectionDiagnostics = {
    isNative: isCapacitorApp(),
    hasGpsManager: false,
    capacitorVersion: Capacitor.getPlatform(),
    platform: Capacitor.getPlatform()
  };

  try {
    // Try to check if GPS manager is available
    const status = await GpsDeviceManager.getStatus();
    diagnostics.hasGpsManager = true;
  } catch (error) {
    diagnostics.hasGpsManager = false;
    diagnostics.error = error instanceof Error ? error.message : String(error);
    console.warn('❌ GPS Manager not available:', diagnostics.error);
  }

  return diagnostics;
}

/**
 * Fix GPS connection issues by providing appropriate fallbacks
 */
export async function fixGpsConnection(): Promise<{
  success: boolean;
  message: string;
  useNativeGps: boolean;
}> {
  const diagnostics = await diagnoseGpsConnection();
  
  // If we're on web platform, native GPS won't work
  if (!diagnostics.isNative) {
    return {
      success: false,
      message: 'GPS device connection requires native Android app. Use browser geolocation instead.',
      useNativeGps: false
    };
  }

  // If GPS manager is not available in native app
  if (!diagnostics.hasGpsManager) {
    console.error('GPS Manager Plugin Issue:', diagnostics.error);
    
    // Common issues and fixes
    if (diagnostics.error?.includes('not implemented')) {
      return {
        success: false,
        message: 'GPS Manager plugin not properly registered. Please restart the app.',
        useNativeGps: false
      };
    }
    
    if (diagnostics.error?.includes('not found')) {
      return {
        success: false,
        message: 'GPS Manager plugin not found. The app may need to be reinstalled.',
        useNativeGps: false
      };
    }
    
    return {
      success: false,
      message: `GPS Manager unavailable: ${diagnostics.error}`,
      useNativeGps: false
    };
  }

  // GPS Manager is available
  return {
    success: true,
    message: 'GPS Manager is ready for device connections',
    useNativeGps: true
  };
}

/**
 * Safe GPS device connection with error handling
 */
export async function safeConnectGpsDevice(
  device: {
    address: string;
    connectionType: 'bluetooth' | 'wifi' | 'serial';
    port?: number;
    name?: string;
  }
): Promise<{
  success: boolean;
  message: string;
  connected: boolean;
}> {
  try {
    // First check if GPS connection is possible
    const connectionCheck = await fixGpsConnection();
    if (!connectionCheck.success) {
      return {
        success: false,
        message: connectionCheck.message,
        connected: false
      };
    }

    // Attempt connection
    console.log('🔌 Attempting to connect to GPS device:', device);
    
    const result = await GpsDeviceManager.connectDevice({
      address: device.address,
      connectionType: device.connectionType,
      port: device.port || 9001,
      name: device.name || 'GPS Device'
    });

    console.log('✅ GPS device connected successfully:', result);
    
    return {
      success: true,
      message: `Connected to ${device.name || device.address}`,
      connected: true
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ GPS connection failed:', errorMessage);
    
    // Provide user-friendly error messages
    if (errorMessage.includes('not implemented') || errorMessage.includes('not found')) {
      return {
        success: false,
        message: 'GPS device connection requires the native Android app. Web browser cannot connect to external GPS devices.',
        connected: false
      };
    }
    
    if (errorMessage.includes('permission')) {
      return {
        success: false,
        message: 'Location permissions are required. Please enable location access in device settings.',
        connected: false
      };
    }
    
    if (errorMessage.includes('timeout') || errorMessage.includes('unreachable')) {
      return {
        success: false,
        message: 'Cannot reach GPS device. Check device IP address and network connection.',
        connected: false
      };
    }
    
    return {
      success: false,
      message: `Connection failed: ${errorMessage}`,
      connected: false
    };
  }
}

/**
 * Initialize GPS system with diagnostics
 */
export async function initializeGpsSystem(): Promise<void> {
  const diagnostics = await diagnoseGpsConnection();
  
  if (diagnostics.isNative && !diagnostics.hasGpsManager) {
    console.warn('⚠️  GPS Manager not available:', diagnostics.error);
    console.warn('💡 Suggestion: Restart the app or check plugin installation');
  }
}

// Auto-initialize when loaded
if (typeof window !== 'undefined') {
  // Initialize after a short delay to ensure Capacitor is ready
  setTimeout(() => {
    initializeGpsSystem().catch(error => {
      console.error('Failed to initialize GPS system:', error);
    });
  }, 1000);
}