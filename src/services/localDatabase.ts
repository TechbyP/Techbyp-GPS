/**
 * Local Database - SQLite Removed
 * 
 * SQLite has been completely removed from this app due to connection conflicts.
 * All storage now uses IndexedDB on all platforms (web and Android).
 * 
 * This file remains as a compatibility layer that returns empty/null values.
 * Actual storage is handled by indexedDBService.ts
 */

import type { GpsProject, GpsTrackDetail, GpsFieldBoundary, GpsDevice } from '../types';

class LocalDatabase {
  constructor() {
    // LocalDatabase initialized - using IndexedDB for all storage
  }

  /**
   * Generic key-value store - returns null (not used, IndexedDB is used instead)
   */
  async setItem(_key: string, _value: any): Promise<void> {
    // No-op: IndexedDB is used via indexedDBService
    return;
  }

  async getItem<T = any>(_key: string): Promise<T | null> {
    // Returns null: IndexedDB is used via indexedDBService
    return null;
  }

  async removeItem(_key: string): Promise<void> {
    // No-op: IndexedDB is used via indexedDBService
    return;
  }

  async clear(): Promise<void> {
    // No-op: IndexedDB is used via indexedDBService
    return;
  }

  async getAllKeys(): Promise<string[]> {
    // Returns empty: IndexedDB is used via indexedDBService
    return [];
  }

  /**
   * Project methods - return empty arrays (Firestore is the source of truth)
   */
  async getProjects(): Promise<GpsProject[]> {
    return [];
  }

  async getProject(_id: string): Promise<GpsProject | null> {
    return null;
  }

  async saveProject(_project: GpsProject): Promise<void> {
    return;
  }

  async deleteProject(_id: string): Promise<void> {
    return;
  }

  /**
   * Track methods - return empty arrays (Firestore is the source of truth)
   */
  async getTracks(_projectId?: string): Promise<GpsTrackDetail[]> {
    return [];
  }

  async getTrack(_id: string): Promise<GpsTrackDetail | null> {
    return null;
  }

  async saveTrack(_track: GpsTrackDetail): Promise<void> {
    return;
  }

  async deleteTrack(_id: string): Promise<void> {
    return;
  }

  /**
   * Boundary methods - return empty arrays (Firestore is the source of truth)
   */
  async getBoundaries(_projectId?: string): Promise<GpsFieldBoundary[]> {
    return [];
  }

  async getBoundary(_id: string): Promise<GpsFieldBoundary | null> {
    return null;
  }

  async saveBoundary(_boundary: GpsFieldBoundary): Promise<void> {
    return;
  }

  async deleteBoundary(_id: string): Promise<void> {
    return;
  }

  /**
   * Device methods - return empty arrays (Firestore is the source of truth)
   */
  async getDevices(): Promise<GpsDevice[]> {
    return [];
  }

  async getDevice(_id: string): Promise<GpsDevice | null> {
    return null;
  }

  async saveDevice(_device: GpsDevice): Promise<void> {
    return;
  }

  async deleteDevice(_id: string): Promise<void> {
    return;
  }

  /**
   * Sync queue methods - not used (direct Firestore sync)
   */
  async getSyncQueue(): Promise<any[]> {
    return [];
  }

  async addToSyncQueue(_item: any): Promise<void> {
    return;
  }

  async removeFromSyncQueue(_id: string): Promise<void> {
    return;
  }

  async clearSyncQueue(): Promise<void> {
    return;
  }

  /**
   * Cleanup methods - no-op
   */
  async clearAllData(): Promise<void> {
    console.log('LocalDB: clearAllData called (no-op, using IndexedDB)');
    return;
  }

  async close(): Promise<void> {
    return;
  }

  async cleanup(): Promise<void> {
    return;
  }
}

// Export singleton instance
export const localDB = new LocalDatabase();
export default localDB;
