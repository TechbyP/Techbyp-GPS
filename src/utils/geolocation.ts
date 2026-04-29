import { Geolocation } from '@capacitor/geolocation';
import MockLocationDetector from '../plugins/MockLocationDetector';

/**
 * Enhanced position options with network-based location support
 * This enables cell tower and WiFi triangulation for improved accuracy
 */
export interface EnhancedPositionOptions extends PositionOptions {
  // Use network location providers (cell towers, WiFi) in addition to GPS
  useNetworkLocation?: boolean;
  // Prefer network-based location for faster results
  preferNetworkLocation?: boolean;
  // Android (Capacitor): minimum interval between watch updates in ms
  minimumUpdateInterval?: number;
}

// Detect Capacitor runtime (native shell or ionic protocol)
export const isCapacitor = (): boolean => {
  if (typeof window === 'undefined') return false;
  const protocol = window.location?.protocol;
  return protocol === 'capacitor:' || protocol === 'ionic:' || !!(window as any).Capacitor?.isNativePlatform?.();
};

export const requestLocationPermission = async (): Promise<boolean> => {
  try {
    if (isCapacitor()) {
      const status = await Geolocation.requestPermissions();
      const locationStatus = (status as any).location || (status as any).coarseLocation;
      return locationStatus === 'granted' || locationStatus === 'prompt';
    }
    if (typeof navigator !== 'undefined' && (navigator as any).permissions?.query) {
      const res = await (navigator as any).permissions.query({ name: 'geolocation' });
      return res.state === 'granted' || res.state === 'prompt';
    }
    return typeof navigator !== 'undefined' && !!navigator.geolocation;
  } catch (error) {
    console.warn('Geolocation permission check failed:', error);
    return false;
  }
};

export const getCurrentPosition = async (options?: EnhancedPositionOptions): Promise<GeolocationPosition> => {
  if (isCapacitor()) {
    // For Android: enableHighAccuracy=true uses GPS + network (cell towers, WiFi)
    // For Android: enableHighAccuracy=false uses only network providers
    // This provides better accuracy in urban areas and faster initial fix
    const useHighAccuracy = options?.enableHighAccuracy ?? true;
    
    console.log('📍 Getting position with settings:', {
      enableHighAccuracy: useHighAccuracy,
      useNetworkLocation: options?.useNetworkLocation ?? true,
      timeout: options?.timeout ?? 60000
    });
    
    const position = await Geolocation.getCurrentPosition({
      // On Android, this enables:
      // - true: GPS + Network (cell towers + WiFi) for best accuracy
      // - false: Network only (faster, less accurate)
      enableHighAccuracy: useHighAccuracy,
      timeout: options?.timeout ?? 60000,
      maximumAge: options?.maximumAge ?? 0,
    });

    // Check if this is a mock location using native plugin
    let isMockLocation = false;
    try {
      const mockCheck = await MockLocationDetector.isMockLocation();
      isMockLocation = mockCheck.isMock;
      console.log('📍 Native mock location check:', mockCheck);
    } catch (error) {
      console.log('📍 Native mock detection not available, using fallback');
      // Fallback: Check multiple possible mock location indicators
      isMockLocation = 
        (position as any).mocked === true || 
        (position as any).mock === true ||
        (position as any).isMock === true ||
        (position as any).coords?.mocked === true ||
        (position as any).coords?.mock === true ||
        (position as any).coords?.isMock === true ||
        (position as any).isFromMockProvider === true;
    }
    
    // Log position data
    console.log('📍 ============ POSITION DATA START ============');
    console.log('📍 Lat/Lng:', position.coords.latitude.toFixed(6), position.coords.longitude.toFixed(6));
    console.log('📍 Accuracy:', position.coords.accuracy);
    console.log('🛰️ MOCK LOCATION:', isMockLocation);
    console.log('📍 ============ POSITION DATA END ============');
    
    return {
      coords: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude,
        altitudeAccuracy: position.coords.altitudeAccuracy ?? null,
        heading: position.coords.heading ?? null,
        speed: position.coords.speed ?? null,
      },
      timestamp: position.timestamp,
      // Add mock location indicator
      ...(isMockLocation && { mocked: true }),
    } as GeolocationPosition & { mocked?: boolean };
  }

  return new Promise((resolve, reject) => {
    // For web browsers, ensure we use the best available positioning:
    // - enableHighAccuracy: true uses GPS if available, WiFi positioning, and IP geolocation
    // - maximumAge: 0 ensures fresh location data
    // - timeout gives enough time for WiFi positioning to work
    const webOptions = {
      enableHighAccuracy: options?.enableHighAccuracy ?? true,
      timeout: options?.timeout ?? 15000,
      maximumAge: options?.maximumAge ?? 0,
    };
    navigator.geolocation.getCurrentPosition(resolve, reject, webOptions);
  });
};

