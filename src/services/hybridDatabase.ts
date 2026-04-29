// Hybrid Database Service
// Automatically uses Firebase when online, local storage when offline
// Syncs local changes to Firebase when connection is restored
// Uses IndexedDB on all platforms (web and Android tablet)

import { firebaseGPS } from './firebaseSync';
import { auth } from '../firebase';
import { indexedDBService } from './indexedDBService';
import { environmentConfig } from '../config/environment';
import { isCapacitorApp } from '../utils/platform';
import { normalizeBoundary, normalizeBoundaries } from '../utils/boundaries';
import { normalizeGeometry, isValidGeoJSONGeometry } from '../utils/geometryUtils';
import { buildBoundaryRenderMeta } from '../utils/boundaryRenderMeta';
import { TIMEOUTS, withTimeout } from '../config/timeouts';
import { ErrorHandler } from '../utils/errors';
import { DatabaseStateMachine, DatabaseState } from './databaseStateMachine';
import { ConflictResolver } from './conflictResolver';
import { categorizeError, logCategorizedError, isRetriableError } from '../utils/errorCategories';
import { dbLogger } from './logger';
import { SYNC_QUEUE, CACHE_CONFIG, ID_PREFIXES, generateLocalId } from '../config/constants';
import { isOnline as checkOnlineStatus } from '../utils/networkStatus';
import type { GpsFieldBoundary, GpsFieldSample } from '../types';

interface SyncQueueItem {
  id: string;
  type: 'project' | 'track' | 'point' | 'sample' | 'field_sample' | 'boundary' | 'device';
  action: 'create' | 'update' | 'delete';
  data: any;
  timestamp: number;
  attempts: number;
  nextAttemptAt: number;
  checksum?: string;
  priority?: number; // 1=urgent, 2=high, 3=normal, 4=low
}

const MAX_QUEUE_ITEMS = 1000;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 60000;

/**
 * Create a timestamp that works for both local storage and Firestore
 * Returns ISO string for consistency across all platforms and types
 */
function createSerializableTimestamp(millis?: number): string {
  return new Date(millis || Date.now()).toISOString();
}

class HybridDatabaseService {
  // Use async network check instead of navigator.onLine
  private async checkIsOnline(): Promise<boolean> {
    try {
      return await checkOnlineStatus();
    } catch {
      // Fallback to navigator.onLine if network check fails
      return navigator.onLine;
    }
  }
  
  private get isOnline(): boolean {
    // Synchronous getter for backwards compatibility
    // Note: This will be slightly delayed, use checkIsOnline() for accurate checks
    return navigator.onLine;
  }
  
  private get isBackendAvailable(): boolean {
    return this.isOnline && this.backendOnline;
  }
  
  // Fast offline detection for tablets - avoids timeouts
  private get isDefinitelyOffline(): boolean {
    // If navigator says we're offline, we're definitely offline
    if (!navigator.onLine) return true;
    
    // Don't assume offline too quickly if navigator says we're online
    if (!this.backendOnline) {
      const timeSinceProbe = Date.now() - this.lastConnectivityCheck;
      // Allow retry after 30 seconds
      const maxWaitMs = 30000;
      
      // If we've waited long enough OR navigator is online, allow retry
      if (timeSinceProbe > maxWaitMs || navigator.onLine) {
        // Don't block if navigator says online - let connectivity check decide
        if (navigator.onLine && timeSinceProbe > 10000) {
          return false; // Allow retry if online
        }
      }
      
      // Only declare definitely offline if we've tried recently and failed
      return this.connectivityBackoffMs >= 20000 && timeSinceProbe < maxWaitMs;
    }
    
    return false;
  }
  
  private backendOnline: boolean = false;
  private syncQueue: SyncQueueItem[] = [];
  private uid: string = '';
  private healthCheckInterval: number | null = null;
  private connectivityCheckTimer: number | null = null;
  private connectivityBackoffMs: number = 10000;
  private lastConnectivityCheck: number = 0;
  private readonly connectivityBackoffMaxMs: number = 60000;
  // Using IndexedDB for all platforms (web + Android tablet)
  // IndexedDB provides better performance and reliability
  private transactionLock: boolean = false;
  private transactionQueue: Array<() => void> = [];
  private eventListeners: Array<{ event: string; handler: () => void }> = [];
  private stateMachine: DatabaseStateMachine = new DatabaseStateMachine();
  private conflictResolver: ConflictResolver = new ConflictResolver('server-wins'); // Ready for Phase 2 sync conflict resolution
  private isSyncing: boolean = false;
  private syncStartTime: number = 0; // Track when sync started
  private queueCleanupTimer: number | null = null;
  private periodicSyncTimer: number | null = null;
  private queuePersistTimer: number | null = null;
  private queuePersistInFlight: boolean = false;
  // Debounce maps to prevent duplicate background syncs
  private ongoingProjectSync: Promise<void> | null = null;
  private ongoingBoundarySync: Map<string, Promise<void>> = new Map();
  private ongoingBoundaryRenderMetaBackfill: Map<string, Promise<void>> = new Map();
  private ongoingTrackSync: Map<string, Promise<void>> = new Map();
  private readonly boundaryRenderMetaBackfillVersion: number = 1;
  
  // User-scoped storage keys
  private get SYNC_QUEUE_KEY() {
    return `gps_sync_queue_${this.uid}`;
  }
  
  private get LOCAL_DATA_PREFIX() {
    return `gps_local_${this.uid}_`;
  }

  /**
   * Snapshot of the current sync queue for UI/debug.
   * Returns a shallow copy with only safe fields to render.
   */
  getSyncQueueSnapshot(limit: number = 50): Array<Pick<SyncQueueItem, 'id' | 'type' | 'action' | 'timestamp' | 'attempts' | 'nextAttemptAt'>> {
    return this.syncQueue
      .slice(0, limit)
      .map(item => ({
        id: item.id,
        type: item.type,
        action: item.action,
        timestamp: item.timestamp,
        attempts: item.attempts,
        nextAttemptAt: item.nextAttemptAt
      }));
  }
  
  constructor(uid?: string) {
    this.uid = uid || '';
    
    // Monitor online/offline status with tracked listeners
    const onlineHandler = () => this.handleOnline();
    const offlineHandler = () => this.handleOffline();
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
    this.eventListeners.push(
      { event: 'online', handler: onlineHandler },
      { event: 'offline', handler: offlineHandler }
    );
    
    // Initialize async (non-blocking)
    this.initialize().catch(error => {
      console.error('[HybridDB] Initialization error:', error);
    });
  }
  
  /**
   * Async initialization with startup integrity checks
   */
  private async initialize(): Promise<void> {
    this.stateMachine.transition(DatabaseState.INITIALIZING, 'Starting database initialization');

    // Load sync queue from persistent storage
    await this.loadSyncQueue();

    // Run startup integrity checks
    await this.runStartupIntegrityChecks();

    // Start backend health checks
    this.startHealthChecks();

    // Start background sync loop
    this.startBackgroundSync();

    // ✅ PRIORITY 5 FIX: Start periodic sync queue cleanup
    this.startQueueCleanup();

    // CRITICAL FIX: Start periodic cache refresh to sync deletions from other devices
    this.startPeriodicSync();

    // Try immediate sync if online (non-blocking)
    if (this.isBackendAvailable && this.syncQueue.length > 0) {
      setTimeout(() => this.syncToFirebaseNonBlocking(), 100);
    }

    this.stateMachine.transition(DatabaseState.CONNECTED, 'Initialization complete');
  }

  /**
   * Transaction wrapper to prevent race conditions
   * Ensures atomic operations across storage layers
   */
  private async withTransaction<T>(operation: () => Promise<T>): Promise<T> {
    // Acquire lock
    while (this.transactionLock) {
      await new Promise<void>(resolve => {
        this.transactionQueue.push(resolve);
      });
    }
    
    this.transactionLock = true;
    
    try {
      const result = await operation();
      return result;
    } finally {
      // Release lock
      this.transactionLock = false;
      
      // Process queue
      const next = this.transactionQueue.shift();
      if (next) {
        next();
      }
    }
  }

  /**
   * Calculate checksum for sync queue item integrity
   */
  private calculateChecksum(item: Omit<SyncQueueItem, 'checksum'>): string {
    const data = JSON.stringify({
      id: item.id,
      type: item.type,
      action: item.action,
      timestamp: item.timestamp
    });
    
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  /**
   * Validate sync queue item structure
   */
  private validateQueueItem(item: any): item is SyncQueueItem {
    const baseValid = (
      item &&
      typeof item.id === 'string' &&
      !item.id.includes('[object Object]') &&
      ['project', 'track', 'point', 'sample', 'field_sample', 'boundary', 'device'].includes(item.type) &&
      ['create', 'update', 'delete'].includes(item.action) &&
      item.data &&
      typeof item.timestamp === 'number' &&
      typeof item.attempts === 'number' &&
      typeof item.nextAttemptAt === 'number'
    );

    if (!baseValid) {
      return false;
    }

    const needsTrackId = (item.type === 'sample' || item.type === 'point') && item.action === 'create';
    if (!needsTrackId) {
      return true;
    }

    const rawTrackId = item.data?.track_id;
    if (typeof rawTrackId === 'string') {
      const normalized = rawTrackId.trim();
      if (!normalized || normalized === '[object Object]') {
        return false;
      }
      item.data.track_id = normalized;
      return true;
    }

    if (rawTrackId && typeof rawTrackId === 'object' && typeof rawTrackId.id === 'string') {
      const normalized = rawTrackId.id.trim();
      if (!normalized || normalized === '[object Object]') {
        return false;
      }
      item.data.track_id = normalized;
      return true;
    }

    return false;
  }

  /**
   * Clear user storage helper
   */
  /**
   * Save boundary to project cache
   */
  private async saveBoundaryToCache(projectId: string, boundary: GpsFieldBoundary) {
    const cachedRaw = await this.getLocalHydrated<any[]>('boundaries', `project_${projectId}`);
    const existing = normalizeBoundaries(cachedRaw || []);
    const updated = [...existing.filter(b => b.id?.toString() !== boundary.id?.toString()), boundary];
    await this.saveLocal('boundaries', `project_${projectId}`, updated);
  }

  private async findCachedBoundary(boundaryId: string): Promise<{ boundary: GpsFieldBoundary | null; cacheKey?: string }> {
    const prefix = `${this.LOCAL_DATA_PREFIX}boundaries_`;
    const allKeys = await this.getStorageKeysByPrefix(prefix);
    const boundaryKeys = allKeys.filter(key => key.startsWith(prefix));

    for (const key of boundaryKeys) {
      const cacheId = key.substring(prefix.length);
      const cachedRaw = await this.getLocalHydrated<any[]>('boundaries', cacheId);
      const normalized = normalizeBoundaries(cachedRaw || []);
      const found = normalized.find(b => b.id?.toString() === boundaryId.toString());
      if (found) {
        return { boundary: found, cacheKey: cacheId };
      }
    }

    return { boundary: null };
  }

  private async getStorageKeysByPrefix(prefix: string): Promise<string[]> {
    const keys = new Set<string>();

    try {
      if (indexedDBService.available()) {
        const indexedKeys = await indexedDBService.getAllKeys();
        indexedKeys.forEach(key => {
          if (key.startsWith(prefix)) {
            keys.add(key);
          }
        });
      }
    } catch (error) {
      console.warn('[HybridDB] Failed to read IndexedDB keys for prefix scan:', error);
    }

    try {
      Object.keys(localStorage)
        .filter(key => key.startsWith(prefix))
        .forEach(key => keys.add(key));
    } catch (error) {
      console.warn('[HybridDB] Failed to read localStorage keys for prefix scan:', error);
    }

    return Array.from(keys);
  }

  private async migrateLegacyLocalStorageToIndexedDB(): Promise<void> {
    if (!this.uid || !indexedDBService.available()) {
      return;
    }

    const migrationKey = `${this.LOCAL_DATA_PREFIX}migration_v1`;

    try {
      const alreadyMigrated = await indexedDBService.get(migrationKey);
      if (alreadyMigrated?.completed === true) {
        return;
      }
    } catch {
      // Continue migration if migration marker cannot be read
    }

    try {
      const keysToMigrate = Object.keys(localStorage).filter((key) =>
        key.startsWith(this.LOCAL_DATA_PREFIX) ||
        key === this.SYNC_QUEUE_KEY ||
        key === `${this.SYNC_QUEUE_KEY}_backup`
      );

      if (keysToMigrate.length === 0) {
        await indexedDBService.set(migrationKey, {
          completed: true,
          migratedKeys: 0,
          completedAt: Date.now()
        });
        return;
      }

      let migratedKeys = 0;

      for (const key of keysToMigrate) {
        const raw = localStorage.getItem(key);
        if (raw === null) continue;

        let parsed: any = raw;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }

        await indexedDBService.set(key, parsed);
        migratedKeys += 1;

        try {
          localStorage.removeItem(key);
        } catch {
          // Ignore cleanup failures
        }
      }

      await indexedDBService.set(migrationKey, {
        completed: true,
        migratedKeys,
        completedAt: Date.now()
      });

      console.log(`[HybridDB] Migrated ${migratedKeys} legacy localStorage keys to IndexedDB`);
    } catch (error) {
      console.warn('[HybridDB] Legacy localStorage migration failed:', error);
    }
  }

  async setUserId(uid: string): Promise<void> {
    // ✅ ISSUE #14 FIX: Validate UID before accepting
    if (uid && typeof uid !== 'string') {
      console.error('[HybridDB] Invalid UID type:', typeof uid);
      throw new Error('User ID must be a string');
    }
    
    if (uid && uid.length > 0 && uid.length < 10) {
      console.warn('[HybridDB] Suspiciously short UID:', uid);
      // Still allow but log warning
    }
    
    if (uid && !/^[a-zA-Z0-9_-]+$/.test(uid)) {
      console.error('[HybridDB] UID contains invalid characters:', uid);
      throw new Error('User ID contains invalid characters');
    }

    // Clear old user's data before switching - ONLY if different user
    if (this.uid && this.uid !== uid) {
      const previousUid = this.uid;
      console.log('[HybridDB] User changed from', previousUid, 'to', uid, '- clearing old user data');
      await this.clearUserStorage(previousUid);
      this.syncQueue = [];
      // Also clear the NEW user's project cache to force fresh fetch
      // This ensures admin always sees current data when switching users
      this.uid = uid;
      await this.removeLocal('projects', 'all');
      console.log('[HybridDB] Cleared project cache for new user to force fresh fetch');
    } else if (this.uid === uid) {
      return;
    } else {
      this.uid = uid;
    }

    // Load new user's sync queue
    if (uid) {
      await this.migrateLegacyLocalStorageToIndexedDB();
      await this.loadSyncQueue();

      // CRITICAL FIX: Make connectivity check and sync non-blocking for faster UI load
      if (navigator.onLine) {
        // Fire all in background without blocking
        void this.refreshConnectivity(true).then((result) => {
          if (result.success) {
            // Fire immediate sync (reduced delay)
            setTimeout(() => this.syncToFirebaseNonBlocking(), 100);
            // Also trigger background project sync (reduced delay)
            setTimeout(() => {
              this.syncProjectsInBackground().catch(_err => 
                console.warn('[HybridDB] Post-login project sync failed')
              );
            }, 300);
          }
        }).catch(err => {
          console.warn('[HybridDB] Post-login connectivity check failed:', err);
        });
      }
    } else {
      // Clearing user completely (logout)
      this.syncQueue = [];
    }
  }

  /**
   * Wipe user-scoped cache and queues across all storage layers during account switch.
   */
  private async clearUserStorage(userId: string): Promise<void> {
    if (!userId) return;

    // Clear sync queue key immediately
    const oldQueueKey = `gps_sync_queue_${userId}`;
    try { localStorage.removeItem(oldQueueKey); } catch (err) { console.warn('[HybridDB] Failed to remove old queue key from localStorage', err); }

    // Clear localStorage caches scoped to the user
    const prefix = `gps_local_${userId}_`;
    try {
      const allKeys = Object.keys(localStorage);
      allKeys.forEach(key => {
        if (key.startsWith(prefix) || key === `gps_projects_${userId}`) {
          localStorage.removeItem(key);
        }
      });
    } catch (err) {
      console.warn('[HybridDB] Failed to clear localStorage for user', err);
    }

    // Clear IndexedDB entries for this specific user only (not the entire database)
    if (indexedDBService.available()) {
      try {
        // Get all keys and delete only those belonging to this user
        const allKeys = await indexedDBService.getAllKeys();
        for (const key of allKeys) {
          if (typeof key === 'string' && (key.startsWith(prefix) || key === oldQueueKey)) {
            await indexedDBService.delete(key);
          }
        }
        console.log('[HybridDB] Cleared IndexedDB caches for previous user:', userId);
      } catch (err) {
        console.warn('[HybridDB] Failed to clear IndexedDB for previous user', err);
      }
    }
  }

