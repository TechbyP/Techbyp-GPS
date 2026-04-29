/**
 * Firebase Sync Debug Utility
 * Helps diagnose sync issues between tablet and Firebase
 */

import { hybridDB } from '../services/hybridDatabase';
import { initializeDatabaseSafely, recoverDatabase, resetDatabaseCompletely } from '../services/databaseRecovery';
import { firebaseGPS } from '../services/firebaseSync';
import { auth } from '../firebase';
import { localDB } from '../services/localDatabase';

export class FirebaseSyncDebugger {
  /**
   * Comprehensive sync status check
   */
  static async checkSyncStatus(uid?: string): Promise<any> {
    const userId = uid || auth.currentUser?.uid || '';
    
    console.log('🔍 Firebase Sync Debug Check Started');
    
    const results = {
      timestamp: new Date().toISOString(),
      networkStatus: {
        navigatorOnline: navigator.onLine,
        connection: (navigator as any).connection?.effectiveType || 'unknown'
      },
      authentication: {
        isAuthenticated: !!auth.currentUser,
        userId: auth.currentUser?.uid || 'none',
        email: auth.currentUser?.email || 'none',
        isAnonymous: auth.currentUser?.isAnonymous || false
      },
      firebaseConnectivity: null as any,
      hybridDbStatus: null as any,
      projectsCheck: null as any,
      syncQueueCheck: null as any
    };

    // 1. Check Firebase connectivity
    try {
      console.log('📡 Testing Firebase connectivity...');
      const pingStart = Date.now();
      results.firebaseConnectivity = await firebaseGPS.ping();
      results.firebaseConnectivity.duration = Date.now() - pingStart;
      console.log('📡 Firebase ping result:', results.firebaseConnectivity);
    } catch (error: any) {
      results.firebaseConnectivity = { success: false, error: error.message };
    }

    // 2. Check hybrid DB status
    try {
      console.log('🗄️ Checking hybrid DB status...');
      results.hybridDbStatus = {
        uid: userId,
        hasUserId: !!userId,
        // Access private properties via any cast for debugging
        isOnline: (hybridDB as any).isOnline,
        isBackendAvailable: (hybridDB as any).isBackendAvailable,
        backendOnline: (hybridDB as any).backendOnline,
        connectivityBackoffMs: (hybridDB as any).connectivityBackoffMs,
        lastConnectivityCheck: (hybridDB as any).lastConnectivityCheck,
        syncQueueLength: (hybridDB as any).syncQueue?.length || 0
      };
    } catch (error: any) {
      results.hybridDbStatus = { error: error.message };
    }

    // 3. Test projects fetch directly from Firebase
    if (userId && results.authentication.isAuthenticated) {
      try {
        console.log('📋 Testing direct Firebase projects fetch...');
        const projectsStart = Date.now();
        const firebaseProjects = await firebaseGPS.getProjects(userId);
        results.projectsCheck = {
          success: true,
          count: firebaseProjects.length,
          duration: Date.now() - projectsStart,
          projects: firebaseProjects.map((p: any) => ({ id: p.id, name: p.name, created_at: p.created_at }))
        };
        console.log('📋 Firebase projects result:', results.projectsCheck);
      } catch (error: any) {
        results.projectsCheck = { success: false, error: error.message };
      }
    } else {
      results.projectsCheck = { skipped: 'No authenticated user' };
    }

    // 4. Check local sync queue
    try {
      console.log('📤 Checking sync queue...');
      const syncQueue = (hybridDB as any).syncQueue || [];
      results.syncQueueCheck = {
        queueLength: syncQueue.length,
        items: syncQueue.slice(0, 5).map((item: any) => ({
          id: item.id,
          type: item.type,
          action: item.action,
          timestamp: new Date(item.timestamp).toISOString(),
          attempts: item.attempts || 0,
          nextAttemptAt: item.nextAttemptAt ? new Date(item.nextAttemptAt).toISOString() : null
        }))
      };
    } catch (error: any) {
      results.syncQueueCheck = { error: error.message };
    }

    console.log('🔍 Firebase Sync Debug Complete:', results);
    return results;
  }

