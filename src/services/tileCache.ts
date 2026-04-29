/**
 * Tile Cache Service
 * Caches map tiles in IndexedDB to avoid re-downloading them
 * Dramatically improves performance on tablets with slow connections
 */

interface CachedTile {
  key: string; // z/x/y
  url: string;
  blob: Blob;
  timestamp: number;
  expiresAt: number;
}

const DB_NAME = 'gps_tile_cache';
const STORE_NAME = 'tiles';
const CACHE_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

class TileCacheService {
  private db: IDBDatabase | null = null;
  private initialized = false;

  /**
   * Initialize the IndexedDB database for tile caching
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        this.initialized = true;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
    });
  }

  /**
   * Get a cached tile, or null if not found/expired
   */
  async getTile(z: number, x: number, y: number, url: string): Promise<Blob | null> {
    if (!this.db) await this.init();
    if (!this.db) return null;

    const key = `${url}/${z}/${x}/${y}`;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        const tile = request.result as CachedTile | undefined;
        if (tile && tile.expiresAt > Date.now()) {
          // Touch timestamp to keep it fresh
          this.updateTimestamp(key);
          resolve(tile.blob);
        } else if (tile) {
          // Expired, delete it
          this.deleteTile(key);
          resolve(null);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => resolve(null);
    });
  }

  /**
   * Cache a downloaded tile
   */
  async cacheTile(z: number, x: number, y: number, url: string, blob: Blob): Promise<void> {
    if (!this.db) await this.init();
    if (!this.db) return;

    const key = `${url}/${z}/${x}/${y}`;
    const tile: CachedTile = {
      key,
      url,
      blob,
      timestamp: Date.now(),
      expiresAt: Date.now() + CACHE_DURATION
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(tile);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update tile timestamp (for LRU tracking)
   */
  private async updateTimestamp(key: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        const tile = request.result as CachedTile | undefined;
        if (tile) {
          tile.timestamp = Date.now();
          store.put(tile);
          resolve();
        } else {
          resolve();
        }
      };

      request.onerror = () => resolve();
    });
  }

  /**
   * Delete a specific tile
   */
  private async deleteTile(key: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  }

  /**
   * Clear all cached tiles (for manual reset)
   */
  async clearCache(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ size: number; tileCount: number }> {
    if (!this.db) await this.init();
    if (!this.db) return { size: 0, tileCount: 0 };

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const tiles = request.result as CachedTile[];
        let totalSize = 0;
        tiles.forEach(tile => {
          totalSize += tile.blob.size;
        });
        resolve({ size: totalSize, tileCount: tiles.length });
      };

      request.onerror = () => resolve({ size: 0, tileCount: 0 });
    });
  }
}

export const tileCache = new TileCacheService();

/**
 * Fetch tile with caching - tries cache first, then network
 * Returns blob URL that can be used directly in img src
 */
export async function fetchTileWithCache(
  z: number,
  x: number,
  y: number,
  url: string
): Promise<string | null> {
  try {
    // Try cache first
    const cached = await tileCache.getTile(z, x, y, url);
    if (cached) {
      return URL.createObjectURL(cached);
    }

    // Fetch from network
    const response = await fetch(url, {
      method: 'GET',
      cache: 'force-cache' // Use browser cache aggressively
    });

    if (!response.ok) {
      console.warn(`[TileCache] Failed to fetch tile ${z}/${x}/${y}:`, response.status);
      return null;
    }

    const blob = await response.blob();

    // Cache the tile for future use
    await tileCache.cacheTile(z, x, y, url, blob);

    return URL.createObjectURL(blob);
  } catch (error) {
    console.warn(`[TileCache] Error fetching/caching tile ${z}/${x}/${y}:`, error);
    return null;
  }
}
