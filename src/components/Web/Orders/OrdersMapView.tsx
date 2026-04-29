import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import type { MutableRefObject } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Polygon, Circle, CircleMarker, useMap, useMapEvents, FeatureGroup, GeoJSON } from 'react-leaflet';
import { EditControl } from 'react-leaflet-draw';
import L from 'leaflet';
import 'leaflet-draw/dist/leaflet.draw.css';
import { Capacitor } from '@capacitor/core';
import { Navigation2, Satellite, Map, Search } from 'lucide-react';
import { useDarkMode } from '../../../hooks/useDarkMode';
import { useLanguage } from '../../../hooks/useLanguage';
import i18n from '../../../i18n';
import { GpsPosition, GpsTrackDetail, GpsPoint, GpsFieldBoundary } from '../../../types';
import { getBlankTileUrl } from '../../../utils/tileUtils';
import { getDefaultPack, getPackForLocation, OFFLINE_MAP_PACKS } from '../../../config/offlineMapPacks';
import PMTilesVectorLayer from '../../GPS/PMTilesVectorLayer';
import { tileDownloader, DownloadProgress } from '../../../services/offlineTileDownloader';
import 'leaflet/dist/leaflet.css';

// Suppress deprecation warning from leaflet-draw library
const originalWarn = console.warn;
console.warn = (...args: any[]) => {
  if (args[0]?.includes?.('Deprecated use of _flat')) {
    return; // Suppress this specific warning from leaflet-draw
  }
  originalWarn(...args);
};

const onlineTileUrl = (window as any).__VITE_ONLINE_TILE_URL__ || (import.meta.env.VITE_ONLINE_TILE_URL as string | undefined);
const offlinePmtilesUrl = (window as any).__VITE_PMTILES_URL__ || (import.meta.env.VITE_PMTILES_URL as string | undefined) || '/tiles/germany.pmtiles';

// Check for Germany offline tiles at runtime
const checkGermanyTilesAvailable = (): boolean => {
  // First check build-time flags
  if ((window as any).__GERMANY_PMTILES_AVAILABLE__ === true) {
    return true;
  }
  if ((window as any).__GERMANY_TILES_AVAILABLE__ === true) {
    return true;
  }
  return false;
};

// Runtime availability check to avoid assuming tiles exist when they do not
const initialGermanyTilesAvailable = checkGermanyTilesAvailable();

// Calculate centroid of a polygon
function calculateCentroid(coordinates: number[][][] | undefined | null): [number, number] | null {
  try {
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0) return null;

    const ring = coordinates[0]; // Use exterior ring
    if (!Array.isArray(ring) || ring.length === 0) return null;

    let sumLat = 0;
    let sumLng = 0;

    for (const coord of ring) {
      if (!coord || coord.length < 2) return null;
      sumLng += coord[0];
      sumLat += coord[1];
    }

    return [sumLat / ring.length, sumLng / ring.length];
  } catch (error) {
    console.error(i18n.t('orders.map.logs.centroidError'), error);
    return null;
  }
}

const haversineDistance = (a: [number, number], b: [number, number]) => {
  const R = 6371000;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const interpolatePoint = (a: [number, number], b: [number, number], t: number): [number, number] => {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
};

const calculateManualSamplePositions = (boundary: GpsFieldBoundary, count: number): [number, number][] => {
  if (!boundary?.coordinates || count < 1) return [];

  const coords = boundary.geometry_type === 'MultiPolygon'
    ? (boundary.coordinates as number[][][][])[0]?.[0]
    : (boundary.coordinates as number[][][])[0];

  if (!coords || coords.length < 2) return [];

  const ring = coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1]
    ? coords
    : [...coords, coords[0]];

  const latLngRing: [number, number][] = ring.map(coord => [coord[1], coord[0]] as [number, number]);

  const segmentLengths = latLngRing.slice(1).map((point, idx) => haversineDistance(latLngRing[idx], point));
  const totalLength = segmentLengths.reduce((sum, len) => sum + len, 0);
  if (totalLength === 0) return [];

  const positions: [number, number][] = [];
  const totalPoints = count + 2;

  for (let i = 0; i < totalPoints; i += 1) {
    const target = (totalLength * i) / (totalPoints - 1);
    let traveled = 0;
    for (let seg = 0; seg < segmentLengths.length; seg += 1) {
      const segLength = segmentLengths[seg];
      if (traveled + segLength >= target) {
        const remaining = target - traveled;
        const t = segLength === 0 ? 0 : remaining / segLength;
        positions.push(interpolatePoint(latLngRing[seg], latLngRing[seg + 1], t));
        break;
      }
      traveled += segLength;
    }
  }

  return positions;
};

const metersPerPixel = (zoom: number, latitude: number): number => {
  return (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / Math.pow(2, zoom);
};

const pixelRadiusToMeters = (zoom: number, latitude: number, pixelRadius: number): number => {
  return pixelRadius * metersPerPixel(zoom, latitude);
};

const inactiveFieldColor = '#DC2626';
const inactivePatternId = 'inactive-field-hatch';

// Advanced GPS Point Smoothing Algorithm
// Creates smooth curved paths, ignores circling and small movements
function smoothGpsPoints(points: GpsPoint[]): GpsPoint[] {
  if (!points || points.length < 2) return points || [];

  const smoothed: GpsPoint[] = [];
  const MIN_MOVEMENT = 0.000001; // ~0.1 meter minimum movement - very low threshold to preserve track lines
  const CIRCLING_THRESHOLD = 0.0001; // ~11 meters - ignore if moving in circles

  // Always keep first point
  smoothed.push(points[0]);

  let lastAcceptedPoint = points[0];

  for (let i = 1; i < points.length; i++) {
    const curr = points[i];

    // Calculate distance from last accepted point
    const distFromLast = Math.sqrt(
      Math.pow(curr.latitude - lastAcceptedPoint.latitude, 2) +
      Math.pow(curr.longitude - lastAcceptedPoint.longitude, 2)
    );

    // Skip points that are too close (small movements) - but be less aggressive
    if (distFromLast < MIN_MOVEMENT) {
      continue;
    }

    // Check if we're circling (distance to start point vs current path length)
    if (smoothed.length > 3) {
      const distToStart = Math.sqrt(
        Math.pow(curr.latitude - smoothed[0].latitude, 2) +
        Math.pow(curr.longitude - smoothed[0].longitude, 2)
      );

      // If we're very close to start but have moved a lot, we're circling
      if (distToStart < CIRCLING_THRESHOLD && smoothed.length > 5) {
        continue;
      }
    }

    // Accept this point
    smoothed.push(curr);
    lastAcceptedPoint = curr;
  }

  // CRITICAL: Ensure we always have at least 2 points for line rendering
  // If filtering was too aggressive, keep first and last point
  if (smoothed.length < 2 && points.length >= 2) {
    console.log(i18n.t('orders.map.logs.smoothingAggressive'));
    return [points[0], points[points.length - 1]];
  }

  // Return simplified points if we don't have enough for spline smoothing
  if (smoothed.length < 4) {
    console.log(i18n.t('orders.map.logs.smoothingNotEnough', { count: smoothed.length }), smoothed.length);
    return smoothed;
  }

  const curved: GpsPoint[] = [smoothed[0]];

  for (let i = 1; i < smoothed.length - 1; i++) {
    const p0 = smoothed[Math.max(0, i - 1)];
    const p1 = smoothed[i];
    const p2 = smoothed[i + 1];
    const p3 = smoothed[Math.min(smoothed.length - 1, i + 2)];

    // Create smooth curve between p1 and p2 with more interpolation points for smoother curves
    for (let t = 0; t <= 1; t += 0.2) {
      const t2 = t * t;
      const t3 = t2 * t;

      const lat = 0.5 * (
        (2 * p1.latitude) +
        (-p0.latitude + p2.latitude) * t +
        (2 * p0.latitude - 5 * p1.latitude + 4 * p2.latitude - p3.latitude) * t2 +
        (-p0.latitude + 3 * p1.latitude - 3 * p2.latitude + p3.latitude) * t3
      );

      const lng = 0.5 * (
        (2 * p1.longitude) +
        (-p0.longitude + p2.longitude) * t +
        (2 * p0.longitude - 5 * p1.longitude + 4 * p2.longitude - p3.longitude) * t2 +
        (-p0.longitude + 3 * p1.longitude - 3 * p2.longitude + p3.longitude) * t3
      );

      curved.push({
        ...p1,
        latitude: lat,
        longitude: lng
      });
    }
  }

  curved.push(smoothed[smoothed.length - 1]);

  return curved;
}

// Fix Leaflet default marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Custom icons
// Arrow marker for current location (rotates with heading)
const createCurrentLocationArrow = (heading: number = 0) => new L.DivIcon({
  className: 'current-location-arrow',
  html: `
    <div style="
      width: 32px;
      height: 32px;
      position: relative;
      transform: rotate(${heading}deg);
    ">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 100%; height: 100%;">
        <path d="M12 2 L18 22 L12 18 L6 22 Z" fill="#3B82F6" stroke="white" stroke-width="2"/>
      </svg>
    </div>
  `,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -14],
});

// Red square for start point - smaller fixed size
const startPointIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
      <rect x="6" y="6" width="12" height="12" fill="#EF4444" stroke="white" stroke-width="2"/>
    </svg>
  `),
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  popupAnchor: [0, -7],
});

// Red square for end point - smaller fixed size
const endPointIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
      <rect x="6" y="6" width="12" height="12" fill="#EF4444" stroke="white" stroke-width="2"/>
    </svg>
  `),
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  popupAnchor: [0, -7],
});