  /**
   * Force sync attempt
   */
  static async forceSyncAttempt(): Promise<any> {
    console.log('🔄 Forcing sync attempt...');
    
    try {
      // Force connectivity refresh
      const connectivityResult = await (hybridDB as any).refreshConnectivity(true);
      console.log('📡 Connectivity refresh:', connectivityResult);

      // Trigger sync
      if (connectivityResult.success) {
        await (hybridDB as any).syncToFirebaseNonBlocking();
        console.log('🔄 Sync triggered');
      }

      return { success: true, connectivity: connectivityResult };
    } catch (error: any) {
      console.error('🔄 Force sync failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Inspect sync queue with full details
   */
  static inspectQueue(): any {
    try {
      const queue = (hybridDB as any).syncQueue || [];
      const summary = {
        total: queue.length,
        byType: queue.reduce((acc: Record<string, number>, it: any) => {
          acc[it.type] = (acc[it.type] || 0) + 1;
          return acc;
        }, {}),
        byAction: queue.reduce((acc: Record<string, number>, it: any) => {
          acc[it.action] = (acc[it.action] || 0) + 1;
          return acc;
        }, {}),
        tracks: queue.filter((it: any) => it.type === 'track'),
        samples: queue.filter((it: any) => it.type === 'sample'),
        points: queue.filter((it: any) => it.type === 'point')
      };

      console.log('📤 Sync Queue Summary:', summary);
      console.log('📊 Tracks in queue:', summary.tracks.map((t: any) => ({ id: t.id, name: t.data?.name, action: t.action })));
      console.log('🧪 Samples in queue:', summary.samples.map((s: any) => ({ id: s.id, name: s.data?.name, track_id: s.data?.track_id, attempts: s.attempts })));
      console.log('📍 GPS Points in queue:', summary.points.length);
      
      queue.forEach((item: any, idx: number) => {
        const display: any = {
          id: item.id,
          type: item.type,
          action: item.action,
          data: {
            name: item.data?.name,
            project_id: item.data?.project_id,
            track_id: item.data?.track_id,
            field_boundary_id: item.data?.field_boundary_id
          },
          attempts: item.attempts || 0,
          nextAttemptAt: item.nextAttemptAt ? new Date(item.nextAttemptAt).toISOString() : 'ready',
          timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : 'n/a'
        };
        
        // Highlight local track IDs
        if (item.data?.track_id && item.data.track_id.startsWith('local_')) {
          display.WARNING = '⚠️ References local track ID - may need track sync first';
        }
        
        console.log(`[${idx + 1}/${queue.length}]`, display);
      });
      return { success: true, summary, items: queue };
    } catch (error: any) {
      console.error('❌ Failed to inspect queue:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clear sync queue (optionally filter by type/action)
   * Usage:
   *  - FirebaseSyncDebugger.clearQueue() // clears all
   *  - FirebaseSyncDebugger.clearQueue({ type: 'track' })
   *  - FirebaseSyncDebugger.clearQueue({ type: 'track', action: 'update' })
   */
  static async clearQueue(filter?: { type?: string; action?: string }): Promise<any> {
    try {
      const dbAny = (hybridDB as any);
      const queue: any[] = dbAny.syncQueue || [];
      const before = queue.length;

      let newQueue = queue;
      if (filter?.type || filter?.action) {
        newQueue = queue.filter(it => {
          const typeOk = filter?.type ? it.type !== filter.type : true;
          const actionOk = filter?.action ? it.action !== filter.action : true;
          return typeOk || actionOk; // remove only when BOTH match
        });
      } else {
        newQueue = [];
      }

      dbAny.syncQueue = newQueue;
      await dbAny.saveSyncQueue();

      const removed = before - newQueue.length;
      console.warn(`🧹 Cleared ${removed} item(s) from sync queue${filter ? ' (filtered)' : ''}.`);
      return { success: true, removed, remaining: newQueue.length };
    } catch (error: any) {
      console.error('❌ Failed to clear queue:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove a specific item from sync queue by ID
   * Usage: FirebaseSyncDebugger.removeQueueItem('update_1765953496107')
   */
  static async removeQueueItem(itemId: string): Promise<any> {
    try {
      const dbAny = (hybridDB as any);
      const queue: any[] = dbAny.syncQueue || [];
      const before = queue.length;
      
      const item = queue.find(it => it.id === itemId);
      if (!item) {
        console.warn(`⚠️ Item ${itemId} not found in queue`);
        return { success: false, error: 'Item not found' };
      }
      
      console.log(`🗑️ Removing item from queue:`, {
        id: item.id,
        type: item.type,
        action: item.action,
        attempts: item.attempts,
        name: item.data?.name
      });
      
      dbAny.syncQueue = queue.filter(it => it.id !== itemId);
      await dbAny.saveSyncQueue();
      
      console.log(`✅ Removed item ${itemId} from sync queue (${before} -> ${dbAny.syncQueue.length})`);
      return { success: true, removed: item, remaining: dbAny.syncQueue.length };
    } catch (error: any) {
      console.error('❌ Failed to remove queue item:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove all items with high attempt counts (likely broken)
   * Usage: FirebaseSyncDebugger.clearBrokenItems(10) // removes items with 10+ attempts
   */
  static async clearBrokenItems(minAttempts: number = 10): Promise<any> {
    try {
      const dbAny = (hybridDB as any);
      const queue: any[] = dbAny.syncQueue || [];
      const before = queue.length;
      
      const brokenItems = queue.filter(it => (it.attempts || 0) >= minAttempts);
      console.log(`🔍 Found ${brokenItems.length} items with ${minAttempts}+ attempts:`, 
        brokenItems.map(it => ({ id: it.id, type: it.type, action: it.action, attempts: it.attempts }))
      );
      
      if (brokenItems.length === 0) {
        console.log('✅ No broken items found');
        return { success: true, removed: 0, remaining: queue.length };
      }
      
      dbAny.syncQueue = queue.filter(it => (it.attempts || 0) < minAttempts);
      await dbAny.saveSyncQueue();
      
      const removed = before - dbAny.syncQueue.length;
      console.warn(`🧹 Removed ${removed} broken item(s) from sync queue`);
      return { success: true, removed, brokenItems, remaining: dbAny.syncQueue.length };
    } catch (error: any) {
      console.error('❌ Failed to clear broken items:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Retry now: triggers connectivity refresh and non-blocking sync
   */
  static async retryNow(): Promise<any> {
    try {
      await (hybridDB as any).refreshConnectivity(true);
      await (hybridDB as any).syncToFirebaseNonBlocking();
      console.log('🔁 Retry sync triggered');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Compare local vs Firebase data
   */
  static async compareLocalVsFirebase(uid?: string): Promise<any> {
    const userId = uid || auth.currentUser?.uid || '';
    
    if (!userId) {
      return { error: 'No user ID available' };
    }

    console.log('🔄 Comparing local vs Firebase data...');

    const comparison = {
      local: null as any,
      firebase: null as any,
      differences: [] as string[]
    };

    try {
      // Get local projects
      const localProjects = await hybridDB.getProjects();
      comparison.local = {
        projectCount: localProjects.length,
        projects: localProjects.map(p => ({ id: p.id, name: p.name, created_at: p.created_at }))
      };

      // Get Firebase projects
      const firebaseProjects = await firebaseGPS.getProjects(userId);
      comparison.firebase = {
        projectCount: firebaseProjects.length,
        projects: firebaseProjects.map(p => ({ id: p.id, name: p.name, created_at: p.created_at }))
      };

      // Find differences
      if (comparison.local.projectCount !== comparison.firebase.projectCount) {
        comparison.differences.push(`Project count mismatch: local=${comparison.local.projectCount}, firebase=${comparison.firebase.projectCount}`);
      }

      // Check for missing projects
      const localIds = new Set(localProjects.map(p => p.id));
      const firebaseIds = new Set(firebaseProjects.map((p: any) => p.id));

      for (const fbId of firebaseIds) {
        if (!localIds.has(fbId)) {
          const fbProject = firebaseProjects.find((p: any) => p.id === fbId);
          comparison.differences.push(`Missing locally: ${fbProject.name} (${fbId})`);
        }
      }

      for (const localId of localIds) {
        if (!firebaseIds.has(localId)) {
          const localProject = localProjects.find(p => p.id === localId);
          comparison.differences.push(`Missing from Firebase: ${localProject.name} (${localId})`);
        }
      }

    } catch (error: any) {
      comparison.differences.push(`Comparison failed: ${error.message}`);
    }

    console.log('🔄 Comparison complete:', comparison);
    return comparison;
  }

  /**
   * Clear local cache and force fresh sync
   */
  static async clearCacheAndResync(): Promise<any> {
    console.log('🧹 Clearing local cache and forcing resync...');
    
    try {
      // Clear localStorage cache
      const userId = auth.currentUser?.uid || '';
      if (userId) {
        const keys = Object.keys(localStorage);
        let clearedCount = 0;
        
        for (const key of keys) {
          if (key.includes(`gps_local_${userId}_`)) {
            localStorage.removeItem(key);
            clearedCount++;
          }
        }
        
        console.log(`🧹 Cleared ${clearedCount} local cache items`);
        
        // Force fresh data fetch
        const freshProjects = await firebaseGPS.getProjects(userId);
        console.log(`📋 Fetched ${freshProjects.length} projects from Firebase`);
        
        return { 
          success: true, 
          clearedItems: clearedCount,
          fetchedProjects: freshProjects.length,
          projects: freshProjects.map((p: any) => ({ id: p.id, name: p.name }))
        };
      } else {
        return { success: false, error: 'No user authenticated' };
      }
    } catch (error: any) {
      console.error('🧹 Cache clear failed:', error);
      return { success: false, error: error.message };
    }
  }
}

// Make available globally for console debugging
if (typeof window !== 'undefined') {
  (window as any).FirebaseSyncDebugger = FirebaseSyncDebugger;
  (window as any).localDB = localDB; // Expose localDB for debugging
  (window as any).DatabaseRecovery = {
    initializeDatabaseSafely,
    recoverDatabase,
    resetDatabaseCompletely
  };
  // Convenience alias expected by tablet console: db.forceSync()
  (window as any).db = {
    // Up+Down non-blocking sync (initiates uploads and downloads)
    forceSync: async () => {
      try {
        return await hybridDB.forceSync();
      } catch (err) {
        console.warn('db.forceSync failed, attempting non-blocking upstream:', err);
        await (hybridDB as any).syncToFirebaseNonBlocking?.();
        return { success: false, error: (err as any)?.message };
      }
    },
    // Immediate upstream-only blocking sync (uploads pending queue)
    forceSyncImmediate: async () => {
      try {
        await (hybridDB as any).refreshConnectivity(true);
        return await hybridDB.forceSyncNow();
      } catch (err) {
        console.warn('db.forceSyncImmediate fallback to non-blocking sync:', err);
        await (hybridDB as any).syncToFirebaseNonBlocking?.();
        return { success: false, error: (err as any)?.message };
      }
    },
    retryNow: FirebaseSyncDebugger.retryNow,
    diagnostics: () => hybridDB.getSyncDiagnostics?.()
  };
}