export const watchPosition = async (
  success: (position: GeolocationPosition) => void,
  error?: (error: GeolocationPositionError) => void,
  options?: EnhancedPositionOptions
): Promise<string | number> => {
  if (isCapacitor()) {
    // Enable network-based location by default for improved accuracy
    const useHighAccuracy = options?.enableHighAccuracy ?? true;
    
    console.log('📍 Starting position watch with settings:', {
      enableHighAccuracy: useHighAccuracy,
      useNetworkLocation: options?.useNetworkLocation ?? true
    });
    
    const nativeWatchOptions: any = {
      // On Android with enableHighAccuracy=true:
      // - Uses GPS satellites (primary)
      // - Uses cell tower triangulation (secondary)
      // - Uses WiFi positioning (tertiary)
      // This combination provides best accuracy and faster fix times
      enableHighAccuracy: useHighAccuracy,
      timeout: options?.timeout ?? 60000,
      maximumAge: options?.maximumAge ?? 0,
      // Capacitor Android defaults to a slower cadence if this is not set.
      minimumUpdateInterval: options?.minimumUpdateInterval ?? 1000,
    };

    const id = await Geolocation.watchPosition(
      nativeWatchOptions,
      (position, err) => {
        if (err && error) {
          error({
            code: 2,
            message: err?.message || 'Unknown error',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError);
        } else if (position) {
          const isMockLocation = 
            (position as any).mocked === true || 
            (position as any).mock === true ||
            (position as any).isMock === true ||
            (position as any).coords?.mocked === true ||
            (position as any).coords?.mock === true ||
            (position as any).coords?.isMock === true ||
            (position as any).isFromMockProvider === true;
          
          // Only log when mock location detected (reduce spam)
          if (isMockLocation) {
            console.log('📍 ============ WATCH POSITION UPDATE ============');
            console.log('📍 Position keys:', Object.keys(position));
            console.log('📍 Coords keys:', Object.keys(position.coords));
            console.log('📍 Accuracy:', position.coords.accuracy);
            console.log('🛰️ MOCK LOCATION:', isMockLocation);
            console.log('📍 ============================================');
          }
          
          success({
            coords: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              altitude: position.coords.altitude,
              altitudeAccuracy: position.coords.altitudeAccuracy ?? null,
              heading: position.coords.heading ?? null,
              speed: position.coords.speed ?? null,
            },
            timestamp: position.timestamp,
            ...(isMockLocation && { mocked: true }),
          } as GeolocationPosition & { mocked?: boolean });
        }
      }
    );
    return id;
  }

  // For web browsers, ensure we use the best available positioning:
  // - enableHighAccuracy: true uses GPS if available, WiFi positioning, and IP geolocation
  // - maximumAge: 0 ensures fresh location updates
  // - timeout gives enough time for WiFi positioning to work
  const webOptions = {
    enableHighAccuracy: options?.enableHighAccuracy ?? true,
    timeout: options?.timeout ?? 15000,
    maximumAge: options?.maximumAge ?? 0,
  };
  return navigator.geolocation.watchPosition(success, error, webOptions);
};

export const clearWatch = async (watchId: string | number | null | undefined) => {
  if (!watchId) return;
  if (isCapacitor() && typeof watchId === 'string') {
    await Geolocation.clearWatch({ id: watchId });
  } else if (typeof watchId === 'number') {
    navigator.geolocation.clearWatch(watchId);
  }
};
