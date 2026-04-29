/**
 * Centralized logging utility that respects environment settings
 */
import { environmentConfig } from '../config/environment';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  component?: string;
  action?: string;
  user?: string;
  [key: string]: any;
}

class Logger {
  private static instance: Logger;
  private isDevelopment: boolean;
  private enabledLevels: Set<LogLevel> = new Set(['warn', 'error']);

  private constructor() {
    this.isDevelopment = environmentConfig.isDevelopment();
    
    // In development, enable selective logging (not debug by default to reduce spam)
    if (this.isDevelopment) {
      this.enabledLevels.add('info');
      // Only enable debug if specifically requested
      if (import.meta.env.VITE_ENABLE_DEBUG_LOGGING === 'true') {
        this.enabledLevels.add('debug');
      }
    }
    
    // Enable info logging if specifically requested
    if (import.meta.env.VITE_ENABLE_INFO_LOGGING === 'true') {
      this.enabledLevels.add('info');
    }
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.enabledLevels.has(level);
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString().substring(11, 23);
    const contextStr = context ? ` [${Object.entries(context).map(([k,v]) => `${k}:${v}`).join(',')}]` : '';
    return `[${timestamp}] ${message}${contextStr}`;
  }

  // Standard logging methods
  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      console.log(`🔧 ${this.formatMessage('debug', message, context)}`);
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      console.log(`ℹ️ ${this.formatMessage('info', message, context)}`);
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      console.warn(`⚠️ ${this.formatMessage('warn', message, context)}`);
    }
  }

  error(message: string, error?: any, context?: LogContext): void {
    if (this.shouldLog('error')) {
      const errorStr = error instanceof Error ? error.message : String(error || '');
      const fullContext = { ...context, error: errorStr };
      console.error(`❌ ${this.formatMessage('error', message, fullContext)}`);
      if (error instanceof Error && this.isDevelopment) {
        console.error(error.stack);
      }
    }
  }

  // Specialized logging methods
  gps(message: string, position?: { latitude: number; longitude: number; accuracy?: number }): void {
    if (this.shouldLog('info')) { // Changed from debug to info to reduce frequency
      const context = position ? {
        component: 'GPS',
        lat: position.latitude.toFixed(6),
        lon: position.longitude.toFixed(6),
        acc: position.accuracy?.toFixed(1)
      } : { component: 'GPS' };
      console.log(`📍 ${this.formatMessage('info', message, context)}`);
    }
  }

  network(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      console.log(`🌐 ${this.formatMessage('debug', message, context)}`);
    }
  }

  auth(message: string, ...args: any[]): void {
    if (this.isDevelopment) {
      console.log(`🔐 ${message}`, ...args);
    }
  }

  database(message: string, ...args: any[]): void {
    if (this.isDevelopment) {
      console.log(`💾 ${message}`, ...args);
    }
  }

  firebase(message: string, ...args: any[]): void {
    if (this.isDevelopment) {
      console.log(`🔥 ${message}`, ...args);
    }
  }

  // Conditional logging - only log once per session for repetitive messages
  private _loggedOnce: Set<string> = new Set();
  
  once(key: string, level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: any[]): void {
    if (!this._loggedOnce.has(key)) {
      this._loggedOnce.add(key);
      this[level](message, ...args);
    }
  }

  // Performance logging
  performance(operation: string, startTime: number, ...args: any[]): void {
    if (this.isDevelopment) {
      const duration = Date.now() - startTime;
      console.log(`⚡ ${operation} took ${duration}ms`, ...args);
    }
  }
}

// Export singleton instance
export const logger = Logger.getInstance();

// Convenience exports for common use cases
export const logDebug = (message: string, ...args: any[]) => logger.debug(message, ...args);
export const logInfo = (message: string, ...args: any[]) => logger.info(message, ...args);
export const logWarn = (message: string, ...args: any[]) => logger.warn(message, ...args);
export const logError = (message: string, error?: any, ...args: any[]) => logger.error(message, error, ...args);
export const logGPS = (message: string, ...args: any[]) => logger.gps(message, ...args);
export const logNetwork = (message: string, ...args: any[]) => logger.network(message, ...args);
export const logAuth = (message: string, ...args: any[]) => logger.auth(message, ...args);
export const logDatabase = (message: string, ...args: any[]) => logger.database(message, ...args);
export const logFirebase = (message: string, ...args: any[]) => logger.firebase(message, ...args);
export const logOnce = (key: string, level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: any[]) => 
  logger.once(key, level, message, ...args);
export const logPerformance = (operation: string, startTime: number, ...args: any[]) => 
  logger.performance(operation, startTime, ...args);