  // Debug function to test Firebase connectivity
  async testFirebaseConnection() {
    if (!environmentConfig.shouldRunFirebaseConnectionTests()) {
      return { success: true, duration: 0, skipped: true };
    }

    if (!this.uid) {
      console.error('[HybridDB] Cannot test connection - no user ID');
      return { success: false, error: 'No user ID' };
    }
    
    console.log('[HybridDB] Testing Firebase connection...');
    try {
      const result = await firebaseGPS.testConnection(this.uid);
      console.log('[HybridDB] Firebase connection test result:', result);
      return result;
    } catch (error: any) {
      console.error('[HybridDB] Firebase connection test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Background sync for projects (non-blocking)
 private async syncProjectsInBackground(): Promise<void> {
    // Debounce: If already syncing, return existing promise
    if (this.ongoingProjectSync) {
      return this.ongoingProjectSync;
    }
    
    this.ongoingProjectSync = (async () => {
      try {
        // Background sync started - logging suppressed to reduce console spam
        const projects = await firebaseGPS.getProjects(this.uid);
        
        if (projects.length > 0) {
          // Background sync received projects - logging suppressed
        
        // Get existing cached projects from IndexedDB
        const existingProjects = await this.getLocalHydrated('projects', 'all') || [];
        
        // Create a map of Firebase projects by ID
        const firebaseMap = new Map(projects.map((p: any) => [p.id, p]));
        
        // Keep local-only projects (not synced yet)
        const localOnlyProjects = existingProjects.filter((p: any) => 
          String(p.id).startsWith('local_') && !firebaseMap.has(p.id)
        );
        
        // Merge Firebase projects with local-only projects
        const mergedProjects = [...projects, ...localOnlyProjects];
        
        // Deduplicate by ID
        const uniqueProjects = Array.from(
          new Map(mergedProjects.map((p: any) => [p.id, p])).values()
        );
          
        await this.saveLocal('projects', 'all', uniqueProjects);
        }
        
        // Background sync completed - logging suppressed to reduce console spam
        // Note: Not emitting sync-complete event to prevent infinite reload loops
        // UI will get updated data on next manual refresh or component mount
      } catch (error: any) {
      console.warn('[HybridDB] Background sync failed:', error.message);
      // Don't throw - this is background sync, failure is acceptable
    } finally {
      // Clear debounce flag
      this.ongoingProjectSync = null;
    }
    })();
    
    return this.ongoingProjectSync;
  }

  private async startHealthChecks() {
    const isCapacitor = isCapacitorApp();

    // Clear any existing timer before scheduling
      if (this.connectivityCheckTimer) {
        clearInterval(this.connectivityCheckTimer);
      }

    // Start with an immediate probe, then schedule with backoff
    this.backendOnline = false;
    this.connectivityBackoffMs = 10000;
    void this.refreshConnectivity(true).finally(() => this.scheduleConnectivityCheck());
  }

  private scheduleConnectivityCheck(force: boolean = false) {
    if (this.connectivityCheckTimer) {
      clearTimeout(this.connectivityCheckTimer);
    }

    this.connectivityCheckTimer = window.setTimeout(async () => {
      const result = await this.refreshConnectivity(force);
      if (result.success) {
        this.connectivityBackoffMs = 10000;
      } else {
        this.connectivityBackoffMs = Math.min(this.connectivityBackoffMs * 2, this.connectivityBackoffMaxMs);
      }
      this.scheduleConnectivityCheck();
    }, this.connectivityBackoffMs);
  }

  private handleOnline() {
    console.log('[SYNC] 🌐 Internet connection restored - checking Firebase connectivity');
    this.stateMachine.transition(DatabaseState.CONNECTED, 'Network online');
    
    // Reset backoff to allow immediate connectivity check
    this.connectivityBackoffMs = 10000;
    this.lastConnectivityCheck = 0; // Force fresh check
    
    // Force connectivity check to update isBackendAvailable
    void this.refreshConnectivity(true).then((result) => {
      if (result.success) {
        console.log('[SYNC] ✅ Firebase connectivity confirmed, backend online');
        this.backendOnline = true;
        
        // Trigger immediate sync if we have queued items
        if (this.syncQueue.length > 0) {
          console.log(`[SYNC] 🔄 Triggering immediate sync for ${this.syncQueue.length} queued items`);
          // Multiple sync attempts to ensure data gets through
          setTimeout(() => this.syncToFirebaseNonBlocking(), 100);
          setTimeout(() => this.syncToFirebaseNonBlocking(), 2000); // Backup after 2s
          setTimeout(() => this.syncToFirebaseNonBlocking(), 5000); // Another after 5s
        }
      } else {
        console.warn('[SYNC] ⚠️ Network online but Firebase unreachable:', result.error);
        // Keep trying with scheduled checks
        this.backendOnline = false;
        // Schedule retry in 3 seconds
        setTimeout(() => {
          console.log('[SYNC] 🔁 Retrying Firebase connectivity...');
          void this.refreshConnectivity(true);
        }, 3000);
      }
    });
  }

  private handleOffline() {
    console.log('[OFFLINE] Internet connection lost - using local storage');
    this.stateMachine.transition(DatabaseState.OFFLINE, 'Network offline');
    // this.isOnline = false; // Removed: isOnline is now a getter
    this.backendOnline = false;
    
    // Clear connectivity check timer to prevent unnecessary checks
    if (this.connectivityCheckTimer) {
      clearTimeout(this.connectivityCheckTimer);
      this.connectivityCheckTimer = null;
    }
  }

  /**
   * Mark backend as offline and back off connectivity checks to prevent repeated slow attempts
   */
  private markBackendOffline(reason?: string) {
    // Avoid false offline flips when the device is online and errors are likely auth/data issues
    const reasonText = reason || '';
    const isNetworkish = /timeout|unavailable|offline|network|failed|fetch/i.test(reasonText);

    if (navigator.onLine && !isNetworkish) {
      // Stay online but schedule a probe to verify
      console.warn('[SYNC] Skipping offline flip (navigator online, non-network error):', reasonText);
      this.lastConnectivityCheck = Date.now();
      if (!this.connectivityCheckTimer) {
        this.scheduleConnectivityCheck(true);
      }
      return;
    }

    if (this.backendOnline) {
      console.warn('[SYNC] Backend marked offline', reasonText);
    }
    this.backendOnline = false;
    this.lastConnectivityCheck = Date.now();
    // Increase backoff so the UI stops waiting on repeated Firebase timeouts when internet is absent
    this.connectivityBackoffMs = Math.min(
      Math.max(this.connectivityBackoffMs, 10000) * 2,
      this.connectivityBackoffMaxMs
    );

    // Ensure a connectivity probe is scheduled even if previous timer was cleared
    if (!this.connectivityCheckTimer) {
      this.scheduleConnectivityCheck(true);
    }
  }

  // Quick Firebase reachability check that does not require auth
  async refreshConnectivity(force: boolean = false) {
    
    if (!navigator.onLine) {
      this.backendOnline = false;
      this.lastConnectivityCheck = Date.now();
      console.log('[HybridDB] Navigator reports offline');
      return { success: false, error: 'Navigator offline' };
    }

    const result = await firebaseGPS.ping();
    this.lastConnectivityCheck = Date.now();
    
    if (result.success) {
      this.backendOnline = true;
      
      // Trigger immediate sync if we have queued items - faster reconnection
      if (this.syncQueue.length > 0) {
        setTimeout(() => this.syncToFirebaseNonBlocking(), 50); // Reduced from 100ms to 50ms
      }
    } else if (force) {
      // Only mark offline if this was a forced check - prevents transient errors
      // from flipping backend status unnecessarily
      this.backendOnline = false;
      console.warn('[HybridDB] ⚠️ Firebase connectivity check failed:', result.error);
    }
    // Note: non-forced checks don't change backend status to prevent transient errors
    return result;
  }

  /**
   * Run startup integrity checks to ensure database consistency
   * Verifies essential storage is available and working
   */
  private async runStartupIntegrityChecks(): Promise<void> {
    try {
      // Check 1: Verify IndexedDB storage is accessible
      if (indexedDBService.available()) {
        try {
          await indexedDBService.set('integrity_test', { test: true });
          const result = await indexedDBService.get('integrity_test');
          if (!result) {
            console.error('[Integrity] IndexedDB read/write test failed');
          } else {
            // IndexedDB integrity verified
          }
          await indexedDBService.delete('integrity_test');
        } catch (error) {
          console.error('[Integrity] IndexedDB integrity check failed:', error);
        }
      }
      
      // Check 2: Verify sync queue is valid
      const invalidItems = this.syncQueue.filter(item => 
        !item || !item.id || !item.type || !item.action
      );
      if (invalidItems.length > 0) {
        console.warn(`[Integrity] Found ${invalidItems.length} invalid sync queue items - cleaning`);
        this.syncQueue = this.syncQueue.filter(item => 
          item && item.id && item.type && item.action
        );
        await this.saveSyncQueue();
      }
      
      // Check 3: Remove corrupted localStorage entries
      try {
        const corruptedKeys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(this.LOCAL_DATA_PREFIX)) {
            try {
              const value = localStorage.getItem(key);
              if (value) {
                JSON.parse(value); // Test if valid JSON
              }
            } catch {
              corruptedKeys.push(key);
            }
          }
        }
        if (corruptedKeys.length > 0) {
          console.warn(`[Integrity] Found ${corruptedKeys.length} corrupted cache entries - removing`);
          corruptedKeys.forEach(key => localStorage.removeItem(key));
        }
      } catch (error) {
        console.error('[Integrity] Cache cleanup failed:', error);
      }
    } catch (error) {
      console.error('[Integrity] Startup checks failed:', error);
    }
  }
  
  /**
   * Load sync queue from persistent storage (transactional)
   * Order: IndexedDB (web) -> localStorage (fallback)
   */
  private async loadSyncQueue(): Promise<void> {
    try {
      let loaded = false;
      let rawQueue: any[] = [];
      
      // Load from IndexedDB as primary
      if (indexedDBService.available()) {
        try {
          const stored = await indexedDBService.get(this.SYNC_QUEUE_KEY);
          if (Array.isArray(stored) && stored.length > 0) {
            rawQueue = stored;
            loaded = true;
            console.log(`[SYNC] Loaded ${stored.length} items from IndexedDB`);
          }
        } catch (error) {
          console.error('[SYNC] Failed to load from IndexedDB:', error);
        }
      }

      // Fallback: localStorage
      if (!loaded) {
        try {
          const queue = localStorage.getItem(this.SYNC_QUEUE_KEY);
          if (queue) {
            const parsed = JSON.parse(queue);
            if (Array.isArray(parsed)) {
              rawQueue = parsed;
              console.log(`[SYNC] Loaded ${parsed.length} items from localStorage (fallback)`);
            }
          }
        } catch (error) {
          console.error('[SYNC] Failed to load from localStorage:', error);
        }
      }
      
      // Validate and filter queue items with checksum verification
      const validItems: SyncQueueItem[] = [];
      const corruptedItems: any[] = [];
      
      for (const item of rawQueue) {
        if (this.validateQueueItem(item)) {
          // Verify checksum if present
          if (item.checksum) {
            const expectedChecksum = this.calculateChecksum(item);
            if (expectedChecksum !== item.checksum) {
              corruptedItems.push({ item, reason: 'checksum_mismatch' });
              continue;
            }
          }
          validItems.push(item);
        } else {
          corruptedItems.push({ item, reason: 'invalid_structure' });
        }
      }
      
      this.syncQueue = validItems;
      
      // Log corruption
      if (corruptedItems.length > 0) {
        console.error(`[SYNC] Found ${corruptedItems.length} corrupted queue items`, corruptedItems);
        ErrorHandler.handle(
          new Error(`Sync queue corruption detected: ${corruptedItems.length} items`),
          true
        );
      }
      
      this.trimSyncQueue();
      console.log(`[SYNC] Queue initialized with ${validItems.length} valid items`);
    } catch (error) {
      console.error('[SYNC] Critical error loading sync queue:', error);
      ErrorHandler.handle(error instanceof Error ? error : new Error(String(error)));
      this.syncQueue = []; // Reset to empty on critical error
    }
  }

  /**
   * Save sync queue to persistent storage (atomic operation)
   * Ensures data integrity even if app crashes
   */
  private async saveSyncQueue(): Promise<void> {
    try {
      this.trimSyncQueue();
      
      // Add checksums to all items
      const queueWithChecksums = this.syncQueue.map(item => ({
        ...item,
        checksum: this.calculateChecksum(item)
      }));
      
      // Atomic snapshot
      const queueSnapshot = [...queueWithChecksums];
      
      // Atomic save with temp file pattern
      const tempKey = `${this.SYNC_QUEUE_KEY}_temp`;
      const backupKey = `${this.SYNC_QUEUE_KEY}_backup`;
      
      // IndexedDB as primary, localStorage as backup
      let indexedDBSuccess = false;
      if (indexedDBService.available()) {
        try {
          // Save to temp first
          await indexedDBService.set(tempKey, queueSnapshot);
          
          // Backup existing
          const existing = await indexedDBService.get(this.SYNC_QUEUE_KEY);
          if (existing) {
            await indexedDBService.set(backupKey, existing);
          }
          
          // Move temp to main
          await indexedDBService.set(this.SYNC_QUEUE_KEY, queueSnapshot);
          
          // Cleanup temp
          await indexedDBService.delete(tempKey);
          
          indexedDBSuccess = true;
          console.log(`[SYNC] Queue (${queueSnapshot.length} items) persisted to IndexedDB`);
        } catch (error) {
          console.error('[SYNC] Failed to persist to IndexedDB:', error);
          ErrorHandler.handle(error instanceof Error ? error : new Error(String(error)), true);
        }
      }

      // Always save to localStorage as backup (unless full)
      try {
        localStorage.setItem(this.SYNC_QUEUE_KEY, JSON.stringify(queueSnapshot));
        if (!indexedDBSuccess) {
          console.log(`[SYNC] Queue persisted to localStorage (primary)`);
        }
      } catch (error) {
        if (!indexedDBSuccess) {
          console.error('[SYNC] CRITICAL: Failed to persist queue anywhere:', error);
          ErrorHandler.handle(error instanceof Error ? error : new Error('Failed to persist sync queue'));
        }
      }
    } catch (error) {
      console.error('[SYNC] Error saving sync queue:', error);
      ErrorHandler.handle(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private trimSyncQueue() {
    if (this.syncQueue.length > MAX_QUEUE_ITEMS) {
      // Keep the newest entries, drop oldest first
      this.syncQueue = this.syncQueue.slice(-MAX_QUEUE_ITEMS);
    }
  }

  /**
   * ✅ PRIORITY 5 FIX: Clean up stale sync queue items
   * Removes items older than 7 days with multiple failed attempts
   */
  private async cleanupSyncQueue(): Promise<void> {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    const originalLength = this.syncQueue.length;
    
    // Remove items older than 7 days with >10 failed attempts
    this.syncQueue = this.syncQueue.filter(item => {
      const age = now - item.timestamp;
      const tooOld = age > maxAge && (item.attempts || 0) > 10;
      if (tooOld) {
        console.warn('[SYNC] Removing stale queue item:', {
          id: item.id,
          type: item.type,
          age: Math.floor(age / (24 * 60 * 60 * 1000)) + ' days',
          attempts: item.attempts
        });
      }
      return !tooOld;
    });
    
    if (this.syncQueue.length < originalLength) {
      const removed = originalLength - this.syncQueue.length;
      console.log(`[SYNC] Cleaned up ${removed} stale queue items`);
      await this.saveSyncQueue();
    }
  }

  /**
   * Start periodic queue cleanup (runs daily)
   */
  /**
   * Refresh local data from Firebase after successful sync
   * This ensures the local cache matches the server state
   */
  private async refreshDataFromFirebase(): Promise<void> {
    if (!this.uid || !this.isBackendAvailable) {
      console.log('[SYNC] Skipping data refresh - no UID or backend unavailable');
      return;
    }
    
    try {
      console.log('[SYNC] Fetching fresh projects from Firebase...');
      const projects = await firebaseGPS.getProjects(this.uid);
      
      if (projects && projects.length > 0) {
        console.log(`[SYNC] ✅ Fetched ${projects.length} projects from Firebase`);
        
        // Update IndexedDB cache with fresh data
        const uniqueProjects = Array.from(
          new Map((projects as any[]).map((p: any) => [p.id, p])).values()
        );
        await this.saveLocal('projects', 'all', uniqueProjects);
        
        console.log('[SYNC] ✅ Local cache updated with fresh Firebase data');
        
        // CRITICAL FIX: Also refresh tracks for each project to ensure track cache is current
        // This prevents tracks from disappearing after they sync to Firebase
        for (const project of uniqueProjects) {
          try {
            const projectId = (project as any).id;
            console.log(`[SYNC] Refreshing tracks for project ${projectId}...`);
            await this.syncTracksInBackground(projectId);
          } catch (trackError) {
            console.warn(`[SYNC] Failed to refresh tracks for project ${(project as any).id}:`, trackError);
            // Continue with other projects even if one fails
          }
        }
        
        console.log('[SYNC] ✅ All project tracks refreshed');
      }
    } catch (error: any) {
      console.warn('[SYNC] Failed to refresh data from Firebase:', error.message);
      throw error;
    }
  }

  private startQueueCleanup() {
    // Run cleanup daily
    this.queueCleanupTimer = setInterval(() => {
      this.cleanupSyncQueue().catch(err => 
        console.error('[SYNC] Queue cleanup failed:', err)
      );
    }, 24 * 60 * 60 * 1000) as unknown as number;
    
    // Run initial cleanup after 5 minutes
    setTimeout(() => {
      this.cleanupSyncQueue().catch(err => 
        console.error('[SYNC] Initial queue cleanup failed:', err)
      );
    }, 5 * 60 * 1000);
    
  }

  /**
   * CRITICAL FIX: Periodic sync to keep cache fresh and detect deletions from other devices
   * Runs every 5 minutes when app is active
   */
  private startPeriodicSync() {
    // Refresh tracks every 5 minutes when app is active
    const periodicSyncInterval = setInterval(async () => {
      // CRITICAL FIX: Run periodic sync even when backend marked offline but navigator online
      // This helps clear ghost tracks that were deleted on other devices
      const shouldSync = this.uid && (this.isBackendAvailable || navigator.onLine);
      
      if (!shouldSync) {
        return;
      }
      
      // If backend marked offline but device online, try connectivity refresh first
      if (!this.isBackendAvailable && navigator.onLine) {
        console.log('[HybridDB] Periodic sync: Backend offline but navigator online - refreshing connectivity...');
        await this.refreshConnectivity(true);
        if (!this.isBackendAvailable) {
          console.warn('[HybridDB] Periodic sync: Backend still offline after refresh, skipping');
          return;
        }
      }
      
      try {
        console.log('[HybridDB] Running periodic sync to detect changes from other devices...');
        const projects = await this.getLocalHydrated('projects', 'all') || [];
        
        for (const project of projects) {
          try {
            await this.syncTracksInBackground(project.id);
          } catch (error) {
            console.warn(`[HybridDB] Periodic sync failed for project ${project.id}:`, error);
          }
        }
        
        console.log('[HybridDB] Periodic track sync completed successfully');
      } catch (error) {
        console.warn('[HybridDB] Periodic sync failed:', error);
      }
    }, 5 * 60 * 1000); // Every 5 minutes
    
    // Store timer reference for cleanup
    this.periodicSyncTimer = periodicSyncInterval as unknown as number;
  }

  private addToSyncQueue(item: Omit<SyncQueueItem, 'timestamp' | 'attempts' | 'nextAttemptAt'>) {
    // Assign priority based on action type
    const priority = item.priority || this.getItemPriority(item.action, item.type);
    
    const queueItem: SyncQueueItem = {
      ...item,
      priority,
      timestamp: Date.now(),
      attempts: 0,
      nextAttemptAt: 0
    };
    this.syncQueue.push(queueItem);
    this.trimSyncQueue();
    this.scheduleSyncQueuePersist();
    
    console.log('[SYNC] Item added to sync queue', {
      type: item.type,
      action: item.action,
      priority,
      queueSize: this.syncQueue.length,
      uid: this.uid ? 'SET' : 'EMPTY'
    });
    
    dbLogger.debug('Item added to sync queue', {
      type: item.type,
      action: item.action,
      priority,
      queueSize: this.syncQueue.length
    });
  }

  private scheduleSyncQueuePersist(delayMs: number = 250) {
    if (this.queuePersistTimer) {
      clearTimeout(this.queuePersistTimer);
    }

    this.queuePersistTimer = window.setTimeout(() => {
      this.queuePersistTimer = null;
      void this.flushSyncQueuePersist();
    }, delayMs);
  }

  private async flushSyncQueuePersist() {
    if (this.queuePersistInFlight) {
      this.scheduleSyncQueuePersist(200);
      return;
    }

    this.queuePersistInFlight = true;
    try {
      await this.saveSyncQueue();
    } finally {
      this.queuePersistInFlight = false;
    }
  }

  /**
   * Determine sync priority for an operation
   */
  private getItemPriority(action: string, type: string): number {
    // Deletions are urgent - prevent data resurrection
    if (action === 'delete') {
      return SYNC_QUEUE.PRIORITY.URGENT;
    }
    
    // User-initiated creates/updates are high priority
    if (action === 'create' || action === 'update') {
      // Projects and tracks are higher priority than GPS points
      if (type === 'project' || type === 'track') {
        return SYNC_QUEUE.PRIORITY.HIGH;
      }
      return SYNC_QUEUE.PRIORITY.NORMAL;
    }
    
    return SYNC_QUEUE.PRIORITY.LOW;
  }

  private async syncToFirebase() {
    if (!this.isBackendAvailable || this.syncQueue.length === 0) {
      console.log('[SYNC] syncToFirebase early exit', {
        isBackendAvailable: this.isBackendAvailable,
        queueLength: this.syncQueue.length
      });
      return;
    }
    
    // Safety: adopt UID from Firebase auth if missing
    if (!this.uid && auth?.currentUser?.uid) {
      this.uid = auth.currentUser.uid;
      console.log('[SYNC] Adopted UID from Firebase auth (blocking sync):', this.uid);
    }

    if (!this.uid) {
      console.error('[SYNC] ❌ Cannot sync - UID is empty!');
      // Retry shortly in case auth propagation is delayed
      setTimeout(() => {
        if (!this.uid && auth?.currentUser?.uid) {
          this.uid = auth.currentUser.uid;
          console.log('[SYNC] Retry adopted UID from Firebase auth (blocking sync):', this.uid);
        }
        void this.syncToFirebase();
      }, 1000);
      return;
    }

    console.log(`[SYNC] Processing ${this.syncQueue.length} items to Firebase`, {
      uid: this.uid,
      queueItems: this.syncQueue.map(i => ({ 
        type: i.type, 
        action: i.action, 
        id: i.id,
        name: i.data?.name || '',
        projectId: i.data?.project_id || '',
        trackId: i.data?.track_id || '',
        attempts: i.attempts || 0,
        backoffUntil: i.nextAttemptAt ? new Date(i.nextAttemptAt).toISOString() : null
      }))
    });
    
    const errors: any[] = [];

    // Sort queue by priority (lower number = higher priority)
    const sortedQueue = [...this.syncQueue].sort((a, b) => {
      const priorityDiff = (a.priority || 3) - (b.priority || 3);
      if (priorityDiff !== 0) return priorityDiff;
      
      // CRITICAL FIX: Within same priority, sync tracks before their points/samples
      // This ensures track_id references are valid when points/samples sync
      const aIsTrack = a.type === 'track' && a.action === 'create';
      const bIsTrack = b.type === 'track' && b.action === 'create';
      const aIsChild = (a.type === 'point' || a.type === 'sample') && a.action === 'create';
      const bIsChild = (b.type === 'point' || b.type === 'sample') && b.action === 'create'; // FIXED: was a.action
      
      if (aIsTrack && bIsChild) return -1; // Track before children
      if (bIsTrack && aIsChild) return 1;  // Track before children
      if (bIsTrack && aIsChild) return 1;  // Track before children
      
      // Same priority and type: older items first
      return a.timestamp - b.timestamp;
    });

    const skippedItems: any[] = [];
    const processedItems: any[] = [];
    
    for (const item of sortedQueue) {
      // CRITICAL: Remove items that have failed too many times (corrupted data)
      const MAX_ATTEMPTS = 50;
      if (item.attempts && item.attempts >= MAX_ATTEMPTS) {
        console.error(`[SYNC] ❌ Removing ${item.type} ${item.action} (id: ${item.id}) - exceeded ${MAX_ATTEMPTS} attempts`);
        console.error(`[SYNC] This item is likely corrupted and will never sync successfully`);
        this.syncQueue = this.syncQueue.filter(i => i.id !== item.id);
        errors.push({ 
          item, 
          error: new Error(`Exceeded maximum retry attempts (${MAX_ATTEMPTS})`), 
          attempts: item.attempts, 
          backoff: 0 
        });
        continue;
      }
      
      // Backoff handling: skip until nextAttemptAt
      if (item.nextAttemptAt && item.nextAttemptAt > Date.now()) {
        const waitTime = Math.round((item.nextAttemptAt - Date.now()) / 1000);
        console.log(`[SYNC] ⏳ Skipping ${item.type} ${item.action} (backing off for ${waitTime}s, attempt ${item.attempts || 0})`);
        skippedItems.push(item);
        continue;
      }

      try {
        await this.processSyncItem(item);
        console.log(`[SYNC] ✅ Successfully synced ${item.type} ${item.action} (id: ${item.id})`);
        // Remove from queue on success
        const beforeLength = this.syncQueue.length;
        this.syncQueue = this.syncQueue.filter(i => i.id !== item.id);
        const afterLength = this.syncQueue.length;
        console.log(`[SYNC] Queue size: ${beforeLength} → ${afterLength}`);
        processedItems.push(item);
      } catch (error: any) {
        console.error(`[SYNC] ❌ Failed to sync ${item.type} ${item.action}:`, {
          id: item.id,
          error: error.message,
          code: error.code,
          stack: error.stack,
          item: item
        });
        dbLogger.error('Error syncing item', error, {
          type: item.type,
          action: item.action,
          attempts: item.attempts
        });
        const attempts = (item.attempts || 0) + 1;
        const backoff = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempts - 1), BACKOFF_MAX_MS);
        item.attempts = attempts;
        item.nextAttemptAt = Date.now() + backoff;
        console.warn(`[SYNC] Will retry ${item.type} ${item.action} in ${backoff}ms (attempt ${attempts}/${MAX_ATTEMPTS})`);
        errors.push({ item, error, attempts, backoff });
      }
    }

    console.log(`[SYNC] Summary: ${processedItems.length} processed, ${errors.length} failed, ${skippedItems.length} skipped`);
    console.log(`[SYNC] Queue before save: ${this.syncQueue.length} items`);
    
    try {
      this.saveSyncQueue();
      console.log(`[SYNC] ✅ Queue saved successfully`);
    } catch (saveError: any) {
      console.error(`[SYNC] ❌ Failed to save queue:`, saveError.message);
    }
    
    // Only dispatch sync event if we actually synced items successfully
    const successCount = processedItems.length - errors.length;
    
    if (successCount > 0) {
      dbLogger.info(`${successCount} items synced successfully`);
      console.log(`[SYNC] ✅✅✅ Successfully synced ${successCount} items - dispatching sync-complete event`);
      
      // After successful upload, pull fresh data from Firebase to ensure cache is current
      console.log('[SYNC] 🔄 Pulling fresh data from Firebase after successful sync...');
      void this.refreshDataFromFirebase().then(() => {
        console.log('[SYNC] ✅ Data refreshed from Firebase');
        
        // Emit sync complete event to trigger UI updates
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('hybriddb-sync-complete', {
            detail: { syncedItems: successCount }
          }));
          console.log(`[SYNC] 📢 Event dispatched: hybriddb-sync-complete (${successCount} items)`);
        }
      }).catch(err => {
        console.error('[SYNC] ❌ Failed to refresh data after sync:', err.message, err);
        // Still emit event even if refresh fails - UI will use cached data
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('hybriddb-sync-complete', {
            detail: { syncedItems: successCount }
          }));
          console.log(`[SYNC] 📢 Event dispatched despite refresh failure: hybriddb-sync-complete (${successCount} items)`);
        }
      });
    } else if (errors.length > 0 && processedItems.length > 0) {
      console.warn(`[SYNC] ⚠️ Partial sync: ${successCount} succeeded, ${errors.length} failed - NOT dispatching event`);
    } else if (sortedQueue.length === 0) {
      console.log('[SYNC] 📭 No items to sync (empty queue)');
    } else if (skippedItems.length === sortedQueue.length) {
      console.log(`[SYNC] 📭 All ${skippedItems.length} items in backoff - nothing to process yet`);
    } else {
      console.warn(`[SYNC] ${errors.length} items failed to sync - will retry on next connection`);
    }
  }

  private syncTimer: number | null = null;
  
  /**
   * Start background sync with exponential backoff
   * Runs periodically and on connectivity changes
   */
  private startBackgroundSync() {
    // Clear existing timer
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
    
    
    // Sync every 30 seconds - balances data safety with battery/network efficiency
    this.syncTimer = setInterval(() => {
      // Safety check: if sync has been running for more than 90 seconds, force reset
      if (this.isSyncing && this.syncStartTime > 0) {
        const syncDuration = Date.now() - this.syncStartTime;
        if (syncDuration > 90000) { // 90 seconds
          console.error('[SYNC] ⚠️ STUCK SYNC DETECTED - Sync has been running for', Math.round(syncDuration / 1000), 'seconds. Force resetting...');
          this.isSyncing = false;
          this.syncStartTime = 0;
        }
      }
      
      if (this.syncQueue.length > 0 && !this.isSyncing) {
        console.log('[SYNC] Background sync check', {
          queueLength: this.syncQueue.length,
          navigatorOnline: navigator.onLine,
          isBackendAvailable: this.isBackendAvailable,
          uid: this.uid ? 'SET' : 'EMPTY'
        });
        
        // If we have queue items and device is online, try to sync
        if (navigator.onLine) {
          // If backend marked offline, do a quick connectivity check
          if (!this.isBackendAvailable) {
            console.log('[SYNC] Checking connectivity before sync attempt');
            void this.refreshConnectivity(true).then(() => {
              if (this.isBackendAvailable) {
                void this.syncToFirebaseNonBlocking();
              }
            });
          } else {
            // Backend available, sync directly
            console.log('[SYNC] Triggering sync - backend available');
            void this.syncToFirebaseNonBlocking();
          }
        } else {
          console.log('[SYNC] 📴 Device offline - skipping sync');
        }
      }
    }, 30000) as unknown as number; // 30 seconds
  }
  
  /**
   * Non-blocking sync - runs in background with exponential backoff
   * Prevents concurrent syncs and handles errors gracefully
   */
  /**
   * Public method to force sync attempt - called by UI force-sync button
   * Refreshes connectivity and triggers background sync
   */
  async forceSync(): Promise<{ success: boolean; message: string }> {
    try {
      // Adopt UID from Firebase auth if missing
      if (!this.uid && auth?.currentUser?.uid) {
        this.uid = auth.currentUser.uid;
        console.log('[SYNC] Adopted UID for forceSync:', this.uid);
      }

      if (!this.uid) {
        console.error('[SYNC] ❌ forceSync aborted: no user ID');
        return { success: false, message: 'No authenticated user ID' };
      }

      if (this.syncQueue.length === 0) {
        // Still refresh data from Firebase
        void this.pullFromFirebaseNonBlocking();
        return { success: true, message: 'No items to sync, refreshing from Firebase' };
      }

      // CRITICAL FIX: Force backend online to allow sync attempt
      console.log('[SYNC] 🔧 Forcing backend online for manual sync attempt');
      this.backendOnline = true;
      
      // Refresh connectivity detection
      console.log('[SYNC] 📡 Refreshing connectivity...');
      await this.refreshConnectivity(true);
      
      console.log('[SYNC] 📡 Connectivity refreshed, backend status:', this.backendOnline);
      
      // Trigger non-blocking upstream sync (uploads)
      console.log('[SYNC] ⬆️ Triggering upstream sync (uploads)...');
      void this.syncToFirebaseNonBlocking();

      // Also trigger downstream sync (downloads) to hydrate fresh installs
      console.log('[SYNC] ⬇️ Triggering downstream sync (downloads)...');
      void this.pullFromFirebaseNonBlocking();
      
      return { success: true, message: `Sync initiated for ${this.syncQueue.length} items` };
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error('[SYNC] ❌ forceSync failed:', msg);
      return { success: false, message: msg };
    }
  }

  /**
   * Pulls projects and field boundaries from Firebase and hydrates local caches.
   * Designed for tablet fresh installs and manual refresh via Force Sync.
   */
  private async pullFromFirebaseNonBlocking(): Promise<void> {
    const canAttemptOnline = this.isBackendAvailable || (navigator.onLine && !this.isDefinitelyOffline);
    if (!canAttemptOnline) {
      console.log('[SYNC] pullFromFirebase skipped: backend not available');
      return;
    }

    if (!this.uid) {
      console.warn('[SYNC] pullFromFirebase skipped: no UID');
      return;
    }

    console.log('[SYNC] ⬇️ Starting downstream pull from Firebase...');
    try {
      const projects = await this.getProjects();
      console.log('[SYNC] ⬇️ Projects pulled:', projects.length);

      // Fetch boundaries for each project (best-effort)
      for (const p of projects) {
        try {
          await this.getFieldBoundaries(p.id);
        } catch (e: any) {
          console.warn('[SYNC] Failed to pull boundaries for project', p?.id, e?.message || e);
        }
      }

      // Optionally, kick background track list fill (lightweight)
      for (const p of projects) {
        try {
          // Populate track lists cache; details (points/samples) fetched on demand
          await this.getTracks(p.id);
        } catch (e: any) {
          console.warn('[SYNC] Failed to pull tracks for project', p?.id, e?.message || e);
        }
      }

      console.log('[SYNC] ✅ Downstream pull completed');
    } catch (err: any) {
      console.warn('[SYNC] Downstream pull failed:', err?.message || err);
    }
  }

  private async syncToFirebaseNonBlocking(): Promise<void> {
    // Safety: if UID missing but Firebase auth has a user, adopt it
    if (!this.uid && auth?.currentUser?.uid) {
      this.uid = auth.currentUser.uid;
      console.log('[SYNC] Adopted UID from Firebase auth:', this.uid);
    }

    // If backend not available, try to refresh connectivity first
    if (!this.isBackendAvailable && navigator.onLine) {
      console.log('[SYNC] Backend unavailable but navigator online - refreshing connectivity');
      await this.refreshConnectivity(true);
    }
    
    // Failsafe: if device online and we have queue, try forcing a sync attempt
    const stuckWhileOnline = navigator.onLine && this.syncQueue.length > 0;
    if (!this.isBackendAvailable && stuckWhileOnline) {
      const secondsSinceCheck = (Date.now() - this.lastConnectivityCheck) / 1000;
      if (secondsSinceCheck > 10) {
        console.warn('[SYNC] Backend marked offline but device online with pending queue — forcing attempt');
        this.backendOnline = true; // Allow a single attempt
      }
    }

    if (!this.isBackendAvailable || this.syncQueue.length === 0 || this.isSyncing) {
      if (!this.isBackendAvailable) {
        console.warn('[SYNC] ⚠️ Backend not available, skipping sync. Status:', {
          backendOnline: this.backendOnline,
          navigatorOnline: navigator.onLine,
          lastCheck: `${Math.round((Date.now() - this.lastConnectivityCheck) / 1000)}s ago`
        });
      }
      if (this.syncQueue.length === 0) {
        // Queue is empty, nothing to sync
      }
      if (this.isSyncing) {
        console.log('[SYNC] ⚠️ Already syncing, skipping. Sync running for:', 
          `${Math.round((Date.now() - this.syncStartTime) / 1000)}s`);
      }
      return;
    }
    
    if (!this.uid) {
      console.error('[SYNC] ❌ Cannot sync - User ID is not set!');
      // Schedule a short retry to avoid permanent stall when auth lags
      setTimeout(() => {
        // Try to adopt UID again on retry
        if (!this.uid && auth?.currentUser?.uid) {
          this.uid = auth.currentUser.uid;
          console.log('[SYNC] Retry adopted UID from Firebase auth:', this.uid);
        }
        void this.syncToFirebaseNonBlocking();
      }, 1000);
      return;
    }

    this.isSyncing = true;
    this.syncStartTime = Date.now(); // Track when sync started
    console.log(`[SYNC] ✅ Starting background sync of ${this.syncQueue.length} items for user ${this.uid}`);
    
    try {
      // Add timeout to prevent stuck sync - maximum 60 seconds
      const syncPromise = this.syncToFirebase();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Sync operation timeout after 60s')), 60000)
      );
      
      await Promise.race([syncPromise, timeoutPromise]);
      console.log('[SYNC] Background sync completed successfully');
    } catch (error) {
      console.warn('[SYNC] Background sync encountered error:', error);
      // Reset syncing flag even on error to allow retry
      this.isSyncing = false;
      this.syncStartTime = 0;
    } finally {
      // Ensure isSyncing is always reset
      this.isSyncing = false;
      this.syncStartTime = 0;
      console.log('[SYNC] isSyncing flag reset to false');
    }
  }

  private async processSyncItem(item: SyncQueueItem) {
    // Add timeout for each sync operation
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Sync item ${item.id} timeout`)), TIMEOUTS.SYNC_OPERATION)
    );

    try {
      // CRITICAL FIX: Guard against undefined values in sample data
      if (item.type === 'sample' && item.action === 'create') {
        const hasUndefined = Object.entries(item.data).some(([key, value]) => value === undefined);
        if (hasUndefined) {
          console.error(`[SYNC] ❌ Sample ${item.id} contains undefined values:`, 
            Object.entries(item.data)
              .filter(([_, v]) => v === undefined)
              .map(([k]) => k)
          );
          console.error(`[SYNC] Full sample data:`, item.data);
          // Remove undefined values before sync
          const cleanedData: any = {};
          Object.entries(item.data).forEach(([key, value]) => {
            if (value !== undefined) {
              cleanedData[key] = value;
            }
          });
          item.data = cleanedData;
          await this.saveSyncQueue();
          console.log(`[SYNC] ✅ Cleaned undefined values from sample ${item.id}`);
        }
      }
      const operation = this.performSyncOperation(item);
      await Promise.race([operation, timeoutPromise]);
    } catch (error: any) {
      if (error.message.includes('timeout')) {
        console.warn(`[SYNC] Item ${item.id} timed out - will retry later`, error);
        // Don't remove from queue - will retry
      } else {
        console.error('[SYNC] Error on item:', item.id, error);
        throw error;
      }
    }
  }

  private async performSyncOperation(item: SyncQueueItem) {
    console.log(`[SYNC] 🔄 Performing ${item.action} ${item.type} (id: ${item.id})`);
    
    switch (item.type) {
      case 'project':
        if (item.action === 'create') {
          console.log(`[SYNC] Creating project: ${item.data.name}`);
          const result = await firebaseGPS.createProject(this.uid, item.data.name, item.data.description, item.id);
          console.log(`[SYNC] ✅ Project created successfully:`, result);
        } else if (item.action === 'update') {
          console.log(`[SYNC] Updating project: ${item.data.id}`);
          await firebaseGPS.updateProject(this.uid, item.data.id, item.data.name, item.data.description);
          console.log(`[SYNC] ✅ Project updated successfully`);
        } else if (item.action === 'delete') {
          console.log(`[SYNC] Deleting project: ${item.data.id}`);
          await firebaseGPS.deleteProject(this.uid, item.data.id);
          console.log(`[SYNC] ✅ Project deleted successfully`);
        }
        break;
      case 'track':
        if (item.action === 'create') {
          console.log(`[SYNC] Creating track: ${item.data.name} (project: ${item.data.project_id}, localId: ${item.id})`);
          const trackResult = await firebaseGPS.createTrack(this.uid, item.data.project_id, item.data.name, item.data.field_boundary_id, item.id);
          console.log(`[SYNC] ✅ Track created in Firebase with ID: ${trackResult}`);
          
          // CRITICAL FIX: Update local cache to use Firebase ID if different from local ID
          // This ensures GPS points and samples can find the track in Firebase
          if (trackResult && trackResult !== item.id) {
            console.log(`[SYNC] Track ID changed: ${item.id} -> ${trackResult}, updating local cache and sync queue`);
            
            // Get current track from cache
            const localTrack = await this.getLocalHydrated('track', item.id);
            if (localTrack) {
              // Update track with Firebase ID
              const updatedTrack = { ...localTrack, id: trackResult };
              await this.saveLocal('track', trackResult, updatedTrack);
              
              // Remove old local-only entry
              await this.removeLocal('track', item.id);
              
              // Update project tracks cache
              const projectTracks = await this.getLocalHydrated('tracks', `project_${item.data.project_id}`) || [];
              const updatedProjectTracks = projectTracks.map((t: any) => 
                t.id === item.id ? updatedTrack : t
              );
              await this.saveLocal('tracks', `project_${item.data.project_id}`, updatedProjectTracks);
              
              // CRITICAL FIX: Update all GPS points and samples in sync queue that reference the old track ID
              let updatedCount = 0;
              console.log(`[SYNC] 🔍 Checking ${this.syncQueue.length} queue items for track_id ${item.id}...`);
              for (const queueItem of this.syncQueue) {
                console.log(`[SYNC]   - Queue item: type=${queueItem.type}, action=${queueItem.action}, track_id=${queueItem.data?.track_id}`);
                if ((queueItem.type === 'point' || queueItem.type === 'sample') && queueItem.data.track_id === item.id) {
                  const oldId = queueItem.data.track_id;
                  queueItem.data.track_id = trackResult;
                  // CRITICAL: Reset retry timer so points/samples can sync immediately
                  queueItem.nextAttemptAt = 0;
                  queueItem.attempts = 0;
                  updatedCount++;
                  console.log(`[SYNC] ✅ Updated ${queueItem.type} ${queueItem.id} track_id: ${oldId} -> ${trackResult} (reset retry timer)`);
                }
              }
              
              // Save queue to persist the updates
              if (updatedCount > 0) {
                await this.saveSyncQueue();
                console.log(`[SYNC] Updated ${updatedCount} GPS points/samples in sync queue with new track ID - they will retry immediately`);
                
                // Force reload queue from storage to ensure updates are visible
                await this.loadSyncQueue();
                console.log(`[SYNC] Queue reloaded from storage after track ID updates`);
                
                // CRITICAL: Trigger another sync pass immediately so points/samples can retry
                // Don't await - let it happen in background after this operation completes
                setTimeout(() => {
                  console.log(`[SYNC] 🔄 Triggering immediate retry pass for updated points/samples`);
                  void this.syncToFirebaseNonBlocking?.();
                }, 100);
              }
              
              // CRITICAL FIX: Update GPS points and samples in local cache
              // Update points cache
              const cachedPoints = await this.getLocalHydrated('points', `track_${item.id}`) || [];
              if (cachedPoints.length > 0) {
                const updatedPoints = cachedPoints.map((p: any) => ({ ...p, track_id: trackResult }));
                await this.saveLocal('points', `track_${trackResult}`, updatedPoints);
                await this.removeLocal('points', `track_${item.id}`);
                console.log(`[SYNC] Updated ${cachedPoints.length} cached GPS points with new track ID`);
              }
              
              // Update samples cache
              const cachedSamples = await this.getLocalHydrated('samples', `track_${item.id}`) || [];
              if (cachedSamples.length > 0) {
                const updatedSamples = cachedSamples.map((s: any) => ({ ...s, track_id: trackResult }));
                await this.saveLocal('samples', `track_${trackResult}`, updatedSamples);
                await this.removeLocal('samples', `track_${item.id}`);
                console.log(`[SYNC] Updated ${cachedSamples.length} cached samples with new track ID`);
              }
              
              console.log(`[SYNC] Local cache updated with Firebase track ID: ${trackResult}`);
            }
          }
        } else if (item.action === 'update') {
          console.log(`[SYNC] Updating track: ${item.data.id}`, item.data);
          await firebaseGPS.updateTrack(this.uid, item.data.id, {
            name: item.data.name,
            field_boundary_id: item.data.field_boundary_id,
            color: item.data.color
          });
          console.log(`[SYNC] ✅ Track updated successfully`);
        } else if (item.action === 'delete') {
          console.log(`[SYNC] Deleting track: ${item.data.id}`);
          await firebaseGPS.deleteTrack(this.uid, item.data.id);
          console.log(`[SYNC] ✅ Track deleted successfully`);
        }
        break;
      case 'point':
        if (item.action === 'create') {
          console.log(`[SYNC] Creating GPS point for track: ${item.data.track_id} (lat: ${item.data.latitude}, lon: ${item.data.longitude})`);
          
          // CRITICAL FIX: Check if track exists in Firebase OR is in queue awaiting sync
          const trackId = item.data.track_id;
          const trackInQueue = this.syncQueue.find(q => 
            q.type === 'track' && 
            (q.id === trackId || q.data?.id === trackId) && 
            q.action === 'create'
          );
          
          if (trackInQueue) {
            console.warn(`[SYNC] ⏳ GPS point references track ${trackId} that is still in queue waiting to sync`);
            console.warn(`[SYNC] ⏳ Deferring point sync until track is synced`);
            item.attempts = (item.attempts || 0) + 1;
            item.nextAttemptAt = Date.now() + 5000; // Retry in 5 seconds
            throw new Error(`Track ${trackId} not yet synced - deferring point`);
          }
          
          await firebaseGPS.addGpsPoints(this.uid, [{
            id: item.data.id,
            track_id: item.data.track_id,
            latitude: item.data.latitude,
            longitude: item.data.longitude,
            altitude: item.data.altitude,
            accuracy: item.data.accuracy,
            timestamp: item.data.timestamp
          }]);
          console.log(`[SYNC] ✅ GPS point created successfully`);
        }
        break;
      case 'sample':
        if (item.action === 'create') {
          console.log(`[SYNC] Creating sample: ${item.data.name} (track: ${item.data.track_id})`);
          
          // CRITICAL FIX: Check if track exists in Firebase OR is in queue awaiting sync
          const trackId = item.data.track_id;
          
          // Check if track is still in queue (pending creation)
          const trackInQueue = this.syncQueue.find(q => 
            q.type === 'track' && 
            (q.id === trackId || q.data?.id === trackId) && 
            q.action === 'create'
          );
          
          if (trackInQueue) {
            console.warn(`[SYNC] ⏳ Sample ${item.data.name} references track ${trackId} that is still in queue waiting to sync`);
            console.warn(`[SYNC] ⏳ Deferring sample sync until track is synced`);
            item.attempts = (item.attempts || 0) + 1;
            item.nextAttemptAt = Date.now() + 5000; // Retry in 5 seconds
            throw new Error(`Track ${trackId} not yet synced - deferring sample`);
          }
          
          // CRITICAL FIX: Verify track exists in Firebase before syncing sample
          try {
            const trackExists = await firebaseGPS.getTrackById(this.uid, trackId);
            if (!trackExists) {
              console.error(`[SYNC] ❌ Track ${trackId} does not exist in Firebase!`);
              console.error(`[SYNC] Sample ${item.data.name} references non-existent track`);
              
              // Check if this might be an old local track ID that was replaced
              const allTracks = await this.getLocalHydrated('projects', 'all') || [];
              let foundTrack = null;
              for (const project of allTracks) {
                if (project.tracks) {
                  foundTrack = project.tracks.find((t: any) => 
                    t.id.toString().includes(trackId.split('_')[1]) // Match UUID part
                  );
                  if (foundTrack) break;
                }
              }
              
              if (foundTrack && foundTrack.id !== trackId) {
                console.log(`[SYNC] 🔧 Found track with updated ID: ${trackId} -> ${foundTrack.id}`);
                console.log(`[SYNC] Updating sample track_id reference`);
                item.data.track_id = foundTrack.id;
                await this.saveSyncQueue();
                // Retry immediately with corrected track ID
                item.nextAttemptAt = 0;
                throw new Error(`Track ID corrected, retrying immediately`);
              }
              
              // If track truly doesn't exist and can't be found, fail after max attempts
              if ((item.attempts || 0) >= 10) {
                console.error(`[SYNC] ❌ Removing sample ${item.id} - track ${trackId} not found after 10 attempts`);
                this.syncQueue = this.syncQueue.filter(i => i.id !== item.id);
                await this.saveSyncQueue();
                return;
              }
              
              item.attempts = (item.attempts || 0) + 1;
              item.nextAttemptAt = Date.now() + 10000; // Retry in 10 seconds
              throw new Error(`Track ${trackId} not found in Firebase - deferring sample`);
            }
          } catch (error: any) {
            if (error.message?.includes('retrying immediately')) {
              throw error; // Propagate for immediate retry
            }
            console.warn(`[SYNC] Could not verify track existence:`, error.message);
            // Continue anyway - let Firebase handle the error
          }
          
          await firebaseGPS.addSample(
            this.uid,
            item.data.track_id,
            item.data.latitude,
            item.data.longitude,
            item.data.name,
            item.data.notes,
            item.data.id,
            item.data.sample_number,
            {
              depth_cm: item.data.depth_cm,
              horizon: item.data.horizon,
              soil_type: item.data.soil_type,
              sampling_method: item.data.sampling_method,
              coordinate_system: item.data.coordinate_system,
              device_accuracy_m: item.data.device_accuracy_m,
              operator: item.data.operator,
              field_id: item.data.field_id,
              parcel_id: item.data.parcel_id,
              legal_ref: item.data.legal_ref
            }
          );
          console.log(`[SYNC] ✅ Sample created successfully`);
        } else if (item.action === 'delete') {
          console.log(`[SYNC] Deleting sample: ${item.data.id}`);
          await firebaseGPS.deleteSample(this.uid, item.data.id);
          console.log(`[SYNC] ✅ Sample deleted successfully`);
        }
        break;
      case 'field_sample':
        if (item.action === 'create') {
          console.log(`[SYNC] Creating field sample: ${item.data.name} (field: ${item.data.field_boundary_id})`);

          await firebaseGPS.addFieldSample(
            this.uid,
            item.data.project_id,
            item.data.field_boundary_id,
            item.data.latitude,
            item.data.longitude,
            item.data.name,
            item.data.notes,
            item.data.id,
            item.data.sample_number,
            {
              ...item.data,
              id: undefined,
              project_id: undefined,
              field_boundary_id: undefined,
              latitude: undefined,
              longitude: undefined,
              name: undefined,
              notes: undefined,
              sample_number: undefined,
            }
          );

          console.log('[SYNC] ✅ Field sample created successfully');
        } else if (item.action === 'delete') {
          console.log(`[SYNC] Deleting field sample: ${item.data.id}`);
          await firebaseGPS.deleteFieldSample(this.uid, item.data.id);
          console.log('[SYNC] ✅ Field sample deleted successfully');
        }
        break;
      case 'boundary':
        if (item.action === 'create') {
          console.log(`[SYNC] Creating boundary: ${item.data.name} (project: ${item.data.project_id})`);
          
          // CRITICAL FIX: Handle geometry that might be in various formats (string, object, double-serialized, etc.)
          let geometry = item.data.geometry;
          if (geometry) {
            // Try to parse if it's a string (could be single or double serialized)
            while (typeof geometry === 'string') {
              try {
                const parsed = JSON.parse(geometry);
                geometry = parsed;
                console.log(`[SYNC] Parsed geometry string layer`);
              } catch (err) {
                // If parse fails, it might be malformed - skip this create
                console.error(`[SYNC] ❌ Corrupted geometry in queue item ${item.id}, skipping:`, geometry);
                throw new Error(`Corrupted geometry data in queue - removing item`);
              }
            }
            
            // Validate it's a proper GeoJSON object
            if (geometry && typeof geometry === 'object' && !geometry.type) {
              console.error(`[SYNC] ❌ Invalid geometry object (missing type) in queue item ${item.id}:`, geometry);
              throw new Error(`Invalid geometry object - removing item`);
            }
            
            console.log(`[SYNC] Geometry validated for boundary create:`, geometry?.type);
          }
          
          await firebaseGPS.createFieldBoundary(
            this.uid,
            item.data.project_id,
            item.data.name,
            geometry,
            item.data.color,
            item.data.properties,
            item.id,
            item.data.render_meta
          );
          console.log(`[SYNC] ✅ Boundary created successfully`);
        } else if (item.action === 'update') {
          console.log(`[SYNC] Updating boundary: ${item.data.id}`);
          console.log(`[SYNC] Raw item.data:`, item.data);
          
          // CRITICAL FIX: Handle geometry that might be in various formats (string, object, double-serialized, etc.)
          let geometry = item.data.geometry;
          console.log(`[SYNC] Initial geometry type:`, typeof geometry, 'value:', geometry);
          
          // Skip if geometry is explicitly undefined (means no geometry update)
          if (geometry !== undefined) {
            // Handle null
            if (geometry === null) {
              console.log(`[SYNC] Geometry is null - will clear geometry`);
            } else {
              // Try to parse if it's a string (could be single or double serialized)
              while (typeof geometry === 'string') {
                try {
                  const parsed = JSON.parse(geometry);
                  geometry = parsed;
                  console.log(`[SYNC] Parsed geometry string layer, now type:`, typeof geometry);
                } catch (err) {
                  // If parse fails, it might be malformed - skip this update
                  console.error(`[SYNC] ❌ Corrupted geometry in queue item ${item.id}, cannot parse:`, geometry);
                  console.error(`[SYNC] Removing this item from queue - it's corrupted beyond repair`);
                  throw new Error(`Corrupted geometry data in queue - removing item`);
                }
              }
              
              // Validate it's a proper GeoJSON object
              if (geometry && typeof geometry === 'object' && !geometry.type) {
                console.error(`[SYNC] ❌ Invalid geometry object (missing type) in queue item ${item.id}:`, geometry);
                console.error(`[SYNC] Removing this item from queue - invalid structure`);
                throw new Error(`Invalid geometry object - removing item`);
              }
              
              console.log(`[SYNC] ✅ Geometry validated for boundary update:`, geometry?.type);
            }
          } else {
            console.log(`[SYNC] No geometry update (undefined)`);
          }
          
          console.log(`[SYNC] Calling Firebase updateFieldBoundary with:`, {
            boundaryId: item.data.id,
            name: item.data.name,
            geometryType: typeof geometry,
            geometryGeoJSONType: geometry?.type,
            color: item.data.color,
            properties: item.data.properties
          });
          
          try {
            await firebaseGPS.updateFieldBoundary(
              this.uid,
              item.data.id,
              item.data.name,
              geometry,
              item.data.color,
              item.data.properties,
              item.data.render_meta
            );
            console.log(`[SYNC] ✅ Boundary updated successfully`);
          } catch (updateError: any) {
            console.error(`[SYNC] ❌ Firebase updateFieldBoundary failed:`, {
              error: updateError.message,
              code: updateError.code,
              stack: updateError.stack,
              boundaryId: item.data.id,
              attempts: item.attempts
            });
            // Re-throw to trigger retry logic
            throw updateError;
          }
        } else if (item.action === 'delete') {
          console.log(`[SYNC] Deleting boundary: ${item.data.id}`);
          await firebaseGPS.deleteFieldBoundary(this.uid, item.data.id);
          console.log(`[SYNC] ✅ Boundary deleted successfully`);
        }
        break;
      case 'device':
        if (item.action === 'create') {
          console.log(`[SYNC] Creating device: ${item.data.name || item.id}`);
          await firebaseGPS.saveDevice(this.uid, item.data, String(item.id));
          console.log(`[SYNC] ✅ Device created successfully`);
        } else if (item.action === 'delete') {
          console.log(`[SYNC] Deleting device: ${item.data.id}`);
          await firebaseGPS.deleteDevice(this.uid, String(item.data.id));
          console.log(`[SYNC] ✅ Device deleted successfully`);
        } else if (item.action === 'update') {
          console.log(`[SYNC] Updating device: ${item.data.id}`);
          await firebaseGPS.saveDevice(this.uid, item.data, String(item.data.id));
          console.log(`[SYNC] ✅ Device updated successfully`);
        }
        break;
    }
  }

  /**
   * ✅ ISSUE #15 FIX: Generate unique IDs using UUID instead of timestamp
   * Prevents collision when operations happen in rapid succession
   */
  private generateLocalId(): string {
    // Use crypto.randomUUID if available (modern browsers + Node 14.17+)
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return `local_${crypto.randomUUID()}`;
    }
    // Fallback to timestamp + random for older environments
    return `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Projects
  async createProject(name: string, description: string, createdBy: string = 'user') {
    const projectData = { name, description, created_by: createdBy };

    // Local-first for instant UX; sync happens in background
    const localId = this.generateLocalId();
    const localProject = {
      id: localId,
      name,
      description: description || '',
      created_by: createdBy,
      created_at: createSerializableTimestamp(),
      updated_at: createSerializableTimestamp()
    };

    // Store in IndexedDB
    await this.saveLocal('project', localId, localProject);
    const cached = await this.getLocalHydrated('projects', 'all') || [];
    await this.saveLocal('projects', 'all', [...cached, localProject]);

    // Queue for sync and kick off a non-blocking sync attempt
    this.addToSyncQueue({
      id: localId,
      type: 'project',
      action: 'create',
      data: projectData
    });

    void this.syncToFirebaseNonBlocking?.();
    return localProject;
  }

  async getProjects() {
    // If device is online but backend is marked offline, trigger an immediate connectivity probe
    if (navigator.onLine && !this.backendOnline) {
      void this.refreshConnectivity(true).then(result => {
        if (result.success) {
          this.connectivityBackoffMs = 10000;
          // Immediately retry projects fetch if connectivity is restored
          setTimeout(() => {
            this.syncProjectsInBackground().catch(err => 
              console.warn('[HybridDB] Post-connectivity sync failed:', err.message)
            );
          }, 100);
        }
      });
    }

    const online = this.isBackendAvailable && !this.isDefinitelyOffline;
    
    if (!this.uid) {
      console.error('[HybridDB] CRITICAL: No user ID set!');
      return [];
    }
    
    console.log('[HybridDB] Loading projects for user:', this.uid);

    // ALWAYS check cache/local DB first - network status shouldn't affect cached data
    let cached: any[] = [];
    try {
      const rawCached = await this.getLocalHydrated('projects', 'all');
      cached = rawCached || [];
      
      // CRITICAL: Return cached projects if available, REGARDLESS of network status
      // This fixes the issue where switching networks (online→offline) loses projects
      if (cached.length > 0) {
        // Only attempt background sync if we're actually online
        if (online && navigator.onLine) {
          // Background sync started (silent mode)
          this.syncProjectsInBackground().catch(err => {
            console.warn('[HybridDB] Background sync failed (cached data still available):', err.message);
          });
        }
        
        return cached;
      }
    } catch (cacheError: any) {
      console.error('[HybridDB] Cache access failed:', cacheError.message);
      // Continue to try Firebase if cache fails
    }

    // No cache - must fetch from Firebase (first load)
    // CRITICAL FIX: Always try to fetch if user is authenticated, even if backend marked offline
    // The backend status might be stale, so give Firebase a chance
    const shouldTryFetch = navigator.onLine && auth.currentUser;
    
    if (shouldTryFetch) {
      try {
        if (!auth.currentUser) {
          throw new Error('Firebase not authenticated - auth.currentUser is null');
        }
        
        // Don't override this.uid - it's already set to the correct user (admin viewing other user's data)
        console.log('[HybridDB] Fetching projects from Firebase for user:', this.uid, '(authenticated as:', auth.currentUser.uid + ')');
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Firebase fetch timeout after 30s')), TIMEOUTS.PROJECT_FETCH)
        );

        try {
          const projects = await Promise.race([
            firebaseGPS.getProjects(this.uid),
            timeoutPromise
          ]) as any[];

          console.log('[HybridDB] Firebase returned', projects.length, 'projects for user:', this.uid);

          // Mark backend reachable on success so future calls consider us online
          this.backendOnline = true;

          if (projects.length > 0) {
            const uniqueProjects = Array.from(new Map((projects as any[]).map((p: any) => [p.id, p])).values());
            await this.saveLocal('projects', 'all', uniqueProjects);
            return uniqueProjects;
          } else {
            // Empty result from Firebase
            await this.saveLocal('projects', 'all', projects);
            return projects;
          }
        } catch (fetchError: any) {
          // ✅ ISSUE #10 FIX: Use categorized error handling
          logCategorizedError('HybridDB.getProjects', fetchError);
          const categorized = categorizeError(fetchError);
          
          console.error('[HybridDB] Firebase fetch failed for user:', this.uid);
          console.error('[HybridDB] Fetch error details:', {
            message: fetchError.message,
            code: fetchError.code,
            isRetriable: categorized.isRetriable,
            stack: fetchError.stack
          });
          
          // If auth error, provide clear message to user
          if (fetchError.message?.includes('Authentication') || 
              fetchError.message?.includes('auth') ||
              fetchError.message?.includes('mismatch') ||
              fetchError.code === 'permission-denied' ||
              fetchError.code === 'auth/mismatch' ||
              !auth.currentUser) {
            console.error('[HybridDB] Authentication/permission error detected');
            throw new Error('Authentication error: Please try logging out and logging in again.');
          }
          
          if (!categorized.isRetriable) {
            // Non-retriable errors (auth, permission) should be thrown
            console.error('[HybridDB] Non-retriable error, throwing:', fetchError.message);
            throw fetchError;
          }
          
          console.warn('[HybridDB] Firebase fetch failed (retriable), returning empty array');
          this.markBackendOffline(fetchError?.message || 'projects fetch failed');
        }
      } catch (error: any) {
        console.error('[HybridDB] Outer catch - error loading projects:', error.message);
        logCategorizedError('HybridDB.getProjects.outer', error);
        this.markBackendOffline(error?.message || 'projects fetch failed');
      }
    } else {
      console.warn('[HybridDB] Not attempting Firebase fetch:', { 
        navigatorOnline: navigator.onLine, 
        authCurrentUser: !!auth.currentUser,
        shouldTryFetch 
      });
    }
    
    // Offline or Firebase failed - return empty array (user can create projects locally)
    return [];
  }

  async updateProject(projectId: string, name: string, description?: string) {
    // Update cache immediately for responsive UI
    const cached = await this.getLocalHydrated('projects', 'all') || [];
    const projectIndex = cached.findIndex((p: any) => p.id === projectId);
    if (projectIndex >= 0) {
      cached[projectIndex].name = name;
      if (description !== undefined) cached[projectIndex].description = description;
      cached[projectIndex].updated_at = createSerializableTimestamp();
      this.saveLocal('projects', 'all', cached);
    }
    
    if (this.isOnline) {
      try {
        await firebaseGPS.updateProject(this.uid, projectId, name, description);
        // Refresh cache from Firebase
        const projects = await firebaseGPS.getProjects(this.uid);
        if (projects.length > 0) {
          this.saveLocal('projects', 'all', projects);
        }
        return;
      } catch (error: any) {
        console.warn('Firebase update failed, using cached update:', error.message);
        // If document doesn't exist, queue it for creation
        if (error.code === 'not-found' || error.message?.includes('not found')) {
          console.log('[HybridDB] Project not in Firebase, will recreate on next sync');
        }
      }
    }
    
    this.addToSyncQueue({
      id: `update_${Date.now()}`,
      type: 'project',
      action: 'update',
      data: { id: projectId, name, description }
    });
  }

  async deleteProject(projectId: string) {
    console.log('[HybridDB] Deleting project with cascade:', projectId);

    // Step 1: Get all child data (tracks and boundaries) before deletion
    let tracksToDelete: any[] = [];
    let boundariesToDelete: any[] = [];

    try {
      // Get all tracks for this project
      const allProjects = await this.getProjects();
      const project = allProjects.find(p => p.id.toString() === projectId.toString());
      
      if (project && project.tracks) {
        tracksToDelete = project.tracks.map((t: any) => t.id);
        console.log(`[HybridDB] Found ${tracksToDelete.length} tracks to cascade delete`);
      }

      // Get all boundaries for this project
      const allBoundaries = await this.getFieldBoundaries(projectId);
      boundariesToDelete = allBoundaries.map(b => b.id);
      console.log(`[HybridDB] Found ${boundariesToDelete.length} boundaries to cascade delete`);
    } catch (error) {
      console.warn('[HybridDB] Error getting child data for cascade:', error);
      // Continue with deletion anyway
    }

    // Step 2: Delete all child tracks (which will cascade delete GPS points and samples)
    for (const trackId of tracksToDelete) {
      try {
        await this.deleteTrack(trackId);
        console.log('[HybridDB] Cascade deleted track:', trackId);
      } catch (error) {
        console.warn('[HybridDB] Failed to cascade delete track:', trackId, error);
        // Continue with other deletions
      }
    }

    // Step 3: Delete all field boundaries
    for (const boundaryId of boundariesToDelete) {
      try {
        await this.deleteFieldBoundary(boundaryId);
        console.log('[HybridDB] Cascade deleted boundary:', boundaryId);
      } catch (error) {
        console.warn('[HybridDB] Failed to cascade delete boundary:', boundaryId, error);
        // Continue with other deletions
      }
    }

    // Step 3.5: Delete dedicated field samples for this project
    try {
      const projectFieldSamplesKey = `project_${projectId}`;
      const projectFieldSamples = await this.getLocalHydrated<GpsFieldSample[]>('field_samples', projectFieldSamplesKey) || [];
      for (const sample of projectFieldSamples) {
        if (sample?.id != null) {
          await this.removeLocal('field_sample', String(sample.id));
        }
      }
      await this.removeLocal('field_samples', projectFieldSamplesKey);
      console.log('[HybridDB] Cascade deleted field samples:', projectFieldSamples.length);
    } catch (error) {
      console.warn('[HybridDB] Failed to cascade delete field samples for project:', projectId, error);
    }

    // Step 4: Remove project from cache
    const cached = await this.getLocalHydrated('projects', 'all') || [];
    const filtered = cached.filter((p: any) => p.id.toString() !== projectId.toString());
    await this.saveLocal('projects', 'all', filtered);
    console.log('[HybridDB] Project removed from cache:', projectId, 'remaining:', filtered.length);
    
    // Step 5: Try Firebase deletion (which also does cascade deletion)
    if (this.isBackendAvailable) {
      try {
        await firebaseGPS.deleteProject(this.uid, projectId);
        console.log('[HybridDB] Project and children deleted from Firebase');
        return;
      } catch (error: any) {
        console.warn('Firebase delete failed:', error.message);
        // Don't re-add to cache or queue - deletion is already done locally
        // If it doesn't exist in Firebase, that's fine
        if (error.code === 'not-found' || error.message?.includes('not found')) {
          console.log('[HybridDB] Project not in Firebase, local deletion complete');
          return; // Success - item already gone
        }
      }
    }
    
    // Step 6: Queue for later sync if offline
    this.addToSyncQueue({
      id: `delete_${Date.now()}`,
      type: 'project',
      action: 'delete',
      data: { id: projectId }
    });
  }

  // Tracks
  async createTrack(projectId: string, name: string, fieldBoundaryId?: string) {
    // Local-first for instant start; sync happens asynchronously
    const localId = this.generateLocalId();
    const localTrack = {
      id: localId,
      project_id: projectId,
      name,
      field_boundary_id: fieldBoundaryId || null,
      created_at: createSerializableTimestamp(),
      is_active: true,
      gps_points: [],
      samples: [],
      color: `#${Math.floor(Math.random()*16777215).toString(16)}`
    };

    // Store in IndexedDB
    await this.saveLocal('track', localId, localTrack);
    const cached = await this.getLocalHydrated('tracks', `project_${projectId}`) || [];
    await this.saveLocal('tracks', `project_${projectId}`, [...cached, localTrack]);

    // CRITICAL FIX: Include complete track data with ID in sync queue
    this.addToSyncQueue({
      id: localId,
      type: 'track',
      action: 'create',
      data: {
        id: localId,
        project_id: projectId,
        name,
        field_boundary_id: fieldBoundaryId,
        color: localTrack.color,
        created_at: localTrack.created_at
      }
    });

    void this.syncToFirebaseNonBlocking?.();
    return localTrack;
  }

  async getTracks(projectId: string) {
    let cached: any[] = [];
    try {
      cached = await this.getLocalHydrated('tracks', `project_${projectId}`) || [];
    } catch (cacheError: any) {
      console.warn('[HybridDB] Track cache access failed:', cacheError.message);
      cached = [];
    }

    // CRITICAL: Return cached tracks if available, REGARDLESS of network status  
    if (cached.length > 0) {
      // Only attempt sync if actually online
      if (this.isBackendAvailable && navigator.onLine) {
        // Use debounced background sync - this will now merge instead of overwrite
        this.syncTracksInBackground(projectId).catch(err => {
          // Silently handle errors - cache is already available
        });
      }
      
      return cached;
    }

    // If the OS reports online but backend is marked offline, force a probe so we can resume sync quickly
    if (navigator.onLine && !this.backendOnline) {
      void this.refreshConnectivity(true).then(result => {
        if (result.success) {
          this.connectivityBackoffMs = 10000;
        }
      });
    }

    if (this.isBackendAvailable) {
      try {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Firebase fetch timeout')), TIMEOUTS.TRACK_FETCH)
        );
        const startTime = Date.now();
        const tracks = await Promise.race([
          firebaseGPS.getTracks(this.uid, projectId),
          timeoutPromise
        ]) as any[];
        const duration = Date.now() - startTime;
        
        // Store in IndexedDB cache
        // No need to merge here since cache was empty
        this.saveLocal('tracks', `project_${projectId}`, tracks);
        
        console.log('[HybridDB] Firebase getTracks successful:', tracks.length, 'tracks in', duration + 'ms');
        return tracks;
      } catch (error: any) {
        const isTimeout = error.message?.includes('timeout');
        console.warn('[HybridDB] Firebase getTracks failed:', {
          message: error.message,
          isTimeout,
          projectId
        });

        if (isTimeout || error?.code === 'unavailable') {
          this.markBackendOffline(error.message || 'getTracks failed');
        }

        if (isTimeout && cached.length === 0) {
          // Best-effort background retry so cache can fill when network recovers
          void firebaseGPS.getTracks(this.uid, projectId)
            .then((tracks) => {
              this.saveLocal('tracks', `project_${projectId}`, tracks);
              console.log('[HybridDB] Background tracks fetch succeeded after timeout:', tracks.length);
            })
            .catch(() => {/* ignore */});
        }
      }
    }
    
    console.log('[HybridDB] Using cached tracks:', cached.length);
    return cached;
  }

  async getTrack(trackId: string) {
    // Get track details with GPS points and samples

    // Try online first to keep samples/points fresh
    const canAttemptOnline = this.isBackendAvailable || (navigator.onLine && !this.isDefinitelyOffline);
    if (canAttemptOnline) {
        try {
          const track = await firebaseGPS.getTrackById(this.uid, trackId);
          if (track) {
            const [points, samples] = await Promise.all([
              this.getGpsPoints(trackId),
              this.getSamples(trackId)
            ]);

            const detail = {
              ...track,
              gps_points: points || [],
              samples: samples || [],
              field_boundary_id: track.field_boundary_id
            };

            await this.saveLocal('track', trackId, detail);
            return detail;
          }
          console.log('[HybridDB] Track not found in Firebase');
        } catch (error) {
          console.warn('[HybridDB] Firebase unavailable, using local cache:', error);
        }
    }

    // Try cached detail with hydration of points/samples from local storage
    const cached = await this.getLocalHydrated('track', trackId);
    if (cached) {
      // CRITICAL FIX: Always load fresh points and samples from local cache
      // Even if track is cached, points/samples may have been added since cache was saved
      const freshPoints = await this.getGpsPoints(trackId);
      const freshSamples = await this.getSamples(trackId);
      
      const detail = {
        ...cached,
        gps_points: freshPoints && freshPoints.length > 0 ? freshPoints : (cached.gps_points || []),
        samples: freshSamples && freshSamples.length > 0 ? freshSamples : (cached.samples || [])
      };
      
      console.log('[HybridDB] Track found in cache, hydrated with fresh points/samples:', {
        trackId,
        hasCache: !!cached,
        cachedPoints: cached.gps_points?.length || 0,
        freshPoints: freshPoints?.length || 0,
        cachedSamples: cached.samples?.length || 0,
        freshSamples: freshSamples?.length || 0,
        field_boundary_id: detail.field_boundary_id
      });
      return detail;
    }

    console.log('[HybridDB] Track not found anywhere, returning null');
    return null;
  }

  async deleteTrack(trackId: string) {
    console.log('[HybridDB] Deleting track with cascade:', trackId);

    // Step 1: Delete child GPS points and samples FIRST (cascade)
    let projectId: string | null = null;
    try {
      // Get track to find associated data
      const allProjects = await this.getProjects();
      let trackFound = false;

      for (const project of allProjects) {
        if (project.tracks) {
          const track = project.tracks.find((t: any) => t.id.toString() === trackId.toString());
          if (track) {
            trackFound = true;
            projectId = project.id; // Store for cache update
            const pointCount = track.gps_points?.length || 0;
            const sampleCount = track.samples?.length || 0;
            console.log(`[HybridDB] Cascade deleting ${pointCount} GPS points and ${sampleCount} samples`);
            
            // Delete GPS points
            if (track.gps_points && track.gps_points.length > 0) {
              for (const point of track.gps_points) {
                try {
                  await this.removeLocal('gps_point', point.id);
                } catch (err) {
                  console.warn('[HybridDB] Failed to delete GPS point:', point.id, err);
                }
              }
            }

            // Delete samples
            if (track.samples && track.samples.length > 0) {
              for (const sample of track.samples) {
                try {
                  await this.removeLocal('sample', sample.id);
                } catch (err) {
                  console.warn('[HybridDB] Failed to delete sample:', sample.id, err);
                }
              }
            }
            break;
          }
        }
      }

      if (!trackFound) {
        console.warn('[HybridDB] Track not found in projects, proceeding with deletion');
      }
    } catch (error) {
      console.warn('[HybridDB] Error during cascade deletion prep:', error);
      // Continue with track deletion anyway
    }

    // Step 2: Check if definitely offline for fast path
    if (this.isDefinitelyOffline) {
      console.log('[HybridDB] Definitely offline - deleting locally and queuing');
      
      // Delete from IndexedDB for immediate UI update
      await this.removeLocal('track', trackId);
      
      // CRITICAL FIX: Remove from project tracks cache
      if (projectId) {
        const projectTracks = await this.getLocalHydrated<any[]>('tracks', `project_${projectId}`) || [];
        const updatedTracks = projectTracks.filter(t => t.id?.toString() !== trackId.toString());
        await this.saveLocal('tracks', `project_${projectId}`, updatedTracks);
        console.log(`[HybridDB] Track removed from project ${projectId} cache`);
      }
      
      this.addToSyncQueue({
        id: `delete_${Date.now()}`,
        type: 'track',
        action: 'delete',
        data: { id: trackId }
      });
      return;
    }
    
    // Step 3: Always delete from IndexedDB first for immediate UI update
    await this.removeLocal('track', trackId);
    
    // CRITICAL FIX: Remove from project tracks cache immediately
    if (projectId) {
      const projectTracks = await this.getLocalHydrated<any[]>('tracks', `project_${projectId}`) || [];
      const updatedTracks = projectTracks.filter(t => t.id?.toString() !== trackId.toString());
      await this.saveLocal('tracks', `project_${projectId}`, updatedTracks);
      console.log(`[HybridDB] Track removed from project ${projectId} cache`);
    }
    
    // Step 4: Try Firebase with short timeout (Firebase also does cascade)
    if (this.isBackendAvailable) {
      try {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Delete timeout')), TIMEOUTS.DELETE_OPERATION)
        );
        await Promise.race([
          firebaseGPS.deleteTrack(this.uid, trackId),
          timeoutPromise
        ]);
        console.log('[HybridDB] Track and children deleted from Firebase');
        
        // CRITICAL FIX: Trigger immediate background sync to propagate deletion
        if (projectId) {
          void this.syncTracksInBackground(projectId);
        }
        return;
      } catch (error) {
        console.warn('Firebase delete failed/timeout, queuing:', error);
        this.markBackendOffline((error as any)?.message || 'deleteTrack failed');
      }
    }
    
    // Step 5: Queue for later sync
    this.addToSyncQueue({
      id: `delete_${Date.now()}`,
      type: 'track',
      action: 'delete',
      data: { id: trackId }
    });
  }

  async updateTrack(trackId: string, updates: { name?: string; field_boundary_id?: string | null; color?: string }) {
    // Update IndexedDB cache first for immediate UI update
    const cached = await this.getLocalHydrated('track', trackId);
    if (cached) {
      const updatedTrack = { ...cached, ...updates };
      await this.saveLocal('track', trackId, updatedTrack);
    }
    
    if (this.isOnline) {
      try {
        await firebaseGPS.updateTrack(this.uid, trackId, updates);
        return;
      } catch (error) {
        console.warn('Firebase unavailable, queuing update:', error);
        // this.isOnline = false; // Removed: isOnline is now a getter
      }
    }
    
    this.addToSyncQueue({
      id: `update_${Date.now()}`,
      type: 'track',
      action: 'update',
      data: { id: trackId, ...updates }
    });
  }

  // GPS Points
  async addGpsPoint(
    trackId: string,
    latitude: number,
    longitude: number,
    altitude?: number,
    accuracy?: number,
    metadata?: {
      source_preference?: 'internal' | 'external';
      source_policy?: 'preferred' | 'strict';
      source_used?: 'internal' | 'external';
      external_fallback?: boolean;
      external_data_age_ms?: number;
    },
    options?: {
      skipProjectCacheUpdate?: boolean;
    }
  ) {
    return this.withTransaction(async () => {
      const timestamp = new Date().toISOString();
      const pointId = `pt_${trackId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const pointData: any = { id: pointId, track_id: trackId, latitude, longitude, timestamp };
      if (typeof altitude === 'number') pointData.altitude = altitude;
      if (typeof accuracy === 'number') pointData.accuracy = accuracy;
      if (metadata) {
        if (metadata.source_preference) pointData.source_preference = metadata.source_preference;
        if (metadata.source_policy) pointData.source_policy = metadata.source_policy;
        if (metadata.source_used) pointData.source_used = metadata.source_used;
        if (typeof metadata.external_fallback === 'boolean') pointData.external_fallback = metadata.external_fallback;
        if (typeof metadata.external_data_age_ms === 'number') pointData.external_data_age_ms = metadata.external_data_age_ms;
      }

      // ALWAYS save to IndexedDB first for instant UX and data safety
      await this.saveLocal('point', pointId, pointData);
      
      // Update cache atomically
      await this.updatePointCaches(trackId, pointData, options?.skipProjectCacheUpdate);

      // Queue for background sync - never wait for Firebase
      this.addToSyncQueue({
        id: pointId,
        type: 'point',
        action: 'create',
        data: pointData
      });
      
      // Trigger background sync (non-blocking)
      void this.syncToFirebaseNonBlocking?.();
      
      console.log('[HybridDB] GPS point saved locally, queued for sync');
      return true;
    });
  }

  private async updatePointCaches(trackId: string, point: any, skipProjectCacheUpdate?: boolean) {
    // Update point list cache
    const listKey = `track_${trackId}`;
    const existingList = await this.getLocalHydrated<any[]>('points', listKey) || [];
    const updatedList = [...existingList, point];
    await this.saveLocal('points', listKey, updatedList);

    // Update cached track detail if present
    const cachedTrack = await this.getLocalHydrated<any>('track', trackId);
    if (cachedTrack) {
      const updatedTrack = {
        ...cachedTrack,
        gps_points: [...(cachedTrack.gps_points || []), point]
      };
      await this.saveLocal('track', trackId, updatedTrack);
      
      // CRITICAL FIX: Also update the project tracks list cache
      if (!skipProjectCacheUpdate) {
        await this.updateProjectTracksCache(cachedTrack.project_id, trackId, updatedTrack);
      }
    }
  }
  
  /**
   * Update a track in the project tracks list cache
   * This ensures sidebar UI stays in sync with track changes
   */
  private async updateProjectTracksCache(projectId: string, trackId: string, updatedTrack: any) {
    // Update project tracks cache
    const projectTracksKey = `project_${projectId}`;
    const projectTracks = await this.getLocalHydrated<any[]>('tracks', projectTracksKey) || [];
    
    // Update the track in the project list
    const updatedProjectTracks = projectTracks.map(t => 
      t.id?.toString() === trackId.toString() ? updatedTrack : t
    );
    
    await this.saveLocal('tracks', projectTracksKey, updatedProjectTracks);
  }
  
  /**
   * Update sample caches including track detail and project tracks list
   */
  private async updateSampleCaches(trackId: string, sample: any) {
    // Update cached track detail if present
    const cachedTrack = await this.getLocalHydrated<any>('track', trackId);
    if (cachedTrack) {
      const updatedTrack = {
        ...cachedTrack,
        samples: [...(cachedTrack.samples || []), sample]
      };
      await this.saveLocal('track', trackId, updatedTrack);
      
      // Also update the project tracks list cache
      await this.updateProjectTracksCache(cachedTrack.project_id, trackId, updatedTrack);
    }
  }

  async getGpsPoints(trackId: string) {
    // CRITICAL: Always return local cache first to preserve unsync'd points
    // Don't fetch from Firebase during tracking - let sync queue handle it
    // This prevents local points from being overwritten with stale Firebase data
    const cached: any[] = await this.getLocalHydrated('points', `track_${trackId}`) || [];
    
    // Only attempt Firebase for historical data if cache is empty AND online
    if (cached.length === 0 && this.isOnline && this.isBackendAvailable) {
      try {
        // Attempting Firebase for track points (cache empty)
        const points = await firebaseGPS.getGpsPoints(this.uid, trackId);
        if (points && points.length > 0) {
          await this.saveLocal('points', `track_${trackId}`, points);
          return points;
        }
      } catch (error) {
        console.warn('[HybridDB] Firebase unavailable for initial points load:', error);
      }
    }
    
    return cached;
  }

// Samples
  async addSample(
    trackId: string,
    latitude: number,
    longitude: number,
    name: string,
    notes?: string,
    metadata?: {
      // Basic metadata
      depth_cm?: number;
      depth_from_cm?: number;
      depth_to_cm?: number;
      horizon?: string;
      horizon_description?: string;
      soil_type?: string;
      sampling_method?: string;
      coordinate_system?: string;
      device_accuracy_m?: number;
      operator?: string;
      
      // Location & Cadastral Data
      field_id?: string;
      field_name?: string;
      parcel_id?: string;
      cadastral_district?: string;
      legal_ref?: string;
      land_use?: string;
      
      // Crop Information
      current_crop?: string;
      previous_crop?: string;
      crop_rotation?: string;
      crop_stage?: string;
      last_harvest_date?: string;
      days_since_harvest?: number;
      fertilization_history?: string;
      
      // Laboratory Assignment
      laboratory_id?: string;
      laboratory_name?: string;
      laboratory_customer_id?: string;
      analysis_parameters?: string[];
      analysis_package?: string;
      analysis_methods?: string[];
      
      // Container & Chain of Custody
      container_id?: string;
      container_type?: string;
      sample_weight_g?: number;
      preservation_method?: string;
      sampled_by_signature?: string;
      reviewed_by?: string;
      transport_date?: string;
      transport_method?: string;
      
      // Quality Assurance
      sample_type?: string;
      qc_group_id?: string;
      sample_valid?: boolean;
      rejection_reason?: string;
      
      // Regulatory
      bundesland?: string;
      sampling_date?: string;
      regulatory_notes?: string;
      
      // Status tracking
      lab_export_status?: string;
      lab_exported_at?: string;
    }
  ) {
    return this.withTransaction(async () => {
      const rawTrackId = trackId as unknown;
      const normalizedTrackId = typeof rawTrackId === 'string'
        ? rawTrackId.trim()
        : (rawTrackId && typeof rawTrackId === 'object' && 'id' in (rawTrackId as any))
          ? String((rawTrackId as any).id || '').trim()
          : String(rawTrackId || '').trim();

      if (!normalizedTrackId || normalizedTrackId === '[object Object]') {
        throw new Error('Invalid track_id for sample');
      }

      const clientId = `sample_${normalizedTrackId}_${Date.now()}`;
      
      // Get current samples from LOCAL cache for accurate numbering
      const currentSamples = await this.getLocalHydrated<any[]>('samples', `track_${normalizedTrackId}`) || [];
      const sampleNumber = currentSamples.length + 1;
      
      // CRITICAL FIX: Sanitize metadata - remove undefined values to prevent Firestore errors
      const sanitizedMetadata: any = {};
      if (metadata) {
        Object.keys(metadata).forEach(key => {
          const value = (metadata as any)[key];
          if (value !== undefined) {
            sanitizedMetadata[key] = value === null ? null : value;
          }
        });
      }
      
      const sampleData = {
        id: clientId,
        track_id: normalizedTrackId,
        latitude,
        longitude,
        sample_number: sampleNumber,
        name,
        notes: notes || '',
        timestamp: createSerializableTimestamp(),
        ...sanitizedMetadata
      };
      
      // ALWAYS persist to IndexedDB first for data safety
      await this.saveLocal('sample', clientId, sampleData);
      await this.saveLocal('samples', `track_${normalizedTrackId}`, [...currentSamples, sampleData]);
      
      // Update cached track detail and project tracks list
      await this.updateSampleCaches(normalizedTrackId, sampleData);

      // Queue for background sync - never wait for Firebase
      this.addToSyncQueue({
        id: clientId,
        type: 'sample',
        action: 'create',
        data: sampleData
      });
      
      // Trigger background sync (non-blocking)
      void this.syncToFirebaseNonBlocking?.();
      
      console.log('[HybridDB] Sample saved locally, queued for sync');
      return clientId;
    });
  }

  async getSamples(trackId: string) {
    // Get local cached samples first
    const cached = await this.getLocalHydrated('samples', `track_${trackId}`) || [];
    
    // CRITICAL FIX: If backend available, fetch from Firebase and merge with local
    // This ensures PC sees samples synced from tablet
    if (this.isOnline && this.isBackendAvailable) {
      try {
        const firebaseSamples = await firebaseGPS.getSamples(this.uid, trackId);
        
        if (firebaseSamples && firebaseSamples.length > 0) {
          // Merge: deduplicate by ID, prefer Firebase versions (authoritative)
          const firebaseIds = new Set(firebaseSamples.map((s: any) => s.id));
          const localOnly = cached.filter((s: any) => !firebaseIds.has(s.id));
          const merged = [...firebaseSamples, ...localOnly];
          
          // Update cache with merged data
          await this.saveLocal('samples', `track_${trackId}`, merged);
          return merged;
        }
      } catch (error) {
        console.warn('[HybridDB] Firebase sample fetch failed, using cache:', error);
      }
    }
    
    // Return cached samples if offline or Firebase unavailable
    return cached;
  }

  async deleteSample(sampleId: string) {
    if (this.isOnline) {
      try {
        await firebaseGPS.deleteSample(this.uid, sampleId);
        return;
      } catch (error) {
        console.warn('Firebase unavailable, queuing delete:', error);
        // this.isOnline = false; // Removed: isOnline is now a getter
      }
    }
    
    this.addToSyncQueue({
      id: `delete_${Date.now()}`,
      type: 'sample',
      action: 'delete',
      data: { id: sampleId }
    });
  }

  async addFieldSample(
    projectId: string,
    fieldBoundaryId: string,
    latitude: number,
    longitude: number,
    name: string,
    notes?: string,
    metadata?: Record<string, any>
  ) {
    return this.withTransaction(async () => {
      const normalizedProjectId = String(projectId || '').trim();
      const normalizedFieldBoundaryId = String(fieldBoundaryId || '').trim();

      if (!normalizedProjectId || normalizedProjectId === '[object Object]') {
        throw new Error('Invalid project_id for field sample');
      }

      if (!normalizedFieldBoundaryId || normalizedFieldBoundaryId === '[object Object]') {
        throw new Error('Invalid field_boundary_id for field sample');
      }

      const listKey = `project_${normalizedProjectId}`;
      const currentSamples = await this.getLocalHydrated<GpsFieldSample[]>('field_samples', listKey) || [];

      const samplesInField = currentSamples.filter(
        (sample) => sample && String(sample.field_boundary_id) === normalizedFieldBoundaryId
      );
      const sampleNumber = samplesInField.length + 1;

      const sanitizedMetadata: Record<string, any> = {};
      if (metadata) {
        Object.keys(metadata).forEach(key => {
          const value = metadata[key];
          if (value !== undefined) {
            sanitizedMetadata[key] = value === null ? null : value;
          }
        });
      }

      const clientId = `field_sample_${normalizedFieldBoundaryId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const sampleData: GpsFieldSample = {
        id: clientId,
        project_id: normalizedProjectId,
        field_boundary_id: normalizedFieldBoundaryId,
        latitude,
        longitude,
        sample_number: sampleNumber,
        name,
        notes: notes || '',
        timestamp: createSerializableTimestamp(),
        created_at: createSerializableTimestamp(),
        ...sanitizedMetadata,
      };

      await this.saveLocal('field_sample', clientId, sampleData);
      await this.saveLocal('field_samples', listKey, [...currentSamples, sampleData]);

      this.addToSyncQueue({
        id: clientId,
        type: 'field_sample',
        action: 'create',
        data: sampleData,
      });

      void this.syncToFirebaseNonBlocking?.();

      return clientId;
    });
  }

  async getFieldSamples(projectId: string, fieldBoundaryId?: string) {
    const normalizedProjectId = String(projectId || '').trim();
    if (!normalizedProjectId) {
      return [] as GpsFieldSample[];
    }

    const listKey = `project_${normalizedProjectId}`;
    const cached = await this.getLocalHydrated<GpsFieldSample[]>('field_samples', listKey) || [];

    let merged = cached;

    if (this.isOnline && this.isBackendAvailable) {
      try {
        const firebaseSamples = await firebaseGPS.getFieldSamples(this.uid, normalizedProjectId);
        if (Array.isArray(firebaseSamples) && firebaseSamples.length > 0) {
          const firebaseIds = new Set(firebaseSamples.map((sample: any) => String(sample.id)));
          const localOnly = cached.filter((sample) => !firebaseIds.has(String(sample.id)));
          merged = [...firebaseSamples as GpsFieldSample[], ...localOnly];
          await this.saveLocal('field_samples', listKey, merged);
        }
      } catch (error) {
        console.warn('[HybridDB] Firebase field sample fetch failed, using cache:', error);
      }
    }

    if (!fieldBoundaryId) {
      return merged;
    }

    const normalizedFieldBoundaryId = String(fieldBoundaryId).trim();
    return merged.filter((sample) => String(sample.field_boundary_id) === normalizedFieldBoundaryId);
  }

  async deleteFieldSample(sampleId: string, projectId?: string) {
    const normalizedSampleId = String(sampleId || '').trim();
    if (!normalizedSampleId) {
      return;
    }

    if (projectId) {
      const listKey = `project_${projectId}`;
      const cached = await this.getLocalHydrated<GpsFieldSample[]>('field_samples', listKey) || [];
      const filtered = cached.filter(sample => String(sample.id) !== normalizedSampleId);
      await this.saveLocal('field_samples', listKey, filtered);
    }

    await this.removeLocal('field_sample', normalizedSampleId);

    this.addToSyncQueue({
      id: `delete_${Date.now()}`,
      type: 'field_sample',
      action: 'delete',
      data: { id: normalizedSampleId }
    });

    void this.syncToFirebaseNonBlocking?.();
  }

  // Field Boundaries
  async createFieldBoundary(projectId: string, name: string, geometry: any, color?: string, properties?: any) {
    const normalizedGeometry = this.validateGeometryInput(geometry);
    const renderMeta = buildBoundaryRenderMeta(normalizedGeometry);
    const geometryType = normalizedGeometry.type;
    const coordinates = normalizedGeometry.coordinates;
    const boundaryData = {
      project_id: projectId,
      name,
      geometry: normalizedGeometry,
      geometry_type: geometryType,
      coordinates,
      color,
      properties,
      render_meta: renderMeta
    };
    
    console.log('[HybridDB] Creating field boundary:', { name });
    
    if (this.isOnline) {
      try {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Firebase create timeout')), TIMEOUTS.BOUNDARY_CREATE)
        );

        const id = await Promise.race([
          firebaseGPS.createFieldBoundary(this.uid, projectId, name, normalizedGeometry, color, properties, undefined, renderMeta),
          timeoutPromise
        ]) as string;

        console.log('[HybridDB] ✅ Field boundary created in Firebase, syncing to tablet:', id);

        const normalizedBoundary = normalizeBoundary({
          id,
          ...boundaryData,
          project_id: projectId,
          created_at: createSerializableTimestamp()
        });

        await this.saveBoundaryToCache(projectId, normalizedBoundary);

        return normalizedBoundary;
      } catch (error) {
        console.warn('Firebase unavailable or timed out, saving locally:', error);
        // this.isOnline = false; // Removed: isOnline is now a getter
      }
    }
    
    const localId = `local_${Date.now()}`;
    const localBoundary = normalizeBoundary({
      id: localId,
      ...boundaryData,
      project_id: projectId,
      created_at: createSerializableTimestamp()
    });

    await this.saveLocal('boundary', localId, localBoundary);
    await this.saveBoundaryToCache(projectId, localBoundary);

    // CRITICAL FIX: Pre-serialize geometry to string for consistent storage across IndexedDB/localStorage
    this.addToSyncQueue({
      id: localId,
      type: 'boundary',
      action: 'create',
      data: {
        ...boundaryData,
        geometry: JSON.stringify(normalizedGeometry),
        render_meta: renderMeta
      }
    });
    
    return localBoundary;
  }

  private getBoundaryRenderMetaBackfillMarkerId(projectId: string): string {
    return `boundary_render_meta_backfill_v${this.boundaryRenderMetaBackfillVersion}_project_${projectId}`;
  }

  private boundaryNeedsRenderMetaBackfill(boundary: any): boolean {
    const meta = boundary?.render_meta;
    if (!meta || typeof meta !== 'object') {
      return true;
    }

    const bbox = meta.bbox;
    const centroid = meta.centroid;

    const hasValidBbox = Array.isArray(bbox)
      && bbox.length === 4
      && bbox.every((value: unknown) => typeof value === 'number' && Number.isFinite(value));

    const hasValidCentroid = centroid === null || (
      Array.isArray(centroid)
      && centroid.length === 2
      && centroid.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
    );

    return !hasValidBbox || !hasValidCentroid;
  }

  private extractBoundaryGeometry(boundary: any): { type: string; coordinates: any } | null {
    const geometry = boundary?.geometry;
    if (
      geometry
      && typeof geometry === 'object'
      && typeof geometry.type === 'string'
      && geometry.coordinates != null
    ) {
      return { type: geometry.type, coordinates: geometry.coordinates };
    }

    if (typeof boundary?.geometry_type === 'string' && boundary?.coordinates != null) {
      return {
        type: boundary.geometry_type,
        coordinates: boundary.coordinates,
      };
    }

    return null;
  }

  private async backfillBoundaryRenderMetaInBackground(projectId: string, firebaseBoundaries: any[]): Promise<void> {
    if (!this.uid || !this.isBackendAvailable) {
      return;
    }

    if (!projectId || !Array.isArray(firebaseBoundaries) || firebaseBoundaries.length === 0) {
      return;
    }

    const existingBackfill = this.ongoingBoundaryRenderMetaBackfill.get(projectId);
    if (existingBackfill) {
      return existingBackfill;
    }

    const backfillPromise = (async () => {
      const markerId = this.getBoundaryRenderMetaBackfillMarkerId(projectId);

      try {
        const marker = await this.getLocalHydrated<any>('meta', markerId);

        if (marker?.completed === true && marker?.version === this.boundaryRenderMetaBackfillVersion) {
          return;
        }

        if (
          marker?.completed === false
          && typeof marker?.lastAttemptAt === 'number'
          && (Date.now() - marker.lastAttemptAt) < 10 * 60 * 1000
        ) {
          return;
        }

        const boundariesToBackfill = firebaseBoundaries.filter((boundary) => this.boundaryNeedsRenderMetaBackfill(boundary));
        if (boundariesToBackfill.length === 0) {
          await this.saveLocal('meta', markerId, {
            version: this.boundaryRenderMetaBackfillVersion,
            completed: true,
            checkedAt: Date.now(),
            checkedCount: firebaseBoundaries.length,
            updatedCount: 0,
            failedCount: 0,
          });
          return;
        }

        let updatedCount = 0;
        let failedCount = 0;
        const patchedRenderMetaByBoundaryId = new Map<string, any>();

        for (const boundary of boundariesToBackfill) {
          const boundaryId = boundary?.id != null ? String(boundary.id) : '';
          if (!boundaryId) {
            failedCount += 1;
            continue;
          }

          try {
            const geometry = this.extractBoundaryGeometry(boundary);
            if (!geometry) {
              failedCount += 1;
              continue;
            }

            const renderMeta = buildBoundaryRenderMeta(geometry);
            await firebaseGPS.updateFieldBoundary(
              this.uid,
              boundaryId,
              undefined,
              undefined,
              undefined,
              undefined,
              renderMeta
            );

            patchedRenderMetaByBoundaryId.set(boundaryId, renderMeta);
            updatedCount += 1;
          } catch (error: any) {
            failedCount += 1;
            console.warn('[HybridDB] Boundary render_meta backfill failed for boundary', boundaryId, error?.message || error);
          }
        }

        if (patchedRenderMetaByBoundaryId.size > 0) {
          const cacheKey = `project_${projectId}`;
          const cachedRaw = await this.getLocalHydrated<any[]>('boundaries', cacheKey);

          if (Array.isArray(cachedRaw) && cachedRaw.length > 0) {
            const patchedCached = cachedRaw.map((boundary: any) => {
              const id = boundary?.id != null ? String(boundary.id) : '';
              const patchedMeta = id ? patchedRenderMetaByBoundaryId.get(id) : undefined;
              if (!patchedMeta) return boundary;
              return {
                ...boundary,
                render_meta: patchedMeta,
              };
            });

            await this.saveLocal('boundaries', cacheKey, normalizeBoundaries(patchedCached));
          }
        }

        const completed = failedCount === 0;
        await this.saveLocal('meta', markerId, {
          version: this.boundaryRenderMetaBackfillVersion,
          completed,
          lastAttemptAt: Date.now(),
          checkedCount: firebaseBoundaries.length,
          targetCount: boundariesToBackfill.length,
          updatedCount,
          failedCount,
        });

        if (updatedCount > 0) {
          console.log(`[HybridDB] Backfilled render_meta for ${updatedCount}/${boundariesToBackfill.length} boundaries in project ${projectId}`);
        }
      } catch (error: any) {
        console.warn('[HybridDB] Boundary render_meta backfill skipped:', error?.message || error);
      } finally {
        this.ongoingBoundaryRenderMetaBackfill.delete(projectId);
      }
    })();

    this.ongoingBoundaryRenderMetaBackfill.set(projectId, backfillPromise);
    return backfillPromise;
  }

  async getFieldBoundaries(projectId: string) {
    const cachedRaw = await this.getLocalHydrated<any[]>('boundaries', `project_${projectId}`);
    let cached = normalizeBoundaries(cachedRaw || []);

    // CRITICAL: Return cached data REGARDLESS of network status
    if (cached.length > 0) {
      // Only sync in background if actually online
      if (this.isBackendAvailable && navigator.onLine) {
        this.syncBoundariesInBackground(projectId).catch(err => {
          console.warn('[HybridDB] Background boundaries sync failed (cached data still available):', err.message);
        });
      }
      
      return cached;
    }

    // No cache - must fetch from Firebase (first load)
    if (this.isBackendAvailable) {
      try {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Firebase fetch timeout after 30s')), TIMEOUTS.BOUNDARY_FETCH)
        );
        const startTime = Date.now();
        const boundaries = await Promise.race([
          firebaseGPS.getFieldBoundaries(this.uid, projectId),
          timeoutPromise
        ]) as any[];
        void this.backfillBoundaryRenderMetaInBackground(projectId, boundaries);
        const duration = Date.now() - startTime;
        const normalized = normalizeBoundaries(boundaries);
        await this.saveLocal('boundaries', `project_${projectId}`, normalized);

        console.log('[HybridDB] Firebase getFieldBoundaries successful:', normalized.length, 'boundaries in', duration + 'ms');
        return normalized;
      } catch (error: any) {
        console.warn('[HybridDB] Firebase getFieldBoundaries failed:', {
          message: error.message,
          projectId
        });
      }
    }
    
    // Offline or Firebase failed - return empty array (user can create boundaries)
    console.log('[HybridDB] Returning empty array (offline or first load)');
    return [];
  }

  // Background sync for boundaries (non-blocking)
  private async syncBoundariesInBackground(projectId: string): Promise<void> {
    // Debounce: If already syncing this project, return existing promise
    const existingSync = this.ongoingBoundarySync.get(projectId);
    if (existingSync) {
      return existingSync;
    }
    
    const syncPromise = (async () => {
      try {
        console.log('[HybridDB] Starting background boundaries sync for project', projectId);
        const boundaries = await firebaseGPS.getFieldBoundaries(this.uid, projectId);
        void this.backfillBoundaryRenderMetaInBackground(projectId, boundaries);
        
        if (boundaries.length > 0) {
        console.log('[HybridDB] Background sync received', boundaries.length, 'boundaries');
        const normalized = normalizeBoundaries(boundaries);
        await this.saveLocal('boundaries', `project_${projectId}`, normalized);
        
        console.log('[HybridDB] Background boundaries sync completed successfully');
      }
    } catch (error: any) {
      console.warn('[HybridDB] Background boundaries sync failed:', error.message);
      // Don't throw - this is background sync, failure is acceptable
    } finally {
      // Clear debounce flag
      this.ongoingBoundarySync.delete(projectId);
    }
    })();
    
    // Store ongoing sync promise
    this.ongoingBoundarySync.set(projectId, syncPromise);
    return syncPromise;
  }

  // Background sync for tracks (non-blocking)
  private async syncTracksInBackground(projectId: string): Promise<void> {
    // Debounce: If already syncing this project, return existing promise
    const existingSync = this.ongoingTrackSync.get(projectId);
    if (existingSync) {
      return existingSync;
    }
    
    const syncPromise = (async () => {
      try {
        // CRITICAL FIX: Get cached tracks first to merge with Firebase data
        const cachedTracks = await this.getLocalHydrated('tracks', `project_${projectId}`) || [];
        const firebaseTracks = await firebaseGPS.getTracks(this.uid, projectId);
        
        // CRITICAL FIX: Merge cached tracks with Firebase tracks to preserve local-only tracks
        // This prevents overwriting local tracks that haven't synced yet
        const cachedTrackIds = new Set(cachedTracks.map((t: any) => t.id));
        const firebaseTrackIds = new Set(firebaseTracks.map((t: any) => t.id));
        
        // CRITICAL FIX: Identify tracks that exist locally but not in Firebase
        // These were likely deleted on another device
        const deletedTrackIds = Array.from(cachedTrackIds).filter(id => !firebaseTrackIds.has(id));
        
        // Check sync queue to see if any "deleted" tracks are actually pending creation
        const pendingCreation = this.syncQueue
          .filter(item => item.type === 'track' && item.action === 'create')
          .map(item => item.id);
        
        // Only keep local tracks that are pending creation (not yet synced)
        const localOnlyTracks = cachedTracks.filter((t: any) => {
          const isPending = pendingCreation.includes(t.id);
          return isPending && !firebaseTrackIds.has(t.id);
        });
        
        // CRITICAL FIX: Clean up deleted tracks from individual caches
        for (const deletedId of deletedTrackIds) {
          if (!pendingCreation.includes(deletedId)) {
            console.log(`[HybridDB] Removing deleted track from cache: ${deletedId}`);
            await this.removeLocal('track', deletedId);
            await this.removeLocal('points', `track_${deletedId}`);
            await this.removeLocal('samples', `track_${deletedId}`);
          }
        }
        
        // Merge: Firebase tracks (authoritative) + local-only pending tracks
        const mergedTracks = [...firebaseTracks, ...localOnlyTracks];
        
        await this.saveLocal('tracks', `project_${projectId}`, mergedTracks);
        
        const deletedCount = deletedTrackIds.length - localOnlyTracks.length;
        console.log('[HybridDB] Background track sync completed:', {
          firebase: firebaseTracks.length,
          localOnly: localOnlyTracks.length,
          deleted: deletedCount,
          total: mergedTracks.length
        });
      } catch (error: any) {
        console.warn('[HybridDB] Background track sync failed:', error.message);
        // Don't throw - this is background sync, failure is acceptable
      } finally {
        // Clear debounce flag
        this.ongoingTrackSync.delete(projectId);
      }
    })();
    
    // Store ongoing sync promise
    this.ongoingTrackSync.set(projectId, syncPromise);
    return syncPromise;
  }

  async deleteFieldBoundary(boundaryId: string) {
    const cachedLookup = await this.findCachedBoundary(boundaryId);

    if (cachedLookup.cacheKey) {
      const cachedList = await this.getLocalHydrated<any[]>('boundaries', cachedLookup.cacheKey);
      const updated = normalizeBoundaries(cachedList || []).filter((b: any) => b.id?.toString() !== boundaryId.toString());
      await this.saveLocal('boundaries', cachedLookup.cacheKey, updated);
    }

    if (this.isBackendAvailable) {
      try {
        await firebaseGPS.deleteFieldBoundary(this.uid, boundaryId);
        return;
      } catch (error) {
        console.warn('Firebase unavailable, queuing delete:', error);
        // this.isOnline = false; // Removed: isOnline is now a getter
      }
    }
    
    this.addToSyncQueue({
      id: `delete_${Date.now()}`,
      type: 'boundary',
      action: 'delete',
      data: { id: boundaryId }
    });
  }

  async updateFieldBoundary(
    boundaryInput: GpsFieldBoundary | string,
    name?: string,
    geometry?: any,
    color?: string,
    properties?: any
  ) {
    // Support both full boundary object and individual parameters
    let boundaryId: string;
    let updateData: Partial<GpsFieldBoundary>;
    let geometryForUpdate: { type: string; coordinates: any } | undefined;
    
    if (typeof boundaryInput === 'object') {
      // Full boundary object provided
      boundaryId = String(boundaryInput.id);
      updateData = {
        name: boundaryInput.name,
        color: boundaryInput.color,
        properties: boundaryInput.properties,
        manual_samples: boundaryInput.manual_samples,
        render_meta: boundaryInput.render_meta,
      };
      if (boundaryInput.coordinates) {
        updateData.coordinates = boundaryInput.coordinates;
        updateData.geometry_type = boundaryInput.geometry_type;
        geometryForUpdate = {
          type: boundaryInput.geometry_type,
          coordinates: boundaryInput.coordinates,
        };
      }
    } else {
      // Individual parameters (legacy support)
      boundaryId = boundaryInput;
      updateData = {
        ...(name && { name }),
        ...(color && { color }),
        ...(properties && { properties }),
      };
      if (geometry) {
        const normalizedGeometry = this.validateGeometryInput(geometry);
        updateData.coordinates = normalizedGeometry.coordinates;
        updateData.geometry_type = normalizedGeometry.type as any;
        geometryForUpdate = normalizedGeometry;
      }
    }

    if (geometryForUpdate) {
      updateData.render_meta = buildBoundaryRenderMeta(geometryForUpdate);
    }
    
    console.log('[HybridDB] Updating field boundary:', { boundaryId, updateData });
    
    const cachedLookup = await this.findCachedBoundary(boundaryId);
    if (cachedLookup.boundary && cachedLookup.cacheKey) {
      const updatedBoundary = {
        ...cachedLookup.boundary,
        ...updateData,
        updated_at: createSerializableTimestamp()
      };
      const normalized = normalizeBoundary(updatedBoundary);
      await this.saveBoundaryToCache(cachedLookup.cacheKey.replace('project_', ''), normalized);
    }

    if (this.isOnline) {
      try {
        // For Firebase, still use individual parameters
        const geoData = geometryForUpdate;
        
        await firebaseGPS.updateFieldBoundary(
          this.uid,
          boundaryId,
          updateData.name,
          geoData,
          updateData.color,
          {
            ...updateData.properties,
            ...(updateData.manual_samples && { manual_samples: updateData.manual_samples })
          },
          updateData.render_meta
        );
        console.log('[HybridDB] ✅ Field boundary updated in Firebase, will sync to tablet');
        return;
      } catch (error) {
        console.warn('Firebase unavailable, queuing update:', error);
        // this.isOnline = false; // Removed: isOnline is now a getter
      }
    }
    
    // CRITICAL FIX: Pre-serialize geometry to string for consistent storage across IndexedDB/localStorage
    this.addToSyncQueue({
      id: `update_${Date.now()}`,
      type: 'boundary',
      action: 'update',
      data: { 
        id: boundaryId,
        ...updateData,
        geometry: geometryForUpdate ? JSON.stringify(geometryForUpdate) : undefined,
        render_meta: updateData.render_meta
      }
    });
  }

  /**
   * Validate geometry input using centralized utility
   * @deprecated Use normalizeGeometry from geometryUtils instead
   */
  private validateGeometryInput(rawGeometry: any): { type: string; coordinates: any } {
    try {
      return normalizeGeometry(rawGeometry);
    } catch (error) {
      throw new Error(`Invalid geometry: ${error instanceof Error ? error.message : 'validation failed'}`);
    }
  }

  // Devices
  async getDevices() {
    // Get cached devices
    let cached = await this.getLocalHydrated('devices', 'all') || [];

    // If we already have cache, return it and refresh in background
    if (cached.length > 0) {
      if (this.isOnline) {
        firebaseGPS.getDevices(this.uid).then(devices => {
          this.saveLocal('devices', 'all', devices);
          console.log('Devices synced from Firebase');
        }).catch(error => {
          console.warn('Firebase sync failed, using cache:', error);
        });
      }
      return cached;
    }

    // No cache: attempt a one-shot fetch if navigator is online (even if backendOnline was false)
    if (this.isOnline || (navigator.onLine && !this.isDefinitelyOffline)) {
      try {
        const devices = await firebaseGPS.getDevices(this.uid);
        this.backendOnline = true;
        await this.saveLocal('devices', 'all', devices);
        return devices;
      } catch (error) {
        console.warn('Firebase devices fetch failed, staying with empty cache:', error);
        this.markBackendOffline((error as any)?.message || 'devices fetch failed');
      }
    }

    // Final fallback: return empty array
    return cached;
  }

  async saveDevice(device: any) {
    const existingId = device.id as string | undefined;
    const nowIso = createSerializableTimestamp();
    const cachedDevices = await this.getLocalHydrated<any[]>('devices', 'all') || [];
    const cachedMatch = existingId ? cachedDevices.find(d => d.id === existingId) : null;
    const createdAt = device.created_at || cachedMatch?.created_at || nowIso;
    const sanitizedDevice = {
      name: device.name || 'Unnamed Device',
      device_type: device.device_type || device.type || 'generic_bluetooth',
      connection_type: device.connection_type || 'bluetooth',
      address: device.address || '',
      manufacturer: device.manufacturer,
      model: device.model,
      capabilities: device.capabilities,
      config: device.config,
      created_at: createdAt,
      updated_at: nowIso,
    };

    // Always save locally first for instant feedback
    const assignedId = existingId || `local_${Date.now()}`;
    const localDevice = { ...sanitizedDevice, id: assignedId };
    await this.saveDeviceToCache(localDevice);

    // Try Firebase in background if online
    if (this.isOnline) {
      try {
        // Don't await - do it in background
        firebaseGPS.saveDevice(this.uid, sanitizedDevice, existingId).then(id => {
          console.log('Device synced to Firebase:', id);
        }).catch(error => {
          console.warn('Firebase sync failed, queued for later:', error);
          this.addToSyncQueue({
            id: assignedId,
            type: 'device',
            action: existingId ? 'update' : 'create',
            data: { ...sanitizedDevice, id: assignedId }
          });
        });
      } catch (error) {
        console.warn('Firebase unavailable, will sync later:', error);
        this.addToSyncQueue({
          id: assignedId,
          type: 'device',
          action: existingId ? 'update' : 'create',
          data: { ...sanitizedDevice, id: assignedId }
        });
      }
    } else {
      // Queue for later sync when back online
      this.addToSyncQueue({
        id: assignedId,
        type: 'device',
        action: existingId ? 'update' : 'create',
        data: { ...sanitizedDevice, id: assignedId }
      });
    }
    
    return localDevice;
  }

  private async saveDeviceToCache(device: any) {
    const key = 'devices';
    const listKey = 'all';
    const cached = await this.getLocalHydrated<any[]>(key, listKey) || [];
    const updated = [...cached.filter(d => d.id !== device.id), device];
    this.saveLocal(key, listKey, updated);
  }

  async deleteDevice(deviceId: string) {
    // Remove from cache immediately
    const cached = await this.getLocalHydrated('devices', 'all') || [];
    const filtered = cached.filter((d: any) => d.id !== deviceId);
    this.saveLocal('devices', 'all', filtered);

    // Delete from Firebase in background
    if (this.isOnline) {
      firebaseGPS.deleteDevice(this.uid, deviceId).then(() => {
        console.log('Device deleted from Firebase:', deviceId);
      }).catch(error => {
        console.warn('Firebase delete failed, queued:', error);
        this.addToSyncQueue({
          id: `delete_${Date.now()}`,
          type: 'device',
          action: 'delete',
          data: { id: deviceId }
        });
      });
    } else {
      // Queue for later
      this.addToSyncQueue({
        id: `delete_${Date.now()}`,
        type: 'device',
        action: 'delete',
        data: { id: deviceId }
      });
    }
  }

  // Local storage helpers - IndexedDB as primary
  // REMOVED: localStorage cache layer to prevent quota exceeded errors and performance issues
  private async saveLocal(type: string, id: string, data: any): Promise<void> {
    const key = `${this.LOCAL_DATA_PREFIX}${type}_${id}`;
    
    // Add timestamp for cache invalidation
    const cachedData = {
      data,
      timestamp: Date.now(),
      version: '1.0' // For future conflict resolution
    };
    
    try {
      // Primary storage: IndexedDB
      if (indexedDBService.available()) {
        await indexedDBService.set(key, cachedData);
        // console.log(`[Storage] Saved to IndexedDB: ${key}`);
      } else {
        // Emergency fallback only
        try {
          localStorage.setItem(key, JSON.stringify(cachedData));
        } catch (quotaError) {
          console.warn('[Storage] localStorage quota exceeded in fallback');
        }
      }
    } catch (error) {
      console.error('[Storage] Error saving to local storage:', error);
      throw error; // Re-throw for caller to handle
    }
  }

  private async getLocalHydrated<T = any>(type: string, id: string): Promise<T | null> {
    const key = `${this.LOCAL_DATA_PREFIX}${type}_${id}`;

    try {
      // Primary storage: IndexedDB
      let value: any = null;
      
      if (indexedDBService.available()) {
        value = await indexedDBService.get(key);
      } else {
        // Legacy/Fallback: Check localStorage
        const cached = localStorage.getItem(key);
        if (cached) {
          try {
            value = JSON.parse(cached);
          } catch {
            // Invalid cache, ignore
          }
        }
      }

      if (value === null || value === undefined) {
        return null;
      }

      // Handle timestamped cache data
      if (value && typeof value === 'object' && 'timestamp' in value && 'data' in value) {
        // Check if cache is fresh (< 5 minutes for projects, < 1 hour for other data)
        const maxAge = type === 'projects' ? 5 * 60 * 1000 : 60 * 60 * 1000;
        const age = Date.now() - (value.timestamp || 0);
        
        if (age > maxAge) {
          // Cache expired, return null to force refresh
          // Background sync will update with fresh data
        }
        
        return value.data as T;
      }

      // Legacy data without timestamp wrapper - return as-is
      return value as T;
    } catch (error) {
      console.error('[Storage] Error reading from storage:', error);
      return null;
    }
  }

  private async removeLocal(type: string, id: string): Promise<void> {
    const key = `${this.LOCAL_DATA_PREFIX}${type}_${id}`;
    
    try {
      // Primary storage: IndexedDB
      if (indexedDBService.available()) {
        await indexedDBService.delete(key);
        console.log(`[Storage] Removed from IndexedDB: ${key}`);
      }

      // Remove from localStorage cache
      try {
        localStorage.removeItem(key);
      } catch (error) {
        console.warn('[Storage] Could not remove from localStorage:', error);
      }
    } catch (error) {
      console.error('[Storage] Error removing from local storage:', error);
      throw error;
    }
  }



  // Status methods
  getStatus() {
    // For native apps, backend is not required - Firebase is the backend
    const online = this.isBackendAvailable;

    // Redact queue payloads to avoid leaking data in debug/status UI
    const queuePreview = this.syncQueue.map(item => ({
      id: item.id,
      type: item.type,
      action: item.action,
      timestamp: item.timestamp,
      attempts: item.attempts || 0,
      nextAttemptAt: item.nextAttemptAt || null
    }));

    return {
      online,
      firebaseOnline: online,
      backendOnline: this.backendOnline,
      internetOnline: this.isOnline,
      pendingSync: this.syncQueue.length,
      queuedItems: queuePreview,
      stateMachine: this.stateMachine.getDiagnostics()
    };
  }

  async forceSyncNow() {
    console.log('[SYNC] 🚀 Force sync requested');
    
    if (!this.uid) {
      console.error('[SYNC] Cannot sync - no user ID');
      throw new Error('Must be logged in to sync');
    }
    
    if (this.syncQueue.length === 0) {
      console.log('[SYNC] No items to sync');
      return { success: true, message: 'No items to sync', syncedCount: 0 };
    }
    
    if (!this.isOnline) {
      console.error('[SYNC] Cannot sync - device offline');
      throw new Error('Cannot sync while offline');
    }
    
    // Force connectivity check
    const connectivityResult = await this.refreshConnectivity(true);
    if (!connectivityResult.success) {
      throw new Error(`Cannot reach Firebase: ${connectivityResult.error}`);
    }
    
    const queueLengthBefore = this.syncQueue.length;
    await this.syncToFirebase();
    const syncedCount = queueLengthBefore - this.syncQueue.length;
    
    console.log(`[SYNC] ✅ Force sync completed: ${syncedCount} items synced`);
    return { success: true, message: `Synced ${syncedCount} items`, syncedCount };
  }

  /**
   * Get detailed sync diagnostics for troubleshooting
   */
  getSyncDiagnostics() {
    return {
      network: {
        navigatorOnline: navigator.onLine,
        backendOnline: this.backendOnline,
        isBackendAvailable: this.isBackendAvailable,
        isDefinitelyOffline: this.isDefinitelyOffline,
        lastCheck: this.lastConnectivityCheck ? `${Math.floor((Date.now() - this.lastConnectivityCheck) / 1000)}s ago` : 'never',
        backoffMs: this.connectivityBackoffMs
      },
      queue: {
        length: this.syncQueue.length,
        isSyncing: this.isSyncing,
        items: this.syncQueue.map(item => ({
          type: item.type,
          action: item.action,
          attempts: item.attempts,
          age: `${Math.floor((Date.now() - item.timestamp) / 1000)}s`
        }))
      },
      auth: {
        uid: this.uid ? 'SET' : 'EMPTY',
        firebaseUser: auth.currentUser?.uid || 'NO_AUTH'
      },
      platform: {
        type: 'IndexedDB'
      }
    };
  }

  /**
   * Clear all duplicate projects from cache and keep only unique ones.
   * Useful for cleaning up after sync issues.
   */
  async clearDuplicates() {
    if (!this.uid) {
      throw new Error('Must be logged in to clear duplicates');
    }

    // Get current projects (already deduplicated by getProjects)
    const uniqueProjects = await this.getProjects();
    
    // Update cache with deduplicated list
    const cacheKey = `gps_projects_${this.uid}`;
    localStorage.setItem(cacheKey, JSON.stringify(uniqueProjects));
    
    console.log(`Cleared duplicates. Kept ${uniqueProjects.length} unique projects.`);
    return uniqueProjects.length;
  }

  // Cleanup method
  destroy() {
    console.log('[HybridDB] Destroying service and cleaning up resources...');
    
    // Clear intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.connectivityCheckTimer) {
      clearInterval(this.connectivityCheckTimer);
      this.connectivityCheckTimer = null;
    }
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.queueCleanupTimer) {
      clearInterval(this.queueCleanupTimer);
      this.queueCleanupTimer = null;
    }
    if (this.periodicSyncTimer) {
      clearInterval(this.periodicSyncTimer);
      this.periodicSyncTimer = null;
    }
    if (this.queuePersistTimer) {
      clearTimeout(this.queuePersistTimer);
      this.queuePersistTimer = null;
    }
    
    // Remove event listeners
    this.eventListeners.forEach(({ event, handler }) => {
      window.removeEventListener(event, handler);
    });
    this.eventListeners = [];
    
    // Clear transaction queue
    this.transactionQueue.forEach(resolve => resolve());
    this.transactionQueue = [];
    this.transactionLock = false;
    
    console.log('[HybridDB] Cleanup complete');
  }
}

// Export singleton instance
export const hybridDB = new HybridDatabaseService();
