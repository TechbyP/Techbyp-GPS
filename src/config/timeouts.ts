/**
 * Standardized timeout configuration for all network operations
 * Provides consistent, predictable timeout behavior across the application
 */

export const TIMEOUTS = {
  // Network operations
  FIREBASE_PING: 6000,
  FIREBASE_AUTH_CHECK: 8000,
  
  // Read operations (longer for initial load)
  PROJECTS_FETCH: 15000,        // First load needs time
  PROJECT_FETCH: 15000,         // Alias for consistency
  TRACKS_FETCH: 10000,
  TRACK_FETCH: 5000,            // Single track fetch (short timeout)
  BOUNDARIES_FETCH: 15000,
  BOUNDARY_FETCH: 15000,        // Alias for consistency
  POINTS_FETCH: 10000,
  SAMPLES_FETCH: 10000,
  DEVICES_FETCH: 10000,
  
  // Write operations (shorter for responsiveness)
  PROJECT_CREATE: 8000,
  PROJECT_UPDATE: 8000,
  PROJECT_DELETE: 8000,
  TRACK_CREATE: 8000,
  TRACK_UPDATE: 8000,
  TRACK_DELETE: 8000,
  DELETE_OPERATION: 3000,       // Generic delete (short timeout)
  POINT_CREATE: 5000,           // GPS points need to be fast
  SAMPLE_CREATE: 5000,
  BOUNDARY_CREATE: 12000,       // Larger payload
  BOUNDARY_UPDATE: 12000,
  BOUNDARY_DELETE: 8000,
  DEVICE_SAVE: 8000,
  DEVICE_DELETE: 8000,
  
  // Sync operations
  SYNC_ITEM: 20000,
  SYNC_OPERATION: 30000,        // Individual sync item timeout
  BATCH_OPERATION: 30000,
  
  // Connection probes
  CONNECTIVITY_CHECK: 5000,
  HEALTH_CHECK: 4000,
  USER_DOC_CHECK: 12000,
  
  // Adaptive timeout multipliers
  SLOW_NETWORK_MULTIPLIER: 2,   // Double timeouts on slow networks
  MOBILE_NETWORK_MULTIPLIER: 1.5 // 50% longer on mobile
};

/**
 * Adaptive timeout helper that learns from network latency
 */
export class AdaptiveTimeout {
  private recentLatencies: number[] = [];
  private maxSamples = 10;
  
  recordLatency(ms: number) {
    this.recentLatencies.push(ms);
    if (this.recentLatencies.length > this.maxSamples) {
      this.recentLatencies.shift();
    }
  }
  
  getTimeout(baseTimeout: number): number {
    if (this.recentLatencies.length === 0) return baseTimeout;
    
    const avgLatency = this.recentLatencies.reduce((a, b) => a + b) / this.recentLatencies.length;
    
    // If average latency is > 2s, double timeout
    if (avgLatency > 2000) {
      return baseTimeout * TIMEOUTS.SLOW_NETWORK_MULTIPLIER;
    }
    
    // If average latency is < 500ms, use base timeout
    return baseTimeout;
  }
  
  reset() {
    this.recentLatencies = [];
  }
}

/**
 * Helper function to wrap promises with timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage?: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`)),
      timeoutMs
    )
  );
  
  return Promise.race([promise, timeoutPromise]);
}
