import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Target } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import L from 'leaflet';
import toast from 'react-hot-toast';
import { useDarkMode } from '../../hooks/useDarkMode';
import { useLanguage } from '../../hooks/useLanguage';
import { GpsPosition, GpsFieldBoundary } from '../../types';
import { enhancedOsrmService } from '../../services/enhancedOsrm';
import { offlineNavigationService } from '../../services/offlineNavigation';

// Import new components
import NavigationHeader from './Navigation/NavigationHeader';
import NavigationMap from './Navigation/NavigationMap';
import RouteSelector, { RouteOption } from './Navigation/RouteSelector';
import NavigationControls from './Navigation/NavigationControls';
import NavigationErrorBoundary from './Navigation/NavigationErrorBoundary';
import OfflineIndicator from './Navigation/OfflineIndicator';
import Button from '../ui/Button';

import 'leaflet/dist/leaflet.css';

interface NavigationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentPosition: GpsPosition | null;
  fieldBoundaries: GpsFieldBoundary[];
  projectName?: string;
}

interface NavigationState {
  stage: 'select-destination' | 'route-preview' | 'navigating' | 'arrived';
  destination: [number, number] | null;
  selectedRoute: RouteOption | null;
  routes: RouteOption[];
  isCalculatingRoute: boolean;
  // Progress state
  activeStepIndex: number;
  distanceToNext: number; // meters
  etaSeconds: number; // seconds
  nextInstruction: string | null;
  currentSpeed: number; // km/h
  progressPercent: number; // 0-100
  traveledDistance: number; // meters
}

// Debounce utility for performance optimization
function useDebounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<NodeJS.Timeout>();
  
  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => func(...args), delay);
  }, [func, delay]);
}

