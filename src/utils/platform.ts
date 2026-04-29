/**
 * Unified platform detection for Capacitor apps
 * DEPRECATED: Use environmentConfig from src/config/environment.ts instead
 * 
 * This file is kept for backward compatibility but should not be used in new code.
 * Use environmentConfig.isNative(), environmentConfig.isWeb(), etc. instead.
 */

import { Capacitor } from '@capacitor/core';

/**
 * @deprecated Use environmentConfig.isNative() instead
 */
export const isCapacitorApp = (): boolean => {
  if (typeof window === 'undefined') return false;

  // Preferred check: Capacitor API knows if we're native
  try {
    if (Capacitor?.isNativePlatform?.()) return true;
  } catch (_) {
    // ignore
  }

  // Protocol-based fallback
  const protocol = window.location.protocol;
  if (protocol === 'capacitor:' || protocol === 'ionic:' || protocol === 'file:') {
    return true;
  }

  return false;
};

/**
 * @deprecated Use environmentConfig.getConfig() instead
 */
export const getPlatformInfo = () => {
  return {
    isCapacitor: isCapacitorApp(),
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    port: window.location.port,
    href: window.location.href
  };
};
