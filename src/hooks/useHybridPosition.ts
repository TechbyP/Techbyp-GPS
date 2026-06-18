import { useCallback, useEffect, useRef, useState } from 'react';
import type { GpsPosition } from '../types';
import { isCapacitor, watchPosition, clearWatch, requestLocationPermission, getCurrentPosition } from '../utils/geolocation';
import { isWindowsTablet } from '../utils/deviceDetection';

export type GpsSourcePreference = 'internal' | 'external';
export type GpsSourcePolicy = 'preferred' | 'strict';

const normalizeTimestamp = (rawTimestamp: number | undefined): number => {
  if (!rawTimestamp || !Number.isFinite(rawTimestamp)) {
    return Date.now();
  }

  return rawTimestamp < 1_000_000_000_000 ? rawTimestamp * 1000 : rawTimestamp;
};

const toGpsPosition = (position: GeolocationPosition): GpsPosition => ({
  latitude: position.coords.latitude,
  longitude: position.coords.longitude,
  accuracy: position.coords.accuracy,
  altitude: position.coords.altitude || undefined,
  heading: position.coords.heading ?? undefined,
  speed: position.coords.speed ?? undefined,
  timestamp: position.timestamp,
  ...(((position as any).mocked === true) ? { mocked: true as any } : {}),
});

