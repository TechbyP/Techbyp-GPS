/**
 * Offline Tile Downloader Service
 * Downloads map tiles from your private server for offline use
 * 
 * Legal: Uses self-hosted tiles generated from OSM data
 */

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import type { OfflineMapPack } from '../config/offlineMapPacks';
import { getDefaultPack } from '../config/offlineMapPacks';
import { getBundledGermanyPmtilesUrl } from '../utils/tileUtils';

export interface DownloadProgress {
  current: number;
  total: number;
  percentage: number;
  status: 'downloading' | 'extracting' | 'complete' | 'error';
  message?: string;
}

export class OfflineTileDownloader {
  private tileServerUrl: string;
  private tileDownloadUrl: string;
  private localTilePath: string = 'tiles/packs';
  private legacyTilePath: string = 'tiles/germany/germany.pmtiles';

  constructor(serverUrl: string, downloadUrl: string) {
    this.tileServerUrl = serverUrl;
    this.tileDownloadUrl = downloadUrl;
  }

  /**
   * Download tile package from your server (PMTiles or MBTiles)
   */
  async downloadTilePackage(
    onProgress: (progress: DownloadProgress) => void,
    pack?: OfflineMapPack
  ): Promise<boolean> {
    try {
      const resolvedPack = pack || getDefaultPack();
      const downloadUrl = this.resolveDownloadUrl(resolvedPack);
      if (!downloadUrl) {
        throw new Error('No PMTiles URL configured. Set VITE_PMTILES_URL to a .pmtiles file.');
      }

      // Only works on native platform
      if (!Capacitor.isNativePlatform()) {
        console.warn('[TileDownloader] Can only download on native platform');
        return false;
      }

      // Check if already downloaded
      const exists = await this.checkTilesExist(resolvedPack);
      if (exists) {
        console.log('[TileDownloader] Tiles already downloaded');
        onProgress({
          current: 100,
          total: 100,
          percentage: 100,
          status: 'complete',
          message: 'Tiles already downloaded'
        });
        return true;
      }

      onProgress({
        current: 0,
        total: 100,
        percentage: 0,
        status: 'downloading',
        message: 'Starting download...'
      });

      // Download from your server
      const response = await fetch(downloadUrl, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
      }

      const totalSize = parseInt(response.headers.get('content-length') || '0');
      let downloadedSize = 0;
      const chunks: Uint8Array[] = [];

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Failed to get response reader');
      }

      // Read chunks with progress
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        chunks.push(value);
        downloadedSize += value.length;

        const percentage = totalSize > 0 ? (downloadedSize / totalSize) * 100 : 0;
        onProgress({
          current: downloadedSize,
          total: totalSize,
          percentage,
          status: 'downloading',
          message: totalSize > 0
            ? `Downloading: ${this.formatBytes(downloadedSize)} / ${this.formatBytes(totalSize)}`
            : `Downloading: ${this.formatBytes(downloadedSize)}`
        });
      }

      // Combine chunks
      onProgress({
        current: totalSize,
        total: totalSize,
        percentage: 100,
        status: 'extracting',
        message: 'Saving to device...'
      });

      const blob = new Blob(chunks);
      const arrayBuffer = await blob.arrayBuffer();
      const base64Data = this.arrayBufferToBase64(arrayBuffer);

      // Save to device
      await Filesystem.writeFile({
        path: this.getPackFilePath(resolvedPack),
        data: base64Data,
        directory: Directory.Data,
        recursive: true
      });

      onProgress({
        current: totalSize,
        total: totalSize,
        percentage: 100,
        status: 'complete',
        message: 'Download complete!'
      });

