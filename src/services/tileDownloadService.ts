/**
 * On-demand tile download service
 * Downloads map tiles dynamically when user navigates to areas without offline coverage
 */

import { Capacitor } from '@capacitor/core';

interface TileCoordinate {
  x: number;
  y: number;
  zoom: number;
}

interface TileBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

// Lower Saxony bounds (pre-downloaded offline tiles)
const LOWER_SAXONY_BOUNDS: TileBounds = {
  north: 53.9,
  south: 51.3,
  east: 11.6,
  west: 6.7
};

// Track downloaded tiles
const downloadedTiles = new Set<string>();
const downloadQueue = new Map<string, Promise<void>>();

// Tile template (self-hosted only). Must be configured via VITE_ONLINE_TILE_URL.
const ONLINE_TILE_TEMPLATE = (import.meta.env.VITE_ONLINE_TILE_URL as string | undefined) || '';

/**
 * Check if coordinates are within Lower Saxony (offline coverage area)
 */
function isInLowerSaxony(lat: number, lon: number): boolean {
  return (
    lat >= LOWER_SAXONY_BOUNDS.south &&
    lat <= LOWER_SAXONY_BOUNDS.north &&
    lon >= LOWER_SAXONY_BOUNDS.west &&
    lon <= LOWER_SAXONY_BOUNDS.east
  );
}

/**
 * Convert lat/lon to tile coordinates
 */
function latLonToTile(lat: number, lon: number, zoom: number): TileCoordinate {
  const latRad = (lat * Math.PI) / 180;
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);
  return { x, y, zoom };
}

/**
 * Convert tile coordinates to lat/lon bounds
 */
function tileToBounds(x: number, y: number, zoom: number): TileBounds {
  const n = Math.pow(2, zoom);
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const northRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const southRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  const north = (northRad * 180) / Math.PI;
  const south = (southRad * 180) / Math.PI;
  return { north, south, east, west };
}

/**
 * Get unique key for tile
 */
function getTileKey(x: number, y: number, zoom: number): string {
  return `${zoom}/${x}/${y}`;
}

/**
 * Download a single tile and cache it
 */
async function downloadTile(x: number, y: number, zoom: number): Promise<void> {
  const key = getTileKey(x, y, zoom);
  
  // Check if already downloaded
  if (downloadedTiles.has(key)) {
    return;
  }

  // Check if already downloading
  if (downloadQueue.has(key)) {
    return downloadQueue.get(key);
  }

  // Start download
  const downloadPromise = (async () => {
    try {
      if (!ONLINE_TILE_TEMPLATE) {
        throw new Error('No online tile template configured (VITE_ONLINE_TILE_URL).');
      }

      const url = ONLINE_TILE_TEMPLATE
        .replace('{z}', String(zoom))
        .replace('{x}', String(x))
        .replace('{y}', String(y));
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to download tile: ${response.status}`);
      }

      const blob = await response.blob();
      
      // Cache in IndexedDB or localStorage
      await cacheTile(key, blob);
      
      downloadedTiles.add(key);
      console.log(`[TileDownload] ✅ Downloaded tile: ${key}`);
    } catch (error) {
      console.error(`[TileDownload] ❌ Failed to download tile ${key}:`, error);
    } finally {
      downloadQueue.delete(key);
    }
  })();

  downloadQueue.set(key, downloadPromise);
  return downloadPromise;
}

/**
 * Cache tile in IndexedDB
 */
async function cacheTile(key: string, blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('MapTilesCache', 1);
    
    request.onerror = () => reject(request.error);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('tiles')) {
        db.createObjectStore('tiles');
      }
    };
    
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['tiles'], 'readwrite');
      const store = transaction.objectStore('tiles');
      
      const putRequest = store.put(blob, key);
      
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    };
  });
}

/**
 * Get cached tile from IndexedDB
 */
export async function getCachedTile(x: number, y: number, zoom: number): Promise<Blob | null> {
  const key = getTileKey(x, y, zoom);
  
  return new Promise((resolve) => {
    const request = indexedDB.open('MapTilesCache', 1);
    
    request.onerror = () => resolve(null);
    
    request.onsuccess = () => {
      const db = request.result;
      
      if (!db.objectStoreNames.contains('tiles')) {
        resolve(null);
        return;
      }
      
      const transaction = db.transaction(['tiles'], 'readonly');
      const store = transaction.objectStore('tiles');
      const getRequest = store.get(key);
      
      getRequest.onsuccess = () => {
        resolve(getRequest.result || null);
      };
      
      getRequest.onerror = () => resolve(null);
    };
  });
}

/**
 * Request tiles for a map viewport
 * Downloads tiles outside Lower Saxony on-demand
 */
export async function requestTilesForViewport(
  bounds: TileBounds,
  zoom: number,
  maxZoom: number = 15
): Promise<void> {
  // Only download up to max zoom
  if (zoom > maxZoom) {
    zoom = maxZoom;
  }

  // Get center of viewport
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLon = (bounds.east + bounds.west) / 2;

  // Check if we're in Lower Saxony
  if (isInLowerSaxony(centerLat, centerLon)) {
    // Already have offline tiles
    return;
  }

  // Calculate which tiles are visible
  const topLeft = latLonToTile(bounds.north, bounds.west, zoom);
  const bottomRight = latLonToTile(bounds.south, bounds.east, zoom);

  console.log(`[TileDownload] Requesting tiles for viewport outside Lower Saxony (zoom ${zoom})`);

  // Download visible tiles
  const downloadPromises: Promise<void>[] = [];
  
  for (let x = topLeft.x; x <= bottomRight.x; x++) {
    for (let y = topLeft.y; y <= bottomRight.y; y++) {
      downloadPromises.push(downloadTile(x, y, zoom));
      
      // Limit concurrent downloads
      if (downloadPromises.length >= 6) {
        await Promise.all(downloadPromises);
        downloadPromises.length = 0;
      }
    }
  }

  // Wait for remaining downloads
  if (downloadPromises.length > 0) {
    await Promise.all(downloadPromises);
  }
}

/**
 * Clear tile cache
 */
export async function clearTileCache(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('MapTilesCache');
    request.onsuccess = () => {
      downloadedTiles.clear();
      console.log('[TileDownload] ✅ Tile cache cleared');
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get cache statistics
 */
export async function getTileCacheStats(): Promise<{ count: number; sizeEstimate: string }> {
  return new Promise((resolve) => {
    const request = indexedDB.open('MapTilesCache', 1);
    
    request.onerror = () => resolve({ count: 0, sizeEstimate: '0 MB' });
    
    request.onsuccess = () => {
      const db = request.result;
      
      if (!db.objectStoreNames.contains('tiles')) {
        resolve({ count: 0, sizeEstimate: '0 MB' });
        return;
      }
      
      const transaction = db.transaction(['tiles'], 'readonly');
      const store = transaction.objectStore('tiles');
      const countRequest = store.count();
      
      countRequest.onsuccess = () => {
        const count = countRequest.result;
        const sizeEstimate = ((count * 15) / 1024).toFixed(2) + ' MB'; // ~15KB per tile
        resolve({ count, sizeEstimate });
      };
      
      countRequest.onerror = () => resolve({ count: 0, sizeEstimate: '0 MB' });
    };
  });
}

export default {
  requestTilesForViewport,
  getCachedTile,
  clearTileCache,
  getTileCacheStats
};