export function useHybridPosition(
  externalGpsSource?: GpsPosition | null,
  sourcePreference: GpsSourcePreference = 'internal',
  sourcePolicy: GpsSourcePolicy = 'preferred'
) {
  const EXTERNAL_GPS_STALE_MS = 15000;
  const [position, setPosition] = useState<GpsPosition | null>(() => {
    try {
      const saved = localStorage.getItem('lastKnownPosition');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const accuracyHistoryRef = useRef<number[]>([]);
  const [gpsPosition, setGpsPosition] = useState<GpsPosition | null>(null);
  const [networkPosition, setNetworkPosition] = useState<GpsPosition | null>(null);
  const [isMockLocation, setIsMockLocation] = useState(false);
  const [selectionTick, setSelectionTick] = useState(0);
  const [positionSource, setPositionSource] = useState<'internal' | 'external' | 'none'>('none');
  const [isExternalFallback, setIsExternalFallback] = useState(false);
  const [externalDataAgeMs, setExternalDataAgeMs] = useState<number | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (position) {
      localStorage.setItem('lastKnownPosition', JSON.stringify(position));
    }
  }, [position]);

  useEffect(() => {
    if (sourcePreference !== 'external') {
      return;
    }

    const timer = window.setInterval(() => {
      setSelectionTick((tick) => tick + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [sourcePreference]);

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  useEffect(() => {
    const normalizedExternalGpsSource = externalGpsSource
      ? {
          ...externalGpsSource,
          timestamp: normalizeTimestamp(externalGpsSource.timestamp),
        }
      : null;

    const externalAge = normalizedExternalGpsSource
      ? Math.max(0, Date.now() - normalizedExternalGpsSource.timestamp)
      : null;
    setExternalDataAgeMs(externalAge);

    const hasFreshExternalSource = externalAge !== null && externalAge <= EXTERNAL_GPS_STALE_MS;

    let bestInternalSource: GpsPosition | null = null;
    if (!gpsPosition && networkPosition) {
      bestInternalSource = networkPosition;
    } else if (gpsPosition && !networkPosition) {
      bestInternalSource = gpsPosition;
    } else if (gpsPosition && networkPosition) {
      if (gpsPosition.accuracy < 20 || networkPosition.accuracy > 50) {
        bestInternalSource = gpsPosition;
      } else if (networkPosition.accuracy < gpsPosition.accuracy * 0.7) {
        bestInternalSource = networkPosition;
      } else {
        bestInternalSource = gpsPosition;
      }
    }

    // Handle manual source preference
    if (sourcePreference === 'external') {
      if (hasFreshExternalSource && normalizedExternalGpsSource) {
        if (!sessionStorage.getItem('external-gps-logged')) {
          console.log('🛰️ Using external GPS source (manual selection)');
          sessionStorage.setItem('external-gps-logged', 'true');
        }
        setPosition(normalizedExternalGpsSource);
        setPositionSource('external');
        setIsExternalFallback(false);
        setError(null);
        return;
      }

      if (sourcePolicy === 'strict') {
        setPosition(null);
        setPositionSource('none');
        setIsExternalFallback(false);
        setError('External GPS selected but no fresh external data is available');
        return;
      }

      setIsExternalFallback(true);
      setError(null);
    }
    
    if (sourcePreference === 'internal' && gpsPosition) {
      if (!sessionStorage.getItem('internal-gps-forced')) {
        console.log('📱 Using internal GPS (manual selection)');
        sessionStorage.setItem('internal-gps-forced', 'true');
      }
      setPosition(gpsPosition);
      setPositionSource('internal');
      setIsExternalFallback(false);
      setError(null);
      return;
    }

    if (bestInternalSource) {
      setPosition(bestInternalSource);
      setPositionSource('internal');
      return;
    }

    if (sourcePreference === 'external') {
      setError('External GPS selected but no fresh external data is available');
    } else {
      setError('No internal GPS position available');
    }
    setPosition(null);
    setPositionSource('none');
  }, [gpsPosition, networkPosition, externalGpsSource, sourcePreference, sourcePolicy, selectionTick]);

  useEffect(() => {
    let gpsId: string | number | null = null;
    let netId: string | number | null = null;
    let cancelled = false;
    const isOnWindowsTablet = isWindowsTablet();
    const isNativeCapacitor = isCapacitor() && !isOnWindowsTablet;

    const start = async () => {
      // For Windows tablets in web mode, use browser's geolocation API directly
      if (isOnWindowsTablet && !isCapacitor()) {
        console.log('🪟 Windows tablet detected - using browser Geolocation API');
        
        if (!('geolocation' in navigator)) {
          setError('Geolocation not supported on this device');
          return;
        }

        const positionOptions: PositionOptions = {
          enableHighAccuracy: true,
          timeout: 60000,
          maximumAge: 0
        };

        // Watch position using browser API
        gpsId = navigator.geolocation.watchPosition(
          (pos) => {
            const gpsPos: GpsPosition = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              altitude: pos.coords.altitude || undefined,
              altitudeAccuracy: pos.coords.altitudeAccuracy || undefined,
              heading: pos.coords.heading || undefined,
              speed: pos.coords.speed || undefined,
              timestamp: pos.timestamp
            };
            
            setGpsPosition(gpsPos);
            setPermissionGranted(true);
            setError(null);
            
            console.log('🪟 Windows GPS position:', {
              lat: gpsPos.latitude.toFixed(6),
              lon: gpsPos.longitude.toFixed(6),
              accuracy: gpsPos.accuracy?.toFixed(1)
            });
          },
          (err) => {
            let errorMessage = 'Geolocation error';
            switch (err.code) {
              case err.PERMISSION_DENIED:
                errorMessage = 'Location permission denied';
                setPermissionGranted(false);
                break;
              case err.POSITION_UNAVAILABLE:
                errorMessage = 'Location unavailable';
                break;
              case err.TIMEOUT:
                errorMessage = 'Location request timed out';
                break;
            }
            console.warn('🪟 Windows GPS error:', errorMessage);
            setError(errorMessage);
          },
          positionOptions
        );

        return;
      }

      // Standard Capacitor/web path
      const granted = await requestLocationPermission();
      if (!granted) {
        setError('Geolocation permission not granted');
        setPermissionGranted(false);
        return;
      }

      if (cancelled) return;

      const primeImmediatePosition = async () => {
        try {
          const quickNetworkPosition = await getCurrentPosition({
            enableHighAccuracy: false,
            timeout: 8000,
            maximumAge: 5000,
          });

          if (!cancelled && Number.isFinite(quickNetworkPosition.coords.accuracy)) {
            setNetworkPosition(toGpsPosition(quickNetworkPosition));
            setPermissionGranted(true);
          }
        } catch {
          // Best-effort warm start only.
        }

        try {
          const quickGpsPosition = await getCurrentPosition({
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 0,
          });

          if (!cancelled) {
            setGpsPosition(toGpsPosition(quickGpsPosition));
            setPermissionGranted(true);
            setError(null);
          }
        } catch {
          // Fall back to the live watch if the immediate fix is still not available.
        }
      };

      void primeImmediatePosition();

      gpsId = await watchPosition(
        (pos) => {
          const newAccuracy = pos.coords.accuracy;
          
          // Enhanced mock location detection
          const positionData = pos as any;
          
          // Debug: Log all position properties to see what's available
          if (!sessionStorage.getItem('position-logged')) {
            console.log('🔍 [Position Debug] Full position object:', {
              coords: pos.coords,
              timestamp: pos.timestamp,
              mocked: positionData.mocked,
              mockUsed: positionData.mockUsed,
              isMock: positionData.isMock,
              provider: positionData.provider,
              accuracy: newAccuracy
            });
            sessionStorage.setItem('position-logged', 'true');
          }
          
          // Detect mock location using multiple indicators:
          // 1. Explicit mock flags (Android)
          // 2. Very high accuracy (< 10m) combined with Capacitor platform
          // 3. Provider information if available
          const isMock = positionData.mocked === true || 
                        positionData.mockUsed === true ||
                        positionData.isMock === true ||
                        (isNativeCapacitor && newAccuracy < 10 && newAccuracy > 0) ||
                        (positionData.provider && positionData.provider.toLowerCase().includes('mock'));
          
          if (isMock !== (sessionStorage.getItem('is-mock') === 'true')) {
            console.log(isMock ? '🛰️ Mock location DETECTED (Bluetooth GNSS or external GPS)' : '📱 Using internal GPS');
            console.log('📍 Accuracy:', newAccuracy, 'meters');
            console.log('🔧 Detection factors:', {
              mocked: positionData.mocked,
              mockUsed: positionData.mockUsed,
              isMock: positionData.isMock,
              provider: positionData.provider,
              accuracy: newAccuracy,
              isCapacitor: isNativeCapacitor
            });
            sessionStorage.setItem('is-mock', isMock.toString());
          }
          setIsMockLocation(isMock);

          if (isIOS) {
            const history = accuracyHistoryRef.current;
            const newHistory = [...history.slice(-4), newAccuracy];
            accuracyHistoryRef.current = newHistory;

            if (history.length >= 3) {
              const avgAccuracy = history.reduce((a, b) => a + b, 0) / history.length;
              if (newAccuracy > avgAccuracy * 3 && newAccuracy > 30) {
                return;
              }
            }
          }

          setGpsPosition({
            ...toGpsPosition(pos),
            accuracy: newAccuracy,
          });
          setPermissionGranted(true);
          setError(null);
        },
        (err) => {
          if (!isIOS || err.code === err.PERMISSION_DENIED) {
            console.warn('GPS position error:', err.message, 'Code:', err.code);
            setError(err.message);
          }
          if (err.code === err.PERMISSION_DENIED) {
            setPermissionGranted(false);
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 60000, // 60 seconds for external GPS initialization
          maximumAge: 0,
          minimumUpdateInterval: 250,
        }
      );

      netId = await watchPosition(
        (pos) => {
          if (pos.coords.accuracy <= 100) {
            setNetworkPosition(toGpsPosition(pos));
            setPermissionGranted(true);
          }
        },
        () => {
          /* optional */
        },
        {
          enableHighAccuracy: false,
          timeout: 30000, // 30 seconds for network
          maximumAge: 5000,
          minimumUpdateInterval: 1000,
        }
      );
    };

    start();

    return () => {
      cancelled = true;
      // Handle both native and browser geolocation cleanup
      if (isWindowsTablet() && !isCapacitor() && typeof gpsId === 'number') {
        navigator.geolocation.clearWatch(gpsId);
      } else {
        void clearWatch(gpsId);
        void clearWatch(netId);
      }
    };
  }, [isIOS, refreshToken]);

  const refreshPosition = useCallback(() => {
    setError(null);
    setSelectionTick((tick) => tick + 1);
    setRefreshToken((token) => token + 1);
  }, []);

  const startTracking = () => {
    setIsTracking(true);
  };

  const stopTracking = () => {
    setIsTracking(false);
  };

  return {
    position,
    error,
    isTracking,
    startTracking,
    stopTracking,
    refreshPosition,
    permissionGranted,
    isCapacitor: isCapacitor(),
    isMockLocation,
    positionSource,
    isExternalFallback,
    externalDataAgeMs,
  } as const;
}
