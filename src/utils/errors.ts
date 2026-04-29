/**
 * Standardized error handling for the application
 * Provides error categorization, severity levels, and user-friendly messaging
 */

import toast from 'react-hot-toast';

export enum ErrorSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

export enum ErrorCategory {
  NETWORK = 'network',
  DATABASE = 'database',
  AUTHENTICATION = 'auth',
  VALIDATION = 'validation',
  PERMISSION = 'permission',
  STORAGE = 'storage',
  SYNC = 'sync',
  UNKNOWN = 'unknown'
}

export class AppError extends Error {
  constructor(
    message: string,
    public category: ErrorCategory,
    public severity: ErrorSeverity,
    public isRetriable: boolean = false,
    public context?: any
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ErrorHandler {
  private static listeners: Array<(error: AppError) => void> = [];
  private static errorCounts = new Map<string, number>();
  
  static handle(error: Error | AppError, silent: boolean = false): void {
    const appError = error instanceof AppError
      ? error
      : this.categorize(error);
    
    // Count errors
    const errorKey = `${appError.category}:${appError.message}`;
    this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);
    
    // Log with context
    const logLevel = appError.severity === ErrorSeverity.CRITICAL || appError.severity === ErrorSeverity.ERROR
      ? console.error
      : appError.severity === ErrorSeverity.WARNING
      ? console.warn
      : console.info;
    
    logLevel(
      `[${appError.severity.toUpperCase()}] ${appError.category}:`,
      appError.message,
      appError.context || ''
    );
    
    // Notify listeners
    this.listeners.forEach(listener => {
      try {
        listener(appError);
      } catch (e) {
        console.error('Error in error listener:', e);
      }
    });
    
    // User notification (unless silent)
    if (!silent) {
      if (appError.severity === ErrorSeverity.CRITICAL || appError.severity === ErrorSeverity.ERROR) {
        toast.error(appError.message);
      } else if (appError.severity === ErrorSeverity.WARNING) {
        toast(appError.message, { icon: '⚠️', duration: 4000 });
      }
    }
  }
  
  static categorize(error: Error): AppError {
    const message = error.message.toLowerCase();
    
    // Network errors
    if (message.includes('timeout') || message.includes('network') || 
        message.includes('fetch') || message.includes('connection')) {
      return new AppError(
        'Network error - please check your connection',
        ErrorCategory.NETWORK,
        ErrorSeverity.WARNING,
        true,
        { originalError: error.message }
      );
    }
    
    // Auth errors
    if (message.includes('permission') || message.includes('unauthorized') || 
        message.includes('auth') || message.includes('not authenticated')) {
      return new AppError(
        'Authentication error - please log in again',
        ErrorCategory.AUTHENTICATION,
        ErrorSeverity.ERROR,
        false,
        { originalError: error.message }
      );
    }
    
    // Database errors
    if (message.includes('database') || 
        message.includes('firestore') || message.includes('indexeddb')) {
      return new AppError(
        'Database error - your data has been saved locally',
        ErrorCategory.DATABASE,
        ErrorSeverity.WARNING,
        true,
        { originalError: error.message }
      );
    }
    
    // Storage errors
    if (message.includes('quota') || message.includes('storage')) {
      return new AppError(
        'Storage quota exceeded - please clear some data',
        ErrorCategory.STORAGE,
        ErrorSeverity.WARNING,
        false,
        { originalError: error.message }
      );
    }
    
    // Sync errors
    if (message.includes('sync') || message.includes('queue')) {
      return new AppError(
        'Sync error - will retry automatically',
        ErrorCategory.SYNC,
        ErrorSeverity.INFO,
        true,
        { originalError: error.message }
      );
    }
    
    // Validation errors
    if (message.includes('invalid') || message.includes('validation')) {
      return new AppError(
        'Validation error - please check your input',
        ErrorCategory.VALIDATION,
        ErrorSeverity.WARNING,
        false,
        { originalError: error.message }
      );
    }
    
    // Unknown
    return new AppError(
      'An unexpected error occurred',
      ErrorCategory.UNKNOWN,
      ErrorSeverity.ERROR,
      false,
      { originalError: error.message }
    );
  }
  
  static subscribe(listener: (error: AppError) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
  
  static getErrorCount(category?: ErrorCategory): number {
    if (!category) {
      return Array.from(this.errorCounts.values()).reduce((a, b) => a + b, 0);
    }
    
    let count = 0;
    for (const [key, value] of this.errorCounts.entries()) {
      if (key.startsWith(`${category}:`)) {
        count += value;
      }
    }
    return count;
  }
  
  static clearErrorCounts(): void {
    this.errorCounts.clear();
  }
}
