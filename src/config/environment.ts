/**
 * Environment Configuration
 * Handles platform-specific settings for PC and Android
 */

import { Capacitor } from '@capacitor/core';

export type Platform = 'web' | 'android' | 'ios' | 'electron';
export type Environment = 'development' | 'production';

interface EnvironmentConfig {
  platform: Platform;
  environment: Environment;
  isDevelopment: boolean;
  isProduction: boolean;
  isNative: boolean;
  isWeb: boolean;
  
  // API Configuration
  api: {
    baseUrl: string;
    timeout: number;
    retryAttempts: number;
    retryDelay: number;
  };
  
  // Firebase Configuration
  firebase: {
    persistenceStrategy: 'network-first' | 'cache-first' | 'memory-only';
    enableOfflineSupport: boolean;
    enableLocalCache: boolean;
    logLevel: 'debug' | 'info' | 'warning' | 'error';
  };
  
  // Database Configuration
  database: {
    useLocalSqlite: boolean;
    localSqliteDbName: string;
    syncStrategy: 'hybrid' | 'firebase-only' | 'local-only';
  };
  
  // Debug/Dev Options
  debug: {
    enableConsoleLogging: boolean;
    enableNetworkLogging: boolean;
    enableFirebaseLogging: boolean;
    enableDetailedErrors: boolean;
    skipFirebaseConnectionTests: boolean;
  };

  // Platform Detection (added for compatibility)
  isProd: boolean;
  isPlatformWeb: boolean;
  isPlatformNative: boolean;
  getPlatform(): Platform;
  isCapacitorApp(): boolean;
}

class EnvironmentManager {
  private static instance: EnvironmentManager;
  private config: EnvironmentConfig;

  private constructor() {
    this.config = this.initializeConfig();
    this.logConfiguration();
  }

  static getInstance(): EnvironmentManager {
    if (!EnvironmentManager.instance) {
      EnvironmentManager.instance = new EnvironmentManager();
    }
    return EnvironmentManager.instance;
  }

  private initializeConfig(): EnvironmentConfig {
    // Detect platform
    const platform = this.detectPlatform();
    const environment = this.detectEnvironment();
    const isDevelopment = environment === 'development';
    const isProduction = environment === 'production';
    const isNative = platform === 'android' || platform === 'ios';
    const isWeb = platform === 'web' || platform === 'electron';

    // Get backend URL based on platform
    const apiBaseUrl = '';

    const forceFirebaseConnectionTests = import.meta.env.VITE_FORCE_FIREBASE_TESTS === 'true';

    // Configure based on platform and environment
    const config: EnvironmentConfig = {
      platform,
      environment,
      isDevelopment,
      isProduction,
      isNative,
      isWeb,

      // API Configuration
      api: {
        baseUrl: apiBaseUrl,
        timeout: 60000,
        retryAttempts: isDevelopment ? 2 : 3,
        retryDelay: 1000,
      },

      // Firebase Configuration
      firebase: {
        // On Android: cache-first for better offline support
        // On Web: network-first for real-time data
        persistenceStrategy: isNative ? 'cache-first' : 'network-first',
        enableOfflineSupport: true,
        enableLocalCache: true,
        logLevel: isDevelopment ? 'debug' : 'warning',
      },

      // Database Configuration
      database: {
        // Use SQLite on native, IndexedDB on web
        useLocalSqlite: isNative,
        localSqliteDbName: 'gps_tracker.db',
        // Hybrid mode: sync when online, use local when offline
        syncStrategy: 'hybrid',
      },

      // Debug options
      debug: {
        enableConsoleLogging: isDevelopment,
        enableNetworkLogging: isDevelopment,
        enableFirebaseLogging: isDevelopment,
        enableDetailedErrors: isDevelopment,
        skipFirebaseConnectionTests: !forceFirebaseConnectionTests && isDevelopment,
      },

      // Platform detection methods for compatibility
      isProd: isProduction,
      isPlatformWeb: isWeb,
      isPlatformNative: isNative,
      getPlatform: () => platform,
      isCapacitorApp: () => isNative,
    };

    return config;
  }

  private detectPlatform(): Platform {
    if (typeof window === 'undefined') return 'web';

    try {
      const platformName = Capacitor.getPlatform();
      if (platformName === 'android') return 'android';
      if (platformName === 'ios') return 'ios';
      if (platformName === 'electron') return 'electron';
    } catch (_) {
      // Capacitor not available
    }

    // Check if running in Electron
    if ((window as any).electron) return 'electron';

    // Default to web
    return 'web';
  }

  private detectEnvironment(): Environment {
    // Check Vite environment variables
    if (import.meta.env.DEV) return 'development';
    if (import.meta.env.PROD) return 'production';
    return 'production';
  }

  private logConfiguration(): void {
    // Configuration logging disabled - use getConfig() to inspect if needed
  }

  getConfig(): Readonly<EnvironmentConfig> {
    return Object.freeze(this.config);
  }

  getPlatform(): Platform {
    return this.config.platform;
  }

  getEnvironment(): Environment {
    return this.config.environment;
  }

  isAndroid(): boolean {
    return this.config.platform === 'android';
  }

  isIOS(): boolean {
    return this.config.platform === 'ios';
  }

  isNative(): boolean {
    return this.config.isNative;
  }

  isWeb(): boolean {
    return this.config.isWeb;
  }

  isDevelopment(): boolean {
    return this.config.isDevelopment;
  }

  isProduction(): boolean {
    return this.config.isProduction;
  }

  getApiBaseUrl(): string {
    return this.config.api.baseUrl;
  }

  getFirebasePersistenceStrategy(): 'network-first' | 'cache-first' | 'memory-only' {
    return this.config.firebase.persistenceStrategy;
  }

  getDatabaseSyncStrategy(): 'hybrid' | 'firebase-only' | 'local-only' {
    return this.config.database.syncStrategy;
  }

  shouldUseSQLite(): boolean {
    return this.config.database.useLocalSqlite;
  }

  shouldEnableOfflineSupport(): boolean {
    return this.config.firebase.enableOfflineSupport;
  }

  log(category: string, message: string, data?: any): void {
    if (!this.config.debug.enableConsoleLogging) return;
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${category}] ${message}`, data ? data : '');
  }

  error(category: string, message: string, error?: any): void {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [${category}] ERROR: ${message}`, error ? error : '');
  }

  warn(category: string, message: string, data?: any): void {
    if (!this.config.debug.enableConsoleLogging) return;
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] [${category}] WARNING: ${message}`, data ? data : '');
  }

  // Hook used by Firebase helpers to optionally skip expensive connectivity checks
  shouldRunFirebaseConnectionTests(): boolean {
    return !(this.config as any).debug?.skipFirebaseConnectionTests;
  }
}

// Export singleton instance
export const environmentConfig = EnvironmentManager.getInstance();
