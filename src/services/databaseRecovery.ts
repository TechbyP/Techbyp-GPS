/**
 * Database Connection Recovery Utility
 * Helps recover from IndexedDB connection issues and database conflicts
 */

import { localDB } from './localDatabase';

export interface DatabaseHealthCheck {
  isHealthy: boolean;
  error?: string;
  suggestion?: string;
}

/**
 * Nuclear option: Delete and recreate database from scratch
 * Use this when migrations are completely broken
 */
export async function resetDatabaseCompletely(): Promise<{
  success: boolean;
  message: string;
}> {
  console.log('💣💣💣 RESETTING DATABASE COMPLETELY - ALL LOCAL DATA WILL BE LOST');
  console.log('⚠️ Cloud data (Firebase) will be preserved and re-synced');
  
  try {
    console.log('[RESET] Step 1: Force cleanup...');
    await localDB.forceCleanup();
    console.log('[RESET] ✅ Cleanup complete');
    
    // Wait for cleanup
    console.log('[RESET] Step 2: Waiting 1s for cleanup to settle...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Delete the database
    console.log('[RESET] Step 3: Deleting database...');
    try {
      await localDB.deleteDatabase();
      console.log('[RESET] ✅ Database deleted');
    } catch (deleteError) {
      console.warn('[RESET] ⚠️ Could not delete database (may not exist):', deleteError);
    }
    
    // Wait before reinitializing
    console.log('[RESET] Step 4: Waiting 500ms before reinit...');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Reinitialize with fresh schema
    console.log('[RESET] Step 5: Reinitializing database...');
    await localDB.reinitialize();
    console.log('[RESET] ✅ Database recreated with fresh schema');
    
    // Verify it works
    console.log('[RESET] Step 6: Health check...');
    const healthCheck = await checkDatabaseHealth();
    console.log('[RESET] Health check result:', healthCheck);
    
    if (healthCheck.isHealthy) {
      console.log('[RESET] ✅✅✅ Database reset complete and healthy!');
      return {
        success: true,
        message: 'Database reset complete. Data will be re-synced from Firebase on next login.'
      };
    } else {
      console.error('[RESET] ❌ Health check FAILED:', healthCheck.error);
      return {
        success: false,
        message: `Database reset attempted but health check failed: ${healthCheck.error}`
      };
    }
  } catch (error) {
    console.error('[RESET] ❌❌❌ Database reset EXCEPTION:', error);
    return {
      success: false,
      message: `Reset failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Check database health and connection status
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealthCheck> {
  try {
    // Check if database is ready
    if (!localDB.isReady()) {
      return {
        isHealthy: false,
        error: 'Database not initialized',
        suggestion: 'Initialize database'
      };
    }

    // Try a simple query to test connection
    // This will throw if there are connection issues
    // Use a test user ID for health check
    await localDB.getProjects('health_check');
    
    return {
      isHealthy: true
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Check for common database connection errors
    if (errorMessage.includes('already exists') || errorMessage.includes('allready exists')) {
      return {
        isHealthy: false,
        error: 'Database connection conflict detected',
        suggestion: 'Force cleanup and reinitialize database'
      };
    }
    
    if (errorMessage.includes('database is locked')) {
      return {
        isHealthy: false,
        error: 'Database is locked',
        suggestion: 'Restart app or force cleanup'
      };
    }
    
    if (errorMessage.includes('not available')) {
      return {
        isHealthy: false,
        error: 'Database not available on this platform',
        suggestion: 'Check platform compatibility'
      };
    }
    
    return {
      isHealthy: false,
      error: errorMessage,
      suggestion: 'Try restarting the app'
    };
  }
}

/**
 * Attempt to recover from database connection issues
 */
export async function recoverDatabase(): Promise<{
  success: boolean;
  message: string;
}> {
  console.log('🛠️ Attempting database recovery...');
  
  try {
    // First, try force cleanup
    await localDB.forceCleanup();
    console.log('✅ Database cleanup completed');
    
    // Wait a moment for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Try to reinitialize
    await localDB.reinitialize();
    console.log('✅ Database reinitialized');
    
    // Test the connection
    const healthCheck = await checkDatabaseHealth();
    
    if (healthCheck.isHealthy) {
      return {
        success: true,
        message: 'Database recovered successfully'
      };
    } else {
      return {
        success: false,
        message: `Recovery failed: ${healthCheck.error}`
      };
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Database recovery failed:', errorMessage);
    
    return {
      success: false,
      message: `Recovery failed: ${errorMessage}`
    };
  }
}

/**
 * Initialize database with automatic recovery on connection conflicts
 */
export async function initializeDatabaseSafely(): Promise<{
  success: boolean;
  message: string;
  wasRecovered: boolean;
}> {
  console.log('🚀 Starting safe database initialization...');
  
  try {
    // First attempt to initialize normally
    await localDB.initialize();
    
    // Check if initialization was successful
    const healthCheck = await checkDatabaseHealth();
    
    if (healthCheck.isHealthy) {
      return {
        success: true,
        message: 'Database initialized successfully',
        wasRecovered: false
      };
    }
    
    // If not healthy, try recovery
    console.log('⚠️ Database initialization had issues, attempting recovery...');
    const recovery = await recoverDatabase();
    
    return {
      success: recovery.success,
      message: recovery.message,
      wasRecovered: recovery.success
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // If initialization fails with connection conflict, try recovery
    if (errorMessage.includes('already exists') || errorMessage.includes('allready exists')) {
      console.log('🔧 Connection conflict detected, attempting automatic recovery...');
      
      const recovery = await recoverDatabase();
      
      return {
        success: recovery.success,
        message: recovery.success ? 'Database recovered from connection conflict' : recovery.message,
        wasRecovered: recovery.success
      };
    }
    
    return {
      success: false,
      message: `Database initialization failed: ${errorMessage}`,
      wasRecovered: false
    };
  }
}

/**
 * Show user-friendly error message based on database issue
 */
export function getDatabaseErrorMessage(error: string): {
  title: string;
  message: string;
  canRecover: boolean;
} {
  if (error.includes('already exists') || error.includes('allready exists')) {
    return {
      title: 'Database Connection Conflict',
      message: 'There was a conflict with the database connection. This can happen after app updates or force-closes.',
      canRecover: true
    };
  }
  
  if (error.includes('database is locked')) {
    return {
      title: 'Database Locked',
      message: 'The database is currently locked by another process. This usually resolves by restarting the app.',
      canRecover: true
    };
  }
  
  if (error.includes('not available')) {
    return {
      title: 'Database Not Available',
      message: 'Local database is not available on this platform. The app will use cloud storage only.',
      canRecover: false
    };
  }
  
  return {
    title: 'Database Error',
    message: `Database error: ${error}. Try restarting the app.`,
    canRecover: true
  };
}

// Auto-recovery interval (check every 5 minutes if database becomes unhealthy)
let healthCheckInterval: NodeJS.Timeout | null = null;

export function startDatabaseHealthMonitoring() {
  if (healthCheckInterval) return; // Already running
  
  healthCheckInterval = setInterval(async () => {
    try {
      const health = await checkDatabaseHealth();
      if (!health.isHealthy) {
        console.warn('⚠️ Database health check failed:', health.error);
        // Could trigger automatic recovery here if needed
      }
    } catch (error) {
      // Ignore health check errors to avoid spam
    }
  }, 5 * 60 * 1000); // 5 minutes
}

export function stopDatabaseHealthMonitoring() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}