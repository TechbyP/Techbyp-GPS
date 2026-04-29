/**
 * IndexedDB Storage Service
 * Primary offline storage for all platforms (replaced SQLite)
 * Automatically syncs to Firebase when online
 */

import { Capacitor } from '@capacitor/core';

interface StoredItem {
  key: string;
  data: any;
  timestamp: number;
  synced: boolean;
}

class IndexedDBService {
  private static instance: IndexedDBService;
  private dbName = 'gps_tracker_web';
  private storeName = 'local_data';
  private db: IDBDatabase | null = null;
  private isAvailable: boolean = false;
  private initPromise: Promise<void> | null = null;
  private initAttempted: boolean = false;

  private constructor() {
    this.checkAvailability();
  }

  static getInstance(): IndexedDBService {
    if (!IndexedDBService.instance) {
      IndexedDBService.instance = new IndexedDBService();
    }
    return IndexedDBService.instance;
  }

  private checkAvailability(): void {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      this.isAvailable = false;
      console.warn('[IndexedDB] Not available in this environment');
      return;
    }

    // Don't use IndexedDB on native (Capacitor handles this)
    if (Capacitor.getPlatform() !== 'web') {
      this.isAvailable = false;
      console.log('[IndexedDB] Native platform detected, skipping IndexedDB');
      return;
    }

