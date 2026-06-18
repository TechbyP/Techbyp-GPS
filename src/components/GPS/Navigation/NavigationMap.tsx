import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap, Polygon, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Capacitor } from '@capacitor/core';
import { GpsPosition, GpsFieldBoundary } from '../../../types';
import { getBlankTileUrl, createTileLoadStartHandler, getBundledGermanyPmtilesUrl, getTileLayerCrossOrigin } from '../../../utils/tileUtils';
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
const offlinePmtilesUrl = getBundledGermanyPmtilesUrl();
const onlineTileUrl = (window as any).__VITE_ONLINE_TILE_URL__ || (import.meta.env.VITE_ONLINE_TILE_URL as string | undefined);
const offlineTilesDisabledByEnv = ((import.meta.env.VITE_DISABLE_OFFLINE_TILES as string | undefined) || '').toLowerCase() === 'true';
const LEAFLET_WORLD_BOUNDS: L.LatLngBoundsExpression = [[-85.05112878, -180], [85.05112878, 180]];

const getBoundaryAreaScore = (boundary: GpsFieldBoundary, fallbackBounds: L.LatLngBounds): number => {
  const bbox = boundary.render_meta?.bbox;
  if (Array.isArray(bbox) && bbox.length === 4) {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    if (Number.isFinite(minLon) && Number.isFinite(minLat) && Number.isFinite(maxLon) && Number.isFinite(maxLat)) {
      const width = Math.max(0, maxLon - minLon);
      const height = Math.max(0, maxLat - minLat);
      if (width > 0 && height > 0) return width * height;
    }
  }

  const sw = fallbackBounds.getSouthWest();
  const ne = fallbackBounds.getNorthEast();
  const width = Math.max(0, ne.lng - sw.lng);
  const height = Math.max(0, ne.lat - sw.lat);
  return width * height;
};

const getFieldNumber = (name: string): string => {
  const dashIndex = name.indexOf(' - ');
  return dashIndex !== -1 ? name.substring(dashIndex + 3) : name;
};

const getBoundaryLabelLimit = (zoom: number, isMoving: boolean): number => {
  if (zoom < 13) return 0;
  if (isMoving) {
    if (zoom < 14) return 3;
    if (zoom < 15) return 6;
    if (zoom < 16) return 10;
    return 14;
  }
  if (zoom < 14) return 8;
  if (zoom < 15) return 16;
  if (zoom < 16) return 28;
  return 40;
};

const getBoundaryRenderLimit = (zoom: number, isMoving: boolean): number => {
  if (isMoving) {
    if (zoom < 13) return 90;
    if (zoom < 15) return 160;
    return 220;
  }

  if (zoom < 12) return 90;
  if (zoom < 13) return 140;
  if (zoom < 14) return 220;
  if (zoom < 15) return 300;
  return 420;
};

const getBoundaryVertexBudget = (zoom: number, isMoving: boolean, isTabletPerformanceMode: boolean): number => {
  if (!isTabletPerformanceMode) {
    return Number.POSITIVE_INFINITY;
  }

  if (isMoving) {
    if (zoom < 14) return 2800;
    if (zoom < 16) return 4200;
    return 6200;
  }

  if (zoom < 14) return 4600;
  if (zoom < 16) return 7600;
  return 10800;
};

const countRingVertices = (rings: [number, number][][]): number => {
  return rings.reduce((sum, ring) => sum + ring.length, 0);
};

const countPolygonVertices = (polygons: [number, number][][][]): number => {
  return polygons.reduce((sum, polygon) => sum + countRingVertices(polygon), 0);
};

const getBoundaryPointLimit = (_zoom: number, _isMoving: boolean, isTabletPerformanceMode: boolean): number => {
  if (!isTabletPerformanceMode) return 0;
  return 180;
};

const TABLET_BOUNDARY_VISUAL_ZOOM = 14;

