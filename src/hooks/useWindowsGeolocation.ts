/**
 * Windows Geolocation Hook
 * Uses the browser's Geolocation API for Windows tablets and desktop browsers
 * Provides a consistent interface similar to Capacitor's geolocation
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { GpsPosition } from '../types';
import { logger } from './logger';

interface UseWindowsGeolocationOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
  onPosition?: (position: GpsPosition) => void;
  onError?: (error: string) => void;
}

interface WindowsGeolocationState {
  position: GpsPosition | null;
  error: string | null;
  isTracking: boolean;
  isAvailable: boolean;
}

export function useWindowsGeolocation(options: UseWindowsGeolocationOptions = {}) {
  const {
    enableHighAccuracy = true,
    timeout = 10000,
    maximumAge = 0,
  } = options;

  const [state, setState] = useState<WindowsGeolocationState>({
    position: null,
    error: null,
    isTracking: false,
    isAvailable: 'geolocation' in navigator
  });

  const watchIdRef = useRef<number | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Convert browser GeolocationPosition to our GpsPosition format
  const convertPosition = useCallback((pos: GeolocationPosition): GpsPosition => {
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      altitude: pos.coords.altitude || undefined,
      altitudeAccuracy: pos.coords.altitudeAccuracy || undefined,
      heading: pos.coords.heading || undefined,
      speed: pos.coords.speed || undefined,
      timestamp: pos.timestamp
    };
  }, []);

  // Start tracking position
  const startTracking = useCallback(() => {
    if (!('geolocation' in navigator)) {
      const error = 'Geolocation is not supported by this browser';
      setState(prev => ({ ...prev, error, isTracking: false }));
      optionsRef.current.onError?.(error);
      logger.error('Geolocation not supported', null, { component: 'WindowsGeolocation' });
      return;
    }

    if (watchIdRef.current !== null) {
      logger.warn('Already tracking location', { component: 'WindowsGeolocation' });
      return;
    }

    logger.info('Starting Windows geolocation tracking', { 
      enableHighAccuracy, 
      timeout, 
      maximumAge 
    });

    setState(prev => ({ ...prev, isTracking: true, error: null }));

    const positionOptions: PositionOptions = {
      enableHighAccuracy,
      timeout,
      maximumAge
    };

    // Start watching position
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const gpsPosition = convertPosition(pos);
        
        logger.debug('Windows GPS position received', {
          lat: gpsPosition.latitude,
          lon: gpsPosition.longitude,
          accuracy: gpsPosition.accuracy
        });

        setState(prev => ({ 
          ...prev, 
          position: gpsPosition, 
          error: null 
        }));

        optionsRef.current.onPosition?.(gpsPosition);
      },
      (error) => {
        let errorMessage = 'Unknown geolocation error';
        
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Location permission denied. Please enable location access in your browser settings.';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Location information is unavailable. Make sure location services are enabled.';
            break;
          case error.TIMEOUT:
            errorMessage = 'Location request timed out. Please try again.';
            break;
        }

        logger.error('Windows geolocation error', error, { 
          component: 'WindowsGeolocation',
          code: error.code,
          message: error.message
        });

        setState(prev => ({ 
          ...prev, 
          error: errorMessage 
        }));

        optionsRef.current.onError?.(errorMessage);
      },
      positionOptions
    );

    logger.info('Windows geolocation watch started', { watchId: watchIdRef.current });
  }, [enableHighAccuracy, timeout, maximumAge, convertPosition]);

  // Stop tracking position
  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      logger.info('Stopping Windows geolocation tracking', { watchId: watchIdRef.current });
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      setState(prev => ({ ...prev, isTracking: false }));
    }
  }, []);

  // Get current position once (not continuous tracking)
  const getCurrentPosition = useCallback((): Promise<GpsPosition> => {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        reject(new Error('Geolocation not supported'));
        return;
      }

      const positionOptions: PositionOptions = {
        enableHighAccuracy,
        timeout,
        maximumAge
      };

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const gpsPosition = convertPosition(pos);
          resolve(gpsPosition);
        },
        (error) => {
          let errorMessage = 'Failed to get current position';
          
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = 'Location permission denied';
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = 'Location unavailable';
              break;
            case error.TIMEOUT:
              errorMessage = 'Location request timed out';
              break;
          }
          
          reject(new Error(errorMessage));
        },
        positionOptions
      );
    });
  }, [enableHighAccuracy, timeout, maximumAge, convertPosition]);

  // Request permission (browsers handle this automatically on first access)
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      // Try to get position - this will trigger permission prompt if needed
      await getCurrentPosition();
      return true;
    } catch (error) {
      logger.error('Permission request failed', error, { component: 'WindowsGeolocation' });
      return false;
    }
  }, [getCurrentPosition]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  return {
    ...state,
    startTracking,
    stopTracking,
    getCurrentPosition,
    requestPermission
  };
}
