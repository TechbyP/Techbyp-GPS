import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap, Polygon, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Capacitor } from '@capacitor/core';
import { GpsPosition, GpsFieldBoundary } from '../../../types';
import { getBlankTileUrl, createTileLoadStartHandler } from '../../../utils/tileUtils';
import { getDefaultPack, getPackForLocation, OFFLINE_MAP_PACKS } from '../../../config/offlineMapPacks';
import { useLanguage } from '../../../hooks/useLanguage';
import { useDarkMode } from '../../../hooks/useDarkMode';
import { RouteOption } from './RouteSelector';
import PMTilesVectorLayer from '../PMTilesVectorLayer';
import { tileDownloader, DownloadProgress } from '../../../services/offlineTileDownloader';
import 'leaflet/dist/leaflet.css';
import 'leaflet-rotate';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css';
import 'leaflet-defaulticon-compatibility';
const offlinePmtilesUrl = (window as any).__VITE_PMTILES_URL__ || (import.meta.env.VITE_PMTILES_URL as string | undefined) || '/tiles/germany.pmtiles';
const onlineTileUrl = (window as any).__VITE_ONLINE_TILE_URL__ || (import.meta.env.VITE_ONLINE_TILE_URL as string | undefined);

const simplifyLatLngByStep = (points: [number, number][], step: number): [number, number][] => {
  if (step <= 1 || points.length <= 4) return points;
  const simplified = points.filter((_, idx) => idx % step === 0);
  if (simplified.length < 4) return points;
  const first = simplified[0];
  const last = simplified[simplified.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    simplified.push(first);
  }
  return simplified;
};

const getPolygonSimplifyStep = (_zoom: number, _isMoving: boolean): number => {
  return 1;
};

const getRouteSimplifyStep = (zoom: number, isMoving: boolean): number => {
  if (isMoving) return 8;
  if (zoom >= 16) return 1;
  if (zoom >= 14) return 2;
  if (zoom >= 12) return 4;
  return 6;
};

// Centroid helper for labeling polygons - memoized for performance
const calculateCentroid = (coordinates: number[][][]): [number, number] | null => {
  try {
    const ring = coordinates[0];
    if (!ring || ring.length === 0) return null;
    let sumLat = 0;
    let sumLng = 0;
    for (const coord of ring) {
      sumLng += coord[0];
      sumLat += coord[1];
    }
    return [sumLat / ring.length, sumLng / ring.length];
  } catch (error) {
    console.error('Error calculating centroid:', error);
    return null;
  }
};

