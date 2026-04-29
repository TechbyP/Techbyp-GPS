/**
 * Debug configuration for performance optimization
 * Disable console logging on production/deployed builds
 * Keep it enabled in development for troubleshooting
 */

const DEBUG_ENABLED = import.meta.env.DEV; // Only log in development mode

export function debugLog(prefix: string, message: any, data?: any) {
  if (DEBUG_ENABLED) {
    if (data) {
      console.log(`[${prefix}] ${message}`, data);
    } else {
      console.log(`[${prefix}] ${message}`);
    }
  }
}

export function debugWarn(prefix: string, message: any, data?: any) {
  if (DEBUG_ENABLED) {
    if (data) {
      console.warn(`[${prefix}] ${message}`, data);
    } else {
      console.warn(`[${prefix}] ${message}`);
    }
  }
}

export function debugError(prefix: string, message: any, data?: any) {
  // Always log errors, but only in dev
  if (DEBUG_ENABLED) {
    if (data) {
      console.error(`[${prefix}] ${message}`, data);
    } else {
      console.error(`[${prefix}] ${message}`);
    }
  }
}

export const isDebugEnabled = DEBUG_ENABLED;