export default function NavigationPanel({
  isOpen,
  onClose,
  currentPosition,
  fieldBoundaries,
  projectName,
}: NavigationPanelProps) {
  const [isDarkMode] = useDarkMode();
  const { t, language } = useLanguage();
  const mapRef = useRef<L.Map | null>(null);
  const [navState, setNavState] = useState<NavigationState>({
    stage: 'select-destination',
    destination: null,
    selectedRoute: null,
    routes: [],
    isCalculatingRoute: false,
    activeStepIndex: 0,
    distanceToNext: 0,
    etaSeconds: 0,
    nextInstruction: null,
    currentSpeed: 0,
    progressPercent: 0,
    traveledDistance: 0,
  });
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [cachedRoutesCount, setCachedRoutesCount] = useState(0);
  const lastSpokenStepRef = useRef<number | null>(null);
  const lastInstructionRef = useRef<string | null>(null);
  const preferredNativeVoiceByLangRef = useRef<Partial<Record<'de' | 'en', number>>>({});
  const lastRerouteAtRef = useRef<number>(0);
  const rerouteInFlightRef = useRef(false);
  const lastRouteStartRef = useRef<[number, number] | null>(null);
  const lastPreviewRecalcRef = useRef<number>(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ displayName: string; lat: number; lon: number }>>([]);
  const [navRecenterToken, setNavRecenterToken] = useState(0);

  const getBoundarySearchResults = useCallback((query: string) => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [] as Array<{ displayName: string; lat: number; lon: number }>;

    return fieldBoundaries
      .map((boundary) => {
        const name = boundary?.name || '';
        if (!name.toLowerCase().includes(normalized)) return null;

        let coordinates: number[][] | null = null;
        if (boundary.geometry_type === 'Polygon') {
          const rings = boundary.coordinates as number[][][];
          coordinates = rings?.[0] || null;
        } else if (boundary.geometry_type === 'MultiPolygon') {
          const polygons = boundary.coordinates as number[][][][];
          coordinates = polygons?.[0]?.[0] || null;
        }

        if (!coordinates || coordinates.length === 0) return null;
        const sum = coordinates.reduce(
          (acc, coord) => ({ lat: acc.lat + (coord?.[1] || 0), lon: acc.lon + (coord?.[0] || 0) }),
          { lat: 0, lon: 0 }
        );

        return {
          displayName: name,
          lat: sum.lat / coordinates.length,
          lon: sum.lon / coordinates.length,
        };
      })
      .filter((result): result is { displayName: string; lat: number; lon: number } => result !== null)
      .slice(0, 8);
  }, [fieldBoundaries]);

  // Monitor online/offline status with actual internet connectivity check
  useEffect(() => {
    const checkInternetConnectivity = async () => {
      if (!navigator.onLine) {
        setIsOnline(false);
        return;
      }
      
      // Verify internet with tolerant probes; keep online=true if probes are blocked but navigator is online.
      const probeUrls = [
        'https://cloudflare.com/cdn-cgi/trace',
        'https://router.project-osrm.org/'
      ];

      let isReachable = false;
      for (const probeUrl of probeUrls) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          const response = await fetch(probeUrl, {
            method: 'GET',
            signal: controller.signal,
            cache: 'no-cache'
          });
          clearTimeout(timeoutId);
          if (response.ok || response.status === 204) {
            isReachable = true;
            break;
          }
        } catch {
          // Try next probe URL
        }
      }

      setIsOnline(isReachable || navigator.onLine);
    };
    
    const handleOnline = () => {
      console.log('[NavigationPanel] Network status changed to online, verifying...');
      checkInternetConnectivity().then(() => {
        if (navigator.onLine) {
          toast.success(t('gps.internetRestored'), { id: 'connection-status' });
        }
      });
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast(t('gps.offlineModeRouting'), {
        id: 'connection-status',
        duration: 8000,
        icon: '📴'
      });
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Check connectivity on mount
    checkInternetConnectivity();
    
    // Periodic re-check every 30 seconds
    const intervalId = setInterval(checkInternetConnectivity, 30000);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(intervalId);
    };
  }, [t]);

  // Update cached routes count
  useEffect(() => {
    const updateCacheStats = () => {
      const stats = enhancedOsrmService.getCacheStats();
      setCachedRoutesCount(stats.size);
    };
    
    updateCacheStats();
    const interval = setInterval(updateCacheStats, 30000); // Update every 30 seconds
    
    return () => clearInterval(interval);
  }, []);

  // Calculate distance between two points (Haversine formula) - memoized
  const calculateDistance = useMemo(() => {
    return (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371; // Earth's radius in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    };
  }, []);

  // Offline tile prefetch helpers
  const germanyTilesAvailable = useMemo(() => {
    if (typeof window === 'undefined') return false;
    if ((window as any).__GERMANY_TILES_AVAILABLE__ === true) return true;
    if ((window as any).Capacitor) return true;
    return false;
  }, []);

  const latLngToTile = useCallback((lat: number, lon: number, zoom: number) => {
    const latRad = lat * Math.PI / 180;
    const n = 2 ** zoom;
    const xTile = Math.floor((lon + 180) / 360 * n);
    const yTile = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { xTile, yTile };
  }, []);

  const prefetchRouteTiles = useCallback(async (route: RouteOption) => {
    if (!germanyTilesAvailable || !route?.coordinates?.length) return;
    if (!('caches' in window)) return;

    const lats = route.coordinates.map(c => c[0]);
    const lons = route.coordinates.map(c => c[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    const zoomLevels = [10, 11, 12, 13, 14];
    const maxRequests = 120; // protect bandwidth
    let requested = 0;

    const cache = await caches.open('route-tiles');

    for (const zoom of zoomLevels) {
      const { xTile: xMin } = latLngToTile(maxLat, minLon, zoom);
      const { xTile: xMax } = latLngToTile(minLat, maxLon, zoom);
      const { yTile: yMin } = latLngToTile(maxLat, minLon, zoom);
      const { yTile: yMax } = latLngToTile(minLat, maxLon, zoom);

      for (let x = xMin; x <= xMax && requested < maxRequests; x++) {
        for (let y = yMin; y <= yMax && requested < maxRequests; y++) {
          const url = `/tiles/germany/${zoom}/${x}/${y}.png`;
          requested++;
          // Fire and forget
          cache.add(url).catch(() => {/* ignore */});
        }
      }

      if (requested >= maxRequests) break;
    }
  }, [germanyTilesAvailable, latLngToTile]);

  // Prefetch tiles for selected route to improve offline experience
  useEffect(() => {
    if (navState.selectedRoute) {
      void prefetchRouteTiles(navState.selectedRoute);
    }
  }, [navState.selectedRoute, prefetchRouteTiles]);

  // Phase 2: bundle regional offline routing backend (e.g., Valhalla/GraphHopper/OSRM dataset for Germany)

  // Calculate route using enhanced OSRM service with retry and caching
  const calculateRoute = useCallback(async (destination: [number, number]) => {
    if (!currentPosition) {
      toast.error(t('gps.noGpsForRoute'));
      return;
    }

    setNavState(prev => ({ ...prev, isCalculatingRoute: true }));
    lastRouteStartRef.current = [currentPosition.latitude, currentPosition.longitude];
    
    const toastId = toast.loading(t('gps.calculatingRoute'), { id: 'route-calc' });

    try {
      console.log('🗺️ Calculating route:', {
        from: [currentPosition.latitude, currentPosition.longitude],
        to: destination
      });
      
      // Try cached route first when offline
      if (!navigator.onLine) {
        const cached = enhancedOsrmService.getCachedRoute(
          [currentPosition.latitude, currentPosition.longitude],
          destination,
          { alternatives: true, profile: 'driving' }
        );
        if (cached) {
          toast.success(t('gps.usingCachedRouteOffline'), { id: toastId });
          const routes: RouteOption[] = cached.routes.map((route: any, idx: number) => ({
            id: `route-cached-${idx}`,
            coordinates: route.geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]] as [number, number]),
            distance: route.distance,
            duration: route.duration,
            name: idx === 0 ? t('gps.fastestRoute') || 'Fastest Route' : `${t('gps.alternative') || 'Alternative'} ${idx}`,
            steps: (route.steps || []).map((step: any) => ({
              ...step,
              instruction: translateInstruction(step.instruction)
            })),
          }));

          setNavState(prev => ({
            ...prev,
            stage: 'route-preview',
            routes,
            selectedRoute: routes[0],
            isCalculatingRoute: false,
          }));
          return;
        }
      }

      const routeLanguage = language?.toLowerCase().startsWith('de') ? 'de' : 'en';
      const data = await enhancedOsrmService.calculateRoute(
        [currentPosition.latitude, currentPosition.longitude],
        destination,
        { alternatives: true, profile: 'driving' },
        routeLanguage
      );
      
      if (data.code === 'Ok' && data.routes) {
        const routes: RouteOption[] = data.routes.map((route: any, idx: number) => ({
          id: `route-${idx}`,
          coordinates: route.geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]] as [number, number]),
          distance: route.distance,
          duration: route.duration,
          name: idx === 0 ? t('gps.fastestRoute') || 'Fastest Route' : `${t('gps.alternative') || 'Alternative'} ${idx}`,
          steps: (route.steps || []).map((step: any) => ({
            ...step,
            instruction: translateInstruction(step.instruction)
          })),
        }));

        setNavState(prev => ({
          ...prev,
          stage: 'route-preview',
          routes,
          selectedRoute: routes[0],
          isCalculatingRoute: false,
        }));
        
        toast.success(
          t(routes.length > 1 ? 'gps.routeFoundMultiple' : 'gps.routeFoundSingle', { count: routes.length }),
          { id: toastId }
        );
      }
    } catch (error: any) {
      console.error('❌ Route calculation failed:', error);
      
      // Fallback: Use offline navigation with turn-by-turn instructions
      console.log('🗺️ Using offline navigation fallback');
      const offlineRoute = offlineNavigationService.createRoute([
        [currentPosition.latitude, currentPosition.longitude],
        destination,
      ]);
      
      const fallbackRoute: RouteOption = {
        id: 'offline',
        coordinates: offlineRoute.waypoints,
        distance: offlineRoute.totalDistance,
        duration: offlineRoute.estimatedDuration,
        name: isOnline ? (t('gps.directRoute') || 'Direct Route') : (t('gps.offlineRoute') || 'Offline Route'),
        steps: offlineRoute.steps.map(step => ({
          distance: step.distance,
          duration: step.distance / 8.33, // ~30 km/h
          instruction: step.instruction,
          name: '',
        })),
      };
      
      setNavState(prev => ({
        ...prev,
        stage: 'route-preview',
        routes: [fallbackRoute],
        selectedRoute: fallbackRoute,
        isCalculatingRoute: false,
      }));
      
      toast(
        isOnline 
          ? t('gps.directRouteWithGuidance')
          : t('gps.offlineGpsNavigation'),
        { id: toastId, icon: '🧭', duration: 5000 }
      );
    }
  }, [currentPosition, t, calculateDistance, isOnline]);

  // Refresh route preview if user moves significantly before starting navigation
  useEffect(() => {
    if (navState.stage !== 'route-preview') return;
    if (!currentPosition || !navState.destination || navState.isCalculatingRoute) return;
    if (!lastRouteStartRef.current) return;

    const [startLat, startLon] = lastRouteStartRef.current;
    const movedMeters = calculateDistance(startLat, startLon, currentPosition.latitude, currentPosition.longitude) * 1000;
    if (movedMeters < 80) return;

    const now = Date.now();
    if (now - lastPreviewRecalcRef.current < 10000) return;
    lastPreviewRecalcRef.current = now;

    void calculateRoute(navState.destination);
  }, [navState.stage, navState.destination, navState.isCalculatingRoute, currentPosition, calculateRoute, calculateDistance]);

  // Simple Nominatim geocoding with debounce
  const performGeocodeSearch = useCallback(async (query: string) => {
    if (!query || query.length < 3) {
      setSearchResults([]);
      return;
    }

    // Skip geocoding when offline to prevent external requests
    if (!navigator.onLine) {
      setSearchResults(getBoundarySearchResults(query));
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const data = await resp.json();
      const results = (data || []).map((item: any) => ({
        displayName: item.display_name,
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon),
      }));
      setSearchResults(results.length > 0 ? results : getBoundarySearchResults(query));
    } catch (error) {
      console.error('Geocoding failed:', error);
      setSearchResults(getBoundarySearchResults(query));
    }
  }, [getBoundarySearchResults]);

  const debouncedGeocodeSearch = useDebounce(performGeocodeSearch, 300);

  const snapToRoad = useCallback(async (lat: number, lon: number): Promise<[number, number]> => {
    // Skip snap-to-road when offline to prevent external requests
    if (!navigator.onLine) {
      console.warn('[NavigationPanel] Skipping snap-to-road - offline mode');
      return [lat, lon];
    }

    try {
      const resp = await fetch(`https://router.project-osrm.org/nearest/v1/driving/${lon},${lat}`);
      const data = await resp.json();
      const coord = data?.waypoints?.[0]?.location;
      if (coord && Array.isArray(coord) && coord.length === 2) {
        return [coord[1], coord[0]];
      }
    } catch (_) {
      // Fall back to original point
    }
    return [lat, lon];
  }, []);

  // Debounced map click handler for better performance
  const debouncedMapClick = useDebounce((e: L.LeafletMouseEvent) => {
    if (navState.stage === 'select-destination' && !navState.isCalculatingRoute) {
      const destination: [number, number] = [e.latlng.lat, e.latlng.lng];
      setNavState(prev => ({ ...prev, destination }));
      calculateRoute(destination);
    }
  }, 300);

  // Handler functions
  const handleStartNavigation = useCallback(() => {
    if (navState.selectedRoute) {
      setNavState(prev => ({ ...prev, stage: 'navigating' }));
      lastSpokenStepRef.current = null;
      lastInstructionRef.current = null;
      toast.success(t('gps.navigationStarted') || 'Navigation started');
    }
  }, [navState.selectedRoute]);

  const handleEndNavigation = useCallback(() => {
    setNavState({
      stage: 'select-destination',
      destination: null,
      selectedRoute: null,
      routes: [],
      isCalculatingRoute: false,
      activeStepIndex: 0,
      distanceToNext: 0,
      etaSeconds: 0,
      nextInstruction: null,
      currentSpeed: 0,
      progressPercent: 0,
      traveledDistance: 0,
    });
    toast.success(t('gps.navigationEnded') || 'Navigation ended');
  }, [t]);

  const handleRouteSelect = useCallback((route: RouteOption) => {
    setNavState(prev => ({ ...prev, selectedRoute: route }));
  }, []);

  const handleRecenterMap = useCallback(() => {
    if (currentPosition && mapRef.current) {
      const zoom = navState.stage === 'navigating' ? 17 : 15;
      mapRef.current.setView(
        [currentPosition.latitude, currentPosition.longitude],
        zoom,
        { animate: true, duration: 0.5 }
      );
      setNavRecenterToken(prev => prev + 1);
      toast.success(t('gps.mapRecentered') || 'Map recentered', { duration: 1500 });
    }
  }, [currentPosition, navState.stage]);

  // Error handler for navigation components
  const handleNavigationError = useCallback((error: Error) => {
    console.error('Navigation component error:', error);
    toast.error(t('gps.navigationError') || 'Navigation error occurred - please try again');
  }, []);

  // --- Navigation progress tracking ---
  const speakInstruction = useCallback(async (text: string) => {
    if (!text) return;

    const currentLanguage = language?.toLowerCase().startsWith('de') ? 'de' : 'en';
    const languageCode = currentLanguage === 'de' ? 'de-DE' : 'en-US';
    
    console.log('[TTS] Speaking instruction:', { text, currentLanguage, languageCode });

    // Native TTS (Capacitor) for APK reliability
    if (Capacitor.isNativePlatform()) {
      try {
        const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
        let preferredVoice = preferredNativeVoiceByLangRef.current[currentLanguage];

        if (preferredVoice === undefined) {
          try {
            const { voices } = await TextToSpeech.getSupportedVoices();
            const normalizedVoices = voices.map((voice, index) => ({
              index,
              lang: (voice.lang || '').toLowerCase(),
              name: (voice.name || '').toLowerCase(),
              default: !!voice.default,
            }));

            const languageCandidates = currentLanguage === 'de'
              ? ['de-de', 'de-at', 'de-ch', 'de']
              : ['en-us', 'en-gb', 'en-au', 'en-ca', 'en'];
            const nameCandidates = currentLanguage === 'de'
              ? ['deutsch', 'german', 'de-de', 'google de']
              : ['english', 'en-us', 'en-gb', 'google us english', 'google uk english'];

            const exactMatch = normalizedVoices.find(v => languageCandidates.includes(v.lang));
            const startsWithMatch = normalizedVoices.find(v => languageCandidates.some(candidate => v.lang.startsWith(candidate)));
            const nameMatch = normalizedVoices.find(v => nameCandidates.some(candidate => v.name.includes(candidate)));
            const defaultMatch = normalizedVoices.find(v => v.default);

            preferredVoice = exactMatch?.index ?? startsWithMatch?.index ?? nameMatch?.index ?? defaultMatch?.index;
            if (preferredVoice !== undefined) {
              preferredNativeVoiceByLangRef.current[currentLanguage] = preferredVoice;
            }
          } catch (voiceError) {
            console.warn('[TTS] Could not query native voices, using language-only selection', voiceError);
          }
        }

        console.log('[TTS] Using native TextToSpeech with lang:', languageCode);
        await TextToSpeech.speak({
          text,
          lang: languageCode,
          voice: preferredVoice,
          rate: 1.0,
          pitch: 1.0,
          volume: 1.0,
          category: 'playback'
        });
        return;
      } catch (err) {
        console.warn('[TTS] Native TTS failed, falling back to SpeechSynthesis', err);
      }
    }

    // Web fallback - SpeechSynthesis API
    if ('speechSynthesis' in window) {
      const speakWithVoice = () => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = languageCode;
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        
        // Get all available voices
        const voices = window.speechSynthesis.getVoices();
        console.log('[TTS] Available voices:', voices.map(v => ({ name: v.name, lang: v.lang })));
        
        if (voices.length > 0) {
          let selectedVoice = null;
          
          if (currentLanguage === 'de') {
            // Find German voice - prioritize de-DE
            selectedVoice = voices.find(voice => voice.lang === 'de-DE') ||
                           voices.find(voice => voice.lang.startsWith('de-')) ||
                           voices.find(voice => voice.lang.toLowerCase().includes('de'));
            console.log('[TTS] Selected German voice:', selectedVoice?.name, selectedVoice?.lang);
          } else {
            // Find English voice - prioritize en-US, fallback to en-GB or any English
            selectedVoice = voices.find(voice => voice.lang === 'en-US') ||
                           voices.find(voice => voice.lang === 'en-GB') ||
                           voices.find(voice => voice.lang.startsWith('en-')) ||
                           voices.find(voice => voice.lang.toLowerCase().includes('en'));
            console.log('[TTS] Selected English voice:', selectedVoice?.name, selectedVoice?.lang);
          }
          
          if (selectedVoice) {
            utterance.voice = selectedVoice;
          } else {
            console.warn('[TTS] No suitable voice found for language:', currentLanguage);
          }
        } else {
          console.warn('[TTS] No voices available');
        }
        
        console.log('[TTS] Speaking with voice:', utterance.voice?.name, 'lang:', utterance.lang);
        window.speechSynthesis.speak(utterance);
      };

      // If voices aren't loaded yet, wait for them
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) {
        window.speechSynthesis.addEventListener('voiceschanged', speakWithVoice, { once: true });
      } else {
        speakWithVoice();
      }
    }
  }, [language]);

  // Translate navigation instruction text based on current language
  const translateInstruction = useCallback((instruction: string): string => {
    if (!instruction) return instruction;
    
    const currentLanguage = language?.toLowerCase().startsWith('de') ? 'de' : 'en';
    console.log('[Translation] Translating instruction:', instruction, 'to language:', currentLanguage);

    // If already in German and user wants German, or already in English and user wants English, return as-is
    const hasGermanWords = /links|rechts|geradeaus|ankommen/i.test(instruction);
    const hasEnglishWords = /left|right|continue|arrive/i.test(instruction);
    
    if (currentLanguage === 'de' && hasGermanWords && !hasEnglishWords) {
      console.log('[Translation] Already in German, keeping as-is');
      return instruction;
    }
    if (currentLanguage === 'en' && hasEnglishWords && !hasGermanWords) {
      console.log('[Translation] Already in English, keeping as-is');
      return instruction;
    }

    // Pattern matching for translation
    const turnLeftPattern = /turn\s+left|biegen\s+Sie\s+links\s+ab/i;
    const turnRightPattern = /turn\s+right|biegen\s+Sie\s+rechts\s+ab/i;
    const continuePattern = /continue|fahren\s+Sie\s+weiter|geradeaus/i;
    const arrivePattern = /arrive|destination|ankommen|ziel/i;
    const ontoPattern = /onto\s+(.+)|auf\s+(.+)/i;
    const inPattern = /in\s+(\d+)\s*(m|meters|km|kilometers)/i;

    let translated = instruction;

    // Translate based on target language
    if (turnLeftPattern.test(instruction)) {
      const replacement = currentLanguage === 'de' 
        ? 'Biegen Sie links ab'
        : 'Turn left';
      translated = translated.replace(turnLeftPattern, replacement);
    }
    
    if (turnRightPattern.test(instruction)) {
      const replacement = currentLanguage === 'de'
        ? 'Biegen Sie rechts ab'
        : 'Turn right';
      translated = translated.replace(turnRightPattern, replacement);
    }
    
    if (continuePattern.test(instruction) && !translated.includes('links') && !translated.includes('rechts') && !translated.includes('left') && !translated.includes('right')) {
      const replacement = currentLanguage === 'de'
        ? 'Fahren Sie weiter'
        : 'Continue';
      translated = translated.replace(continuePattern, replacement);
    }
    
    if (arrivePattern.test(instruction)) {
      const replacement = currentLanguage === 'de'
        ? 'Sie haben Ihr Ziel erreicht'
        : 'You have arrived at your destination';
      translated = translated.replace(/arrive.*$|ankommen.*$/i, replacement);
    }

    // Handle street names
    const ontoMatch = instruction.match(ontoPattern);
    if (ontoMatch) {
      const streetName = ontoMatch[1] || ontoMatch[2];
      if (streetName) {
        const replacement = currentLanguage === 'de'
          ? `auf ${streetName}`
          : `onto ${streetName}`;
        translated = translated.replace(ontoPattern, replacement);
      }
    }

    // Handle distances
    const inMatch = instruction.match(inPattern);
    if (inMatch) {
      const distance = inMatch[1];
      const unit = inMatch[2];
      if (currentLanguage === 'de') {
        const unitDE = unit.startsWith('k') ? 'Kilometer' : 'Meter';
        translated = translated.replace(inPattern, `in ${distance} ${unitDE}`);
      }
    }

    console.log('[Translation] Result:', translated);
    return translated;
  }, [language]);

  const computeProgress = useCallback((route: RouteOption, position: GpsPosition) => {
    const coords = route.coordinates;
    if (!coords || coords.length < 2) return null;

    // Find nearest segment to current position
    let nearestDistance = Infinity;
    let traveledOnSegment = 0;
    let cumulative = 0;
    let nearestCumulative = 0;
    let nearestSegLength = 0;

    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      const segLength = calculateDistance(a[0], a[1], b[0], b[1]) * 1000; // meters
      const distToA = calculateDistance(position.latitude, position.longitude, a[0], a[1]) * 1000;
      const distToB = calculateDistance(position.latitude, position.longitude, b[0], b[1]) * 1000;

      // Approximate perpendicular distance using triangle inequality
      const proj = Math.max(0, Math.min(1, ((position.latitude - a[0]) * (b[0] - a[0]) + (position.longitude - a[1]) * (b[1] - a[1])) / ((b[0] - a[0])**2 + (b[1] - a[1])**2)));
      const projLat = a[0] + proj * (b[0] - a[0]);
      const projLng = a[1] + proj * (b[1] - a[1]);
      const distToProj = calculateDistance(position.latitude, position.longitude, projLat, projLng) * 1000;

      if (distToProj < nearestDistance) {
        nearestDistance = distToProj;
        nearestCumulative = cumulative + proj * segLength;
        nearestSegLength = segLength;
        traveledOnSegment = proj * segLength;
      }

      cumulative += segLength;
    }

    const totalDistance = route.distance;
    const traveledDistance = Math.min(nearestCumulative, totalDistance);
    const remainingDistance = Math.max(totalDistance - traveledDistance, 0);
    const progressPercent = Math.min(100, (traveledDistance / totalDistance) * 100);

    // Determine active step
    let activeStepIndex = 0;
    let stepAccum = 0;
    const steps = route.steps || [];
    for (let i = 0; i < steps.length; i++) {
      stepAccum += steps[i].distance;
      if (traveledDistance <= stepAccum) {
        activeStepIndex = i;
        break;
      }
    }

    const distanceToNext = Math.max(stepAccum - traveledDistance, 0);
    const etaSeconds = route.duration * (remainingDistance / totalDistance);
    const nextInstruction = steps[activeStepIndex]?.instruction || null;

    // Calculate speed from GPS if available, otherwise estimate from progress
    const currentSpeed = position.speed 
      ? position.speed * 3.6 // m/s to km/h
      : (position.speed_kmh || 0);

    return {
      activeStepIndex,
      distanceToNext,
      etaSeconds,
      nextInstruction,
      remainingDistance,
      nearestDistance,
      traveledDistance,
      progressPercent,
      currentSpeed,
    };
  }, [calculateDistance]);

  const rerouteFromCurrentPosition = useCallback(async () => {
    if (!currentPosition || !navState.destination) return;
    if (rerouteInFlightRef.current) return;

    const now = Date.now();
    if (now - lastRerouteAtRef.current < 8000) return; // throttle reroutes
    lastRerouteAtRef.current = now;
    rerouteInFlightRef.current = true;

    const toastId = toast.loading(t('gps.rerouting') || 'Rerouting...', { id: 'reroute' });
    try {
      if (!isOnline) {
        const offlineRoute = offlineNavigationService.createRoute([
          [currentPosition.latitude, currentPosition.longitude],
          navState.destination,
        ]);

        const fallbackRoute: RouteOption = {
          id: `offline-${Date.now()}`,
          coordinates: offlineRoute.waypoints,
          distance: offlineRoute.totalDistance,
          duration: offlineRoute.estimatedDuration,
          name: t('gps.offlineRoute') || 'Offline Route',
          steps: offlineRoute.steps.map(step => ({
            distance: step.distance,
            duration: step.distance / 8.33,
            instruction: step.instruction,
            name: '',
          })),
        };

        lastRouteStartRef.current = [currentPosition.latitude, currentPosition.longitude];
        setNavState(prev => ({
          ...prev,
          routes: [fallbackRoute],
          selectedRoute: fallbackRoute,
          stage: 'navigating',
          activeStepIndex: 0,
          distanceToNext: 0,
          etaSeconds: fallbackRoute.duration,
          nextInstruction: fallbackRoute.steps?.[0]?.instruction || null,
        }));
        toast.success(t('gps.offlineReroute') || 'Offline reroute complete', { id: toastId });
        return;
      }

      const routeLanguage = language?.toLowerCase().startsWith('de') ? 'de' : 'en';
      const data = await enhancedOsrmService.calculateRoute(
        [currentPosition.latitude, currentPosition.longitude],
        navState.destination,
        { alternatives: true, profile: 'driving' },
        routeLanguage
      );

      if (data.code === 'Ok' && data.routes?.length) {
        const routes: RouteOption[] = data.routes.map((route: any, idx: number) => ({
          id: `route-${Date.now()}-${idx}`,
          coordinates: route.geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]] as [number, number]),
          distance: route.distance,
          duration: route.duration,
          name: idx === 0 ? t('gps.fastestRoute') || 'Fastest Route' : `${t('gps.alternative') || 'Alternative'} ${idx}`,
          steps: (route.steps || []).map((step: any) => ({
            ...step,
            instruction: translateInstruction(step.instruction)
          })),
        }));

        lastRouteStartRef.current = [currentPosition.latitude, currentPosition.longitude];
        setNavState(prev => ({
          ...prev,
          routes,
          selectedRoute: routes[0],
          stage: 'navigating',
          activeStepIndex: 0,
          distanceToNext: 0,
          etaSeconds: routes[0].duration,
          nextInstruction: routes[0].steps?.[0]?.instruction || null,
        }));
        toast.success(t('gps.rerouted') || 'Rerouted', { id: toastId });
        return;
      }

      toast.error(t('gps.noAlternativeRoute') || 'No alternative route found', { id: toastId });
    } catch (error) {
      console.error('Reroute failed:', error);
      toast.error(t('gps.rerouteFailed') || 'Reroute failed', { id: toastId });
    } finally {
      rerouteInFlightRef.current = false;
    }
  }, [currentPosition, navState.destination, t, isOnline, translateInstruction, language]);

  useEffect(() => {
    if (navState.stage !== 'navigating' || !navState.selectedRoute || !currentPosition) return;

    const progress = computeProgress(navState.selectedRoute, currentPosition);
    if (!progress) return;

    setNavState(prev => ({
      ...prev,
      activeStepIndex: progress.activeStepIndex,
      distanceToNext: progress.distanceToNext,
      etaSeconds: progress.etaSeconds,
      nextInstruction: progress.nextInstruction,
      currentSpeed: progress.currentSpeed,
      progressPercent: progress.progressPercent,
      traveledDistance: progress.traveledDistance,
    }));

    // Voice guidance: speak when approaching next turn and not already spoken
    if (progress.nextInstruction && progress.distanceToNext < 200) {
      if (lastSpokenStepRef.current !== progress.activeStepIndex || lastInstructionRef.current !== progress.nextInstruction) {
        speakInstruction(progress.nextInstruction);
        lastSpokenStepRef.current = progress.activeStepIndex;
        lastInstructionRef.current = progress.nextInstruction;
      }
    }
    // Off-route detection and rerouting (dynamic threshold)
    const speedKmh = progress.currentSpeed || 0;
    const offRouteThreshold = speedKmh > 20 ? 60 : speedKmh > 5 ? 40 : 25; // meters
    if (progress.nearestDistance > offRouteThreshold) {
      void rerouteFromCurrentPosition();
    }

    // Check if arrived at destination
    if (progress.remainingDistance < 50 && navState.stage === 'navigating') {
      setNavState(prev => ({ ...prev, stage: 'arrived' }));
      toast.success(t('gps.arrivedAtDestination') || 'You have arrived at your destination!', {
        duration: 5000,
        icon: '🎯'
      });
      speakInstruction(t('gps.arrivedAtDestination') || 'You have arrived at your destination');
    }
  }, [navState.stage, navState.selectedRoute, currentPosition, computeProgress, speakInstruction, isOnline, rerouteFromCurrentPosition, t]);

  if (!isOpen) return null;

  return (
    <NavigationErrorBoundary onError={handleNavigationError}>
      <div
        className={`fixed right-0 md:right-4 top-4 bottom-0 md:bottom-4 w-full md:w-[420px] lg:w-[480px] transition-all duration-500 ease-in-out z-50 md:rounded-2xl shadow-lg flex flex-col overflow-hidden glass-panel animate-in fade-in slide-in-from-right-8 duration-500 ${
          isDarkMode ? 'glass-panel-dark' : 'glass-panel-light'
        }`}
        data-nav-panel={isOpen ? 'true' : 'false'}
        style={{ 
          maxWidth: 'calc(100vw)',
          WebkitBackdropFilter: 'blur(12px)',
          backdropFilter: 'blur(12px)',
          WebkitTransform: 'translateZ(0)',
          transform: 'translateZ(0)'
        }}
      >
        {/* Header */}
        <NavigationHeader 
          projectName={projectName} 
          onClose={onClose} 
        />

        {/* Map - Full size with overlays */}
        <div className="flex-1 relative overflow-hidden min-h-[320px]">
          {/* Offline/Connection Indicator */}
          <OfflineIndicator 
            isOnline={isOnline}
            hasGPSSignal={!!currentPosition}
            cachedRoutesCount={cachedRoutesCount}
          />
          
          {/* Navigation Controls Overlay (only during navigation) */}
          {navState.stage === 'navigating' && (
            <NavigationControls
              selectedRoute={navState.selectedRoute}
              onRecenter={handleRecenterMap}
              onEndNavigation={handleEndNavigation}
              distanceToNext={navState.distanceToNext}
              etaSeconds={navState.etaSeconds}
              nextInstruction={navState.nextInstruction}
              currentSpeed={navState.currentSpeed}
              progressPercent={navState.progressPercent}
            />
          )}
          
          {/* Map Component */}
          <NavigationErrorBoundary 
            fallback={
              <div className="flex items-center justify-center h-full bg-gray-100 dark:bg-gray-800">
                <p className="text-gray-600 dark:text-gray-400">{t('gps.mapUnavailable') || 'Map temporarily unavailable'}</p>
              </div>
            }
          >
            <NavigationMap
              currentPosition={currentPosition}
              fieldBoundaries={fieldBoundaries}
              destination={navState.destination}
              selectedRoute={navState.selectedRoute}
              routes={navState.routes}
              navStage={navState.stage}
              isOnline={isOnline}
              onMapClick={debouncedMapClick}
              mapRef={mapRef}
              recenterToken={navRecenterToken}
            />
          </NavigationErrorBoundary>
        </div>

        {/* Bottom Panel - Instructions/Controls (only for non-navigating states) */}
        {navState.stage !== 'navigating' && (
          <div className={`flex-shrink-0 p-3 md:p-4 border-t backdrop-blur-2xl ${
            isDarkMode ? 'glass-panel-dark border-gray-700/50' : 'glass-panel-light border-gray-200/50'
          }`}>
            {navState.stage === 'select-destination' && (
              <div className="flex items-center gap-2 md:gap-3 p-2 rounded-xl" style={{
                background: isDarkMode ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.08)'
              }}>
                <div className="p-1.5 md:p-2 rounded-full bg-blue-500 flex-shrink-0">
                  <Target className="w-3 h-3 md:w-4 md:h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-xs md:text-sm text-gray-900 dark:text-white">
                    {t('gps.selectDestination') || 'Select Destination'}
                  </p>
                  <p className="text-xs mt-0.5 text-gray-600 dark:text-gray-400">
                    {navState.isCalculatingRoute 
                      ? (t('gps.calculatingRoute') || 'Calculating route...')
                      : (t('gps.tapOnField') || 'Tap on map to set destination')
                    }
                  </p>
                </div>
              </div>
            )}

            {navState.stage === 'select-destination' && (
              <div className="mt-3 space-y-2">
                <div className="flex gap-2">
                  <input
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      debouncedGeocodeSearch(e.target.value);
                    }}
                    placeholder={t('gps.searchDestination') || 'Search address or place'}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => debouncedGeocodeSearch(searchTerm)}
                  >
                    {t('common.search') || 'Search'}
                  </Button>
                </div>

                {searchResults.length > 0 && (
                  <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg border ${isDarkMode ? 'border-gray-700' : 'border-gray-200'} max-h-40 overflow-auto`}> 
                    {searchResults.map((result, idx) => (
                      <button
                        key={`${result.displayName}-${idx}`}
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-gray-700 text-sm"
                        onClick={async () => {
                          const snapped = await snapToRoad(result.lat, result.lon);
                          const destination: [number, number] = snapped;
                          setNavState(prev => ({ ...prev, destination }));
                          calculateRoute(destination);
                          setSearchResults([]);
                        }}
                      >
                        {result.displayName}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {navState.stage === 'route-preview' && navState.selectedRoute && (
              <RouteSelector
                routes={navState.routes}
                selectedRoute={navState.selectedRoute}
                onRouteSelect={handleRouteSelect}
                onStartNavigation={handleStartNavigation}
                isLoading={navState.isCalculatingRoute}
              />
            )}

            {navState.stage === 'arrived' && (
              <div className="p-4 text-center">
                <div className="mb-4">
                  <div className="w-20 h-20 mx-auto bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                    <Target className="w-10 h-10 text-green-600 dark:text-green-400" />
                  </div>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  {t('gps.arrivedAtDestination') || 'You have arrived!'}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  {t('gps.destinationReached') || 'You have reached your destination'}
                </p>
                <Button
                  variant="primary"
                  onClick={handleEndNavigation}
                  className="w-full"
                >
                  {t('gps.newRoute') || 'Start New Route'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </NavigationErrorBoundary>
  );
}