// Create arrow icon that rotates based on heading
const createArrowIcon = (heading: number = 0) => {
  return new L.DivIcon({
    className: 'navigation-arrow-marker',
    html: `
      <div style="
        width: 40px;
        height: 40px;
        position: relative;
        transform: rotate(${heading}deg);
      ">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 100%; height: 100%;">
          <path d="M12 2 L18 22 L12 18 L6 22 Z" fill="#3B82F6" stroke="white" stroke-width="2"/>
        </svg>
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
};

const destinationIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" fill="#EF4444" stroke="white" stroke-width="2"/>
      <circle cx="12" cy="10" r="3" fill="white"/>
    </svg>
  `),
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

const BLANK_TILE_URL = getBlankTileUrl();

// Map controller for auto-zoom and center
function MapController({
  bounds,
  center,
  zoom,
  shouldUpdate,
  forceCenter,
  shouldUpdateZoom,
  
  centerThresholdMeters = 10
}: {
  bounds?: L.LatLngBounds | null;
  center?: [number, number] | null;
  zoom?: number;
  shouldUpdate?: boolean;
  forceCenter?: boolean;
  shouldUpdateZoom?: boolean;
  centerThresholdMeters?: number;
}) {
  const map = useMap();
  const lastUpdateRef = useRef<{ boundsKey?: string; centerKey?: string; zoom?: number }>({});

  const getBoundsKey = (value: L.LatLngBounds): string => {
    const sw = value.getSouthWest();
    const ne = value.getNorthEast();
    return `${sw.lat.toFixed(6)},${sw.lng.toFixed(6)}:${ne.lat.toFixed(6)},${ne.lng.toFixed(6)}`;
  };

  const getCenterKey = (value: [number, number]): string => {
    return `${value[0].toFixed(6)},${value[1].toFixed(6)}`;
  };

  useEffect(() => {
    // Only update if something actually changed
    if (shouldUpdate === false) return;

    // Always update if forceCenter is true - this is for manual re-centering after user interaction
    if (forceCenter && center) {
      const target = L.latLng(center[0], center[1]);
      const zoomTarget = shouldUpdateZoom && zoom != null ? zoom : map.getZoom();
      const zoomDelta = Math.abs(map.getZoom() - zoomTarget);
      const distance = map.distance(map.getCenter(), target);
      if (distance > centerThresholdMeters || zoomDelta >= 0.01) {
        map.setView(target, zoomTarget, { animate: true, duration: 0.35 });
        lastUpdateRef.current.centerKey = getCenterKey(center);
        lastUpdateRef.current.zoom = zoomTarget;
      }
      return;
    }

    // Check if we actually have new data
    const nextBoundsKey = bounds ? getBoundsKey(bounds) : undefined;
    const nextCenterKey = center ? getCenterKey(center) : undefined;
    const isBoundsChanged = nextBoundsKey != null && nextBoundsKey !== lastUpdateRef.current.boundsKey;
    const isCenterChanged = nextCenterKey != null && nextCenterKey !== lastUpdateRef.current.centerKey;
    const isZoomChanged = zoom != null && zoom !== lastUpdateRef.current.zoom;

    if (!isBoundsChanged && !isCenterChanged && !isZoomChanged) {
      return;
    }

    if (bounds && isBoundsChanged) {
      lastUpdateRef.current.boundsKey = nextBoundsKey;
      map.fitBounds(bounds, { padding: [50, 50], animate: true, duration: 0.5 });
      return;
    }

    if (center) {
      const target = L.latLng(center[0], center[1]);
      const current = map.getCenter();
      const distance = map.distance(current, target);
      // Center if distance exceeds threshold
      const shouldCenter = distance > centerThresholdMeters;

      if (shouldCenter) {
        lastUpdateRef.current.centerKey = nextCenterKey;
        if (shouldUpdateZoom && zoom != null && (isZoomChanged || Math.abs(map.getZoom() - zoom) >= 1)) {
          lastUpdateRef.current.zoom = zoom;
          map.setView(target, zoom, { animate: true, duration: 0.35 });
        } else {
          map.setView(target, map.getZoom(), { animate: true, duration: 0.35 });
        }
      }
    }
  }, [bounds, center, zoom, shouldUpdate, forceCenter, shouldUpdateZoom, centerThresholdMeters, map]);

  return null;
}

// Component to rotate map based on heading during navigation (position center is handled by MapController)
function CurrentPositionTracker({
  position,
  isNavigating,
  followUser,
  autoRotate,
  forceRotate,
  headingOverride
}: {
  position: GpsPosition | null;
  isNavigating: boolean;
  followUser: boolean;
  autoRotate: boolean;
  forceRotate?: boolean;
  headingOverride?: number | null;
}) {
  const map = useMap();
  const lastBearingRef = useRef<number | null>(null);

  useEffect(() => {
    if (position && isNavigating && followUser && autoRotate) {
      // Only handle rotation here - map centering is done by MapController
      const heading = headingOverride ?? position.heading ?? 0;
      const hasHeading = headingOverride != null || position.heading != null;
      
      // Rotate the map to match driving direction (0 degrees = north)
      if (hasHeading && (position.speed == null || position.speed > 1)) {
        // Only rotate if moving (speed > 1 m/s = ~3.6 km/h)
        const rotateFn = (map as any).setBearing;
        if (typeof rotateFn === 'function') {
          const last = lastBearingRef.current;
          const delta = last == null
            ? 999
            : Math.abs((((heading - last) % 360) + 540) % 360 - 180);
          if (forceRotate || delta >= 5) {
            rotateFn.call(map, heading);
            lastBearingRef.current = heading;
          }
        }
      }
    }
  }, [position, isNavigating, followUser, autoRotate, forceRotate, map]);

  return null;
}

const LabelPaneSetup = function LabelPaneSetup() {
  const map = useMap();

  useEffect(() => {
    if (!map.getPane('field-labels')) {
      map.createPane('field-labels');
    }
    const pane = map.getPane('field-labels');
    if (pane) {
      pane.style.zIndex = '650';
      pane.style.pointerEvents = 'none';
    }
  }, [map]);

  return null;
};

const MapViewportTracker = function MapViewportTracker({
  onBoundsChange,
  onMovingChange,
  onZoomChange
}: {
  onBoundsChange: (bounds: L.LatLngBounds) => void;
  onMovingChange: (isMoving: boolean) => void;
  onZoomChange: (zoom: number) => void;
}) {
  const map = useMap();

  useEffect(() => {
    const updateBounds = () => onBoundsChange(map.getBounds());
    const handleZoom = () => onZoomChange(map.getZoom());
    const onMoveStart = () => onMovingChange(true);
    const onMoveEnd = () => {
      onMovingChange(false);
      updateBounds();
      handleZoom();
    };

    updateBounds();
    handleZoom();
    map.on('movestart', onMoveStart);
    map.on('zoomstart', onMoveStart);
    map.on('moveend', onMoveEnd);
    map.on('zoomend', onMoveEnd);

    return () => {
      map.off('movestart', onMoveStart);
      map.off('zoomstart', onMoveStart);
      map.off('moveend', onMoveEnd);
      map.off('zoomend', onMoveEnd);
    };
  }, [map, onBoundsChange, onMovingChange, onZoomChange]);

  return null;
};

const MapClickHandler = function MapClickHandler({
  onMapClick
}: {
  onMapClick: (e: L.LeafletMouseEvent) => void;
}) {
  useMapEvents({
    click: onMapClick,
  });

  return null;
};

interface NavigationMapProps {
  currentPosition: GpsPosition | null;
  fieldBoundaries: GpsFieldBoundary[];
  destination: [number, number] | null;
  selectedRoute: RouteOption | null;
  routes: RouteOption[];
  navStage: string;
  isOnline: boolean;
  onMapClick: (e: L.LeafletMouseEvent) => void;
  mapRef: React.RefObject<L.Map>;
  recenterToken?: number;
}

export default function NavigationMap({
  currentPosition,
  fieldBoundaries,
  destination,
  selectedRoute,
  routes,
  navStage,
  isOnline,
  onMapClick,
  mapRef,
  recenterToken
}: NavigationMapProps) {
  const { t } = useLanguage();
  const [isDarkMode] = useDarkMode();
  const MAP_MODE_STORAGE_KEY = 'gpsMapMode';
  const getInitialMapMode = (): 'osm' | 'satellite' => {
    if (typeof window === 'undefined') return 'osm';
    const stored = window.localStorage.getItem(MAP_MODE_STORAGE_KEY);
    return stored === 'satellite' ? 'satellite' : 'osm';
  };
  const [mapMode, setMapMode] = useState<'osm' | 'satellite'>(getInitialMapMode);
  const useSatellite = mapMode === 'satellite';
  const useOSM = mapMode === 'osm';
  const [offlinePmtilesUri, setOfflinePmtilesUri] = useState<string | null>(null);
  const [offlineRasterAvailable, setOfflineRasterAvailable] = useState((window as any).__GERMANY_TILES_AVAILABLE__ === true);
  const [germanyTilesAvailable, setGermanyTilesAvailable] = useState(
    (window as any).__GERMANY_PMTILES_AVAILABLE__ === true || (window as any).__GERMANY_TILES_AVAILABLE__ === true
  );
  const [tileProbeComplete, setTileProbeComplete] = useState(false);
  const [tileProbeCounter, setTileProbeCounter] = useState(0);
  const [showOfflinePrompt, setShowOfflinePrompt] = useState(false);
  const pmtilesVersion = import.meta.env.VITE_PMTILES_VERSION || '20260122';
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);
  const [isMapMoving, setIsMapMoving] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(currentPosition ? 13 : 6);
  const canvasRenderer = useMemo(() => L.canvas({ padding: 0.5 }), []);
  const labelCacheRef = useRef(new Map<string, { centroid: [number, number] | null; labelIconSmall: L.DivIcon | null; labelIconLarge: L.DivIcon | null; labelIconSmallOutlined: L.DivIcon | null; labelIconLargeOutlined: L.DivIcon | null }>());
  const routeLodCacheRef = useRef(new Map<string, { pointCount: number; points: [number, number][] }>());
  const [offlinePromptDismissed, setOfflinePromptDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('offlineMapPromptDismissed') === 'true';
  });
  const [isDownloadingOffline, setIsDownloadingOffline] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [selectedPackId, setSelectedPackId] = useState<string>(() => getDefaultPack().id);
  const [userSelectedPack, setUserSelectedPack] = useState(false);
  const locationPack = useMemo(() => {
    const lat = currentPosition?.latitude;
    const lng = currentPosition?.longitude;
    if (lat == null || lng == null) return null;
    return getPackForLocation(lat, lng);
  }, [currentPosition]);
  useEffect(() => {
    if (!locationPack) return;
    if (userSelectedPack) return;
    if (locationPack.id !== selectedPackId) {
      setSelectedPackId(locationPack.id);
    }
  }, [locationPack, selectedPackId, userSelectedPack]);
  const selectedPack = useMemo(() => {
    if (!selectedPackId) return null;
    return OFFLINE_MAP_PACKS.find(pack => pack.id === selectedPackId) || null;
  }, [selectedPackId]);
  const activePack = selectedPack || locationPack || getDefaultPack();
  const hasLocationPack = !!locationPack;
  const isWithinOfflineBounds = hasLocationPack || !currentPosition;
  const offlineTilesReady = !!offlinePmtilesUri || offlineRasterAvailable;
  const offlineTilesDisabled = true;
  const shouldUseOfflineTiles = !offlineTilesDisabled && isWithinOfflineBounds && (germanyTilesAvailable || offlineTilesReady);
  const needsOfflineDownload = false;
  const activePackName = activePack.name;
  const hasDownloadUrl = !!activePack.downloadUrl;
  const canDownloadOffline = hasDownloadUrl && isOnline;
  const forceOfflineTiles = !offlineTilesDisabled && Capacitor.isNativePlatform() && offlineTilesReady && !onlineTileUrl;
  const preferRasterOnNative = !offlineTilesDisabled && Capacitor.isNativePlatform() && offlineRasterAvailable && !offlinePmtilesUri;
  const [autoRotate] = useState(true);

  const handleDismissOfflinePrompt = useCallback(() => {
    setOfflinePromptDismissed(true);
    setShowOfflinePrompt(false);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('offlineMapPromptDismissed', 'true');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const verifyPmtiles = async (url: string, signal?: AbortSignal): Promise<boolean> => {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { Range: 'bytes=0-7' },
          signal
        });
        if (!(res.ok || res.status === 206)) return false;
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/html')) return false;
        const buf = await res.arrayBuffer();
        const header = new TextDecoder().decode(new Uint8Array(buf));
        return header.startsWith('PMTiles');
      } catch {
        return false;
      }
    };
    const verifyRasterMetadata = async (url: string, signal?: AbortSignal): Promise<boolean> => {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { Range: 'bytes=0-256' },
          signal
        });
        if (!(res.ok || res.status === 206)) return false;
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/html')) return false;
        const buf = await res.arrayBuffer();
        const text = new TextDecoder().decode(new Uint8Array(buf)).trim();
        if (!text.startsWith('{')) return false;
        return text.includes('"tiles"') || text.includes('"bounds"') || text.includes('"name"');
      } catch {
        return false;
      }
    };
    const probe = async () => {
      try {
        if (!cancelled) setTileProbeComplete(false);
        let pmtilesAvailable = false;
        let rasterAvailable = false;

        if (!Capacitor.isNativePlatform()) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          const bundledUrl = activePack.bundledUrl || offlinePmtilesUrl;
          pmtilesAvailable = await verifyPmtiles(bundledUrl, controller.signal);
          clearTimeout(timeoutId);
          if (!cancelled) {
            setOfflinePmtilesUri(pmtilesAvailable ? bundledUrl : null);
            setOfflineRasterAvailable(false);
            setGermanyTilesAvailable(pmtilesAvailable);
          }
          return;
        }

        if (Capacitor.isNativePlatform()) {
          const localUrl = await tileDownloader.getLocalTileHttpUrl(activePack);
          pmtilesAvailable = !!localUrl;
          if (!cancelled) {
            setOfflinePmtilesUri(localUrl);
          }
          // Fallback to bundled PMTiles in app assets if no downloaded file yet
          if (!pmtilesAvailable) {
            const bundledUrl = activePack.bundledUrl || offlinePmtilesUrl;
            const copiedUrl = await tileDownloader.ensureBundledTiles(bundledUrl, activePack);
            pmtilesAvailable = !!copiedUrl || !!bundledUrl;
            if (!cancelled) {
              setOfflinePmtilesUri(copiedUrl || bundledUrl || null);
            }
          }
        } else {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          const bundledUrl = activePack.bundledUrl || offlinePmtilesUrl;
          pmtilesAvailable = await verifyPmtiles(bundledUrl, controller.signal);
          clearTimeout(timeoutId);
          if (!cancelled) {
            setOfflinePmtilesUri(pmtilesAvailable ? bundledUrl : null);
          }
        }

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          rasterAvailable = await verifyRasterMetadata('/tiles/germany/metadata.json', controller.signal);
          clearTimeout(timeoutId);
        } catch (error: any) {
          if (error?.name === 'AbortError' || error?.code === 'AbortError') {
            rasterAvailable = (window as any).__GERMANY_TILES_AVAILABLE__ === true;
          } else {
            rasterAvailable = false;
          }
        }

        if (!cancelled) {
          setOfflineRasterAvailable(rasterAvailable);
          setGermanyTilesAvailable(pmtilesAvailable || rasterAvailable);
        }
      } catch (err: any) {
        if (cancelled) return;
        if (err?.name === 'AbortError' || err?.code === 'AbortError') {
          return;
        }
        setOfflinePmtilesUri(null);
        setOfflineRasterAvailable(false);
        setGermanyTilesAvailable(false);
      } finally {
        if (!cancelled) {
          setTileProbeComplete(true);
        }
      }
    };
    probe();
    return () => { cancelled = true; };
  }, [offlinePmtilesUrl, isOnline, tileProbeCounter, activePack]);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      setShowOfflinePrompt(needsOfflineDownload);
      return;
    }
    if (offlinePromptDismissed) {
      setShowOfflinePrompt(false);
      return;
    }
    setShowOfflinePrompt(needsOfflineDownload);
  }, [needsOfflineDownload, offlinePromptDismissed]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (offlineTilesReady) return;
    const timeoutId = window.setTimeout(() => {
      setShowOfflinePrompt(true);
    }, 3500);
    return () => window.clearTimeout(timeoutId);
  }, [offlineTilesReady]);

  const handleDownloadOfflineMaps = useCallback(async () => {
    if (isDownloadingOffline) return;
    if (!Capacitor.isNativePlatform()) {
      setDownloadProgress({
        current: 0,
        total: 0,
        percentage: 0,
        status: 'error',
        message: t('gps.offlinePrompt.webOnly') || 'Offline download is only available on the Android app.'
      });
      return;
    }
    if (!isOnline) {
      setDownloadProgress({
        current: 0,
        total: 0,
        percentage: 0,
        status: 'error',
        message: t('gps.offlinePrompt.noInternet') || 'Connect to the internet to download offline maps.'
      });
      return;
    }
    if (!activePack.downloadUrl) {
      setDownloadProgress({
        current: 0,
        total: 0,
        percentage: 0,
        status: 'error',
        message: t('gps.offlinePrompt.unavailable') || 'Offline download is not configured for this region.'
      });
      return;
    }
    setIsDownloadingOffline(true);
    setDownloadProgress({ current: 0, total: 100, percentage: 0, status: 'downloading', message: 'Starting download...' });
    const ok = await tileDownloader.downloadTilePackage((progress) => {
      setDownloadProgress(progress);
    }, activePack);
    setIsDownloadingOffline(false);
    if (ok) {
      setTileProbeCounter((v) => v + 1);
      setShowOfflinePrompt(false);
    }
  }, [isDownloadingOffline, t, activePack]);

  // Memoized calculation of project bounds for performance
  const projectBounds = useMemo(() => {
    if (fieldBoundaries.length === 0) return null;

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    fieldBoundaries.forEach(boundary => {
      if (boundary.geometry_type === 'Polygon') {
        const coords = boundary.coordinates as number[][][];
        coords[0].forEach(([lng, lat]) => {
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
        });
      } else if (boundary.geometry_type === 'MultiPolygon') {
        const coords = boundary.coordinates as number[][][][];
        coords.forEach(polygon => {
          polygon[0].forEach(([lng, lat]) => {
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
          });
        });
      }
    });

    return L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
  }, [fieldBoundaries]);

  const labelMetaMap = useMemo(() => {
    const next = new Map<string, { centroid: [number, number] | null; labelIconSmall: L.DivIcon | null; labelIconLarge: L.DivIcon | null; labelIconSmallOutlined: L.DivIcon | null; labelIconLargeOutlined: L.DivIcon | null }>();
    fieldBoundaries.forEach((boundary) => {
      if (!boundary) return;
      const id = String(boundary.id);
      const cached = labelCacheRef.current.get(id);
      if (cached) {
        next.set(id, cached);
        return;
      }
      const dashIndex = boundary.name.indexOf(' - ');
      const fieldNumber = dashIndex !== -1 ? boundary.name.substring(dashIndex + 3) : boundary.name;
      const coords = boundary.coordinates as any;
      let centroid: [number, number] | null = null;
      if (boundary.geometry_type === 'Polygon') {
        centroid = calculateCentroid(coords as number[][][]);
      } else if (boundary.geometry_type === 'MultiPolygon') {
        const polygons = (coords as number[][][][]) || [];
        const firstPolygon = polygons[0] as number[][][] | undefined;
        if (firstPolygon) centroid = calculateCentroid(firstPolygon);
      }

      const labelIconSmall = centroid ? L.divIcon({
        className: 'field-label',
        html: `<div style="
          position: absolute;
          left: 0;
          top: 0;
          font-weight: 600;
          font-size: 12px;
          color: #000000;
          white-space: nowrap;
          pointer-events: none;
          transform: translate(-50%, -50%);
        ">${fieldNumber}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }) : null;

      const labelIconLarge = centroid ? L.divIcon({
        className: 'field-label',
        html: `<div style="
          position: absolute;
          left: 0;
          top: 0;
          font-weight: 600;
          font-size: 14px;
          color: #000000;
          white-space: nowrap;
          pointer-events: none;
          transform: translate(-50%, -50%);
        ">${fieldNumber}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }) : null;

      const labelIconSmallOutlined = centroid ? L.divIcon({
        className: 'field-label',
        html: `<div style="
          position: absolute;
          left: 0;
          top: 0;
          font-weight: 700;
          font-size: 12px;
          color: #000000;
          white-space: nowrap;
          pointer-events: none;
          transform: translate(-50%, -50%);
        ">${fieldNumber}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }) : null;

      const labelIconLargeOutlined = centroid ? L.divIcon({
        className: 'field-label',
        html: `<div style="
          position: absolute;
          left: 0;
          top: 0;
          font-weight: 700;
          font-size: 14px;
          color: #000000;
          white-space: nowrap;
          pointer-events: none;
          transform: translate(-50%, -50%);
        ">${fieldNumber}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }) : null;

      const meta = { centroid, labelIconSmall, labelIconLarge, labelIconSmallOutlined, labelIconLargeOutlined };
      labelCacheRef.current.set(id, meta);
      next.set(id, meta);
    });
    return next;
  }, [fieldBoundaries]);

  const routeBounds = useMemo(() => {
    if (!selectedRoute?.coordinates || selectedRoute.coordinates.length === 0) return null;
    const points = selectedRoute.coordinates.map(([lat, lng]) => L.latLng(lat, lng));
    return L.latLngBounds(points);
  }, [selectedRoute]);

  // Memoized field boundaries rendering for performance
  const boundaryRenderData = useMemo(() => {
    const step = getPolygonSimplifyStep(currentZoom, isMapMoving);
    return fieldBoundaries.map((boundary) => {
      if (!boundary) return null;
      const coordsRaw = boundary.coordinates as any;
      if (!coordsRaw || !Array.isArray(coordsRaw) || coordsRaw.length === 0) return null;
      const labelMeta = labelMetaMap.get(String(boundary.id)) || { centroid: null, labelIconSmall: null, labelIconLarge: null, labelIconSmallOutlined: null, labelIconLargeOutlined: null };

      if (boundary.geometry_type === 'Polygon') {
        const coords = boundary.coordinates as number[][][];
        const positions = coords.map(ring => {
          const latLngs = ring.map(coord => [coord[1], coord[0]] as [number, number]);
          return simplifyLatLngByStep(latLngs, step);
        });
        const bounds = L.latLngBounds(positions[0]);
        return { boundary, type: 'Polygon' as const, positions, bounds, centroid: labelMeta.centroid, labelIconSmall: labelMeta.labelIconSmall, labelIconLarge: labelMeta.labelIconLarge, labelIconSmallOutlined: labelMeta.labelIconSmallOutlined, labelIconLargeOutlined: labelMeta.labelIconLargeOutlined };
      }

      if (boundary.geometry_type === 'MultiPolygon') {
        const polygons = (boundary.coordinates as number[][][][]).filter(p => Array.isArray(p) && p.length > 0);
        if (polygons.length === 0) return null;
        const positions = polygons.map(polygon =>
          polygon.map(ring => simplifyLatLngByStep(ring.map(coord => [coord[1], coord[0]] as [number, number]), step))
        );
        const bounds = L.latLngBounds(positions.flat(2) as [number, number][]);
        return { boundary, type: 'MultiPolygon' as const, positions, bounds, centroid: labelMeta.centroid, labelIconSmall: labelMeta.labelIconSmall, labelIconLarge: labelMeta.labelIconLarge, labelIconSmallOutlined: labelMeta.labelIconSmallOutlined, labelIconLargeOutlined: labelMeta.labelIconLargeOutlined };
      }

      return null;
    }).filter(Boolean) as Array<
      | { boundary: GpsFieldBoundary; type: 'Polygon'; positions: [number, number][][]; bounds: L.LatLngBounds; centroid: [number, number] | null; labelIconSmall: L.DivIcon | null; labelIconLarge: L.DivIcon | null; labelIconSmallOutlined: L.DivIcon | null; labelIconLargeOutlined: L.DivIcon | null }
      | { boundary: GpsFieldBoundary; type: 'MultiPolygon'; positions: [number, number][][][]; bounds: L.LatLngBounds; centroid: [number, number] | null; labelIconSmall: L.DivIcon | null; labelIconLarge: L.DivIcon | null; labelIconSmallOutlined: L.DivIcon | null; labelIconLargeOutlined: L.DivIcon | null }
    >;
  }, [fieldBoundaries, currentZoom, isMapMoving, labelMetaMap]);

  const visibleBoundaryRenderData = useMemo(() => {
    if (!mapBounds) return boundaryRenderData;
    return boundaryRenderData.filter(item => mapBounds.intersects(item.bounds));
  }, [boundaryRenderData, mapBounds]);

  const visibleLabelIds = useMemo(() => {
    const visible = new Set<string>();
    const map = mapRef.current;
    if (!map || !visibleBoundaryRenderData.length) {
      visibleBoundaryRenderData.forEach(item => visible.add(String(item.boundary.id)));
      return visible;
    }

    const labelFontSize = currentZoom < 13 ? 12 : 14;
    const labelHeight = labelFontSize + 4;
    const cellSize = Math.max(40, labelFontSize * 4);
    const occupied = new Map<string, Array<{ x1: number; y1: number; x2: number; y2: number }>>();

    const boxesOverlap = (a: { x1: number; y1: number; x2: number; y2: number }, b: { x1: number; y1: number; x2: number; y2: number }) => {
      return !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
    };

    visibleBoundaryRenderData.forEach(item => {
      const centroid = item.centroid;
      if (!centroid) return;
      const point = map.latLngToContainerPoint(centroid as any);
      const dashIndex = item.boundary.name.indexOf(' - ');
      const fieldNumber = dashIndex !== -1 ? item.boundary.name.substring(dashIndex + 3) : item.boundary.name;
      const labelWidth = Math.max(16, fieldNumber.length * labelFontSize * 0.6);

      const box = {
        x1: point.x - labelWidth / 2,
        y1: point.y - labelHeight / 2,
        x2: point.x + labelWidth / 2,
        y2: point.y + labelHeight / 2,
      };

      const minCellX = Math.floor(box.x1 / cellSize);
      const maxCellX = Math.floor(box.x2 / cellSize);
      const minCellY = Math.floor(box.y1 / cellSize);
      const maxCellY = Math.floor(box.y2 / cellSize);

      let overlaps = false;
      for (let cx = minCellX; cx <= maxCellX && !overlaps; cx += 1) {
        for (let cy = minCellY; cy <= maxCellY && !overlaps; cy += 1) {
          const key = `${cx}:${cy}`;
          const existing = occupied.get(key);
          if (!existing) continue;
          overlaps = existing.some(existingBox => boxesOverlap(existingBox, box));
        }
      }

      if (overlaps) return;

      for (let cx = minCellX; cx <= maxCellX; cx += 1) {
        for (let cy = minCellY; cy <= maxCellY; cy += 1) {
          const key = `${cx}:${cy}`;
          if (!occupied.has(key)) occupied.set(key, []);
          occupied.get(key)!.push(box);
        }
      }

      visible.add(String(item.boundary.id));
    });

    return visible;
  }, [visibleBoundaryRenderData, currentZoom, mapBounds, mapRef]);

  const renderedBoundaries = useMemo(() => {
    return visibleBoundaryRenderData.map((item) => {
      const boundary = item.boundary;
      const labelIcon = isMapMoving || currentZoom < 14
        ? (currentZoom < 13 ? item.labelIconSmall : item.labelIconLarge)
        : (currentZoom < 15 ? item.labelIconSmallOutlined : item.labelIconLargeOutlined);

      if (item.type === 'Polygon') {
        return (
          <div key={boundary.id}>
            <Polygon
              positions={item.positions}
              pathOptions={{
                color: boundary.color || '#00FF00',
                fillColor: boundary.color || '#00FF00',
                fillOpacity: 0.2,
                weight: 2,
              }}
              renderer={canvasRenderer}
            >
              <Popup>
                <div className="text-sm">
                  <strong>{(() => { const dashIndex = boundary.name.indexOf(' - '); return dashIndex !== -1 ? boundary.name.substring(dashIndex + 3) : boundary.name; })()}</strong>
                </div>
              </Popup>
            </Polygon>
            {item.centroid && labelIcon && visibleLabelIds.has(String(boundary.id)) && (
              <Marker
                position={item.centroid}
                icon={labelIcon}
                pane="field-labels"
                interactive={false}
              />
            )}
          </div>
        );
      }

      if (item.type === 'MultiPolygon') {
        return (
          <div key={boundary.id}>
            {item.positions.map((polygon, idx) => (
              <Polygon
                key={`${boundary.id}-${idx}`}
                positions={polygon}
                pathOptions={{
                  color: boundary.color || '#00FF00',
                  fillColor: boundary.color || '#00FF00',
                  fillOpacity: 0.2,
                  weight: 2,
                }}
                renderer={canvasRenderer}
                eventHandlers={{
                  click: onMapClick,
                }}
              />
            ))}
            {item.centroid && labelIcon && visibleLabelIds.has(String(boundary.id)) && (
              <Marker
                position={item.centroid}
                icon={labelIcon}
                pane="field-labels"
                interactive={false}
              />
            )}
          </div>
        );
      }

      return null;
    });
  }, [visibleBoundaryRenderData, currentZoom, canvasRenderer, onMapClick, visibleLabelIds]);

  const [followUser, setFollowUser] = useState(true);
  const [forceSnap, setForceSnap] = useState(false);
  const userInteractingRef = useRef(false);
  const lastNavStageRef = useRef(navStage);
  const lastPositionRef = useRef<GpsPosition | null>(null);
  const [derivedHeading, setDerivedHeading] = useState<number | null>(null);
  const getRoutePoints = useCallback((route: RouteOption) => {
    const lodKey = getRouteSimplifyStep(currentZoom, isMapMoving);
    const cacheKey = `${route.id}:${lodKey}`;
    const cached = routeLodCacheRef.current.get(cacheKey);
    if (cached && cached.pointCount === route.coordinates.length) {
      return cached.points;
    }
    const points = route.coordinates.length > 4
      ? route.coordinates.filter((_, idx) => idx % lodKey === 0)
      : route.coordinates;
    routeLodCacheRef.current.set(cacheKey, { pointCount: route.coordinates.length, points });
    return points;
  }, [currentZoom, isMapMoving]);

  useEffect(() => {
    const handleModeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ mode: 'osm' | 'satellite' }>).detail;
      if (detail?.mode) {
        setMapMode(detail.mode);
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== MAP_MODE_STORAGE_KEY) return;
      if (event.newValue === 'satellite') {
        setMapMode('satellite');
        return;
      }
      setMapMode('osm');
    };
    window.addEventListener('gps-map-mode-changed', handleModeChange as EventListener);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('gps-map-mode-changed', handleModeChange as EventListener);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const calculateBearing = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const toRad = (value: number) => (value * Math.PI) / 180;
    const toDeg = (value: number) => (value * 180) / Math.PI;
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  };

  const calculateDistanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000;
    const toRad = (value: number) => (value * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Disable follow on user drag/zoom/rotate until recenter is pressed
  useEffect(() => {
    if (!mapRef.current) return;
    const mapInstance = mapRef.current;
    const handleInteractionStart = () => {
      userInteractingRef.current = true;
      setFollowUser(false);
    };
    const handleInteractionEnd = () => {
      userInteractingRef.current = false;
    };
    mapInstance.on('dragstart', handleInteractionStart);
    mapInstance.on('zoomstart', handleInteractionStart);
    mapInstance.on('mousedown', handleInteractionStart);
    mapInstance.on('touchstart', handleInteractionStart);
    mapInstance.on('rotatestart', handleInteractionStart as any);
    mapInstance.on('dragend', handleInteractionEnd);
    mapInstance.on('zoomend', handleInteractionEnd);
    mapInstance.on('mouseup', handleInteractionEnd);
    mapInstance.on('touchend', handleInteractionEnd);
    mapInstance.on('rotateend', handleInteractionEnd as any);
    return () => {
      mapInstance.off('dragstart', handleInteractionStart);
      mapInstance.off('zoomstart', handleInteractionStart);
      mapInstance.off('mousedown', handleInteractionStart);
      mapInstance.off('touchstart', handleInteractionStart);
      mapInstance.off('rotatestart', handleInteractionStart as any);
      mapInstance.off('dragend', handleInteractionEnd);
      mapInstance.off('zoomend', handleInteractionEnd);
      mapInstance.off('mouseup', handleInteractionEnd);
      mapInstance.off('touchend', handleInteractionEnd);
      mapInstance.off('rotateend', handleInteractionEnd as any);
    };
  }, [mapRef, navStage]);

  // Re-enable follow on explicit recenter
  useEffect(() => {
    if (!recenterToken) return;
    setFollowUser(true);
    setForceSnap(true);
  }, [recenterToken]);

  // When navigation stage changes to a following mode, snap once to current location
  useEffect(() => {
    if (navStage !== lastNavStageRef.current) {
      if (navStage === 'navigating') {
        setFollowUser(true);
        setForceSnap(true);
      }
      lastNavStageRef.current = navStage;
    }
  }, [navStage]);

  // Clear force snap after it triggers
  useEffect(() => {
    if (!forceSnap) return;
    const id = setTimeout(() => setForceSnap(false), 400);
    return () => clearTimeout(id);
  }, [forceSnap]);

  useEffect(() => {
    if (!currentPosition) return;
    const last = lastPositionRef.current;
    if (last) {
      const movedMeters = calculateDistanceMeters(
        last.latitude,
        last.longitude,
        currentPosition.latitude,
        currentPosition.longitude
      );
      if (movedMeters >= 2) {
        setDerivedHeading(calculateBearing(
          last.latitude,
          last.longitude,
          currentPosition.latitude,
          currentPosition.longitude
        ));
      }
    }
    lastPositionRef.current = currentPosition;
  }, [currentPosition]);

  // Default to Germany center if no position yet
  const defaultCenter: [number, number] = [51.1657, 10.4515]; // Germany center
  const mapCenter = currentPosition
    ? [currentPosition.latitude, currentPosition.longitude] as [number, number]
    : (fieldBoundaries.length > 0 && projectBounds ? projectBounds.getCenter() : defaultCenter) as [number, number];

  return (
    <div className="relative h-full w-full">
      <MapContainer
        ref={mapRef}
        center={mapCenter}
        zoom={currentPosition ? 13 : 6}
        maxZoom={22}
        zoomSnap={0}
        zoomDelta={1}
        className={`h-full w-full ${shouldUseOfflineTiles ? 'pmtiles-active' : ''}`}
        zoomControl={false}
        attributionControl={false}
        preferCanvas={true}
        zoomAnimation={false}
        fadeAnimation={false}
        markerZoomAnimation={false}
        style={{ height: '100%', minHeight: '320px', width: '100%' }}
      >
      <LabelPaneSetup />
      <MapViewportTracker
        onBoundsChange={setMapBounds}
        onMovingChange={setIsMapMoving}
        onZoomChange={setCurrentZoom}
      />
      <MapClickHandler onMapClick={onMapClick} />
      {/* Track current position during navigation */}
      <CurrentPositionTracker
        position={currentPosition}
        isNavigating={navStage === 'navigating'}
        followUser={followUser}
        autoRotate={autoRotate}
        forceRotate={forceSnap}
        headingOverride={derivedHeading ?? currentPosition?.heading ?? null}
      />

      {/* SINGLE MAP CONTROLLER - handles all view updates to prevent fighting */}
      <MapController
        bounds={
          navStage === 'select-destination'
            ? projectBounds
            : navStage === 'route-preview'
              ? routeBounds
              : null
        }
        center={
          navStage === 'navigating' && currentPosition && (followUser || forceSnap)
            ? [currentPosition.latitude, currentPosition.longitude]
            : null
        }
        zoom={
          navStage === 'navigating' && currentPosition
            ? (isOnline ? 17 : 13)
            : undefined
        }
        shouldUpdate={navStage !== 'navigating' || followUser || forceSnap}
        forceCenter={navStage === 'navigating' ? forceSnap : false}
        shouldUpdateZoom={navStage === 'navigating' ? forceSnap : false}
        centerThresholdMeters={12}
      />

      {/* Tile layers - offline tiles when available; never hit OSM when offline to avoid blocked warnings */}
      {(() => {
        // Tile layer logic - logs disabled to reduce console spam

        if (useOSM && isOnline) {
          return (
            <TileLayer
              key='nav-tiles-osm'
              url='https://tile.openstreetmap.org/{z}/{x}/{y}.png'
              minZoom={1}
              maxZoom={20}
              maxNativeZoom={19}
              attribution='© OpenStreetMap contributors'
              crossOrigin="anonymous"
            />
          );
        }

        if (useSatellite && isOnline) {
          return (
            <TileLayer
              key='nav-tiles-satellite'
              url='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
              minZoom={1}
              maxZoom={19}
              maxNativeZoom={19}
              attribution='© Esri'
              crossOrigin="anonymous"
            />
          );
        }
        
        // Prefer offline tiles within bounds
        if ((shouldUseOfflineTiles || forceOfflineTiles) && preferRasterOnNative && offlineRasterAvailable && !useSatellite) {
          return (
            <TileLayer
              key='nav-tiles-offline'
              url='/tiles/germany/{z}/{x}/{y}.png'
              minZoom={1}
              maxZoom={18}
              maxNativeZoom={12}
              attribution='Offline Maps - Germany Base Map (OpenStreetMap Data)'
              errorTileUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
              crossOrigin="anonymous"
              eventHandlers={{
                tileloadstart: createTileLoadStartHandler(false, '/tiles/germany/{z}/{x}/{y}.png')
              }}
            />
          );
        }

        if ((shouldUseOfflineTiles || forceOfflineTiles) && offlineRasterAvailable && !useSatellite) {
          console.log('[NavigationMap] ✅ Using Germany Offline Raster');
          return (
            <TileLayer
              key='nav-tiles-offline-raster'
              url='/tiles/germany/{z}/{x}/{y}.png'
              minZoom={1}
              maxZoom={18}
              maxNativeZoom={12}
              attribution='Offline Maps - Germany Base Map (OpenStreetMap Data)'
              errorTileUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
              crossOrigin="anonymous"
              eventHandlers={{
                tileloadstart: createTileLoadStartHandler(false, '/tiles/germany/{z}/{x}/{y}.png')
              }}
            />
          );
        }

        // Fallback to PMTiles if raster not available (within bounds)
        if ((shouldUseOfflineTiles || forceOfflineTiles) && offlinePmtilesUri && !useSatellite && !(preferRasterOnNative && offlineRasterAvailable)) {
          console.log('[NavigationMap] ✅ Using Germany Offline PMTiles');
          return (
            <PMTilesVectorLayer
              pmtilesUrl={offlinePmtilesUri}
              maxZoom={19}
              maxDataZoom={15}
              attribution='© OpenStreetMap contributors | Offline PMTiles'
              theme={Capacitor.isNativePlatform() && isDarkMode ? 'dark' : 'light'}
              schema="openmaptiles"
            />
          );
        }

        // Offline mode: always show blank to prevent external tile requests
        if (!isOnline) {
          console.warn('[NavigationMap] Offline - showing blank fallback to avoid external tile requests');
          return (
            <TileLayer
              key='nav-tiles-offline-blank'
              url={BLANK_TILE_URL}
              minZoom={1}
              maxZoom={18}
              maxNativeZoom={18}
              attribution='Offline fallback (no tiles available)'
              tileSize={256}
            />
          );
        }
        
        // Still probing for offline tiles: show blank to avoid premature OSM calls
        if (!tileProbeComplete && (isWithinOfflineBounds || forceOfflineTiles)) {
          console.log('[NavigationMap] Probing tiles - showing blank fallback');
          return (
            <TileLayer
              key='nav-tiles-probe-blank'
              url={BLANK_TILE_URL}
              minZoom={1}
              maxZoom={18}
              maxNativeZoom={18}
              attribution='Loading tiles...'
              tileSize={256}
            />
          );
        }
        
        // Online outside offline bounds: use self-hosted tiles or OSM fallback
        const rasterFallback = germanyTilesAvailable ? '/tiles/germany/{z}/{x}/{y}.png' : null;
        const baseOnlineUrl = onlineTileUrl || rasterFallback || null;

        if (!baseOnlineUrl) {
          console.warn('[NavigationMap] No online tiles configured for native; showing blank fallback.');
          return (
            <TileLayer
              key='nav-tiles-online-blank'
              url={BLANK_TILE_URL}
              minZoom={1}
              maxZoom={18}
              maxNativeZoom={18}
              attribution='Online tiles unavailable'
              tileSize={256}
            />
          );
        }
        return (
          <TileLayer
            key='nav-tiles-online'
            url={baseOnlineUrl}
            minZoom={1}
            maxZoom={20}
            attribution={onlineTileUrl || rasterFallback ? 'Self-hosted tiles | GPS Navigation' : '© OpenStreetMap contributors | GPS Navigation'}
            crossOrigin="anonymous"
            tileSize={256}
          />
        );
      })()}

      {/* Field boundaries - memoized for performance */}
      {renderedBoundaries}

      {/* Current position with arrow pointing in direction of travel */}
      {currentPosition && (
        <Marker
          position={[currentPosition.latitude, currentPosition.longitude]}
          icon={createArrowIcon(derivedHeading ?? currentPosition.heading ?? 0)}
        >
          <Popup>
            <div className="text-sm">
              <strong>{t('gps.currentPosition') || 'Current Position'}</strong>
              {(derivedHeading != null || currentPosition.heading != null) && (
                <>
                  <br />
                  {t('gps.heading') || 'Heading'}: {Math.round(derivedHeading ?? currentPosition.heading ?? 0)}°
                </>
              )}
              {currentPosition.speed != null && (
                <>
                  <br />
                  {t('gps.speed') || 'Speed'}: {(currentPosition.speed * 3.6).toFixed(1)} km/h
                </>
              )}
            </div>
          </Popup>
        </Marker>
      )}

      {/* Destination marker */}
      {destination && (
        <Marker
          position={destination}
          icon={destinationIcon}
        >
          <Popup>
            <div className="text-sm">
              <strong>{t('gps.destination') || 'Destination'}</strong>
            </div>
          </Popup>
        </Marker>
      )}

      {/* Route */}
      {selectedRoute && (
        <Polyline
          positions={getRoutePoints(selectedRoute)}
          pathOptions={{
            color: '#3B82F6',
            weight: 4,
            opacity: 0.8,
          }}
          renderer={canvasRenderer}
        />
      )}

      {/* Alternative routes */}
      {navStage === 'route-preview' && routes.map((route) => (
        route.id !== selectedRoute?.id && (
          <Polyline
            key={route.id}
            positions={getRoutePoints(route)}
            pathOptions={{
              color: '#94A3B8',
              weight: 3,
              opacity: 0.5,
              dashArray: '10, 10',
            }}
            renderer={canvasRenderer}
          />
        )
      ))}
      </MapContainer>

      {false && showOfflinePrompt && (
        <div className={`fixed top-2 left-1/2 z-[6000] w-[92%] max-w-lg -translate-x-1/2 px-4 py-3 text-xs shadow-lg md:text-sm glass-panel ${isDarkMode ? 'glass-panel-dark text-white' : 'glass-panel-light text-gray-900'}`}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="font-medium">
              {t('gps.offlinePrompt.title', { region: activePackName }) || 'Offline map not available for this area.'}
              <div className={`mt-1 text-[11px] md:text-xs ${isDarkMode ? 'text-gray-200' : 'text-gray-600'}`}>
                {t('gps.offlinePrompt.description', { region: activePackName }) || `Download ${activePackName} for offline use. We will keep using online OpenStreetMap in the meantime.`}
              </div>
              {!isOnline && (
                <div className={`mt-1 text-[11px] md:text-xs ${isDarkMode ? 'text-amber-200' : 'text-amber-700'}`}>
                  {t('gps.offlinePrompt.noInternet') || 'Connect to the internet to download offline maps.'}
                </div>
              )}
              {!hasDownloadUrl && (
                <div className={`mt-1 text-[11px] md:text-xs ${isDarkMode ? 'text-amber-200' : 'text-amber-700'}`}>
                  {t('gps.offlinePrompt.unavailable') || 'Offline download is not configured for this region.'}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownloadOfflineMaps}
                disabled={isDownloadingOffline || !canDownloadOffline}
                className="rounded-lg bg-blue-600 px-3 py-1 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDownloadingOffline
                  ? (t('gps.offlinePrompt.downloading') || 'Downloading…')
                  : (t('gps.offlinePrompt.download') || 'Download')}
              </button>
              <button
                onClick={handleDismissOfflinePrompt}
                className={`rounded-lg border px-3 py-1 ${isDarkMode ? 'border-gray-600 text-gray-200 hover:bg-gray-800/60' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}
              >
                {t('gps.offlinePrompt.dismiss') || 'Dismiss'}
              </button>
            </div>
          </div>
          {OFFLINE_MAP_PACKS.length > 1 && (
            <div className="mt-2 flex flex-col gap-1 text-[11px] md:text-xs">
              <label className={isDarkMode ? 'text-gray-200' : 'text-gray-600'}>
                {t('gps.offlinePrompt.regionLabel') || 'Region'}
              </label>
              <select
                value={selectedPackId}
                onChange={(e) => {
                  setSelectedPackId(e.target.value);
                  setUserSelectedPack(true);
                }}
                className={`w-full rounded-md border px-2 py-1 ${isDarkMode ? 'border-gray-600 bg-gray-800 text-gray-100' : 'border-gray-300 bg-white text-gray-900'}`}
              >
                {OFFLINE_MAP_PACKS.map(pack => (
                  <option key={pack.id} value={pack.id}>
                    {pack.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {typeof downloadProgress?.percentage === 'number' && (
            <div className="mt-2">
              <div className={`h-2 w-full overflow-hidden rounded-full ${isDarkMode ? 'bg-gray-700/60' : 'bg-gray-200'}`}>
                <div
                  className={`h-full rounded-full bg-blue-600 transition-all ${downloadProgress.total === 0 ? 'animate-pulse' : ''}`}
                  style={{ width: `${downloadProgress.total === 0 ? 35 : Math.min(100, Math.max(0, downloadProgress.percentage))}%` }}
                />
              </div>
              <div className={`mt-1 text-[11px] md:text-xs ${isDarkMode ? 'text-gray-200' : 'text-gray-600'}`}>
                {downloadProgress.total === 0
                  ? (t('gps.offlinePrompt.progressIndeterminate') || 'Downloading…')
                  : (t('gps.offlinePrompt.progress', { percent: Math.round(downloadProgress.percentage) }) || `${Math.round(downloadProgress.percentage)}%`)
                }
              </div>
            </div>
          )}
          {downloadProgress?.message && (
            <div className={`mt-2 text-[11px] md:text-xs ${isDarkMode ? 'text-gray-200' : 'text-gray-600'}`}>
              {downloadProgress.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}