    this.isAvailable = true;
    // Don't initialize immediately - wait for first use
  }

  private async initializeDB(): Promise<void> {
    if (!this.isAvailable) {
      throw new Error('IndexedDB not available');
    }

    // Return existing initialization promise if already in progress
    if (this.initPromise) {
      return this.initPromise;
    }

    // Already initialized successfully
    if (this.db && this.initAttempted) {
      return Promise.resolve();
    }

    this.initAttempted = true;

    this.initPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, 1);

        request.onerror = () => {
          console.error('[IndexedDB] Failed to open database:', request.error);
          this.isAvailable = false;
          this.initPromise = null;
          reject(request.error);
        };

        request.onsuccess = () => {
          this.db = request.result;
          this.initPromise = null;
          resolve();
        };

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          
          if (!db.objectStoreNames.contains(this.storeName)) {
            const store = db.createObjectStore(this.storeName, { keyPath: 'key' });
            store.createIndex('synced', 'synced', { unique: false });
            store.createIndex('timestamp', 'timestamp', { unique: false });
            console.log('[IndexedDB] Object store created');
          }
        };
      }).catch(error => {
        console.error('[IndexedDB] Initialization failed:', error);
        this.isAvailable = false;
        this.initPromise = null;
        throw error;
      });

    return this.initPromise;
  }

  /**
   * Ensure DB is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.db || !this.initAttempted) {
      await this.initializeDB();
    }
  }

  /**
   * Store data in IndexedDB
   */
  async set(key: string, data: any): Promise<void> {
    if (!this.isAvailable) {
      throw new Error('IndexedDB not available');
    }

    try {
      await this.ensureInitialized();

      return new Promise((resolve, reject) => {
        if (!this.db) {
          reject(new Error('Database not initialized'));
          return;
        }

        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);

        const item: StoredItem = {
          key,
          data,
          timestamp: Date.now(),
          synced: false,
        };

        const request = store.put(item);

        request.onerror = () => {
          console.error('[IndexedDB] Failed to store data:', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          resolve();
        };
      });
    } catch (error) {
      console.error('[IndexedDB] Storage error:', error);
      throw error;
    }
  }

  /**
   * Retrieve data from IndexedDB
   */
  async get(key: string): Promise<any | null> {
    if (!this.isAvailable) {
      console.warn('[IndexedDB] Not available, cannot retrieve');
      return null;
    }

    try {
      await this.ensureInitialized();

      return new Promise((resolve, reject) => {
        if (!this.db) {
          reject(new Error('Database not initialized'));
          return;
        }

        const transaction = this.db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(key);

        request.onerror = () => {
          console.error('[IndexedDB] Failed to retrieve data:', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          if (request.result) {
            resolve(request.result.data);
          } else {
            resolve(null);
          }
        };
      });
    } catch (error) {
      console.error('[IndexedDB] Retrieval error:', error);
      throw error;
    }
  }

  /**
   * Get all unsynced items
   */
  async getUnsyncedItems(): Promise<StoredItem[]> {
    if (!this.isAvailable) {
      return [];
    }

    try {
      if (!this.db) {
        await this.initializeDB();
      }

      return new Promise((resolve, reject) => {
        if (!this.db) {
          reject(new Error('Database not initialized'));
          return;
        }

        const transaction = this.db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const index = store.index('synced');
        // Query for items where synced = false
        const range = IDBKeyRange.only(false);
        const request = index.getAll(range);

        request.onerror = () => {
          console.error('[IndexedDB] Failed to get unsynced items:', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          console.log(`[IndexedDB] Found ${request.result.length} unsynced items`);
          resolve(request.result);
        };
      });
    } catch (error) {
      console.error('[IndexedDB] Error getting unsynced items:', error);
      return [];
    }
  }

  /**
   * Mark item as synced
   */
  async markSynced(key: string): Promise<void> {
    if (!this.isAvailable) {
      return;
    }

    try {
      if (!this.db) {
        await this.initializeDB();
      }

      return new Promise((resolve, reject) => {
        if (!this.db) {
          reject(new Error('Database not initialized'));
          return;
        }

        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(key);

        request.onerror = () => {
          console.error('[IndexedDB] Failed to mark synced:', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          if (request.result) {
            request.result.synced = true;
            const updateRequest = store.put(request.result);
            
            updateRequest.onerror = () => reject(updateRequest.error);
            updateRequest.onsuccess = () => {
              console.log(`[IndexedDB] Marked as synced: ${key}`);
              resolve();
            };
          } else {
            resolve();
          }
        };
      });
    } catch (error) {
      console.error('[IndexedDB] Error marking synced:', error);
    }
  }

  /**
   * Delete data from IndexedDB
   */
  async delete(key: string): Promise<void> {
    if (!this.isAvailable) {
      return;
    }

    try {
      if (!this.db) {
        await this.initializeDB();
      }

      return new Promise((resolve, reject) => {
        if (!this.db) {
          reject(new Error('Database not initialized'));
          return;
        }

        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.delete(key);

        request.onerror = () => {
          console.error('[IndexedDB] Failed to delete data:', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          console.log(`[IndexedDB] Deleted: ${key}`);
          resolve();
        };
      });
    } catch (error) {
      console.error('[IndexedDB] Deletion error:', error);
    }
  }

  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    if (!this.isAvailable) {
      return;
    }

    try {
      if (!this.db) {
        await this.initializeDB();
      }

      return new Promise((resolve, reject) => {
        if (!this.db) {
          reject(new Error('Database not initialized'));
          return;
        }

        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.clear();

        request.onerror = () => {
          console.error('[IndexedDB] Failed to clear data:', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          console.log('[IndexedDB] All data cleared');
          resolve();
        };
      });
    } catch (error) {
      console.error('[IndexedDB] Clear error:', error);
    }
  }

  /**
   * Get all keys in the database
   */
  async getAllKeys(): Promise<string[]> {
    if (!this.isAvailable) {
      return [];
    }

    try {
      if (!this.db) {
        await this.initializeDB();
      }

      return new Promise((resolve, reject) => {
        if (!this.db) {
          reject(new Error('Database not initialized'));
          return;
        }

        const transaction = this.db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.getAllKeys();

        request.onerror = () => {
          console.error('[IndexedDB] Failed to get all keys:', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          const keys = request.result.map(k => String(k));
          resolve(keys);
        };
      });
    } catch (error) {
      console.error('[IndexedDB] Error getting all keys:', error);
      return [];
    }
  }

  /**
   * Check if IndexedDB is available
   */
  available(): boolean {
    return this.isAvailable;
  }

  /**
   * Get database size estimation
   */
  async getStorageInfo(): Promise<{ usage: number; quota: number } | null> {
    if (!this.isAvailable || !navigator.storage) {
      return null;
    }

    try {
      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage || 0,
        quota: estimate.quota || 0,
      };
    } catch (error) {
      console.error('[IndexedDB] Failed to get storage info:', error);
      return null;
    }
  }
}

export const indexedDBService = IndexedDBService.getInstance();
