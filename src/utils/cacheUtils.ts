/**
 * Cache Utilities
 * Fixes Issue #25: Deduplicate cache save/load logic
 * 
 * Provides shared cache management functions used across database services:
 * - Unified save/load interface for IndexedDB and localStorage
 * - Automatic cache invalidation based on data type
 * - Consistent error handling
 * - Platform-aware storage selection
 */

import { indexedDBService } from '../services/indexedDBService';
import { CACHE_CONFIG } from '../config/constants';
import { logger } from '../services/logger';

export interface CachedData<T = any> {
  data: T;
  timestamp: number;
  version: string;
  checksum?: string; // For integrity checking
}

export interface CacheOptions {
  maxAge?: number; // milliseconds
  skipValidation?: boolean;
  forceRefresh?: boolean;
}

/**
 * Save data to cache with timestamp and version
 */
export async function saveToCache<T>(
  key: string,
  data: T,
  options: { version?: string } = {}
): Promise<void> {
  const cachedData: CachedData<T> = {
    data,
    timestamp: Date.now(),
    version: options.version || '1.0'
  };
  
  try {
    // Use IndexedDB on all platforms (web and native)
    if (indexedDBService.available()) {
      await indexedDBService.set(key, cachedData);
      logger.trace('Cache', `Saved to IndexedDB: ${key}`);
    } else {
      // Emergency fallback only
      try {
        localStorage.setItem(key, JSON.stringify(cachedData));
        logger.trace('Cache', `Saved to localStorage (fallback): ${key}`);
      } catch (quotaError) {
        logger.warn('Cache', `localStorage quota exceeded for ${key}`);
        throw quotaError;
      }
    }
  } catch (error) {
    logger.error('Cache', `Failed to save to cache: ${key}`, error);
    throw error;
  }
}

/**
 * Load data from cache with automatic invalidation
 */
export async function loadFromCache<T>(
  key: string,
  options: CacheOptions = {}
): Promise<T | null> {
  try {
    let value: any = null;
    
    // Use IndexedDB on all platforms (web and native)
    if (indexedDBService.available()) {
      value = await indexedDBService.get(key);
    } else {
      // Legacy/Fallback: Check localStorage
      const cached = localStorage.getItem(key);
      if (cached) {
        try {
          value = JSON.parse(cached);
        } catch {
          logger.warn('Cache', `Invalid JSON in localStorage cache: ${key}`);
          return null;
        }
      }
    }
    
    if (value === null || value === undefined) {
      return null;
    }
    
    // Handle timestamped cache data
    if (value && typeof value === 'object' && 'timestamp' in value && 'data' in value) {
      const cachedData = value as CachedData<T>;
      
      // Check if cache is fresh
      if (!options.forceRefresh && !options.skipValidation) {
        const maxAge = options.maxAge || getDefaultMaxAge(key);
        const age = Date.now() - cachedData.timestamp;
        
        if (age > maxAge) {
          logger.debug('Cache', `Cache expired for ${key}`, { 
            ageSeconds: Math.floor(age / 1000),
            maxAgeSeconds: Math.floor(maxAge / 1000)
          });
          return null; // Force refresh
        }
      }
      
      return cachedData.data;
    }
    
    // Legacy data without timestamp wrapper - return as-is
    logger.debug('Cache', `Legacy cache data (no timestamp): ${key}`);
    return value as T;
  } catch (error) {
    logger.error('Cache', `Failed to load from cache: ${key}`, error);
    return null;
  }
}

/**
 * Remove data from cache
 */
export async function removeFromCache(key: string): Promise<void> {
  try {
    // Use IndexedDB on all platforms
    if (indexedDBService.available()) {
      await indexedDBService.delete(key);
      logger.trace('Cache', `Removed from IndexedDB: ${key}`);
    }
    
    // Remove from localStorage cache
    try {
      localStorage.removeItem(key);
    } catch (error) {
      logger.warn('Cache', `Could not remove from localStorage: ${key}`);
    }
  } catch (error) {
    logger.error('Cache', `Failed to remove from cache: ${key}`, error);
    throw error;
  }
}

/**
 * Clear all cache data
 */