// Red X for sample points - small fixed size
const sampleIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
      <path d="M4 4L20 20M20 4L4 20" stroke="#EF4444" stroke-width="4" stroke-linecap="round"/>
    </svg>
  `),
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  popupAnchor: [0, -7],
});

// Reusable 1x1 transparent tile for safe fallback when offline tiles are missing
const BLANK_TILE_URL = getBlankTileUrl();

interface OrdersMapViewProps {
  currentPosition: GpsPosition | null;
  tracks: GpsTrackDetail[];
  fieldBoundaries?: GpsFieldBoundary[];
  drawnFields?: Array<{ id: string; geometry: any; color?: string; baseName?: string; baseId?: string; areaHa?: number }>;
  focusedBoundaryId?: number | null;
  focusedDrawnFieldId?: string | null;
  selectedBoundaryIds?: Array<number | string>;
  selectedDrawnIds?: string[];
  focusedTrackId?: number | null;
  disableSelectionFocus?: boolean;
  isTracking: boolean;
  showNavigationButton?: boolean;
  onNavigationClick?: () => void;
  isNavigationOpen?: boolean;
  isSidebarCollapsed?: boolean;
  recenterTrigger?: number;
  onFieldClick?: (fieldId: number | string, source?: 'uploaded' | 'drawn', multiSelect?: boolean) => void;
  onMapClick?: () => void;
  onFieldEditRequest?: (fieldId: number | string, source?: 'uploaded' | 'drawn') => void;
  onFieldDeleteRequest?: (fieldId: number | string, source?: 'uploaded' | 'drawn') => void;
  onFieldShapeAction?: (action: 'edit-shape' | 'redraw-shape' | 'delete-shape', fieldId: number | string, source?: 'uploaded' | 'drawn') => void;
  disableHoverEditPopup?: boolean;
  drawingMode?: 'polygon' | 'rectangle' | 'edit' | 'delete' | null;
  onDrawingComplete?: (payload: { id: string; geometry: any }) => void;
  onDrawingEdited?: (payload: { id: string; geometry: any }) => void;
  onDrawingDeleted?: (ids: string[]) => void;
}

type PlaceSearchResult = {
  displayName: string;
  lat: number;
  lon: number;
  boundingbox?: string[];
};

const MapController = memo(function MapController({
  currentPosition,
  fieldBoundaries,
  focusedBoundaryId,
  focusedDrawnFieldId,
  drawnFields,
  focusedTrackId,
  tracks,
  isTracking,
  disableSelectionFocus,
  snapState
}: {
  currentPosition: GpsPosition | null;
  fieldBoundaries: GpsFieldBoundary[];
  focusedBoundaryId?: number | null;
  focusedDrawnFieldId?: string | null;
  drawnFields: Array<{ id: string; geometry: any }>;
  focusedTrackId?: number | null;
  tracks: GpsTrackDetail[];
  isTracking?: boolean;
  disableSelectionFocus?: boolean;
  snapState?: {
    hasZoomedRef: MutableRefObject<boolean>;
    hasZoomedToBoundariesRef: MutableRefObject<boolean>;
    trackingCenterDoneRef: MutableRefObject<boolean>;
    boundaryFocusDoneRef: MutableRefObject<boolean>;
    lastFocusedBoundaryIdRef: MutableRefObject<number | null>;
    trackFocusDoneRef: MutableRefObject<boolean>;
    lastFocusedTrackIdRef: MutableRefObject<number | null>;
  };
}) {
  const map = useMap();
  const localHasZoomedRef = useRef(false);
  const localHasZoomedToBoundariesRef = useRef(false);
  const isAnimatingRef = useRef(false);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const localTrackingCenterDoneRef = useRef(false);
  const localLastFocusedBoundaryIdRef = useRef<number | null>(null);
  const localBoundaryFocusDoneRef = useRef(false);
  const localLastFocusedTrackIdRef = useRef<number | null>(null);
  const localTrackFocusDoneRef = useRef(false);

  const hasZoomedRef = snapState?.hasZoomedRef ?? localHasZoomedRef;
  const hasZoomedToBoundariesRef = snapState?.hasZoomedToBoundariesRef ?? localHasZoomedToBoundariesRef;
  const trackingCenterDoneRef = snapState?.trackingCenterDoneRef ?? localTrackingCenterDoneRef;
  const lastFocusedBoundaryIdRef = snapState?.lastFocusedBoundaryIdRef ?? localLastFocusedBoundaryIdRef;
  const boundaryFocusDoneRef = snapState?.boundaryFocusDoneRef ?? localBoundaryFocusDoneRef;
  const lastFocusedTrackIdRef = snapState?.lastFocusedTrackIdRef ?? localLastFocusedTrackIdRef;
  const trackFocusDoneRef = snapState?.trackFocusDoneRef ?? localTrackFocusDoneRef;

  const getBoundsFromGeometry = useCallback((geometry: any) => {
    if (!geometry) return null;
    const bounds = L.latLngBounds([]);
    if (geometry.type === 'Polygon') {
      const coords = geometry.coordinates as number[][][];
      coords[0]?.forEach((coord) => bounds.extend([coord[1], coord[0]]));
    } else if (geometry.type === 'MultiPolygon') {
      const coords = geometry.coordinates as number[][][][];
      coords.forEach((polygon) => {
        polygon[0]?.forEach((coord) => bounds.extend([coord[1], coord[0]]));
      });
    }
    return bounds.isValid() ? bounds : null;
  }, []);

  const flyToBoundsAnimated = useCallback((bounds: L.LatLngBoundsExpression, padding: [number, number] = [80, 80], maxZoom: number = 18, force: boolean = false) => {
    if (!map) return;

    // Prevent overlapping animations unless forced
    if (isAnimatingRef.current && !force) return;

    isAnimatingRef.current = true;

    // Clear any existing timeout
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
    }

    try {
      (map as any).flyToBounds(bounds, {
        padding,
        maxZoom,
        duration: 1.0, // Slightly faster to reduce perception lag
        easeLinearity: 0.25 // Smoother easing
      });

      // Reset animation flag after completion
      animationTimeoutRef.current = setTimeout(() => {
        isAnimatingRef.current = false;
      }, 1100); // Slightly longer than animation duration
    } catch (_) {
      map.fitBounds(bounds, { padding, maxZoom });
      isAnimatingRef.current = false;
    }
  }, [map]);

  // Center once when tracking starts, then let the user control the camera
  useEffect(() => {
    if (!isTracking) {
      trackingCenterDoneRef.current = false;
      return;
    }

    if (trackingCenterDoneRef.current) return;
    if (currentPosition) {
      map.setView([currentPosition.latitude, currentPosition.longitude], map.getZoom(), {
        animate: true,
        duration: 0.3
      });
      trackingCenterDoneRef.current = true;
    }
  }, [currentPosition, isTracking, map]);

  // Focus on specific boundary when clicked
  useEffect(() => {
    if (disableSelectionFocus) return;
    if (!focusedBoundaryId) {
      boundaryFocusDoneRef.current = false;
      lastFocusedBoundaryIdRef.current = null;
      return;
    }

    if (boundaryFocusDoneRef.current && lastFocusedBoundaryIdRef.current === focusedBoundaryId) {
      return;
    }

    if (fieldBoundaries.length > 0) {
      const boundary = fieldBoundaries.find(b => String(b.id) === String(focusedBoundaryId));
      if (boundary) {
        try {
          const bounds = L.latLngBounds([]);

          if (boundary.geometry_type === 'Polygon') {
            const coords = boundary.coordinates as number[][][];
            coords[0].forEach(coord => {
              bounds.extend([coord[1], coord[0]]);
            });
          } else if (boundary.geometry_type === 'MultiPolygon') {
            const coords = boundary.coordinates as number[][][][];
            coords.forEach(polygon => {
              polygon[0].forEach(coord => {
                bounds.extend([coord[1], coord[0]]);
              });
            });
          }

          if (bounds.isValid()) {
            flyToBoundsAnimated(bounds, [90, 90], 18, true);
            boundaryFocusDoneRef.current = true;
            lastFocusedBoundaryIdRef.current = focusedBoundaryId;
          }
        } catch (error) {
          console.error(t('orders.map.logs.focusBoundaryError'), error);
        }
      }
    }
  }, [focusedBoundaryId, fieldBoundaries, map, flyToBoundsAnimated, disableSelectionFocus]);

  // Focus on specific drawn field when clicked
  useEffect(() => {
    if (disableSelectionFocus) return;
    if (!focusedDrawnFieldId) return;
    const drawn = drawnFields.find((field) => String(field.id) === String(focusedDrawnFieldId));
    if (!drawn) return;
    try {
      const bounds = getBoundsFromGeometry(drawn.geometry);
      if (bounds) {
        flyToBoundsAnimated(bounds, [90, 90], 18, true);
      }
    } catch (error) {
      console.error(t('orders.map.logs.focusDrawnFieldError'), error);
    }
  }, [focusedDrawnFieldId, drawnFields, flyToBoundsAnimated, getBoundsFromGeometry, disableSelectionFocus]);

  // Focus on specific track when clicked
  useEffect(() => {
    if (!focusedTrackId) {
      trackFocusDoneRef.current = false;
      lastFocusedTrackIdRef.current = null;
      return;
    }

    if (trackFocusDoneRef.current && lastFocusedTrackIdRef.current === focusedTrackId) {
      return;
    }

    if (tracks.length > 0) {
      const track = tracks.find(t => t.id === focusedTrackId);
      const gpsPoints = track?.gps_points || [];

      if (track && gpsPoints.length > 0) {
        try {
          const bounds = L.latLngBounds([]);
          gpsPoints.forEach(point => {
            bounds.extend([point.latitude, point.longitude]);
          });

          if (bounds.isValid()) {
            flyToBoundsAnimated(bounds, [90, 90], 18, true);
            trackFocusDoneRef.current = true;
            lastFocusedTrackIdRef.current = focusedTrackId;
          }
        } catch (error) {
          console.error(t('orders.map.logs.focusTrackError'), error);
        }
      }
    }
  }, [focusedTrackId, tracks, map, flyToBoundsAnimated]);

  // Auto-zoom to field boundaries when they're loaded (with delay to ensure rendering)
  useEffect(() => {
    if (fieldBoundaries.length > 0 && !hasZoomedToBoundariesRef.current) {
      // Add a small delay to ensure boundaries are rendered before animation
      const timer = setTimeout(() => {
        try {
          const bounds = L.latLngBounds([]);

          fieldBoundaries.forEach(boundary => {
            if (boundary.geometry_type === 'Polygon') {
              const coords = boundary.coordinates as number[][][];
              coords[0].forEach(coord => {
                bounds.extend([coord[1], coord[0]]);
              });
            } else if (boundary.geometry_type === 'MultiPolygon') {
              const coords = boundary.coordinates as number[][][][];
              coords.forEach(polygon => {
                polygon[0].forEach(coord => {
                  bounds.extend([coord[1], coord[0]]);
                });
              });
            }
          });

          if (bounds.isValid()) {
            flyToBoundsAnimated(bounds, [70, 70], 17);
            hasZoomedToBoundariesRef.current = true;
          }
        } catch (error) {
          console.error(t('orders.map.logs.boundaryBoundsError'), error);
        }
      }, 150); // Small delay to ensure rendering

      return () => clearTimeout(timer);
    }
  }, [fieldBoundaries, map, flyToBoundsAnimated]);

  // Zoom to current position if no boundaries
  useEffect(() => {
    if (currentPosition && !hasZoomedRef.current && fieldBoundaries.length === 0) {
      map.setView([currentPosition.latitude, currentPosition.longitude], 18);
      hasZoomedRef.current = true;
    }
  }, [currentPosition, fieldBoundaries, map]);

  // Cleanup animation timeout on unmount
  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
    };
  }, []);

  return null;
});

const MapScaleUpdater = memo(function MapScaleUpdater({
  onScaleChange,
  formatLabel,
}: {
  onScaleChange: (scale: { label: string; width: number }) => void;
  formatLabel: (meters: number) => string;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    const calculateScale = () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      const metersPerPixel =
        (156543.03392 * Math.cos((center.lat * Math.PI) / 180)) / Math.pow(2, zoom);
      const targetPx = 80;
      const rawMeters = metersPerPixel * targetPx;

      const pow10 = Math.pow(10, Math.floor(Math.log10(rawMeters)));
      const candidates = [1, 2, 5, 10].map((m) => m * pow10);
      const niceMeters = candidates.find((m) => m >= rawMeters) || candidates[candidates.length - 1];
      const width = Math.max(40, Math.min(140, niceMeters / metersPerPixel));
      const label = formatLabel(niceMeters);

      onScaleChange({ label, width });
    };

    calculateScale();
    map.on('zoomend moveend', calculateScale);

    return () => {
      map.off('zoomend moveend', calculateScale);
    };
  }, [map, onScaleChange, formatLabel]);

  return null;
});

// Zoom level tracker for performance optimization
const ZoomTracker = memo(function ZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap();
  
  useEffect(() => {
    const handleZoom = () => {
      onZoomChange(map.getZoom());
    };
    
    map.on('zoomend', handleZoom);
    onZoomChange(map.getZoom()); // Set initial zoom
    
    return () => {
      map.off('zoomend', handleZoom);
    };
  }, [map, onZoomChange]);
  
  return null;
});

const TileLoadingTracker = memo(function TileLoadingTracker({
  onLoadingChange
}: {
  onLoadingChange: (isLoading: boolean) => void;
}) {
  const map = useMap();
  const loadingCountRef = useRef(0);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const setLoading = (value: boolean) => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      if (value) {
        onLoadingChange(true);
        return;
      }
      hideTimeoutRef.current = setTimeout(() => onLoadingChange(false), 150);
    };

    const handleStart = () => {
      loadingCountRef.current += 1;
      setLoading(true);
    };

    const handleEnd = () => {
      loadingCountRef.current = Math.max(0, loadingCountRef.current - 1);
      if (loadingCountRef.current === 0) {
        setLoading(false);
      }
    };

    const handleZoomStart = () => {
      setLoading(true);
    };

    const handleZoomEnd = () => {
      if (loadingCountRef.current === 0) {
        setLoading(false);
      }
    };

    map.on('tileloadstart', handleStart);
    map.on('tileload', handleEnd);
    map.on('tileerror', handleEnd);
    map.on('zoomstart', handleZoomStart);
    map.on('zoomend', handleZoomEnd);

    return () => {
      map.off('tileloadstart', handleStart);
      map.off('tileload', handleEnd);
      map.off('tileerror', handleEnd);
      map.off('zoomstart', handleZoomStart);
      map.off('zoomend', handleZoomEnd);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    };
  }, [map, onLoadingChange]);

  return null;
});

const FieldVectorPaneSetup = memo(function FieldVectorPaneSetup() {
  const map = useMap();

  useEffect(() => {
    const paneName = 'field-vectors';
    const pane = map.getPane(paneName) ?? map.createPane(paneName);
    pane.style.zIndex = '420';
  }, [map]);

  return null;
});

type DeferredTileLayerProps = {
  url: string;
  attribution?: string;
  minZoom?: number;
  maxZoom?: number;
  maxNativeZoom?: number;
  tileSize?: number;
  opacity?: number;
  keepBuffer?: number;
  updateWhenIdle?: boolean;
  updateWhenZooming?: boolean;
  crossOrigin?: boolean | string;
  errorTileUrl?: string;
  zIndex?: number;
};

export default function OrdersMapView({
  currentPosition,
  tracks,
  fieldBoundaries = [],
  drawnFields = [],
  focusedBoundaryId = null,
  focusedDrawnFieldId = null,
  selectedBoundaryIds = [],
  selectedDrawnIds = [],
  focusedTrackId = null,
  disableSelectionFocus = false,
  isTracking,
  showNavigationButton = false,
  onNavigationClick,
  isNavigationOpen = false,
  isSidebarCollapsed = false,
  recenterTrigger,
  onFieldClick,
  onMapClick,
  onFieldEditRequest,
  onFieldShapeAction,
  disableHoverEditPopup = false,
  drawingMode = null,
  onDrawingComplete,
  onDrawingEdited,
  onDrawingDeleted,
}: OrdersMapViewProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const featureGroupRef = useRef<L.FeatureGroup | null>(null);
  const activeDrawHandlerRef = useRef<any>(null);
  const onDrawingEditedRef = useRef(onDrawingEdited);
  const canvasRenderer = useMemo(() => L.canvas({ padding: 0.5 }), []);
  const fieldSvgRenderer = useMemo(() => L.svg({ padding: 0.5 }), []);
  const fieldMetadataRef = useRef<Record<string, any>>({});
  const makeDrawnId = useCallback(() => `drawn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, []);
  const hasZoomedRef = useRef(false);
  const hasZoomedToBoundariesRef = useRef(false);
  const trackingCenterDoneRef = useRef(false);
  const boundaryFocusDoneRef = useRef(false);

  // Clear/update metadata cache when fields change to ensure updated names/colors display
  useEffect(() => {
    const updatedMetadata: Record<string, any> = {};
    drawnFields.forEach(field => {
      if (field.baseName || field.baseId) {
        updatedMetadata[field.id] = {
          baseName: field.baseName,
          baseId: field.baseId,
          areaHa: field.areaHa
        };
      }
    });
    fieldMetadataRef.current = updatedMetadata;
  }, [drawnFields]);

  // Keep the ref updated
  useEffect(() => {
    onDrawingEditedRef.current = onDrawingEdited;
  }, [onDrawingEdited]);
  const lastFocusedBoundaryIdRef = useRef<number | null>(null);
  const trackFocusDoneRef = useRef(false);
  const lastFocusedTrackIdRef = useRef<number | null>(null);
  const snapState = useMemo(() => ({
    hasZoomedRef,
    hasZoomedToBoundariesRef,
    trackingCenterDoneRef,
    boundaryFocusDoneRef,
    lastFocusedBoundaryIdRef,
    trackFocusDoneRef,
    lastFocusedTrackIdRef
  }), []);
  const [isDark] = useDarkMode();
  const isDarkMode = isDark;
  const { t, language } = useLanguage();
  const MAP_MODE_STORAGE_KEY = 'ordersMapMode';
  const getInitialMapMode = (): 'osm' | 'satellite' => {
    if (typeof window === 'undefined') return 'osm';
    const stored = window.localStorage.getItem(MAP_MODE_STORAGE_KEY);
    return stored === 'satellite' ? 'satellite' : 'osm';
  };
  // Map mode: OSM or satellite (online only)
  const [mapMode, setMapMode] = useState<'osm' | 'satellite'>(getInitialMapMode);
  const useSatellite = mapMode === 'satellite';
  const useOSM = mapMode === 'osm';
  const [germanyTilesAvailable, setGermanyTilesAvailable] = useState(initialGermanyTilesAvailable);
  const [offlineRasterAvailable, setOfflineRasterAvailable] = useState((window as any).__GERMANY_TILES_AVAILABLE__ === true);
  const [offlinePmtilesUri, setOfflinePmtilesUri] = useState<string | null>(null);
  const [tileProbeCounter, setTileProbeCounter] = useState(0);
  const [tileProbeComplete, setTileProbeComplete] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(13);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverPopupActiveRef = useRef(false);
  const hideOnPopupLeaveRef = useRef(false);
  const popupHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverPopupRef = useRef<HTMLDivElement | null>(null);
  const selectedFieldRef = useRef<{ fieldId: number | string; source: 'uploaded' | 'drawn' } | null>(null);
  const suppressNextMapClickRef = useRef(false);
  const hasInjectedPatternRef = useRef(false);
  const selectedBoundarySet = useMemo(
    () => new Set(selectedBoundaryIds.map(id => String(id))),
    [selectedBoundaryIds]
  );
  const selectedDrawnSet = useMemo(
    () => new Set(selectedDrawnIds.map(id => String(id))),
    [selectedDrawnIds]
  );
  const hoverPendingRef = useRef<{
    fieldId: number | string;
    source: 'uploaded' | 'drawn';
    x: number;
    y: number;
  } | null>(null);
  const [hoverEditPopup, setHoverEditPopup] = useState<{
    fieldId: number | string;
    source: 'uploaded' | 'drawn';
    x: number;
    y: number;
  } | null>(null);
  const [drawingHint, setDrawingHint] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    const drawLocal = ((L as any).drawLocal = (L as any).drawLocal || {});
    drawLocal.draw = drawLocal.draw || {};
    drawLocal.draw.toolbar = drawLocal.draw.toolbar || {};
    drawLocal.draw.toolbar.buttons = drawLocal.draw.toolbar.buttons || {};
    drawLocal.draw.handlers = drawLocal.draw.handlers || {};
    drawLocal.draw.handlers.polygon = drawLocal.draw.handlers.polygon || {};
    drawLocal.draw.handlers.polygon.tooltip = drawLocal.draw.handlers.polygon.tooltip || {};
    drawLocal.draw.handlers.rectangle = drawLocal.draw.handlers.rectangle || {};
    drawLocal.draw.handlers.rectangle.tooltip = drawLocal.draw.handlers.rectangle.tooltip || {};

    drawLocal.draw.toolbar.buttons.polygon = t('orders.drawPolygon') || 'Draw Polygon';
    drawLocal.draw.toolbar.buttons.rectangle = t('orders.drawRectangle') || 'Draw Rectangle';
    drawLocal.draw.handlers.polygon.tooltip.start = t('drawingHelpers.polygonStart') || 'Click to start drawing shape';
    drawLocal.draw.handlers.polygon.tooltip.cont = t('drawingHelpers.polygonContinue') || 'Click to continue drawing shape';
    drawLocal.draw.handlers.polygon.tooltip.end = t('drawingHelpers.polygonEnd') || 'Click first point to close this shape';
    drawLocal.draw.handlers.rectangle.tooltip.start = t('drawingHelpers.rectangleStart') || 'Click and drag to draw rectangle';
  }, [language, t]);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const clearPopupHideTimer = useCallback(() => {
    if (popupHideTimerRef.current) {
      clearTimeout(popupHideTimerRef.current);
      popupHideTimerRef.current = null;
    }
  }, []);

  const getMousePosition = useCallback((event: any) => {
    const rect = mapContainerRef.current?.getBoundingClientRect();
    const clientX = event?.originalEvent?.clientX ?? event?.clientX;
    const clientY = event?.originalEvent?.clientY ?? event?.clientY;
    if (!rect || clientX == null || clientY == null) return null;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }, []);

  const handleFieldClick = useCallback((event: any, fieldId: number | string, source: 'uploaded' | 'drawn') => {
    if (drawingMode === 'polygon' || drawingMode === 'rectangle') {
      if (activeDrawHandlerRef.current?._enabled) {
        activeDrawHandlerRef.current.disable();
      }
    }
    const position = getMousePosition(event);
    const multiSelect = Boolean(event?.originalEvent?.ctrlKey || event?.originalEvent?.metaKey || event?.ctrlKey || event?.metaKey);
    suppressNextMapClickRef.current = true;
    onFieldClick?.(fieldId, source, multiSelect);
    selectedFieldRef.current = { fieldId, source };
    if (multiSelect) {
      setHoverEditPopup(null);
      return;
    }
    if (position) {
      setHoverEditPopup({ fieldId, source, ...position });
    } else {
      setHoverEditPopup(null);
    }
  }, [drawingMode, getMousePosition, onFieldClick]);

  const handleMapClick = useCallback(() => {
    if (suppressNextMapClickRef.current) {
      suppressNextMapClickRef.current = false;
      return;
    }
    setHoverEditPopup(null);
    selectedFieldRef.current = null;
    onMapClick?.();
  }, [onMapClick]);

  const MapClickHandler = memo(function MapClickHandler() {
    useMapEvents({
      click: handleMapClick
    });
    return null;
  });

  const scheduleHoverPopup = useCallback((event: any, fieldId: number | string, source: 'uploaded' | 'drawn') => {
    const position = getMousePosition(event);
    if (!position) return;

    const isSameActive = hoverEditPopup
      && hoverEditPopup.fieldId === fieldId
      && hoverEditPopup.source === source;

    const isSamePending = hoverPendingRef.current
      && hoverPendingRef.current.fieldId === fieldId
      && hoverPendingRef.current.source === source;

    if (isSameActive) {
      return;
    }

    if (isSamePending) {
      hoverPendingRef.current = { fieldId, source, ...position };
      return;
    }

    hoverPendingRef.current = { fieldId, source, ...position };
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      if (!hoverPendingRef.current) return;
      setHoverEditPopup({ ...hoverPendingRef.current });
    }, 1000);
  }, [clearHoverTimer, getMousePosition, hoverEditPopup]);

  const handleFieldMouseOut = useCallback(() => {
    clearHoverTimer();
    hoverPendingRef.current = null;
    if (hoverPopupActiveRef.current) {
      hideOnPopupLeaveRef.current = true;
      return;
    }
    clearPopupHideTimer();
    popupHideTimerRef.current = setTimeout(() => {
      if (!hoverPopupActiveRef.current) {
        setHoverEditPopup(null);
      }
    }, 150);
  }, [clearHoverTimer, clearPopupHideTimer]);

  useEffect(() => () => {
    clearHoverTimer();
    clearPopupHideTimer();
  }, [clearHoverTimer, clearPopupHideTimer]);

  useEffect(() => {
    if (!hoverEditPopup) return;
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (hoverPopupRef.current && target && hoverPopupRef.current.contains(target)) {
        return;
      }
      setHoverEditPopup(null);
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [hoverEditPopup]);

  useEffect(() => {
    if (!disableHoverEditPopup) return;
    clearHoverTimer();
    hoverPendingRef.current = null;
    setHoverEditPopup(null);
  }, [disableHoverEditPopup, clearHoverTimer]);

  const startDrawingHandler = useCallback(() => {
    if (!mapRef.current) return;
    if (drawingMode !== 'polygon' && drawingMode !== 'rectangle') return;
    if (activeDrawHandlerRef.current?._enabled) return;
    if (activeDrawHandlerRef.current) {
      activeDrawHandlerRef.current.disable();
    }
    const shapeOptions = {
      color: '#3B82F6',
      fillColor: '#3B82F6',
      fillOpacity: 0.2,
      weight: 2
    };
    const handler = drawingMode === 'polygon'
      ? new (L.Draw as any).Polygon(mapRef.current, { shapeOptions, showArea: false, repeatMode: false })
      : new (L.Draw as any).Rectangle(mapRef.current, { shapeOptions, showArea: false, repeatMode: false });
    handler.enable();
    activeDrawHandlerRef.current = handler;
  }, [drawingMode]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (activeDrawHandlerRef.current) {
      activeDrawHandlerRef.current.disable();
      activeDrawHandlerRef.current = null;
    }
    startDrawingHandler();
    return () => {
      if (activeDrawHandlerRef.current) {
        activeDrawHandlerRef.current.disable();
        activeDrawHandlerRef.current = null;
      }
    };
  }, [drawingMode, startDrawingHandler]);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    if (drawingMode !== 'polygon' && drawingMode !== 'rectangle') {
      setDrawingHint(null);
      return;
    }

    const resolveHintText = () => {
      if (drawingMode === 'rectangle') {
        return t('drawingHelpers.rectangleStart');
      }
      const handler = activeDrawHandlerRef.current;
      const points = handler?._markers?.length ?? 0;
      if (points <= 0) return t('drawingHelpers.polygonStart');
      if (points === 1) return t('drawingHelpers.polygonContinue');
      return t('drawingHelpers.polygonEnd');
    };

    const handleMove = (event: any) => {
      const position = getMousePosition(event);
      if (!position) return;
      setDrawingHint({
        x: position.x + 12,
        y: position.y + 12,
        text: resolveHintText()
      });
    };

    const handleOut = () => {
      setDrawingHint(null);
    };

    map.on('mousemove', handleMove);
    map.on('mouseout', handleOut);
    return () => {
      map.off('mousemove', handleMove);
      map.off('mouseout', handleOut);
    };
  }, [drawingMode, getMousePosition, t]);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    if (drawingMode !== 'polygon' && drawingMode !== 'rectangle') return;

    const handleMouseDown = (event: any) => {
      if (activeDrawHandlerRef.current?._enabled) return;
      const target = event?.originalEvent?.target as HTMLElement | null;
      if (target?.closest?.('.leaflet-interactive')) return;
      startDrawingHandler();
    };

    map.on('mousedown', handleMouseDown);
    return () => {
      map.off('mousedown', handleMouseDown);
    };
  }, [drawingMode, startDrawingHandler]);

  const ensureInactivePattern = useCallback(() => {
    const svgContainer = (fieldSvgRenderer as any)?._container as SVGSVGElement | undefined;
    if (!svgContainer) return false;
    const svgNs = 'http://www.w3.org/2000/svg';
    let defs = svgContainer.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS(svgNs, 'defs');
      svgContainer.insertBefore(defs, svgContainer.firstChild);
    }

    if (!defs.querySelector(`#${inactivePatternId}`)) {
      const pattern = document.createElementNS(svgNs, 'pattern');
      pattern.setAttribute('id', inactivePatternId);
      pattern.setAttribute('patternUnits', 'userSpaceOnUse');
      pattern.setAttribute('width', '8');
      pattern.setAttribute('height', '8');
      pattern.setAttribute('patternTransform', 'rotate(45)');

      const line = document.createElementNS(svgNs, 'line');
      line.setAttribute('x1', '0');
      line.setAttribute('y1', '0');
      line.setAttribute('x2', '0');
      line.setAttribute('y2', '8');
      line.setAttribute('stroke', '#94A3B8');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('opacity', '0.6');

      pattern.appendChild(line);
      defs.appendChild(pattern);
    }

    if (!document.getElementById('inactive-field-hatch-style')) {
      const style = document.createElement('style');
      style.id = 'inactive-field-hatch-style';
      style.textContent = `
        .leaflet-pane .field-hatch {
          fill: url(#${inactivePatternId});
          fill-opacity: 0.25;
        }
      `;
      document.head.appendChild(style);
    }

    return true;
  }, [fieldSvgRenderer]);

  useEffect(() => {
    if (!mapRef.current) return;
    let cancelled = false;

    const tryInject = () => {
      if (cancelled || hasInjectedPatternRef.current) return;
      if (ensureInactivePattern()) {
        hasInjectedPatternRef.current = true;
        return;
      }
      setTimeout(tryInject, 200);
    };

    tryInject();
    return () => {
      cancelled = true;
    };
  }, [ensureInactivePattern]);

  useEffect(() => {
    if (!featureGroupRef.current || !onDrawingEdited) return;

    const handleLayerEdit = (event: any) => {
      const layer = event?.target;
      const geojson = layer?.toGeoJSON?.();
      const drawnId = geojson?.properties?.__drawnId;
      if (drawnId) {
        onDrawingEdited({ id: drawnId, geometry: geojson.geometry });
      }
    };

    featureGroupRef.current.eachLayer((layer: any) => {
      if (layer?.eachLayer) {
        layer.eachLayer((child: any) => {
          child.off?.('edit', handleLayerEdit);
          child.on?.('edit', handleLayerEdit);
        });
      } else {
        layer.off?.('edit', handleLayerEdit);
        layer.on?.('edit', handleLayerEdit);
      }
    });

    return () => {
      featureGroupRef.current?.eachLayer((layer: any) => {
        if (layer?.eachLayer) {
          layer.eachLayer((child: any) => child.off?.('edit', handleLayerEdit));
        } else {
          layer.off?.('edit', handleLayerEdit);
        }
      });
    };
  }, [drawnFields, onDrawingEdited]);
  
  // Advanced offline detection - checks both navigator.onLine and actual internet connectivity
  const [hasInternetAccess, setHasInternetAccess] = useState(navigator.onLine);
  const isOffline = !hasInternetAccess;
  const prefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPrefetchCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const [showOfflinePrompt, setShowOfflinePrompt] = useState(false);
  const [offlinePromptDismissed, setOfflinePromptDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('offlineMapPromptDismissed') === 'true';
  });
  const [isDownloadingOffline, setIsDownloadingOffline] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [selectedPackId, setSelectedPackId] = useState<string>(() => getDefaultPack().id);
  const [userSelectedPack, setUserSelectedPack] = useState(false);

  const handleDismissOfflinePrompt = useCallback(() => {
    setShowOfflinePrompt(false);
    setOfflinePromptDismissed(true);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('offlineMapPromptDismissed', 'true');
    }
  }, []);

  // Helpers for tile math
  const latLngToTile = useCallback((lat: number, lng: number, zoom: number) => {
    const latRad = (lat * Math.PI) / 180;
    const n = 2 ** zoom;
    const x = Math.floor(((lng + 180) / 360) * n);
    const y = Math.floor(
      (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
    );
    return { x, y };
  }, []);

  const buildPrefetchList = useCallback(
    (center: L.LatLngExpression, template: string, zooms: number[]) => {
      const [lat, lng] = Array.isArray(center)
        ? center
        : [center.lat as number, center.lng as number];

      const PREFETCH_RADIUS_KM = 1; // ~1km radius around center
      const PREFETCH_ZOOMS = zooms.length ? zooms : [12, 13, 14, 15, 16, 17, 18];
      const PREFETCH_MAX = 1200; // hard cap to respect provider usage

      const latRad = (lat * Math.PI) / 180;
      const dLat = PREFETCH_RADIUS_KM / 110.574;
      const dLng = PREFETCH_RADIUS_KM / (111.320 * Math.cos(latRad));

      const latMin = lat - dLat;
      const latMax = lat + dLat;
      const lngMin = lng - dLng;
      const lngMax = lng + dLng;

      const urls: string[] = [];
      const seen = new Set<string>();

      for (const z of PREFETCH_ZOOMS) {
        const { x: xMin, y: yMax } = latLngToTile(latMin, lngMin, z);
        const { x: xMax, y: yMin } = latLngToTile(latMax, lngMax, z);

        for (let x = Math.min(xMin, xMax); x <= Math.max(xMin, xMax); x++) {
          for (let y = Math.min(yMin, yMax); y <= Math.max(yMin, yMax); y++) {
            const url = template
              .replace('{z}', String(z))
              .replace('{x}', String(x))
              .replace('{y}', String(y));
            if (!seen.has(url)) {
              seen.add(url);
              urls.push(url);
              if (urls.length >= PREFETCH_MAX) {
                return urls;
              }
            }
          }
        }
      }
      return urls;
    },
    [latLngToTile]
  );

  const prefetchTiles = useCallback(async (center: L.LatLngExpression, template: string, zooms: number[]) => {
    const urls = buildPrefetchList(center, template, zooms);
    if (urls.length === 0) return;

    const CONCURRENCY = 4;
    const DELAY_MS = 75;
    let index = 0;

    const worker = async () => {
      while (index < urls.length) {
        const url = urls[index++];
        try {
          await fetch(url, { cache: 'force-cache' });
        } catch (err) {
          console.warn(t('orders.map.logs.prefetchTileFailed'), err);
        }
        await new Promise(res => setTimeout(res, DELAY_MS));
      }
    };

    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);
  }, [buildPrefetchList]);

  // Calculate bounds and offline tile availability before using in callbacks
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
  const isOnline = !isOffline;
  const isNative = Capacitor.isNativePlatform();
  const forceOfflineTiles = !offlineTilesDisabled && isNative && offlineTilesReady && !onlineTileUrl;
  const needsOfflineDownload = false;
  const preferRasterOnNative = !offlineTilesDisabled && isNative && offlineRasterAvailable && !offlinePmtilesUri;
  const activePackName = activePack.name;
  const hasDownloadUrl = !!activePack.downloadUrl;
  const canDownloadOffline = hasDownloadUrl && isOnline;

  const getActiveTileTemplate = useCallback((): string | null => {
    // If we are inside offline bounds but still probing, don't prefetch online tiles
    if (isWithinOfflineBounds && !tileProbeComplete) return null;

    // Prefer offline tiles within bounds
    if (shouldUseOfflineTiles) {
      if (preferRasterOnNative && offlineRasterAvailable) return '/tiles/germany/{z}/{x}/{y}.png';
      if (offlinePmtilesUri) return null; // PMTiles handled by vector layer
      if (offlineRasterAvailable) return '/tiles/germany/{z}/{x}/{y}.png';
      return null;
    }

    // If offline and outside bounds, no prefetch
    if (isOffline) return null;

    // Satellite (online only) when outside offline bounds
    if (useSatellite) return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

    // Street map (self-hosted preferred, fallback to OSM online)
    if (Capacitor.isNativePlatform() && !onlineTileUrl) return null;
    return onlineTileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  }, [offlinePmtilesUri, offlineRasterAvailable, isOffline, useSatellite, onlineTileUrl, shouldUseOfflineTiles, isWithinOfflineBounds, tileProbeComplete, preferRasterOnNative]);

  // Auto prefetch tiles around current view (1km radius, zooms 12-18)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const template = getActiveTileTemplate();
    if (!template) return;

    const schedule = () => {
      if (prefetchTimeoutRef.current) clearTimeout(prefetchTimeoutRef.current);
      prefetchTimeoutRef.current = setTimeout(async () => {
        const center = map.getCenter();

        // Avoid re-prefetching the same area repeatedly
        const last = lastPrefetchCenterRef.current;
        const distanceKm = (() => {
          if (!last) return Infinity;
          const dLat = center.lat - last.lat;
          const dLng = center.lng - last.lng;
          const meanLat = (center.lat + last.lat) / 2;
          const kmPerDegLat = 110.574;
          const kmPerDegLng = 111.320 * Math.cos((meanLat * Math.PI) / 180);
          return Math.sqrt((dLat * kmPerDegLat) ** 2 + (dLng * kmPerDegLng) ** 2);
        })();

        // Only prefetch if moved >150m to reduce duplicate fetches
        if (distanceKm < 0.15) return;

        lastPrefetchCenterRef.current = { lat: center.lat, lng: center.lng };
        const zoom = map.getZoom();
        const zoomCandidates = [
          Math.round(zoom),
          Math.round(zoom - 2),
          Math.round(zoom + 2),
          Math.round(zoom - 10),
          Math.round(zoom + 10),
        ];
        const zooms = Array.from(new Set(zoomCandidates))
          .filter((z) => Number.isFinite(z))
          .map((z) => Math.min(19, Math.max(1, z)));
        prefetchTiles(center, template, zooms);
      }, 800); // debounce
    };

    map.on('moveend', schedule);
    map.on('zoomend', schedule);

    // initial prefetch
    schedule();

    return () => {
      map.off('moveend', schedule);
      map.off('zoomend', schedule);
      if (prefetchTimeoutRef.current) clearTimeout(prefetchTimeoutRef.current);
    };
  }, [getActiveTileTemplate, prefetchTiles]);

  // Zoom change handler
  const handleZoomChange = useCallback((zoom: number) => {
    setCurrentZoom(zoom);
  }, []);

  // Memoize unique field boundaries to avoid recalculation on every render
  const uniqueFieldBoundaries = useMemo(() => {
    const seen = new Set<string>();
    return fieldBoundaries.filter(boundary => {
      if (!boundary) return false;
      const id = String(boundary.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [fieldBoundaries]);

  // Show tracks logic: if a field is selected, show only that field's tracks
  const tracksForSelectedField = useMemo(() => {
    if (focusedBoundaryId) {
      return tracks.filter(t => t && t.field_boundary_id != null && String(t.field_boundary_id) === String(focusedBoundaryId));
    }

    // No field selected: show all tracks
    return tracks;
  }, [tracks, focusedBoundaryId]);

  // Viewport-based filtering for visible tracks
  const viewportFilteredTracks = useMemo(() => {
    if (focusedBoundaryId) return tracksForSelectedField;
    if (!mapRef.current) return tracksForSelectedField;

    const bounds = mapRef.current.getBounds();
    return tracksForSelectedField.filter(track => {
      if (!track) return false;
      const gpsPoints = track.gps_points || [];
      const samples = track.samples || [];
      if (gpsPoints.length === 0 && samples.length === 0) return false;

      const latLngs: [number, number][] = [];
      gpsPoints.forEach(p => latLngs.push([p.latitude, p.longitude]));
      samples.forEach(s => latLngs.push([s.latitude, s.longitude]));
      if (latLngs.length === 0) return false;

      const trackBounds = L.latLngBounds(latLngs);
      return bounds.intersects(trackBounds);
    });
  }, [tracksForSelectedField, currentZoom, focusedBoundaryId]);

  // Runtime probe for Germany offline tiles to avoid assuming they exist when missing
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
        const contentType = res.headers.get('content-type');
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
        const contentType = res.headers.get('content-type');
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
        setGermanyTilesAvailable(false);
        setOfflineRasterAvailable(false);
        setOfflinePmtilesUri(null);
        console.warn(t('orders.map.logs.offlineProbeFailed'), err);
      } finally {
        if (!cancelled) {
          setTileProbeComplete(true);
        }
      }
    };
    probe();
    return () => { cancelled = true; };
  }, [tileProbeCounter, offlinePmtilesUrl, activePack]);

  useEffect(() => {
    if (isNative) {
      setShowOfflinePrompt(needsOfflineDownload);
      return;
    }
    if (offlinePromptDismissed) {
      setShowOfflinePrompt(false);
      return;
    }
    setShowOfflinePrompt(needsOfflineDownload);
  }, [needsOfflineDownload, offlinePromptDismissed, isNative]);

  useEffect(() => {
    if (!isNative) return;
    if (offlineTilesReady) return;
    const timeoutId = window.setTimeout(() => {
      setShowOfflinePrompt(true);
    }, 3500);
    return () => window.clearTimeout(timeoutId);
  }, [isNative, offlineTilesReady]);

  const handleDownloadOfflineMaps = useCallback(async () => {
    if (isDownloadingOffline) return;
    if (!Capacitor.isNativePlatform()) {
      setDownloadProgress({
        current: 0,
        total: 0,
        percentage: 0,
        status: 'error',
        message: t('gps.offlinePrompt.webOnly')
      });
      return;
    }
    if (!isOnline) {
      setDownloadProgress({
        current: 0,
        total: 0,
        percentage: 0,
        status: 'error',
        message: t('gps.offlinePrompt.noInternet')
      });
      return;
    }
    if (!activePack.downloadUrl) {
      setDownloadProgress({
        current: 0,
        total: 0,
        percentage: 0,
        status: 'error',
        message: t('gps.offlinePrompt.unavailable')
      });
      return;
    }
    setIsDownloadingOffline(true);
    setDownloadProgress({ current: 0, total: 100, percentage: 0, status: 'downloading', message: t('orders.offlineDownloadStarting') });
    const ok = await tileDownloader.downloadTilePackage((progress) => {
      setDownloadProgress(progress);
    }, activePack);
    setIsDownloadingOffline(false);
    if (ok) {
      setTileProbeCounter((v) => v + 1);
      setShowOfflinePrompt(false);
    }
  }, [isDownloadingOffline, t, activePack]);
  
  // Check if we actually have internet access (not just WiFi connection)
  useEffect(() => {
    const checkInternetConnectivity = async () => {
      if (!navigator.onLine) {
        setHasInternetAccess(false);
        return;
      }
      
      // If navigator says we're online, verify we can actually reach the internet
      try {
        // Try to fetch connectivity check with a short timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
        
        const response = await fetch(
          'https://cloudflare.com/cdn-cgi/trace',
          { 
            method: 'GET',
            signal: controller.signal,
            cache: 'no-cache'
          }
        );
        clearTimeout(timeoutId);
        
        const onlineResult = response.ok;
        setHasInternetAccess(onlineResult);
      } catch (error) {
        setHasInternetAccess(navigator.onLine);
      }
    };
    
    // Check immediately
    checkInternetConnectivity();
    
    // Re-check when online status changes
    const handleOnline = () => {
      console.log(t('orders.map.logs.networkOnlineVerifying'));
      checkInternetConnectivity();
      setTileProbeCounter(c => c + 1);
    };
    const handleOffline = () => {
      console.log(t('orders.map.logs.networkOffline'));
      setHasInternetAccess(false);
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Periodic re-check every 30 seconds
    const intervalId = setInterval(checkInternetConnectivity, 30000);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(intervalId);
    };
  }, []);

  // Force map rerender and retry tiles on connectivity change
  useEffect(() => {
    setMapKey(k => k + 1);
    if (hasInternetAccess) {
      setTileProbeCounter(c => c + 1);
      setTimeout(() => mapRef.current?.invalidateSize?.(), 150);
    }
  }, [hasInternetAccess]);
  const forceOffline = isOffline;
  const [showLabels, setShowLabels] = useState(true); // Show labels on satellite
  const [mapKey, setMapKey] = useState(0); // Force map refresh on network change
  const formatScaleLabel = useCallback((meters: number) => {
    if (meters >= 1000) {
      const kmValue = (meters / 1000).toFixed(meters >= 10000 ? 0 : 1);
      return t('orders.scaleKilometers', { value: kmValue }) || `${kmValue} km`;
    }
    const mValue = Math.round(meters);
    return t('orders.scaleMeters', { value: mValue }) || `${mValue} m`;
  }, [t]);

  const [scaleInfo, setScaleInfo] = useState<{ label: string; width: number }>({
    label: t('orders.scaleDefaultLabel'),
    width: 80,
  });
  const [isTileLoading, setIsTileLoading] = useState(false);
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceSearchResult[]>([]);
  const [isSearchingPlace, setIsSearchingPlace] = useState(false);
  const [placeSearchError, setPlaceSearchError] = useState<string | null>(null);
  const [showPlaceResults, setShowPlaceResults] = useState(false);
  const pmtilesVersion = import.meta.env.VITE_PMTILES_VERSION || '20260122';

  const centerOnCurrentLocation = () => {
    if (currentPosition && mapRef.current) {
      mapRef.current.setView([currentPosition.latitude, currentPosition.longitude], 19); // Zoom 19 = ~2.5m per pixel
    }
  };

  const DEFAULT_CENTER: [number, number] = [49.6116, 6.1319]; // Luxembourg

  // Handle external recenter trigger
  useEffect(() => {
    if (recenterTrigger && recenterTrigger > 0) {
      centerOnCurrentLocation();
    }
  }, [recenterTrigger]);

  const runPlaceSearch = useCallback(async () => {
    const query = placeQuery.trim();
    if (!query) {
      setPlaceResults([]);
      setShowPlaceResults(false);
      setPlaceSearchError(null);
      return;
    }

    if (isOffline) {
      setPlaceSearchError(t('orders.mapMode.offlineDisabled'));
      setShowPlaceResults(true);
      return;
    }

    setIsSearchingPlace(true);
    setPlaceSearchError(null);

    try {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('q', query);
      url.searchParams.set('limit', '6');
      url.searchParams.set('addressdetails', '0');
      url.searchParams.set('polygon_geojson', '0');

      const response = await fetch(url.toString(), {
        headers: {
          'Accept-Language': i18n.language || 'en'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const results: PlaceSearchResult[] = Array.isArray(data)
        ? data
            .map((item: any) => ({
              displayName: String(item.display_name || ''),
              lat: Number(item.lat),
              lon: Number(item.lon),
              boundingbox: Array.isArray(item.boundingbox) ? item.boundingbox : undefined
            }))
            .filter((item: PlaceSearchResult) => item.displayName && Number.isFinite(item.lat) && Number.isFinite(item.lon))
        : [];

      setPlaceResults(results);
      setShowPlaceResults(true);
      if (!results.length) {
        setPlaceSearchError(t('orders.noContracts'));
      }
    } catch (error) {
      console.warn('[OrdersMapView] Place search failed:', error);
      setPlaceResults([]);
      setShowPlaceResults(true);
      setPlaceSearchError(t('orders.loadContractsFailed'));
    } finally {
      setIsSearchingPlace(false);
    }
  }, [placeQuery, isOffline, t]);

  const focusPlaceResult = useCallback((result: PlaceSearchResult) => {
    const map = mapRef.current;
    if (!map) return;

    setPlaceQuery(result.displayName);
    setShowPlaceResults(false);
    setPlaceSearchError(null);

    const bbox = result.boundingbox;
    if (bbox && bbox.length === 4) {
      const south = Number(bbox[0]);
      const north = Number(bbox[1]);
      const west = Number(bbox[2]);
      const east = Number(bbox[3]);
      if ([south, north, west, east].every(Number.isFinite)) {
        map.fitBounds([
          [south, west],
          [north, east]
        ], {
          padding: [40, 40],
          maxZoom: 14
        });
        return;
      }
    }

    map.flyTo([result.lat, result.lon], Math.max(map.getZoom(), 13), {
      duration: 0.8
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MAP_MODE_STORAGE_KEY, mapMode);
    window.dispatchEvent(new CustomEvent('orders-map-mode-changed', { detail: { mode: mapMode } }));
  }, [mapMode]);

  // Restrict zoom only when we actually use offline Germany tiles
  const usingOfflineGermanyTiles = shouldUseOfflineTiles && !useSatellite && !useOSM;
  const effectiveInitialZoom = usingOfflineGermanyTiles ? 13 : 18;

  return (
    <div className="w-full h-full relative" ref={mapContainerRef}>
      <MapContainer
        key={mapKey}
        center={currentPosition ? [currentPosition.latitude, currentPosition.longitude] : DEFAULT_CENTER}
        zoom={effectiveInitialZoom}
        maxZoom={19}
        zoomSnap={0}
        zoomDelta={10}
        zoomControl={false}
        attributionControl={false}
        className={`w-full h-full orders-map-canvas ${shouldUseOfflineTiles ? 'pmtiles-active' : ''}`}
        ref={mapRef}
        zoomAnimation={false}
        fadeAnimation={false}
        markerZoomAnimation={false}
        preferCanvas={true}
        renderer={canvasRenderer}
      >
        <MapClickHandler />
        <MapScaleUpdater onScaleChange={setScaleInfo} formatLabel={formatScaleLabel} />
        <FieldVectorPaneSetup />
        <TileLoadingTracker onLoadingChange={setIsTileLoading} />
        {/* Tile Layer - Street Map or Satellite */}
        {(() => {

          if (useOSM && !isOffline) {
            return (
              <TileLayer
                key="osm-map"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                maxZoom={19}
                attribution={t('orders.mapAttribution.osm')}
                crossOrigin="anonymous"
                tileSize={256}
                keepBuffer={12}
                updateWhenIdle={false}
                updateWhenZooming={false}
              />
            );
          }
          
          if ((shouldUseOfflineTiles || forceOfflineTiles) && preferRasterOnNative && offlineRasterAvailable && !useSatellite) {
            return (
              <TileLayer
                key="germany-offline-raster-preferred"
                url="/tiles/germany/{z}/{x}/{y}.png"
                minZoom={1}
                maxZoom={18}
                maxNativeZoom={12}
                attribution={t('orders.mapAttribution.offlineGermany')}
                errorTileUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
                crossOrigin="anonymous"
                keepBuffer={12}
                updateWhenIdle={false}
                updateWhenZooming={false}
              />
            );
          }

          // Prefer offline tiles within bounds (online/offline)
          if ((shouldUseOfflineTiles || forceOfflineTiles) && offlinePmtilesUri && !useSatellite) {
            return (
              <PMTilesVectorLayer
                pmtilesUrl={offlinePmtilesUri}
                maxZoom={19}
                maxDataZoom={15}
                attribution={t('orders.mapAttribution.offlinePmtiles')}
                theme={Capacitor.isNativePlatform() && isDarkMode ? 'dark' : 'light'}
                schema="openmaptiles"
              />
            );
          }

          if ((shouldUseOfflineTiles || forceOfflineTiles) && offlineRasterAvailable && !useSatellite) {
            return (
              <TileLayer
                key="germany-offline-raster"
                url="/tiles/germany/{z}/{x}/{y}.png"
                minZoom={1}
                maxZoom={18}
                maxNativeZoom={12}
                attribution={t('orders.mapAttribution.offlineGermany')}
                errorTileUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
                crossOrigin="anonymous"
                keepBuffer={12}
                updateWhenIdle={false}
                updateWhenZooming={false}
              />
            );
          }
          
          // Offline mode: always show blank to prevent OSM external requests
          if (isOffline) {
            return (
              <TileLayer
                key="offline-blank"
                url={BLANK_TILE_URL}
                minZoom={1}
                maxZoom={18}
                maxNativeZoom={18}
                attribution={t('orders.mapAttribution.offlineFallback')}
                tileSize={256}
              />
            );
          }
          
          // Still probing for offline tiles: show blank to avoid premature OSM calls
          if (!tileProbeComplete && (isWithinOfflineBounds || forceOfflineTiles)) {
            console.log(t('orders.map.logs.probingTiles'));
            return (
              <TileLayer
                key="probe-blank"
                url={BLANK_TILE_URL}
                minZoom={1}
                maxZoom={18}
                maxNativeZoom={18}
                tileSize={256}
              />
            );
          }

          // Satellite view (online only)
          if (useSatellite) {
            return (
              <>
                <TileLayer
                  key="esri-satellite"
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  maxZoom={20}
                    keepBuffer={12}
                    updateWhenIdle={false}
                  updateWhenZooming={false}
                  attribution={t('orders.mapAttribution.esri')}
                />
                {showLabels && (
                  <TileLayer
                    key="esri-labels"
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                    maxZoom={20}
                    opacity={0.7}
                      keepBuffer={12}
                      updateWhenIdle={false}
                    updateWhenZooming={false}
                    attribution={t('orders.mapAttribution.esri')}
                  />
                )}
              </>
            );
          }

          // Street map (self-hosted preferred, fallback to OSM online)
          const rasterFallback = germanyTilesAvailable ? '/tiles/germany/{z}/{x}/{y}.png' : null;
          const baseOnlineUrl = onlineTileUrl || rasterFallback || null;

          if (!baseOnlineUrl) {
            console.warn(t('orders.map.logs.noOnlineTiles'));
            return (
              <TileLayer
                key="street-map-blank"
                url={BLANK_TILE_URL}
                minZoom={1}
                maxZoom={18}
                maxNativeZoom={18}
                attribution={t('orders.mapAttribution.onlineUnavailable')}
                tileSize={256}
              />
            );
          }

          return (
            <TileLayer
              key="street-map"
              url={baseOnlineUrl}
              maxZoom={19}
              maxNativeZoom={19}
              attribution={onlineTileUrl || rasterFallback ? (t('orders.mapAttribution.selfHosted')) : (t('orders.mapAttribution.osm'))}
              crossOrigin="anonymous"
              tileSize={256}
                keepBuffer={12}
                updateWhenIdle={false}
              updateWhenZooming={false}
            />
          );
        })()}
        <ZoomTracker onZoomChange={handleZoomChange} />
        <MapController
          currentPosition={currentPosition}
          fieldBoundaries={uniqueFieldBoundaries}
          focusedBoundaryId={focusedBoundaryId}
          focusedDrawnFieldId={focusedDrawnFieldId}
          drawnFields={drawnFields}
          focusedTrackId={focusedTrackId}
          tracks={tracks}
          isTracking={isTracking}
          disableSelectionFocus={disableSelectionFocus}
          snapState={snapState}
        />

        {/* Drawing Controls - FeatureGroup for drawn shapes - always render but control what's enabled */}
        <FeatureGroup ref={featureGroupRef}>
          <EditControl
            key={drawingMode || 'default'}
            position="bottomright"
            onCreated={(e: any) => {
              const { layer, layerType } = e;
              if (layerType === 'polygon' || layerType === 'rectangle') {
                const drawnId = makeDrawnId();
                (layer as any).feature = {
                  type: 'Feature',
                  properties: { __drawnId: drawnId }
                };
                const geojson = layer.toGeoJSON();
                onDrawingComplete?.({ id: drawnId, geometry: geojson.geometry });
                if (featureGroupRef.current && featureGroupRef.current.hasLayer(layer)) {
                  featureGroupRef.current.removeLayer(layer);
                }
              }
            }}
            onEdited={(e: any) => {
              const layers = e.layers;
              layers.eachLayer((layer: any) => {
                const geojson = layer.toGeoJSON();
                const drawnId = geojson?.properties?.__drawnId;
                if (drawnId) {
                  onDrawingEdited?.({ id: drawnId, geometry: geojson.geometry });
                }
              });
            }}
            onDeleted={(e: any) => {
              const removedIds: string[] = [];
              const layers = e.layers;
              layers.eachLayer((layer: any) => {
                const geojson = layer.toGeoJSON?.();
                const drawnId = geojson?.properties?.__drawnId;
                if (drawnId) removedIds.push(drawnId);
              });
              if (removedIds.length) {
                onDrawingDeleted?.(removedIds);
              }
            }}
            draw={{
              rectangle: drawingMode === 'rectangle',
              polygon: drawingMode === 'polygon',
              circle: false,
              circlemarker: false,
              marker: false,
              polyline: false
            }}
            edit={{
              edit: drawingMode === 'edit',
              remove: false
            }}
          />
          {drawnFields.map((field) => {
            // Convert GeoJSON geometry to Leaflet positions
            const geometry = field.geometry;
            if (geometry.type === 'Polygon') {
              const coordinates = geometry.coordinates[0]; // First ring (exterior)
              const positions = coordinates.map(coord => [coord[1], coord[0]] as [number, number]);
              
              // Calculate centroid for label
              const centroid = calculateCentroid(geometry.coordinates as number[][][]);
              
              // Create label icon using field data or stored metadata
              const fieldName = field.baseName ?? fieldMetadataRef.current[field.id]?.baseName ?? '';
              const fieldId = field.baseId ?? fieldMetadataRef.current[field.id]?.baseId ?? '';
              
              // Format label - prefer name, fall back to ID
              let labelText = 'Field';
              if (fieldName) {
                labelText = fieldName;
              } else if (fieldId) {
                labelText = fieldId;
              }
              
              const labelIcon = centroid ? L.divIcon({
                className: 'field-label',
                html: `<div style="
                  position: absolute;
                  left: 0;
                  top: 0;
                  font-weight: bold;
                  font-size: 16px;
                  color: #000000;
                  text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff, 0 0 4px #fff;
                  white-space: nowrap;
                  pointer-events: none;
                  transform: translate(-50%, -50%);
                ">${labelText}</div>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0],
              }) : null;
              
              return (
                <div key={`${field.id}-${field.geometry.coordinates[0]?.length || 0}`}>
                  <Polygon
                    positions={positions}
                    pathOptions={{
                      color: selectedDrawnSet.has(String(field.id)) ? '#2563EB' : (field.color ?? '#3B82F6'),
                      fillColor: field.color ?? '#3B82F6',
                      fillOpacity: selectedDrawnSet.has(String(field.id)) ? 0.3 : 0.2,
                      weight: selectedDrawnSet.has(String(field.id)) ? 4 : 2
                    }}
                    pane="field-vectors"
                    renderer={fieldSvgRenderer}
                    eventHandlers={{
                      click: (event) => handleFieldClick(event, field.id, 'drawn'),
                      add: (e: any) => {
                        // Store field metadata for later reference
                        fieldMetadataRef.current[field.id] = {
                          baseName: field.baseName,
                          baseId: field.baseId,
                          color: field.color,
                          areaHa: field.areaHa
                        };
                        
                        // Store the field metadata in the layer's feature property
                        const layer = e.target;
                        if (layer) {
                          layer.feature = {
                            type: 'Feature',
                            properties: { 
                              __drawnId: field.id,
                              baseName: field.baseName,
                              baseId: field.baseId,
                              color: field.color,
                              areaHa: field.areaHa
                            },
                            geometry: field.geometry
                          };
                        }
                      }
                    }}
                  />
                  {/* Field name label at centroid */}
                  {centroid && labelIcon && (
                    <Marker
                      position={centroid}
                      icon={labelIcon}
                    />
                  )}
                </div>
              );
            }
            return null;
          })}
        </FeatureGroup>

        {/* Current position marker with accuracy circle */}
        {currentPosition && (
          <>
            {/* Accuracy circle - shows GPS precision (divided by 2 for more realistic display) */}
            <Circle
              center={[currentPosition.latitude, currentPosition.longitude]}
              radius={currentPosition.accuracy ? currentPosition.accuracy / 2 : 5}
              pathOptions={{
                color: '#3b82f6',
                fillColor: '#3b82f6',
                fillOpacity: 0.1,
                weight: 2,
              }}
            />
            {drawingHint && (
              <div
                className="absolute z-[4500] pointer-events-none px-2 py-1 rounded-md text-xs font-semibold shadow-lg border border-gray-200/70 dark:border-gray-700/70 bg-white/90 dark:bg-gray-900/90 text-gray-700 dark:text-gray-200"
                style={{ left: drawingHint.x, top: drawingHint.y }}
              >
                {drawingHint.text}
              </div>
            )}

            <Marker
              position={[currentPosition.latitude, currentPosition.longitude]}
              icon={createCurrentLocationArrow(currentPosition.heading ?? 0)}
            >
              <Popup className={isDarkMode ? 'dark-popup' : 'light-popup'}>
                <div className={`text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  <strong>{t('gps.currentPosition')}</strong>
                  <br />
                  {t('gps.latitude')}: {currentPosition.latitude.toFixed(7)}°
                  <br />
                  {t('gps.longitude')}: {currentPosition.longitude.toFixed(7)}°
                  <br />
                  {t('gps.accuracy')}: ±{currentPosition.accuracy.toFixed(1)}m
                  {currentPosition.altitude && (
                    <>
                      <br />
                      {t('gps.altitude')}: {currentPosition.altitude.toFixed(1)}m
                    </>
                  )}
                  {currentPosition.satellites != null && (
                    <>
                      <br />
                      {t('gps.satellites')}: {currentPosition.satellites}
                    </>
                  )}
                  {currentPosition.fix_type && (
                    <>
                      <br />
                      {t('gps.fixType')}: {currentPosition.fix_type}
                    </>
                  )}
                </div>
              </Popup>
            </Marker>
          </>
        )}

        {/* Render all field boundaries (polygons from shapefiles) */}
        {uniqueFieldBoundaries.map((boundary) => {
          if (!boundary) return null;
          const coordsRaw = boundary.coordinates as any;
          if (!coordsRaw || !Array.isArray(coordsRaw) || coordsRaw.length === 0) return null;
          // Calculate centroid for label placement
          const centroid = calculateCentroid(boundary.coordinates as number[][][]);
          const isActive = boundary.properties?.isActive !== false;
          const showLabel = boundary.properties?.showLabel !== false;

          if (boundary.geometry_type === 'Polygon') {
            // Single polygon: coordinates is array of rings (first is exterior, others are holes)
            const rings = (boundary.coordinates as number[][][]).filter(r => Array.isArray(r) && r.length >= 3);
            if (rings.length === 0) return null;
            const positions = rings.map(ring =>
              ring
                .filter(coord => Array.isArray(coord) && coord.length >= 2)
                .map(coord => [coord[1], coord[0]] as [number, number])
            );

            // Create a text label icon
            // Extract field identifier by removing project name prefix
            const dashIndex = boundary.name.indexOf(' - ');
            const fieldNumber = dashIndex !== -1 ? boundary.name.substring(dashIndex + 3) : boundary.name;
            const labelIcon = centroid && showLabel ? L.divIcon({
              className: 'field-label',
              html: `<div style="
                position: absolute;
                left: 0;
                top: 0;
                font-weight: bold;
                font-size: 16px;
                color: #000000;
                text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff, 0 0 4px #fff;
                white-space: nowrap;
                pointer-events: none;
                transform: translate(-50%, -50%);
              ">${fieldNumber}</div>`,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            }) : null;

            return (
              <div key={boundary.id}>
                {(() => {
                  // Auto-change to pink if field has tracks assigned (active contract only)
                  const hasTracksInField = isActive && tracks.some(t => t && String(t.field_boundary_id) === String(boundary.id));
                  const fieldColor = isActive
                    ? (hasTracksInField ? '#FF1493' : (boundary.color || '#00FF00'))
                    : inactiveFieldColor;
                  
                  return (
                    <>
                      <Polygon
                        positions={positions}
                        pathOptions={{
                          color: selectedBoundarySet.has(String(boundary.id)) ? '#2563EB' : fieldColor,
                          fillColor: fieldColor,
                          fillOpacity: isActive ? (selectedBoundarySet.has(String(boundary.id)) ? 0.3 : 0.2) : 0.08,
                          weight: selectedBoundarySet.has(String(boundary.id)) ? 4 : (isActive ? 2 : 1),
                          className: undefined
                        }}
                        pane="field-vectors"
                        renderer={fieldSvgRenderer}
                        interactive={true}
                        eventHandlers={{
                          click: (event) => handleFieldClick(event, boundary.id, 'uploaded')
                        }}
                      >
                      </Polygon>

                      {/* Field name label at centroid */}
                      {centroid && labelIcon && (
                        <Marker
                          position={centroid}
                          icon={labelIcon}
                        />
                      )}
                    </>
                  );
                })()}
              </div>
            );
          }

          if (boundary.geometry_type === 'MultiPolygon') {
            // Multiple polygons: coordinates is array of polygons
            const polygons = (boundary.coordinates as number[][][][]).filter(p => Array.isArray(p) && p.length > 0);
            if (polygons.length === 0) return null;

            // For MultiPolygon, calculate centroid of the first (usually largest) polygon
            const firstPolygonCoords = polygons[0] as number[][][];
            const centroid = calculateCentroid(firstPolygonCoords);

            // Create a text label icon
            // Extract field identifier by removing project name prefix
            const dashIndex = boundary.name.indexOf(' - ');
            const fieldNumber = dashIndex !== -1 ? boundary.name.substring(dashIndex + 3) : boundary.name;
            const labelIcon = centroid && showLabel ? L.divIcon({
              className: 'field-label',
              html: `<div style="
                position: absolute;
                left: 0;
                top: 0;
                font-weight: bold;
                font-size: 16px;
                color: #000000;
                text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff, 0 0 4px #fff;
                white-space: nowrap;
                pointer-events: none;
                transform: translate(-50%, -50%);
              ">${fieldNumber}</div>`,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            }) : null;

            return (
              <div key={boundary.id}>
                {polygons.map((polygon, idx) => {
                  const validRings = polygon.filter(r => Array.isArray(r) && r.length >= 3);
                  if (validRings.length === 0) return null;
                  const positions = validRings.map(ring =>
                    ring
                      .filter(coord => Array.isArray(coord) && coord.length >= 2)
                      .map(coord => [coord[1], coord[0]] as [number, number])
                  );

                  // Auto-change to pink if field has tracks assigned
                  const hasTracksInField = isActive && tracks.some(t => t && String(t.field_boundary_id) === String(boundary.id));
                  const fieldColor = isActive
                    ? (hasTracksInField ? '#FF1493' : (boundary.color || '#00FF00'))
                    : inactiveFieldColor;
                  
                  return (
                    <Polygon
                      key={`${boundary.id}-${idx}`}
                      positions={positions}
                      pathOptions={{
                        color: selectedBoundarySet.has(String(boundary.id)) ? '#2563EB' : fieldColor,
                        fillColor: fieldColor,
                        fillOpacity: isActive ? (selectedBoundarySet.has(String(boundary.id)) ? 0.3 : 0.2) : 0.08,
                        weight: selectedBoundarySet.has(String(boundary.id)) ? 4 : (isActive ? 2 : 1),
                        className: undefined
                      }}
                      pane="field-vectors"
                      renderer={fieldSvgRenderer}
                      interactive={true}
                      eventHandlers={{
                        click: (event) => handleFieldClick(event, boundary.id, 'uploaded')
                      }}
                    >
                    </Polygon>
                  );
                })}

                {/* Field name label at centroid */}
                {centroid && labelIcon && (
                  <Marker
                    position={centroid}
                    icon={labelIcon}
                  />
                )}

                {/* Manual sample dots */}
                {isActive && boundary.manual_samples?.enabled && boundary.manual_samples.count > 0 && (() => {
                  const samplePositions: [number, number][] = calculateManualSamplePositions(boundary, boundary.manual_samples.count);
                  const hasTracksInField = tracks.some(t => t && String(t.field_boundary_id) === String(boundary.id));
                  const dotColor = hasTracksInField ? '#FF1493' : (boundary.color || '#00FF00');
                  
                  return (
                    <>
                      {/* Start dot */}
                      {samplePositions.length > 0 && (
                        <Circle
                          center={samplePositions[0]}
                          radius={pixelRadiusToMeters(currentZoom, samplePositions[0][0], 8)}
                          pathOptions={{
                            color: '#ffffff',
                            fillColor: dotColor,
                            fillOpacity: 1,
                            weight: 3,
                          }}
                        >
                          <Popup>
                            <div className="text-xs font-semibold">{t('gps.manualSampleStart')}</div>
                          </Popup>
                        </Circle>
                      )}
                      
                      {/* Sample dots (marked with X) */}
                      {samplePositions.slice(1, -1).map((pos: [number, number], idx: number) => (
                        <div key={`manual-sample-mp-${boundary.id}-${idx}`}>
                          <Circle
                            center={pos}
                            radius={pixelRadiusToMeters(currentZoom, pos[0], 7)}
                            pathOptions={{
                              color: '#ffffff',
                              fillColor: dotColor,
                              fillOpacity: 0.9,
                              weight: 3,
                            }}
                          >
                            <Popup>
                              <div className="text-xs font-semibold">{t('gps.manualSample')} #{idx + 1}</div>
                            </Popup>
                          </Circle>
                          <Marker
                            position={pos}
                            icon={L.divIcon({
                              className: 'manual-sample-x',
                              html: '<div style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); font-weight: bold; font-size: 18px; color: #000; text-shadow: 0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff;">✕</div>',
                              iconSize: [0, 0],
                            })}
                          />
                        </div>
                      ))}
                      
                      {/* End dot */}
                      {samplePositions.length > 1 && (
                        <Circle
                          center={samplePositions[samplePositions.length - 1]}
                          radius={pixelRadiusToMeters(currentZoom, samplePositions[samplePositions.length - 1][0], 8)}
                          pathOptions={{
                            color: '#ffffff',
                            fillColor: dotColor,
                            fillOpacity: 1,
                            weight: 3,
                          }}
                        >
                          <Popup>
                            <div className="text-xs font-semibold">{t('gps.manualSampleEnd')}</div>
                          </Popup>
                        </Circle>
                      )}
                      
                      {/* Connecting line */}
                      {samplePositions.length > 1 && (
                        <Polyline
                          positions={samplePositions}
                          pathOptions={{
                            color: dotColor,
                            weight: 3,
                            opacity: 0.8,
                            dashArray: '10, 10',
                          }}
                        />
                      )}
                    </>
                  );
                })()}
              </div>
            );
          }

          return null;
        })}

        {/* Render viewport-filtered tracks - memoized for performance */}
        {useMemo(() => {
          // Determine sample visibility based on zoom level
          const maxSamplesPerTrack = currentZoom >= 16 ? 200 : 
                                      currentZoom >= 14 ? 100 : 
                                      currentZoom >= 12 ? 50 : 0;
          
          return viewportFilteredTracks.map((track) => {
          if (!track) return null;
          const gpsPoints = track.gps_points || [];
          const samples = track.samples || [];

          // Skip tracks with no GPS points
          if (gpsPoints.length === 0) {
            return null;
          }

          const pointsToRender = gpsPoints;

          // Smooth the GPS points to create curved lines and filter out jitter
          const smoothedPoints = smoothGpsPoints(pointsToRender);
          
          // Ensure we have at least 2 points for rendering a line
          const renderPoints = smoothedPoints.length >= 2 ? smoothedPoints : gpsPoints.slice(0, Math.min(2, gpsPoints.length));
          
          // Combine GPS points with sample points for complete path
          const allPathPoints = [
            ...renderPoints,
            ...samples.map(s => ({ latitude: s.latitude, longitude: s.longitude }))
          ];

          return (
            <div key={`track-${track.id}-${track.name}`}>
              {/* GPS path connecting all points including samples - ALWAYS render if we have 2+ points */}
              {allPathPoints.length >= 2 && (
                <Polyline
                  positions={allPathPoints.map((point) => [
                    point.latitude,
                    point.longitude,
                  ])}
                  pathOptions={{
                    color: track.color || '#3B82F6',
                    weight: 3,
                    opacity: 1.0,
                    dashArray: '1, 8',
                    lineCap: 'round',
                    lineJoin: 'round',
                    dashOffset: '0'
                  }}
                  smoothFactor={10}
                  pane="overlayPane"
                />
              )}

              {/* Start point - only render at zoom 13+ for performance */}
              {gpsPoints.length > 0 && currentZoom >= 13 && (
                <Marker
                  position={[gpsPoints[0].latitude, gpsPoints[0].longitude]}
                  icon={startPointIcon}
                  zIndexOffset={1000}
                >
                  <Popup className={isDarkMode ? 'dark-popup' : 'light-popup'}>
                    <div className={`text-sm ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}>
                      <strong>{track.name}</strong>
                      <br />
                      <span className={isDarkMode ? 'text-blue-400' : 'text-blue-600'}>
                        {t('gps.startPoint')}
                      </span>
                      <br />
                      <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
                        {new Date(gpsPoints[0].timestamp).toLocaleTimeString()}
                      </span>
                      <br />
                      <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {t('orders.gpsPointsLabel', { count: gpsPoints.length }) || `${gpsPoints.length} GPS points`}
                      </span>
                    </div>
                  </Popup>
                </Marker>
              )}

              {/* End point - only render at zoom 13+ for performance */}
              {gpsPoints.length > 1 && currentZoom >= 13 && (
                <Marker
                  position={[
                    gpsPoints[gpsPoints.length - 1].latitude,
                    gpsPoints[gpsPoints.length - 1].longitude
                  ]}
                  icon={endPointIcon}
                  zIndexOffset={1000}
                >
                  <Popup className={isDarkMode ? 'dark-popup' : 'light-popup'}>
                    <div className={`text-sm ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}>
                      <strong>{t('gps.endPoint')}</strong>
                      <br />
                      <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
                        {new Date(gpsPoints[gpsPoints.length - 1].timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </Popup>
                </Marker>
              )}

              {/* Sample points - only render at zoom 14+ for better performance */}
              {currentZoom >= 14 && samples.slice(0, maxSamplesPerTrack).map((sample) => (
                <Marker
                  key={sample.id}
                  position={[sample.latitude, sample.longitude]}
                  icon={sampleIcon}
                  zIndexOffset={1000}
                >
                  <Popup className={isDarkMode ? 'dark-popup' : 'light-popup'}>
                    <div className={`text-sm ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}>
                      <strong>{t('gps.sample')} #{sample.sample_number}</strong>
                      {sample.notes && (
                        <>
                          <br />
                          <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>{sample.notes}</span>
                        </>
                      )}
                    </div>
                  </Popup>
                </Marker>
              ))}
            </div>
          );
        });
        }, [viewportFilteredTracks, currentZoom, isDarkMode, t, focusedBoundaryId])}
      </MapContainer>
      {/* Navigation Button - Bottom right, hidden when navigation panel is open on mobile, moves left on desktop */}
      {showNavigationButton && onNavigationClick && (
        <button
          onClick={onNavigationClick}
          className={`absolute bottom-4 z-[1500] w-10 h-10 md:w-12 md:h-12 flex items-center justify-center text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-full shadow-lg transition-all duration-300 ${isNavigationOpen
              ? 'hidden md:flex md:right-[29rem] lg:right-[32rem]'
              : 'right-4'
            }`}
          title={t('common.navigation')}
        >
          <Navigation2 className="w-5 h-5 md:w-6 md:h-6" />
        </button>
      )}

      {/* Dynamic scale bar - Bottom left */}
      <div className="absolute bottom-16 left-4 z-[1500] flex items-center gap-2 px-2 py-1 text-[10px] md:text-xs text-black font-bold">
        <div className="flex items-center">
          <div className="mx-1 h-[2px] bg-current" style={{ width: `${scaleInfo.width}px` }} />
        </div>
        <span>{scaleInfo.label}</span>
      </div>

      <div className="absolute bottom-4 left-4 z-[1500]">
        <div className="relative">
          <div className={`h-10 md:h-11 w-64 md:w-72 rounded-xl border border-gray-200/60 dark:border-gray-700/60 bg-white/80 dark:bg-gray-900/80 shadow-xl backdrop-blur-xl flex items-center gap-2 px-2 ${isOffline ? 'opacity-70' : ''}`}>
            <Search className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <input
              value={placeQuery}
              onChange={(event) => {
                setPlaceQuery(event.target.value);
                if (!event.target.value.trim()) {
                  setPlaceResults([]);
                  setPlaceSearchError(null);
                  setShowPlaceResults(false);
                }
              }}
              onFocus={() => {
                if (placeResults.length || placeSearchError) {
                  setShowPlaceResults(true);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void runPlaceSearch();
                }
                if (event.key === 'Escape') {
                  setShowPlaceResults(false);
                }
              }}
              placeholder={(() => {
                const value = t('orders.map.searchPlacesPlaceholder');
                return value && value !== 'orders.map.searchPlacesPlaceholder'
                  ? value
                  : 'Search place or city';
              })()}
              className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 outline-none"
            />
            <button
              type="button"
              onClick={() => {
                void runPlaceSearch();
              }}
              disabled={isSearchingPlace || !placeQuery.trim()}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${isSearchingPlace || !placeQuery.trim() ? 'bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
            >
              {isSearchingPlace ? (t('common.loading')) : (t('common.search'))}
            </button>
          </div>

          {showPlaceResults && (placeResults.length > 0 || placeSearchError) && (
            <div className="absolute bottom-full mb-1 w-full rounded-xl border border-gray-200/70 dark:border-gray-700/70 bg-white/90 dark:bg-gray-900/90 shadow-2xl backdrop-blur-xl max-h-56 overflow-y-auto z-[4100]">
              {placeSearchError ? (
                <div className="px-3 py-2 text-xs text-red-600 dark:text-red-300">{placeSearchError}</div>
              ) : (
                placeResults.map((result, index) => (
                  <button
                    key={`${result.displayName}-${index}`}
                    type="button"
                    onClick={() => focusPlaceResult(result)}
                    className="w-full text-left px-3 py-2 text-xs text-gray-800 dark:text-gray-200 hover:bg-gray-100/80 dark:hover:bg-gray-800/80"
                    title={result.displayName}
                  >
                    {result.displayName}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {hoverEditPopup && !disableHoverEditPopup && (
        <div
          className="absolute z-[6000] pointer-events-none"
          style={{ left: hoverEditPopup.x + 12, top: hoverEditPopup.y + 12 }}
        >
          <div
            ref={hoverPopupRef}
            className="pointer-events-auto"
            onMouseEnter={() => {
              hoverPopupActiveRef.current = true;
              hideOnPopupLeaveRef.current = false;
              clearPopupHideTimer();
            }}
            onMouseLeave={() => {
              hoverPopupActiveRef.current = false;
              if (hideOnPopupLeaveRef.current) {
                hideOnPopupLeaveRef.current = false;
                setHoverEditPopup(null);
              }
            }}
          >
            <div className="flex flex-col items-stretch gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setHoverEditPopup(null);
                  onFieldEditRequest?.(hoverEditPopup.fieldId, hoverEditPopup.source);
                }}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-blue-700 dark:text-blue-200 bg-white/80 dark:bg-gray-900/80 border border-gray-200/50 dark:border-gray-700/50 shadow-2xl backdrop-blur-2xl hover:bg-white/90 dark:hover:bg-gray-900/90"
              >
                {t('orders.editProperties')}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setHoverEditPopup(null);
                  onFieldShapeAction?.('redraw-shape', hoverEditPopup.fieldId, hoverEditPopup.source);
                }}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-amber-700 dark:text-amber-200 bg-white/80 dark:bg-gray-900/80 border border-gray-200/50 dark:border-gray-700/50 shadow-2xl backdrop-blur-2xl hover:bg-white/90 dark:hover:bg-gray-900/90"
              >
                {t('orders.redrawShape')}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setHoverEditPopup(null);
                  onFieldShapeAction?.('delete-shape', hoverEditPopup.fieldId, hoverEditPopup.source);
                }}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-red-700 dark:text-red-300 bg-white/80 dark:bg-gray-900/80 border border-red-300/40 dark:border-red-900/50 shadow-2xl backdrop-blur-2xl hover:bg-red-50/60 dark:hover:bg-red-900/30"
              >
                {t('orders.deleteShape')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
