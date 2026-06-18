/**
 * Error Translation Helper
 * Maps error codes to i18n translation keys
 * Fixes Issue #23: Translation keys missing for error messages
 */

export type ErrorCategory = 
  | 'database'
  | 'sync' 
  | 'gps'
  | 'device'
  | 'field'
  | 'track'
  | 'sample'
  | 'common';

export interface TranslatedError {
  key: string; // i18n translation key
  category: ErrorCategory;
  message: string; // English fallback
  params?: Record<string, any>; // Parameters for interpolation
}

/**
 * Error code to translation key mapping
 */
const ERROR_KEY_MAP: Record<string, string> = {
  // Auth errors
  'auth/requires-recent-login': 'errors.database.authentication_required',
  'auth/user-not-found': 'errors.database.authentication_required',
  'permission-denied': 'errors.database.permission_denied',
  
  // Network errors
  'network-request-failed': 'errors.database.network_error',
  'unavailable': 'errors.database.device_offline',
  'timeout': 'errors.database.operation_timeout',
  
  // Data errors
  'not-found': 'errors.database.not_found',
  'invalid-argument': 'errors.database.invalid_data',
  'already-exists': 'errors.database.invalid_data',
  
  // Storage errors
  'quota-exceeded': 'errors.database.storage_quota_exceeded',
  'failed-precondition': 'errors.database.database_error',
  
  // GPS errors
  'POSITION_UNAVAILABLE': 'errors.gps.location_unavailable',
  'PERMISSION_DENIED': 'errors.gps.permission_denied',
  'TIMEOUT': 'errors.gps.timeout',
  
  // Sync errors
  'sync-failed': 'errors.database.sync_failed',
  'conflict': 'errors.sync.conflict_detected',
};

/**
 * Translate error to i18n key
 */
export function translateError(error: Error | string | any): TranslatedError {
  const errorMsg = typeof error === 'string' ? error : error?.message || error?.code || 'unknown';
  const errorCode = typeof error === 'object' ? error?.code : errorMsg;
  
  // Try direct mapping first
  if (errorCode && ERROR_KEY_MAP[errorCode]) {
    return {
      key: ERROR_KEY_MAP[errorCode],
      category: getCategoryFromKey(ERROR_KEY_MAP[errorCode]),
      message: errorMsg
    };
  }
  
  // Pattern matching for common error types
  if (errorMsg.toLowerCase().includes('network')) {
    return {
      key: 'errors.database.network_error',
      category: 'database',
      message: errorMsg
    };
  }
  
  if (errorMsg.toLowerCase().includes('offline')) {
    return {
      key: 'errors.database.device_offline',
      category: 'database',
      message: errorMsg
    };
  }
  
  if (errorMsg.toLowerCase().includes('timeout')) {
    return {
      key: 'errors.database.operation_timeout',
      category: 'database',
      message: errorMsg
    };
  }
  
  if (errorMsg.toLowerCase().includes('permission')) {
    return {
      key: 'errors.database.permission_denied',
      category: 'database',
      message: errorMsg
    };
  }
  
  if (errorMsg.toLowerCase().includes('not found')) {
    return {
      key: 'errors.database.not_found',
      category: 'database',
      message: errorMsg
    };
  }
  
  if (errorMsg.toLowerCase().includes('invalid') || errorMsg.toLowerCase().includes('validation')) {
    return {
      key: 'errors.database.invalid_data',
      category: 'database',
      message: errorMsg
    };
  }
  
  if (errorMsg.toLowerCase().includes('gps') || errorMsg.toLowerCase().includes('location')) {
    return {
      key: 'errors.gps.location_unavailable',
      category: 'gps',
      message: errorMsg
    };
  }
  
  if (errorMsg.toLowerCase().includes('device') || errorMsg.toLowerCase().includes('bluetooth')) {
    return {
      key: 'errors.device.connection_failed',
      category: 'device',
      message: errorMsg
    };
  }
  
  // Fallback to unknown error
  return {
    key: 'errors.common.unknown_error',
    category: 'common',
    message: errorMsg
  };
}

/**
 * Get category from translation key
 */
function getCategoryFromKey(key: string): ErrorCategory {
  const parts = key.split('.');
  if (parts.length >= 2 && parts[0] === 'errors') {
    return parts[1] as ErrorCategory;
  }
  return 'common';
}

/**
 * Format error for user display with i18n
 */
export function formatErrorForUser(
  error: Error | string | any,
  t: (key: string, params?: any) => string
): string {
  const translated = translateError(error);
  
  try {
    // Try translation with params
    const translatedMsg = t(translated.key, translated.params);
    
    // If translation returns the key itself, use fallback
    if (translatedMsg === translated.key) {
      return translated.message;
    }
    
    return translatedMsg;
  } catch (e) {
    // Fallback to English message
    return translated.message;
  }
}

/**
 * Check if error is retriable based on translation
 */
export function isRetriableFromTranslation(error: Error | string | any): boolean {
  const translated = translateError(error);
  
  const retriableKeys = [
    'errors.database.network_error',
    'errors.database.device_offline',
    'errors.database.operation_timeout',
    'errors.database.sync_failed',
    'errors.gps.timeout',
    'errors.device.connection_timeout',
  ];
  
  return retriableKeys.includes(translated.key);
}

/**
 * Get user-friendly action suggestion based on error
 */
export function getErrorAction(
  error: Error | string | any,
  t: (key: string) => string
): string | null {
  const translated = translateError(error);
  
  const actionMap: Record<string, string> = {
    'errors.database.device_offline': 'errors.common.try_again',
    'errors.database.network_error': 'errors.common.try_again',
    'errors.database.operation_timeout': 'errors.common.try_again',
    'errors.gps.permission_denied': 'errors.common.contact_support',
    'errors.database.permission_denied': 'errors.common.contact_support',
    'errors.database.storage_quota_exceeded': 'errors.common.contact_support',
  };
  
  const actionKey = actionMap[translated.key];
  if (actionKey) {
    try {
      return t(actionKey);
    } catch (e) {
      return null;
    }
  }
  
  return null;
}

/**
 * Create error notification config for toast/snackbar
 */
export interface ErrorNotificationConfig {
  message: string;
  action?: string;
  severity: 'error' | 'warning' | 'info';
  duration?: number;
  retriable: boolean;
}

export function createErrorNotification(
  error: Error | string | any,
  t: (key: string, params?: any) => string
): ErrorNotificationConfig {
  const translated = translateError(error);
  const message = formatErrorForUser(error, t);
  const action = getErrorAction(error, t);
  const retriable = isRetriableFromTranslation(error);
  
  // Determine severity based on category
  let severity: 'error' | 'warning' | 'info' = 'error';
  if (translated.category === 'sync' || translated.key.includes('offline')) {
    severity = 'warning'; // Offline/sync issues are warnings, not critical
  }
  
  // Duration based on severity
  const duration = severity === 'error' ? 5000 : 3000;
  
  return {
    message,
    action: action || undefined,
    severity,
    duration,
    retriable
  };
}
