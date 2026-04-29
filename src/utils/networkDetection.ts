/**
 * Network Detection Utility
 * Provides accurate network connectivity detection including
 * WiFi-without-internet scenarios
 */

/**
 * Check if the device has actual internet access
 * (not just WiFi connection)
 * 
 * This makes a lightweight request to a reliable tile server
 * to verify internet connectivity
 */
export async function hasInternetAccess(): Promise<boolean> {
  // If navigator says offline, definitely no internet
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  
  try {
    // Use Cloudflare's connectivity check endpoint instead of OSM tiles
    // This avoids tile usage policy violations and provides reliable detection
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout
    
    const response = await fetch('https://cloudflare.com/cdn-cgi/trace', {
      method: 'GET', // GET for trace endpoint
      signal: controller.signal,
      cache: 'no-cache', // Don't use cached response
      mode: 'cors' // Allow cross-origin
    });
    
    clearTimeout(timeoutId);
    
    // If we got any response, internet works
    // no-cors mode means we can't check response.ok, but if fetch succeeds, we're online
    return true;
  } catch (error) {
    // Fetch failed = no internet (timeout, network error, abort, etc.)
    console.log('[Network] Internet check failed:', error);
    return false;
  }
}

/**
 * Monitor network status with periodic checks
 * Returns a cleanup function to stop monitoring
 * 
 * @param onStatusChange - Callback when network status changes
 * @param checkIntervalMs - How often to check (default: 10000 = 10 seconds)
 */
export function monitorNetworkStatus(
  onStatusChange: (hasInternet: boolean) => void,
  checkIntervalMs: number = 10000
): () => void {
  let lastStatus: boolean | null = null;
  let intervalId: NodeJS.Timeout | null = null;
  let isChecking = false;
  
  const checkStatus = async () => {
    if (isChecking) return; // Prevent concurrent checks
    isChecking = true;
    
    try {
      const currentStatus = await hasInternetAccess();
      
      // Only notify if status changed
      if (currentStatus !== lastStatus) {
        lastStatus = currentStatus;
        onStatusChange(currentStatus);
      }
    } finally {
      isChecking = false;
    }
  };
  
  // Initial check
  checkStatus();
  
  // Periodic checks
  intervalId = setInterval(checkStatus, checkIntervalMs);
  
  // Listen to online/offline events for immediate detection
  const handleOnline = () => checkStatus();
  const handleOffline = () => {
    lastStatus = false;
    onStatusChange(false);
  };
  
  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  }
  
  // Cleanup function
  return () => {
    if (intervalId) {
      clearInterval(intervalId);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    }
  };
}

/**
 * Get network connection type if available
 * Returns 'wifi', 'cellular', 'ethernet', 'none', or 'unknown'
 */
export function getConnectionType(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  
  const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
  
  if (!conn) return 'unknown';
  
  const type = conn.effectiveType || conn.type;
  
  if (!type) return 'unknown';
  
  // Map various connection types
  if (type === 'wifi' || type === 'WiFi') return 'wifi';
  if (type === 'cellular' || type.includes('2g') || type.includes('3g') || type.includes('4g') || type.includes('5g')) return 'cellular';
  if (type === 'ethernet') return 'ethernet';
  if (type === 'none') return 'none';
  
  return type;
}

/**
 * Estimate network speed (slow, moderate, fast)
 * Based on effective connection type
 */
export function estimateNetworkSpeed(): 'slow' | 'moderate' | 'fast' | 'unknown' {
  if (typeof navigator === 'undefined') return 'unknown';
  
  const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
  
  if (!conn || !conn.effectiveType) return 'unknown';
  
  const effectiveType = conn.effectiveType;
  
  if (effectiveType === 'slow-2g' || effectiveType === '2g') return 'slow';
  if (effectiveType === '3g') return 'moderate';
  if (effectiveType === '4g' || effectiveType === '5g') return 'fast';
  
  return 'unknown';
}