const simplifyRingForPerformance = (ring: [number, number][], maxPoints: number): [number, number][] => {
  if (!Array.isArray(ring) || ring.length < 4 || maxPoints <= 0 || ring.length <= maxPoints) {
    return ring;
  }

  const first = ring[0];
  const last = ring[ring.length - 1];
  const isClosed = first && last && first[0] === last[0] && first[1] === last[1];
  const core = isClosed ? ring.slice(0, -1) : ring.slice();

  if (core.length <= maxPoints) {
    return ring;
  }

  const step = Math.max(1, Math.ceil(core.length / maxPoints));
  const reduced = core.filter((_, idx) => idx % step === 0);

  const finalCorePoint = core[core.length - 1];
  const finalReducedPoint = reduced[reduced.length - 1];
  if (!finalReducedPoint || finalReducedPoint[0] !== finalCorePoint[0] || finalReducedPoint[1] !== finalCorePoint[1]) {
    reduced.push(finalCorePoint);
  }

  if (isClosed && reduced.length > 0) {
    const reducedFirst = reduced[0];
    const reducedLast = reduced[reduced.length - 1];
    if (reducedLast[0] !== reducedFirst[0] || reducedLast[1] !== reducedFirst[1]) {
      reduced.push([reducedFirst[0], reducedFirst[1]]);
    }
  }

  return reduced.length >= 3 ? reduced : ring;
};

const simplifyRingsForPerformance = (rings: [number, number][][], maxPoints: number): [number, number][][] => {
  if (maxPoints <= 0) return rings;
  return rings.map((ring) => simplifyRingForPerformance(ring, maxPoints));
};

const simplifyPolygonsForPerformance = (polygons: [number, number][][][], maxPoints: number): [number, number][][][] => {
  if (maxPoints <= 0) return polygons;
  return polygons.map((polygon) => simplifyRingsForPerformance(polygon, maxPoints));
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
  }, [position, isNavigating, followUser, autoRotate, forceRotate, map, headingOverride]);

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
  onZoomChange,
  suppressZoomMoveState = false,
  disablePostZoomUpdates = false,
}: {
  onBoundsChange: (bounds: L.LatLngBounds) => void;
  onMovingChange: (isMoving: boolean) => void;
  onZoomChange: (zoom: number) => void;
  suppressZoomMoveState?: boolean;
  disablePostZoomUpdates?: boolean;
}) {
  const map = useMap();
  const zoomingRef = useRef(false);
  const skipNextMoveEndRef = useRef(false);
  const lastZoomRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const updateBounds = () => onBoundsChange(map.getBounds());
    const emitZoom = () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
      }

      frameRef.current = requestAnimationFrame(() => {
        const nextZoom = map.getZoom();
        if (lastZoomRef.current != null && Math.abs(lastZoomRef.current - nextZoom) < 0.001) {
          return;
        }

        lastZoomRef.current = nextZoom;
        onZoomChange(nextZoom);
      });
    };
    const onMoveStart = () => {
      if (!zoomingRef.current && skipNextMoveEndRef.current) {
        skipNextMoveEndRef.current = false;
      }

      if (suppressZoomMoveState && zoomingRef.current) {
        return;
      }
      onMovingChange(true);
    };
    const onMoveEnd = () => {
      if (skipNextMoveEndRef.current) {
        skipNextMoveEndRef.current = false;
        return;
      }

      onMovingChange(false);
      updateBounds();
    };
    const onZoomStart = () => {
      zoomingRef.current = true;
      if (!suppressZoomMoveState) {
        onMovingChange(true);
      }
    };
    const onZoom = () => emitZoom();
    const onZoomEnd = () => {
      zoomingRef.current = false;

      if (disablePostZoomUpdates) {
        skipNextMoveEndRef.current = true;
        return;
      }

      skipNextMoveEndRef.current = true;
      if (!suppressZoomMoveState) {
        onMovingChange(false);
      }
      updateBounds();
      emitZoom();
    };

    updateBounds();
    emitZoom();
    map.on('movestart', onMoveStart);
    map.on('zoomstart', onZoomStart);
    map.on('moveend', onMoveEnd);
    map.on('zoom', onZoom);
    map.on('zoomend', onZoomEnd);

    return () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      map.off('movestart', onMoveStart);
      map.off('zoomstart', onZoomStart);
      map.off('moveend', onMoveEnd);
      map.off('zoom', onZoom);
      map.off('zoomend', onZoomEnd);
    };
  }, [map, onBoundsChange, onMovingChange, onZoomChange, suppressZoomMoveState, disablePostZoomUpdates]);

  return null;
};

