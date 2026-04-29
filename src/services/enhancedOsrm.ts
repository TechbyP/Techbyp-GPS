import toast from 'react-hot-toast';

/**
 * Enhanced OSRM Service with retry logic, error handling, and offline caching
 * Using GraphHopper Routing API (policy-compliant, CORS-enabled)
 */

// GraphHopper public API - Free tier: 500 requests/day
const GRAPHHOPPER_API_KEY = 'e534619c-432b-4464-9fc8-98c133770c0c';
const ROUTING_ENDPOINT = 'https://graphhopper.com/api/1/route';

interface OSRMRoute {
  distance: number; // meters
  duration: number; // seconds
  geometry: {
    type: 'LineString';
    coordinates: number[][]; // [lon, lat] format
  };
  steps: OSRMStep[];
}

interface OSRMStep {
  distance: number;
  duration: number;
  instruction: string;
  name: string;
  maneuver?: {
    type: string;
    modifier?: string;
    location: [number, number];
  };
}

interface OSRMResponse {
  code: string;
  routes: OSRMRoute[];
  waypoints?: any[];
}

interface RouteOptions {
  alternatives?: boolean;
  profile?: 'driving' | 'walking' | 'cycling';
}

interface CachedRoute {
  key: string;
  data: OSRMResponse;
  timestamp: number;
  expiresAt: number;
}

class EnhancedOSRMService {
  private routeCache: Map<string, CachedRoute> = new Map();
  private readonly CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAYS = [1000, 2000, 4000]; // Progressive backoff

  constructor() {
    // Load cached routes from localStorage on initialization
    this.loadCacheFromStorage();
  }

  private getCacheKey(start: [number, number], end: [number, number], options: RouteOptions): string {
    return `route_${start[0].toFixed(6)}_${start[1].toFixed(6)}_${end[0].toFixed(6)}_${end[1].toFixed(6)}_${options.profile || 'driving'}_${options.alternatives || false}`;
  }

  private loadCacheFromStorage(): void {
    try {
      const stored = localStorage.getItem('osrm_route_cache');
      if (stored) {
        const parsed = JSON.parse(stored);
        const now = Date.now();
        
        // Filter out expired entries
        Object.entries(parsed).forEach(([key, value]: [string, any]) => {
          if (value.expiresAt > now) {
            this.routeCache.set(key, value);
          }
        });
      }
    } catch (error) {
      console.warn('Failed to load route cache from localStorage:', error);
    }
  }

  private saveCacheToStorage(): void {
    try {
      const cacheObject: Record<string, CachedRoute> = {};
      this.routeCache.forEach((value, key) => {
        cacheObject[key] = value;
      });
      localStorage.setItem('osrm_route_cache', JSON.stringify(cacheObject));
    } catch (error) {
      console.warn('Failed to save route cache to localStorage:', error);
    }
  }

  private getCachedRouteInternal(key: string): OSRMResponse | null {
    const cached = this.routeCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      console.log('📦 Using cached route:', key);
      return cached.data;
    }
    