export async function clearAllCache(prefix?: string): Promise<number> {
  let cleared = 0;
  
  try {
    // Use IndexedDB on all platforms
    if (indexedDBService.available()) {
      // IndexedDB: Clear all or by prefix
      const keys = await indexedDBService.keys();
      for (const key of keys) {
        if (!prefix || key.startsWith(prefix)) {
          await indexedDBService.delete(key);
          cleared++;
        }
      }
    } else {
      // localStorage fallback
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (!prefix || key.startsWith(prefix))) {
          toRemove.push(key);
        }
      }
      toRemove.forEach(key => localStorage.removeItem(key));
      cleared = toRemove.length;
    }
    
    logger.info('Cache', `Cleared ${cleared} cache entries`, { prefix });
    return cleared;
  } catch (error) {
    logger.error('Cache', 'Failed to clear cache', error);
    throw error;
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(prefix?: string): Promise<{
  count: number;
  totalSize: number;
  oldestTimestamp: number;
  newestTimestamp: number;
}> {
  const stats = {
    count: 0,
    totalSize: 0,
    oldestTimestamp: Date.now(),
    newestTimestamp: 0
  };
  
  try {
    const isNative = isCapacitorApp();
    
    if (!isNative && indexedDBService.available()) {
      const keys = await indexedDBService.keys();
      
      for (const key of keys) {
        if (!prefix || key.startsWith(prefix)) {
          const value = await indexedDBService.get(key);
          if (value) {
            stats.count++;
            
            // Estimate size
            const size = JSON.stringify(value).length;
            stats.totalSize += size;
            
            // Track timestamps
            if (typeof value === 'object' && 'timestamp' in value) {
              const ts = value.timestamp as number;
              if (ts < stats.oldestTimestamp) stats.oldestTimestamp = ts;
              if (ts > stats.newestTimestamp) stats.newestTimestamp = ts;
            }
          }
        }
      }
    } else if (!isNative) {
      // localStorage fallback
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (!prefix || key.startsWith(prefix))) {
          const value = localStorage.getItem(key);
          if (value) {
            stats.count++;
            stats.totalSize += value.length;
            
            try {
              const parsed = JSON.parse(value);
              if (typeof parsed === 'object' && 'timestamp' in parsed) {
                const ts = parsed.timestamp as number;
                if (ts < stats.oldestTimestamp) stats.oldestTimestamp = ts;
                if (ts > stats.newestTimestamp) stats.newestTimestamp = ts;
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    }
    
    logger.debug('Cache', 'Cache statistics', stats);
    return stats;
  } catch (error) {
    logger.error('Cache', 'Failed to get cache stats', error);
    throw error;
  }
}

/**
 * Get default max age for cache key
 */
function getDefaultMaxAge(key: string): number {
  // Use constants from config
  if (key.includes('projects')) {
    return CACHE_CONFIG.PROJECT_CACHE_TTL;
  } else if (key.includes('tracks')) {
    return CACHE_CONFIG.TRACK_CACHE_TTL;
  } else if (key.includes('boundaries')) {
    return CACHE_CONFIG.BOUNDARY_CACHE_TTL;
  } else if (key.includes('devices')) {
    return CACHE_CONFIG.DEVICE_CACHE_TTL;
  }
  
  // Default: 1 hour
  return 60 * 60 * 1000;
}

/**
 * Check if cache entry exists
 */
export async function cacheExists(key: string): Promise<boolean> {
  try {
    const data = await loadFromCache(key, { skipValidation: true });
    return data !== null;
  } catch {
    return false;
  }
}

/**
 * Get cache age in milliseconds
 */
export async function getCacheAge(key: string): Promise<number | null> {
  try {
    const isNative = isCapacitorApp();
    let value: any = null;
    
    if (isNative) {
      value = await localDB.getItem(key);
    } else if (indexedDBService.available()) {
      value = await indexedDBService.get(key);
    } else {
      const cached = localStorage.getItem(key);
      if (cached) {
        value = JSON.parse(cached);
      }
    }
    
    if (value && typeof value === 'object' && 'timestamp' in value) {
      return Date.now() - (value.timestamp as number);
    }
    
    return null;
  } catch {
    return null;
  }
}