const TileHandoffController = function TileHandoffController({
  enabled,
  fadeOutMs = 160,
  maxVisibleMs = 2200,
}: {
  enabled: boolean;
  fadeOutMs?: number;
  maxVisibleMs?: number;
}) {
  const map = useMap();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);

  const clearTimer = useCallback((timerRef: MutableRefObject<number | null>) => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const ensureOverlay = useCallback(() => {
    const container = map.getContainer();
    const existing = overlayRef.current ?? document.createElement('div');
    overlayRef.current = existing;

    existing.className = 'tile-handoff-overlay';
    existing.style.position = 'absolute';
    existing.style.left = '0';
    existing.style.top = '0';
    existing.style.width = '100%';
    existing.style.height = '100%';
    existing.style.pointerEvents = 'none';
    existing.style.zIndex = '300';
    existing.style.opacity = '0';
    existing.style.willChange = 'opacity';
    existing.style.overflow = 'hidden';

    if (!container.contains(existing)) {
      container.appendChild(existing);
    }

    return existing;
  }, [map]);

  const captureCurrentTiles = useCallback((): boolean => {
    if (!enabled) return false;

    const overlay = ensureOverlay();
    const tilePane = map.getPanes().tilePane;
    if (!tilePane) return false;

    const snapshot = tilePane.cloneNode(true) as HTMLElement;
    snapshot.querySelectorAll('img.leaflet-tile:not(.leaflet-tile-loaded)').forEach((tile) => tile.remove());
    snapshot.querySelectorAll<HTMLCanvasElement>('canvas').forEach((canvas) => {
      if (canvas.width <= 0 || canvas.height <= 0) {
        canvas.remove();
      }
    });

    const drawableCount = snapshot.querySelectorAll('img.leaflet-tile-loaded, canvas').length;
    if (drawableCount === 0) {
      overlay.innerHTML = '';
      return false;
    }

    snapshot.style.pointerEvents = 'none';
    overlay.innerHTML = '';
    overlay.appendChild(snapshot);
    return true;
  }, [enabled, ensureOverlay, map]);

  const hasPendingTiles = useCallback((): boolean => {
    const tilePane = map.getPanes().tilePane;
    if (!tilePane) return false;
    return tilePane.querySelectorAll('img.leaflet-tile:not(.leaflet-tile-loaded)').length > 0;
  }, [map]);

  const showSnapshot = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    clearTimer(hideTimerRef);
    overlay.style.transition = `opacity ${fadeOutMs}ms ease`;
    overlay.style.opacity = '1';
  }, [clearTimer, fadeOutMs]);

  const hideSnapshot = useCallback((delayMs: number = 0) => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    clearTimer(hideTimerRef);
    clearTimer(settleTimerRef);
    hideTimerRef.current = window.setTimeout(() => {
      overlay.style.opacity = '0';
      hideTimerRef.current = null;
    }, delayMs);
  }, [clearTimer]);

  const waitForTilesToSettle = useCallback(() => {
    clearTimer(settleTimerRef);

    const startedAt = performance.now();
    const tick = () => {
      if (!enabled) {
        hideSnapshot(0);
        return;
      }

      const elapsed = performance.now() - startedAt;
      if (!hasPendingTiles()) {
        hideSnapshot(60);
        settleTimerRef.current = null;
        return;
      }

      if (elapsed >= maxVisibleMs) {
        hideSnapshot(0);
        settleTimerRef.current = null;
        return;
      }

      settleTimerRef.current = window.setTimeout(tick, 45);
    };

    settleTimerRef.current = window.setTimeout(tick, 45);
  }, [clearTimer, enabled, hasPendingTiles, hideSnapshot, maxVisibleMs]);

  const startHandoff = useCallback(() => {
    if (!enabled) return;

    const hasSnapshot = captureCurrentTiles();
    if (!hasSnapshot) return;

    showSnapshot();
    waitForTilesToSettle();
  }, [enabled, captureCurrentTiles, showSnapshot, waitForTilesToSettle]);

  useEffect(() => {
    if (!enabled) {
      hideSnapshot(0);
      return;
    }

    const handleLoading = () => startHandoff();
    const handleZoomStart = () => startHandoff();
    const handleMoveEnd = () => waitForTilesToSettle();

    map.on('loading', handleLoading);
    map.on('zoomstart', handleZoomStart);
    map.on('moveend', handleMoveEnd);

    return () => {
      map.off('loading', handleLoading);
      map.off('zoomstart', handleZoomStart);
      map.off('moveend', handleMoveEnd);
    };
  }, [enabled, map, startHandoff, hideSnapshot, waitForTilesToSettle]);

  useEffect(() => {
    return () => {
      clearTimer(hideTimerRef);
      clearTimer(settleTimerRef);

      const overlay = overlayRef.current;
      if (overlay && overlay.parentElement) {
        overlay.parentElement.removeChild(overlay);
      }
      overlayRef.current = null;
    };
  }, [clearTimer]);

  return null;
};