    if (cached) {
      this.routeCache.delete(key);
    }
    return null;
  }

  private cacheRoute(key: string, data: OSRMResponse): void {
    const cached: CachedRoute = {
      key,
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.CACHE_DURATION
    };
    
    this.routeCache.set(key, cached);
    this.saveCacheToStorage();
  }

  /**
   * Peek cached route if available (used for offline reuse)
   */
  public getCachedRoute(start: [number, number], end: [number, number], options: RouteOptions = {}): OSRMResponse | null {
    const cacheKey = this.getCacheKey(start, end, options);
    return this.getCachedRouteInternal(cacheKey);
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getErrorMessage(error: any): string {
    if (error.code === 'ECONNABORTED') {
      return 'Request timeout - server is taking too long to respond';
    }
    
    if (error.code === 'ENETUNREACH' || error.code === 'ENOTFOUND') {
      return 'Network unavailable - check your internet connection';
    }
    
    if (error.response?.status === 429) {
      return 'Rate limit exceeded - too many requests';
    }
    
    if (error.response?.status >= 500) {
      return 'Server error - routing service is temporarily unavailable';
    }
    
    return error.message || 'Unknown routing error';
  }

  private showErrorToast(message: string, isRetrying: boolean = false): void {
    if (isRetrying) {
      toast.error(`${message} - Retrying...`, {
        duration: 2000,
        id: 'routing-error'
      });
    } else {
      toast.error(message, {
        duration: 4000,
        id: 'routing-error'
      });
    }
  }

  /**
   * Calculate route between two points with retry logic and caching
   */
  async calculateRoute(
    start: [number, number],
    end: [number, number],
    options: RouteOptions = {},
    language: string = 'en'
  ): Promise<OSRMResponse> {
    const { alternatives = true, profile = 'driving' } = options;
    const cacheKey = this.getCacheKey(start, end, options);
    
    // Check cache first
    const cached = this.getCachedRouteInternal(cacheKey);
    if (cached) {
      return cached;
    }

    // Check if we're offline
    if (!navigator.onLine) {
      throw new Error('No internet connection available for route calculation');
    }
    
    let lastError: any;
    
    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        // Use GraphHopper API with proper parameters
        const url = new URL(ROUTING_ENDPOINT);
        // Use append instead of set to add multiple point parameters
        url.searchParams.append('point', `${start[0]},${start[1]}`);
        url.searchParams.append('point', `${end[0]},${end[1]}`);
        url.searchParams.set('vehicle', 'car');
        url.searchParams.set('locale', language === 'de' ? 'de' : 'en');
        url.searchParams.set('instructions', 'true');
        url.searchParams.set('points_encoded', 'false');
        if (alternatives) url.searchParams.set('algorithm', 'alternative_route');
        url.searchParams.set('key', GRAPHHOPPER_API_KEY);

        console.log(`🌐 GraphHopper Request (attempt ${attempt + 1}/${this.MAX_RETRIES}):`, {
          from: `${start[0]},${start[1]}`,
          to: `${end[0]},${end[1]}`
        });

        const response = await fetch(url.toString(), {
          method: 'GET',
          signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('❌ GraphHopper Error:', {
            status: response.status,
            statusText: response.statusText,
            body: errorText
          });
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        console.log('📡 GraphHopper Response:', {
          hasPaths: !!data.paths,
          numPaths: data.paths?.length || 0,
          fullResponse: data
        });

        if (!data.paths?.[0]) {
          console.error('❌ No paths in GraphHopper response:', data);
          throw new Error('No route found');
        }

        // Convert GraphHopper response to OSRM-compatible format
        const path = data.paths[0];
        
        const processedResponse: OSRMResponse = {
          code: 'Ok',
          routes: [{
            distance: path.distance,
            duration: path.time / 1000, // ms to seconds
            geometry: {
              type: 'LineString',
              coordinates: path.points.coordinates // Already [lon,lat]
            },
            steps: (path.instructions || []).map((instr: any) => ({
              distance: instr.distance,
              duration: instr.time / 1000,
              instruction: instr.text || 'Continue',
              name: instr.street_name || 'Unnamed road',
              maneuver: { type: instr.sign?.toString() || 'turn', location: [0, 0] }
            }))
          }],
          waypoints: []
        };

        // Cache successful response
        this.cacheRoute(cacheKey, processedResponse);
        
        // Clear any existing error toasts
        toast.dismiss('routing-error');
        
        return processedResponse;

      } catch (error: any) {
        lastError = error;
        console.error(`❌ Routing error (attempt ${attempt + 1}):`, error);

        const errorMessage = this.getErrorMessage(error);
        const isLastAttempt = attempt === this.MAX_RETRIES - 1;
        
        // Wait before retrying (progressive backoff)
        if (!isLastAttempt) {
          this.showErrorToast(errorMessage, true);
          await this.delay(this.RETRY_DELAYS[attempt]);
        } else {
          this.showErrorToast(`Route calculation failed: ${errorMessage}`);
        }
      }
    }

    // All retries failed
    throw lastError || new Error('Route calculation failed after all retry attempts');
  }

  /**
   * Clear route cache
   */
  clearCache(): void {
    this.routeCache.clear();
    localStorage.removeItem('osrm_route_cache');
    console.log('🗑️ Route cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.routeCache.size,
      entries: Array.from(this.routeCache.keys())
    };
  }
}

// Export singleton instance
export const enhancedOsrmService = new EnhancedOSRMService();