      console.log('[TileDownloader] ✓ Download complete');
      return true;

    } catch (error) {
      console.error('[TileDownloader] Download failed:', error);
      onProgress({
        current: 0,
        total: 100,
        percentage: 0,
        status: 'error',
        message: error instanceof Error ? error.message : 'Download failed'
      });
      return false;
    }
  }

  /**
   * Ensure bundled PMTiles are copied to local storage (native only)
   */
  async ensureBundledTiles(
    bundledUrl: string | undefined,
    pack?: OfflineMapPack,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<string | null> {
    if (!Capacitor.isNativePlatform()) return null;
    if (!bundledUrl) return null;

    const resolvedPack = pack || getDefaultPack();
    const exists = await this.checkTilesExist(resolvedPack);
    if (exists) {
      return this.getLocalTileHttpUrl(resolvedPack);
    }

    try {
      const response = await fetch(bundledUrl, { method: 'GET' });
      if (!response.ok || !response.body) {
        throw new Error('Failed to read bundled PMTiles');
      }

      const totalSize = parseInt(response.headers.get('content-length') || '0');
      let downloadedSize = 0;

      // Create empty file first
      await Filesystem.writeFile({
        path: this.getPackFilePath(resolvedPack),
        data: '',
        directory: Directory.Data,
        recursive: true
      });

      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        downloadedSize += value.length;
        const base64Chunk = this.arrayBufferToBase64(value.buffer);
        await Filesystem.appendFile({
          path: this.getPackFilePath(resolvedPack),
          data: base64Chunk,
          directory: Directory.Data
        });

        if (onProgress) {
          const percentage = totalSize > 0 ? (downloadedSize / totalSize) * 100 : 0;
          onProgress({
            current: downloadedSize,
            total: totalSize,
            percentage,
            status: 'downloading',
            message: totalSize > 0
              ? `Preparing offline maps: ${this.formatBytes(downloadedSize)} / ${this.formatBytes(totalSize)}`
              : `Preparing offline maps: ${this.formatBytes(downloadedSize)}`
          });
        }
      }

      if (onProgress) {
        onProgress({
          current: totalSize,
          total: totalSize,
          percentage: 100,
          status: 'complete',
          message: 'Offline maps ready'
        });
      }

      return this.getLocalTileHttpUrl(resolvedPack);
    } catch (error) {
      console.error('[TileDownloader] Failed to copy bundled PMTiles:', error);
      return null;
    }
  }

  /**
   * Check if tiles are already downloaded
   */
  async checkTilesExist(pack?: OfflineMapPack): Promise<boolean> {
    const resolvedPack = pack || getDefaultPack();
    if (!Capacitor.isNativePlatform()) {
      return false;
    }

    try {
      const result = await Filesystem.stat({
        path: this.getPackFilePath(resolvedPack),
        directory: Directory.Data
      });
      return result.size > 0;
    } catch {
      if (resolvedPack.id === 'niedersachsen') {
        try {
          const legacy = await Filesystem.stat({
            path: this.legacyTilePath,
            directory: Directory.Data
          });
          return legacy.size > 0;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  /**
   * Get local tile file URI
   */
  async getLocalTileUri(pack?: OfflineMapPack): Promise<string | null> {
    if (!Capacitor.isNativePlatform()) {
      return null;
    }

    const resolvedPack = pack || getDefaultPack();

    try {
      const result = await Filesystem.getUri({
        path: this.getPackFilePath(resolvedPack),
        directory: Directory.Data
      });
      return result.uri;
    } catch {
      if (resolvedPack.id === 'niedersachsen') {
        try {
          const legacy = await Filesystem.getUri({
            path: this.legacyTilePath,
            directory: Directory.Data
          });
          return legacy.uri;
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  /**
   * Get local tile URL usable by WebView (Capacitor)
   */
  async getLocalTileHttpUrl(pack?: OfflineMapPack): Promise<string | null> {
    const uri = await this.getLocalTileUri(pack);
    if (!uri) return null;
    return Capacitor.convertFileSrc(uri);
  }

  /**
   * Get tile file info (size, date)
   */
  async getTileInfo(pack?: OfflineMapPack): Promise<{ size: number; ctime: number } | null> {
    if (!Capacitor.isNativePlatform()) {
      return null;
    }

    const resolvedPack = pack || getDefaultPack();

    try {
      const result = await Filesystem.stat({
        path: this.getPackFilePath(resolvedPack),
        directory: Directory.Data
      });
      return {
        size: result.size,
        ctime: result.ctime
      };
    } catch {
      return null;
    }
  }

  /**
   * Delete downloaded tiles
   */
  async deleteTiles(): Promise<void> {
    try {
      await Filesystem.rmdir({
        path: this.localTilePath,
        directory: Directory.Data,
        recursive: true
      });
      console.log('[TileDownloader] ✓ Tiles deleted');
    } catch (error) {
      console.error('[TileDownloader] Failed to delete tiles:', error);
      throw error;
    }
  }

  /**
   * Format bytes to human readable
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Convert ArrayBuffer to base64
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192; // Process in chunks to avoid stack overflow
    
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.slice(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    
    return btoa(binary);
  }

  private resolveDownloadUrl(pack: OfflineMapPack): string | null {
    const packUrl = pack.downloadUrl || '';
    if (packUrl) {
      if (packUrl.endsWith('.pmtiles')) return packUrl;
      return `${packUrl.replace(/\/$/, '')}/${this.getPackFileName(pack)}`;
    }
    if (this.tileDownloadUrl) {
      if (this.tileDownloadUrl.endsWith('.pmtiles')) return this.tileDownloadUrl;
      return `${this.tileDownloadUrl.replace(/\/$/, '')}/${this.getPackFileName(pack)}`;
    }
    if (!this.tileServerUrl) return null;
    if (this.tileServerUrl.endsWith('.pmtiles')) return this.tileServerUrl;
    return `${this.tileServerUrl.replace(/\/$/, '')}/${this.getPackFileName(pack)}`;
  }

  private getPackFileName(pack: OfflineMapPack): string {
    return pack.fileName || `${pack.id}.pmtiles`;
  }

  private getPackFilePath(pack: OfflineMapPack): string {
    return `${this.localTilePath}/${this.getPackFileName(pack)}`;
  }
}

// Singleton instance
// TODO: Replace with your server URL after setting up tile hosting
export const tileDownloader = new OfflineTileDownloader(
  getBundledGermanyPmtilesUrl() || '',
  (import.meta.env.VITE_PMTILES_DOWNLOAD_URL as string | undefined) || ''
);