const TouchZoomEndStabilizer = function TouchZoomEndStabilizer({
  enabled,
}: {
  enabled: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return;

    const handler: any = (map as any).touchZoom;
    if (!handler || typeof handler._onTouchEnd !== 'function') {
      return;
    }

    const originalOnTouchEnd = handler._onTouchEnd;

    handler._onTouchEnd = function () {
      if (!this._moved || !this._zooming) {
        this._zooming = false;
        return;
      }

      this._zooming = false;
      if (this._animRequest != null) {
        cancelAnimationFrame(this._animRequest);
        this._animRequest = null;
      }

      L.DomEvent.off(document, 'touchmove', this._onTouchMove, this);
      L.DomEvent.off(document, 'touchend touchcancel', this._onTouchEnd, this);

      const finalZoom = this._map._limitZoom(this._zoom);
      this._map._move(this._center, finalZoom, undefined, true);
      this._map._moveEnd(true);
    };

    return () => {
      handler._onTouchEnd = originalOnTouchEnd;
    };
  }, [map, enabled]);

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
  const isNative = Capacitor.isNativePlatform();
  const isTabletPerformanceMode = isNative;
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);
  const [isMapMoving, setIsMapMoving] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(currentPosition ? 13 : 6);
  const canvasRenderer = useMemo(() => L.canvas({ padding: 0.5 }), []);
  const labelCacheRef = useRef(new Map<string, { labelIconSmall: L.DivIcon; labelIconLarge: L.DivIcon; labelIconSmallOutlined: L.DivIcon; labelIconLargeOutlined: L.DivIcon }>());
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
  const offlineTilesDisabled = offlineTilesDisabledByEnv;
  const shouldUseOfflineTiles = !offlineTilesDisabled && isWithinOfflineBounds && (germanyTilesAvailable || offlineTilesReady);
  const needsOfflineDownload = false;
  const activePackName = activePack.name;
  const hasDownloadUrl = !!activePack.downloadUrl;
  const canDownloadOffline = hasDownloadUrl && isOnline;
  const forceOfflineTiles = !offlineTilesDisabled && isNative && offlineTilesReady && !onlineTileUrl;
  const preferRasterOnNative = !offlineTilesDisabled && isNative && offlineRasterAvailable && !offlinePmtilesUri;
  const tileKeepBuffer = isTabletPerformanceMode ? 8 : 3;
  const satelliteTileKeepBuffer = isTabletPerformanceMode ? Math.max(tileKeepBuffer, 6) : tileKeepBuffer;
  const tileUpdateWhenZooming = true;
  const tileUpdateWhenIdle = false;
  const satelliteUpdateWhenZooming = tileUpdateWhenZooming;
  const mapPanInertia = !isTabletPerformanceMode;
  const mapBounceAtZoomLimits = !isTabletPerformanceMode;
  const enableTileHandoff = isTabletPerformanceMode ? false : (isNative || shouldUseOfflineTiles || forceOfflineTiles);
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
        if (offlineTilesDisabledByEnv) {
          if (!cancelled) {
            setOfflinePmtilesUri(null);
            setOfflineRasterAvailable(false);
            setGermanyTilesAvailable(false);
            setTileProbeComplete(true);
          }
          return;
        }

        if (!cancelled) setTileProbeComplete(false);
        let pmtilesAvailable = false;
        let rasterAvailable = false;

        if (!Capacitor.isNativePlatform()) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          const bundledUrl = activePack.bundledUrl ?? offlinePmtilesUrl;
          pmtilesAvailable = bundledUrl ? await verifyPmtiles(bundledUrl, controller.signal) : false;
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
            const bundledUrl = activePack.bundledUrl ?? offlinePmtilesUrl;
            const copiedUrl = bundledUrl ? await tileDownloader.ensureBundledTiles(bundledUrl, activePack) : null;
            pmtilesAvailable = !!copiedUrl;
            if (!cancelled) {
              setOfflinePmtilesUri(copiedUrl || null);
            }
          }
        } else {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          const bundledUrl = activePack.bundledUrl ?? offlinePmtilesUrl;
          pmtilesAvailable = bundledUrl ? await verifyPmtiles(bundledUrl, controller.signal) : false;
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
  }, [isOnline, tileProbeCounter, activePack]);

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
  }, [isDownloadingOffline, isOnline, t, activePack]);

  const uniqueFieldBoundaries = useMemo(() => {
    const seen = new Set<string>();
    return fieldBoundaries.filter((boundary) => {
      if (!boundary) return false;
      const id = String(boundary.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [fieldBoundaries]);

  const createFieldLabelIcon = useCallback((
    fieldNumber: string,
    labelColor: string,
    fontSizePx: number,
    fontWeight: number
  ): L.DivIcon => {
    return L.divIcon({
      className: 'field-label',
      html: `<div style="
        position: absolute;
        left: 0;
        top: 0;
        font-weight: ${fontWeight};
        font-size: ${fontSizePx}px;
        color: ${labelColor};
        white-space: nowrap;
        pointer-events: none;
        transform: translate(-50%, -50%);
      ">${fieldNumber}</div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
  }, []);

  const getLabelIcons = useCallback((
    boundaryId: string,
    fieldNumber: string,
    labelColor: string
  ) => {
    const cacheKey = `${boundaryId}:${fieldNumber}:${labelColor}`;
    const cached = labelCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const next = {
      labelIconSmall: createFieldLabelIcon(fieldNumber, labelColor, 12, 600),
      labelIconLarge: createFieldLabelIcon(fieldNumber, labelColor, 14, 600),
      labelIconSmallOutlined: createFieldLabelIcon(fieldNumber, labelColor, 12, 700),
      labelIconLargeOutlined: createFieldLabelIcon(fieldNumber, labelColor, 14, 700),
    };

    labelCacheRef.current.set(cacheKey, next);
    return next;
  }, [createFieldLabelIcon]);

  const boundaryVisualZoom = isTabletPerformanceMode ? TABLET_BOUNDARY_VISUAL_ZOOM : currentZoom;
  const effectiveMapBounds = isTabletPerformanceMode ? null : mapBounds;
  const boundaryPointLimit = useMemo(() => {
    return getBoundaryPointLimit(boundaryVisualZoom, isMapMoving, isTabletPerformanceMode);
  }, [boundaryVisualZoom, isMapMoving, isTabletPerformanceMode]);

  const projectBounds = useMemo(() => {
    if (uniqueFieldBoundaries.length === 0) return null;

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    let hasValidCoordinates = false;

    uniqueFieldBoundaries.forEach((boundary) => {
      if (boundary.geometry_type === 'Polygon') {
        const coords = boundary.coordinates as number[][][];
        const exteriorRing = Array.isArray(coords) ? coords[0] : null;
        if (!Array.isArray(exteriorRing) || exteriorRing.length === 0) return;

        exteriorRing.forEach((coord) => {
          if (!Array.isArray(coord) || coord.length < 2) return;
          const [lng, lat] = coord;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

          hasValidCoordinates = true;
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
        });
      } else if (boundary.geometry_type === 'MultiPolygon') {
        const coords = boundary.coordinates as number[][][][];
        coords.forEach((polygon) => {
          const exteriorRing = Array.isArray(polygon) ? polygon[0] : null;
          if (!Array.isArray(exteriorRing) || exteriorRing.length === 0) return;

          exteriorRing.forEach((coord) => {
            if (!Array.isArray(coord) || coord.length < 2) return;
            const [lng, lat] = coord;
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

            hasValidCoordinates = true;
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
          });
        });
      }
    });

    if (!hasValidCoordinates) return null;

    return L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
  }, [uniqueFieldBoundaries]);

  const routeBounds = useMemo(() => {
    if (!selectedRoute?.coordinates || selectedRoute.coordinates.length === 0) return null;
    const points = selectedRoute.coordinates.map(([lat, lng]) => L.latLng(lat, lng));
    return L.latLngBounds(points);
  }, [selectedRoute]);

  const selectDestinationBounds = useMemo(() => {
    if (!projectBounds) return null;
    if (!currentPosition) return projectBounds;

    const bounds = L.latLngBounds(projectBounds.getSouthWest(), projectBounds.getNorthEast());
    bounds.extend([currentPosition.latitude, currentPosition.longitude]);
    return bounds;
  }, [currentPosition, projectBounds]);

  const boundaryRenderData = useMemo(() => {
    return uniqueFieldBoundaries.map((boundary) => {
      if (!boundary) return null;
      const coordsRaw = boundary.coordinates as any;
      if (!coordsRaw || !Array.isArray(coordsRaw) || coordsRaw.length === 0) return null;

      const fieldNumber = getFieldNumber(boundary.name);
      let centroid: [number, number] | null = null;

      if (boundary.geometry_type === 'Polygon') {
        centroid = calculateCentroid(coordsRaw as number[][][]);
        const coords = boundary.coordinates as number[][][];
        const positions = simplifyRingsForPerformance(
          coords.map((ring) => ring.map((coord) => [coord[1], coord[0]] as [number, number])),
          boundaryPointLimit
        );
        const bounds = L.latLngBounds(positions.flat() as [number, number][]);

        return {
          boundary,
          type: 'Polygon' as const,
          positions,
          vertexCount: countRingVertices(positions),
          bounds,
          centroid,
          fieldNumber,
          areaScore: getBoundaryAreaScore(boundary, bounds),
        };
      }

      if (boundary.geometry_type === 'MultiPolygon') {
        const polygons = (coordsRaw as number[][][][]).filter((polygon) => Array.isArray(polygon) && polygon.length > 0);
        if (polygons.length === 0) return null;

        const firstPolygon = polygons[0] as number[][][] | undefined;
        if (firstPolygon) {
          centroid = calculateCentroid(firstPolygon);
        }

        const positions = simplifyPolygonsForPerformance(
          polygons.map((polygon) =>
            polygon.map((ring) => ring.map((coord) => [coord[1], coord[0]] as [number, number]))
          ),
          boundaryPointLimit
        );
        const bounds = L.latLngBounds(positions.flat(2) as [number, number][]);

        return {
          boundary,
          type: 'MultiPolygon' as const,
          positions,
          vertexCount: countPolygonVertices(positions),
          bounds,
          centroid,
          fieldNumber,
          areaScore: getBoundaryAreaScore(boundary, bounds),
        };
      }

      return null;
    }).filter(Boolean) as Array<
      | { boundary: GpsFieldBoundary; type: 'Polygon'; positions: [number, number][][]; vertexCount: number; bounds: L.LatLngBounds; centroid: [number, number] | null; fieldNumber: string; areaScore: number }
      | { boundary: GpsFieldBoundary; type: 'MultiPolygon'; positions: [number, number][][][]; vertexCount: number; bounds: L.LatLngBounds; centroid: [number, number] | null; fieldNumber: string; areaScore: number }
    >;
  }, [uniqueFieldBoundaries, boundaryPointLimit]);

  const boundaryRenderLimit = useMemo(() => {
    const movingForBoundaries = isTabletPerformanceMode ? false : isMapMoving;
    return getBoundaryRenderLimit(boundaryVisualZoom, movingForBoundaries);
  }, [boundaryVisualZoom, isMapMoving, isTabletPerformanceMode]);

  const boundaryVertexBudget = useMemo(() => {
    const movingForBoundaries = isTabletPerformanceMode ? false : isMapMoving;
    return getBoundaryVertexBudget(boundaryVisualZoom, movingForBoundaries, isTabletPerformanceMode);
  }, [boundaryVisualZoom, isMapMoving, isTabletPerformanceMode]);

  const visibleBoundaryRenderData = useMemo(() => {
    const visible = !effectiveMapBounds
      ? boundaryRenderData
      : boundaryRenderData.filter((item) => effectiveMapBounds.intersects(item.bounds));

    const ranked = [...visible].sort((a, b) => {
      if (b.areaScore !== a.areaScore) return b.areaScore - a.areaScore;
      const bPoints = b.boundary.render_meta?.point_count ?? 0;
      const aPoints = a.boundary.render_meta?.point_count ?? 0;
      return bPoints - aPoints;
    });

    if (ranked.length <= boundaryRenderLimit && !Number.isFinite(boundaryVertexBudget)) {
      return ranked;
    }

    const selected: typeof ranked = [];
    let usedVertices = 0;

    for (const item of ranked) {
      if (selected.length >= boundaryRenderLimit) {
        break;
      }

      if (Number.isFinite(boundaryVertexBudget) && (usedVertices + item.vertexCount) > boundaryVertexBudget) {
        continue;
      }

      selected.push(item);
      usedVertices += item.vertexCount;
    }

    return selected;
  }, [boundaryRenderData, effectiveMapBounds, boundaryRenderLimit, boundaryVertexBudget]);

  const activeBoundaryRenderData = useMemo(() => {
    return visibleBoundaryRenderData;
  }, [visibleBoundaryRenderData]);

  const labelLimit = useMemo(() => {
    const movingForBoundaries = isTabletPerformanceMode ? false : isMapMoving;
    return getBoundaryLabelLimit(boundaryVisualZoom, movingForBoundaries);
  }, [boundaryVisualZoom, isMapMoving, isTabletPerformanceMode]);

  const visibleLabelIds = useMemo(() => {
    if (labelLimit <= 0 || activeBoundaryRenderData.length === 0) {
      return new Set<string>();
    }

    const ranked = [...activeBoundaryRenderData].sort((a, b) => {
      if (b.areaScore !== a.areaScore) return b.areaScore - a.areaScore;
      const bPoints = b.boundary.render_meta?.point_count ?? 0;
      const aPoints = a.boundary.render_meta?.point_count ?? 0;
      return bPoints - aPoints;
    });

    const visible = new Set<string>();
    for (const item of ranked) {
      visible.add(String(item.boundary.id));
      if (visible.size >= labelLimit) {
        break;
      }
    }

    return visible;
  }, [activeBoundaryRenderData, labelLimit]);

  const renderedBoundaries = useMemo(() => {
    return activeBoundaryRenderData.map((item) => {
      const boundary = item.boundary;
      const fieldColor = boundary.color || '#00FF00';
      const labelColor = useSatellite ? '#ffffff' : '#000000';
      const shouldRenderLabel = boundaryVisualZoom >= 13 && visibleLabelIds.has(String(boundary.id));
      const labelIcons = shouldRenderLabel
        ? getLabelIcons(String(boundary.id), item.fieldNumber, labelColor)
        : null;
      const labelIcon = labelIcons
        ? (boundaryVisualZoom < 14
            ? labelIcons.labelIconSmall
            : (boundaryVisualZoom < 15 ? labelIcons.labelIconLarge : labelIcons.labelIconLargeOutlined))
        : null;
      const baseRegularWeight = boundaryVisualZoom < 14 ? 0.9 : 1.2;
      const fillOpacity = (isTabletPerformanceMode ? false : isMapMoving) ? 0 : 0.10;

      const handleFieldClick = (event: L.LeafletMouseEvent) => {
        if (event.originalEvent) {
          L.DomEvent.stop(event.originalEvent);
        }
        onMapClick(event);
      };

      if (item.type === 'Polygon') {
        return (
          <div key={boundary.id}>
            <Polygon
              positions={item.positions}
              smoothFactor={0}
              pathOptions={{
                color: fieldColor,
                fillColor: fieldColor,
                fillOpacity,
                weight: baseRegularWeight,
              }}
              interactive={true}
              renderer={canvasRenderer}
              eventHandlers={{
                click: handleFieldClick,
              }}
            />
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
                smoothFactor={0}
                pathOptions={{
                  color: fieldColor,
                  fillColor: fieldColor,
                  fillOpacity,
                  weight: baseRegularWeight,
                }}
                interactive={true}
                renderer={canvasRenderer}
                eventHandlers={{
                  click: handleFieldClick,
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
  }, [
    activeBoundaryRenderData,
    useSatellite,
    boundaryVisualZoom,
    visibleLabelIds,
    getLabelIcons,
    isTabletPerformanceMode,
    isMapMoving,
    onMapClick,
    canvasRenderer,
  ]);

  const [followUser, setFollowUser] = useState(true);
  const [forceSnap, setForceSnap] = useState(false);
  const [hasLockedSelectDestinationBounds, setHasLockedSelectDestinationBounds] = useState(false);
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

  useEffect(() => {
    setHasLockedSelectDestinationBounds(false);
  }, [fieldBoundaries]);

  useEffect(() => {
    if (navStage !== 'select-destination') {
      if (hasLockedSelectDestinationBounds) {
        setHasLockedSelectDestinationBounds(false);
      }
      return;
    }

    if (!selectDestinationBounds || hasLockedSelectDestinationBounds) {
      return;
    }

    setHasLockedSelectDestinationBounds(true);
  }, [hasLockedSelectDestinationBounds, navStage, selectDestinationBounds]);

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
        worldCopyJump={true}
        maxBounds={LEAFLET_WORLD_BOUNDS}
        maxBoundsViscosity={1}
        inertia={mapPanInertia}
        bounceAtZoomLimits={mapBounceAtZoomLimits}
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
      <TouchZoomEndStabilizer enabled={isNative} />
      <MapViewportTracker
        onBoundsChange={setMapBounds}
        onMovingChange={setIsMapMoving}
        onZoomChange={setCurrentZoom}
        suppressZoomMoveState={isTabletPerformanceMode}
        disablePostZoomUpdates={isTabletPerformanceMode}
      />
      <TileHandoffController enabled={enableTileHandoff} />
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
            ? (hasLockedSelectDestinationBounds ? projectBounds : selectDestinationBounds)
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
              noWrap={true}
              attribution='© OpenStreetMap contributors'
              crossOrigin={getTileLayerCrossOrigin('https://tile.openstreetmap.org/{z}/{x}/{y}.png')}
              keepBuffer={tileKeepBuffer}
              updateWhenIdle={tileUpdateWhenIdle}
              updateWhenZooming={tileUpdateWhenZooming}
              reuseTiles={true}
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
              noWrap={true}
              attribution='© Esri'
              crossOrigin={getTileLayerCrossOrigin('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}')}
              keepBuffer={satelliteTileKeepBuffer}
              updateWhenIdle={tileUpdateWhenIdle}
              updateWhenZooming={satelliteUpdateWhenZooming}
              reuseTiles={true}
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
              noWrap={true}
              attribution='Offline Maps - Germany Base Map (OpenStreetMap Data)'
              errorTileUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
              crossOrigin={getTileLayerCrossOrigin('/tiles/germany/{z}/{x}/{y}.png')}
              keepBuffer={tileKeepBuffer}
              updateWhenIdle={tileUpdateWhenIdle}
              updateWhenZooming={tileUpdateWhenZooming}
              reuseTiles={true}
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
              noWrap={true}
              attribution='Offline Maps - Germany Base Map (OpenStreetMap Data)'
              errorTileUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
              crossOrigin={getTileLayerCrossOrigin('/tiles/germany/{z}/{x}/{y}.png')}
              keepBuffer={tileKeepBuffer}
              updateWhenIdle={tileUpdateWhenIdle}
              updateWhenZooming={tileUpdateWhenZooming}
              reuseTiles={true}
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
              noWrap={true}
              attribution='© OpenStreetMap contributors | Offline PMTiles'
              theme={Capacitor.isNativePlatform() && isDarkMode ? 'dark' : 'light'}
              schema="openmaptiles"
              disableLabels={isTabletPerformanceMode}
              keepBuffer={isNative ? Math.max(tileKeepBuffer, 6) : tileKeepBuffer}
              updateWhenIdle={isNative ? false : tileUpdateWhenIdle}
              updateWhenZooming={isNative ? true : tileUpdateWhenZooming}
              tileDelay={isNative ? 0.01 : 3}
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
              noWrap={true}
              attribution='Offline fallback (no tiles available)'
              tileSize={256}
            />
          );
        }
        
        // Still probing for offline tiles: keep online tiles visible while probing when possible.
        if (!tileProbeComplete && (isWithinOfflineBounds || forceOfflineTiles)) {
          if (isOnline) {
            const probeUrl = onlineTileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
            return (
              <TileLayer
                key='nav-tiles-probe-online'
                url={probeUrl}
                minZoom={1}
                maxZoom={20}
                maxNativeZoom={19}
                noWrap={true}
                attribution={onlineTileUrl ? 'Self-hosted tiles' : '© OpenStreetMap contributors'}
                crossOrigin={getTileLayerCrossOrigin(probeUrl)}
                keepBuffer={tileKeepBuffer}
                updateWhenIdle={tileUpdateWhenIdle}
                updateWhenZooming={tileUpdateWhenZooming}
                reuseTiles={true}
              />
            );
          }

          console.log('[NavigationMap] Probing tiles - showing blank fallback');
          return (
            <TileLayer
              key='nav-tiles-probe-blank'
              url={BLANK_TILE_URL}
              minZoom={1}
              maxZoom={18}
              maxNativeZoom={18}
              noWrap={true}
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
              noWrap={true}
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
            noWrap={true}
            attribution={onlineTileUrl || rasterFallback ? 'Self-hosted tiles | GPS Navigation' : '© OpenStreetMap contributors | GPS Navigation'}
            crossOrigin={getTileLayerCrossOrigin(baseOnlineUrl)}
            tileSize={256}
            keepBuffer={tileKeepBuffer}
            updateWhenIdle={tileUpdateWhenIdle}
            updateWhenZooming={tileUpdateWhenZooming}
            reuseTiles={true}
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

      {import.meta.env.VITE_ENABLE_OFFLINE_PROMPT_BANNER === 'true' && showOfflinePrompt && (
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