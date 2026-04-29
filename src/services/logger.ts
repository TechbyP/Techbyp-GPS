/**
 * Centralized logging service with configurable log levels
 * Replaces scattered console.log/warn/error calls throughout the app
 * 
 * Log Levels (in order of severity):
 * - ERROR: Critical errors that need immediate attention
 * - WARN: Warning messages about potential issues
 * - INFO: General informational messages
 * - DEBUG: Detailed debug information (disabled in production)
 * - TRACE: Very detailed tracing (disabled in production)
 */

import { environmentConfig } from '../config/environment';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4,
}

export interface LogContext {
  module?: string;
  userId?: string;
  projectId?: string;
  trackId?: string;
  operation?: string;
  timestamp?: number;
  platform?: string;
  [key: string]: any;
}

class Logger {
  private currentLevel: LogLevel;
  private isProduction: boolean;
  private logHistory: Array<{ level: LogLevel; message: string; context?: LogContext; timestamp: number }> = [];
  private maxHistorySize = 100;

  constructor() {
    // In production, only show ERROR and WARN
    // In development, show everything
    this.isProduction = environmentConfig.isProd;
    this.currentLevel = this.isProduction ? LogLevel.WARN : LogLevel.DEBUG;
  }

  /**
   * Set the minimum log level to display
   */
  setLevel(level: LogLevel) {
    this.currentLevel = level;
  }

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return this.currentLevel;
  }

  /**
   * Check if a log level should be displayed
   */
  private shouldLog(level: LogLevel): boolean {
    return level <= this.currentLevel;
  }

  /**
   * Format log message with context
   */
  private formatMessage(module: string, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0]; // HH:MM:SS
    const moduleStr = module ? `[${module}]` : '';
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    return `${timestamp} ${moduleStr} ${message}${contextStr}`;
  }

  /**
   * Add to log history (for debugging)
   */
  private addToHistory(level: LogLevel, message: string, context?: LogContext) {
    this.logHistory.push({
      level,
      message,
      context,
      timestamp: Date.now(),
    });

    // Keep history size manageable
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory.shift();
    }
  }

  /**
   * Get recent log history
   */
  getHistory(): typeof this.logHistory {
    return [...this.logHistory];
  }

  /**
   * Clear log history
   */
  clearHistory() {
    this.logHistory = [];
  }

  /**
   * ERROR level logging - always shown
   */
  error(module: string, message: string, error?: any, context?: LogContext) {
    if (!this.shouldLog(LogLevel.ERROR)) return;

    const formatted = this.formatMessage(module, message, context);
    console.error('❌', formatted);
    if (error) {
      console.error(error);
    }
    this.addToHistory(LogLevel.ERROR, message, { ...context, error: error?.message });
  }

  /**
   * WARN level logging - shown in production
   */
  warn(module: string, message: string, context?: LogContext) {
    if (!this.shouldLog(LogLevel.WARN)) return;

    const formatted = this.formatMessage(module, message, context);
    console.warn('⚠️', formatted);
    this.addToHistory(LogLevel.WARN, message, context);
  }

  /**
   * INFO level logging - hidden in production
   */
  info(module: string, message: string, context?: LogContext) {
    if (!this.shouldLog(LogLevel.INFO)) return;

    const formatted = this.formatMessage(module, message, context);
    console.log('ℹ️', formatted);
    this.addToHistory(LogLevel.INFO, message, context);
  }

  /**
   * DEBUG level logging - hidden in production
   */
  debug(module: string, message: string, context?: LogContext) {
    if (!this.shouldLog(LogLevel.DEBUG)) return;

    const formatted = this.formatMessage(module, message, context);
    console.log('🐛', formatted);
    this.addToHistory(LogLevel.DEBUG, message, context);
  }

  /**
   * TRACE level logging - very detailed, hidden in production
   */
  trace(module: string, message: string, context?: LogContext) {
    if (!this.shouldLog(LogLevel.TRACE)) return;

    const formatted = this.formatMessage(module, message, context);
    console.log('🔍', formatted);
    this.addToHistory(LogLevel.TRACE, message, context);
  }

  /**
   * Log operation start (DEBUG level)
   */
  operationStart(module: string, operation: string, context?: LogContext) {
    this.debug(module, `Starting: ${operation}`, context);
  }

  /**
   * Log operation success (DEBUG level)
   */
  operationSuccess(module: string, operation: string, context?: LogContext) {
    this.debug(module, `Success: ${operation}`, context);
  }

  /**
   * Log operation failure (ERROR level)
   */
  operationFailure(module: string, operation: string, error: any, context?: LogContext) {
    this.error(module, `Failed: ${operation}`, error, context);
  }

  /**
   * Performance timing helper
   */
  time(label: string): () => void {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      this.debug('Performance', `${label}: ${duration.toFixed(2)}ms`);
    };
  }
}

// Export singleton instance
export const logger = new Logger();

// Export convenience functions for common modules
export const dbLogger = {
  error: (msg: string, error?: any, ctx?: LogContext) => logger.error('Database', msg, error, ctx),
  warn: (msg: string, ctx?: LogContext) => logger.warn('Database', msg, ctx),
  info: (msg: string, ctx?: LogContext) => logger.info('Database', msg, ctx),
  debug: (msg: string, ctx?: LogContext) => logger.debug('Database', msg, ctx),
};

export const syncLogger = {
  error: (msg: string, error?: any, ctx?: LogContext) => logger.error('Sync', msg, error, ctx),
  warn: (msg: string, ctx?: LogContext) => logger.warn('Sync', msg, ctx),
  info: (msg: string, ctx?: LogContext) => logger.info('Sync', msg, ctx),
  debug: (msg: string, ctx?: LogContext) => logger.debug('Sync', msg, ctx),
};

export const gpsLogger = {
  error: (msg: string, error?: any, ctx?: LogContext) => logger.error('GPS', msg, error, ctx),
  warn: (msg: string, ctx?: LogContext) => logger.warn('GPS', msg, ctx),
  info: (msg: string, ctx?: LogContext) => logger.info('GPS', msg, ctx),
  debug: (msg: string, ctx?: LogContext) => logger.debug('GPS', msg, ctx),
};

export const authLogger = {
  error: (msg: string, error?: any, ctx?: LogContext) => logger.error('Auth', msg, error, ctx),
  warn: (msg: string, ctx?: LogContext) => logger.warn('Auth', msg, ctx),
  info: (msg: string, ctx?: LogContext) => logger.info('Auth', msg, ctx),
  debug: (msg: string, ctx?: LogContext) => logger.debug('Auth', msg, ctx),
};
