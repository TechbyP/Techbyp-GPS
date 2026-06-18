/**
 * ✅ ISSUE #10 FIX: Standardized Error Handling with Categories
 * 
 * Provides consistent error categorization, retry logic, and user feedback
 * across the entire application.
 */

export enum ErrorCategory {
  NETWORK = 'network',           // Network connectivity issues
  AUTH = 'auth',                 // Authentication/authorization errors
  PERMISSION = 'permission',     // Permission denied errors
  VALIDATION = 'validation',     // Data validation errors
  STORAGE = 'storage',          // Storage quota/access errors
  DATABASE = 'database',        // Database operation errors
  TIMEOUT = 'timeout',          // Operation timeout errors
  CONFLICT = 'conflict',        // Data conflict errors
  NOT_FOUND = 'not-found',      // Resource not found
  UNKNOWN = 'unknown'           // Uncategorized errors
}

export interface CategorizedError {
  category: ErrorCategory;
  message: string;
  originalError: any;
  isRetriable: boolean;
  shouldNotifyUser: boolean;
  userMessage: string;
  timestamp: number;
}

/**
 * Categorize an error and determine appropriate handling
 */
export function categorizeError(
  error: any, 
  t?: (key: string, fallback?: string) => string
): CategorizedError {
  const timestamp = Date.now();
  let category = ErrorCategory.UNKNOWN;
  let isRetriable = false;
  let shouldNotifyUser = true;
  let userMessage = t?.('error.categories.unexpectedError') || 'An unexpected error occurred';
  const message = error?.message || String(error);

  // Network errors
  if (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('timeout') ||
    message.includes('offline') ||
    error?.code === 'unavailable' ||
    error?.code === 'deadline-exceeded'
  ) {
    category = ErrorCategory.NETWORK;
    isRetriable = true;
    shouldNotifyUser = false; // Silent retry for network issues
    userMessage = t?.('error.categories.networkError') || 'Network connection issue. Will retry automatically.';
  }

  // Timeout errors
  else if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    error?.code === 'deadline-exceeded'
  ) {
    category = ErrorCategory.TIMEOUT;
    isRetriable = true;
    shouldNotifyUser = false;
    userMessage = t?.('error.categories.timeoutError') || 'Operation timed out. Will retry automatically.';
  }

  // Authentication errors
  else if (
    message.includes('auth') ||
    message.includes('unauthenticated') ||
    message.includes('not authenticated') ||
    message.includes('mismatch') ||
    error?.code?.startsWith('auth/') ||
    error?.code === 'auth/mismatch'
  ) {
    category = ErrorCategory.AUTH;
    isRetriable = false;
    shouldNotifyUser = true;
    userMessage = t?.('error.categories.authError') || 'Please log in again to continue.';
  }

  // Permission errors
  else if (
    message.includes('permission') ||
    message.includes('denied') ||
    message.includes('forbidden') ||
    error?.code === 'permission-denied'
  ) {
    category = ErrorCategory.PERMISSION;
    isRetriable = false;
    shouldNotifyUser = true;
    userMessage = t?.('error.categories.permissionError') || 'You do not have permission to perform this action.';
  }

  // Storage errors
  else if (
    message.includes('quota') ||
    message.includes('storage') ||
    message.includes('disk') ||
    message.includes('space')
  ) {
    category = ErrorCategory.STORAGE;
    isRetriable = false;
    shouldNotifyUser = true;
    userMessage = t?.('error.categories.storageError') || 'Storage is full. Please free up space.';
  }

  // Database errors
  else if (
    message.includes('database') ||
    message.includes('indexeddb') ||
    message.includes('connection')
  ) {
    category = ErrorCategory.DATABASE;
    isRetriable = true;
    shouldNotifyUser = true;
    userMessage = t?.('error.categories.databaseError') || 'Database error. Please try again.';
  }

  // Not found errors
  else if (
    message.includes('not found') ||
    message.includes('missing') ||
    error?.code === 'not-found'
  ) {
    category = ErrorCategory.NOT_FOUND;
    isRetriable = false;
    shouldNotifyUser = false; // Often expected
    userMessage = t?.('error.categories.notFoundError') || 'Item not found.';
  }

  // Validation errors
  else if (
    message.includes('invalid') ||
    message.includes('validation') ||
    message.includes('required')
  ) {
    category = ErrorCategory.VALIDATION;
    isRetriable = false;
    shouldNotifyUser = true;
    userMessage = message; // Use original message for validation errors
  }

  return {
    category,
    message,
    originalError: error,
    isRetriable,
    shouldNotifyUser,
    userMessage,
    timestamp
  };
}

/**
 * Check if an error is retriable
 */
export function isRetriableError(error: any): boolean {
  const categorized = categorizeError(error);
  return categorized.isRetriable;
}

/**
 * Get user-friendly error message
 */
export function getUserErrorMessage(error: any): string {
  const categorized = categorizeError(error);
  return categorized.userMessage;
}

/**
 * Log error with category context
 */
export function logCategorizedError(context: string, error: any): void {
  const categorized = categorizeError(error);
  
  const logEntry = {
    context,
    category: categorized.category,
    message: categorized.message,
    retriable: categorized.isRetriable,
    timestamp: new Date(categorized.timestamp).toISOString()
  };

  // Use appropriate console method based on category
  if (categorized.category === ErrorCategory.NETWORK || 
      categorized.category === ErrorCategory.TIMEOUT) {
    console.warn(`[${context}]`, logEntry);
  } else if (categorized.category === ErrorCategory.NOT_FOUND) {
    console.info(`[${context}]`, logEntry);
  } else {
    console.error(`[${context}]`, logEntry);
  }
}

/**
 * Create standardized error with category
 */
export function createCategorizedError(
  category: ErrorCategory,
  message: string,
  originalError?: any
): Error {
  const error = new Error(message);
  (error as any).category = category;
  (error as any).originalError = originalError;
  return error;
}
