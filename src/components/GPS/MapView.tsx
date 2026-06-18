import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import type { MutableRefObject } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Polygon, Circle, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Capacitor } from '@capacitor/core';
import { Navigation2, Satellite } from 'lucide-react';
import { useDarkMode } from '../../hooks/useDarkMode';
import { useLanguage } from '../../hooks/useLanguage';
import { GpsPosition, GpsTrackDetail, GpsPoint, GpsFieldBoundary, GpsFieldSample } from '../../types';
import { getBoundaryLodLevel } from '../../utils/boundaryRenderMeta';
import { getBoundarySamplingState } from '../../utils/fieldSamplingState';
import { getBlankTileUrl, getBundledGermanyPmtilesUrl, getTileLayerCrossOrigin } from '../../utils/tileUtils';
import { getDefaultPack, getPackForLocation, OFFLINE_MAP_PACKS } from '../../config/offlineMapPacks';
import PMTilesVectorLayer from './PMTilesVectorLayer';
import { tileDownloader, DownloadProgress } from '../../services/offlineTileDownloader';
import 'leaflet/dist/leaflet.css';

const onlineTileUrl = (window as any).__VITE_ONLINE_TILE_URL__ || (import.meta.env.VITE_ONLINE_TILE_URL as string | undefined);
const offlinePmtilesUrl = getBundledGermanyPmtilesUrl();
const offlineTilesDisabledByEnv = ((import.meta.env.VITE_DISABLE_OFFLINE_TILES as string | undefined) || '').toLowerCase() === 'true';

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
    console.error('Error calculating centroid:', error);
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

const normalizeHeading = (heading?: number | null): number | null => {
  if (heading == null || !Number.isFinite(heading)) return null;
  return ((heading % 360) + 360) % 360;
};

const shortestHeadingDelta = (from: number, to: number): number => {
  return ((to - from + 540) % 360) - 180;
};

const blendHeading = (from: number, to: number, factor: number): number => {
  const delta = shortestHeadingDelta(from, to);
  return ((from + (delta * factor)) % 360 + 360) % 360;
};

const calculateBearing = (from: [number, number], to: [number, number]): number => {
  const lat1 = (from[0] * Math.PI) / 180;
  const lat2 = (to[0] * Math.PI) / 180;
  const dLon = ((to[1] - from[1]) * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
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

const pruneCacheMap = <T,>(cache: Map<string, T>, maxSize: number) => {
  if (cache.size <= maxSize) return;
  const removeCount = cache.size - maxSize;
  let removed = 0;
  for (const key of cache.keys()) {
    cache.delete(key);
    removed += 1;
    if (removed >= removeCount) break;
  }
};

const _getTrackSimplifyStep = (zoom: number, isMoving: boolean): number => {
  if (isMoving) return 12;
  if (zoom >= 16) return 2;
  if (zoom >= 14) return 6;
  if (zoom >= 12) return 10;
  return 16;
};

const _getTrackLodKey = (zoom: number, isMoving: boolean): string => {
  if (isMoving) return 'moving';
  if (zoom >= 16) return 'z16';
  if (zoom >= 14) return 'z14';
  if (zoom >= 12) return 'z12';
  return 'z10';
};

const getBoundaryPointCount = (boundary: GpsFieldBoundary): number => {
  if (typeof boundary.render_meta?.point_count === 'number' && Number.isFinite(boundary.render_meta.point_count)) {
    return boundary.render_meta.point_count;
  }

  if (boundary.geometry_type === 'Polygon') {
    const coords = boundary.coordinates as number[][][];
    return coords.reduce((sum, ring) => sum + (ring?.length || 0), 0);
  }
  if (boundary.geometry_type === 'MultiPolygon') {
    const coords = boundary.coordinates as number[][][][];
    return coords.reduce((sum, poly) => sum + poly.reduce((pSum, ring) => pSum + (ring?.length || 0), 0), 0);
  }
  return 0;
};

const getBoundaryLodCoordinates = (
  boundary: GpsFieldBoundary,
  lodLevel: 'low' | 'mid' | 'high'
): number[][][] | number[][][][] => {
  const lod = boundary.render_meta?.lod;
  const requested = lod?.[lodLevel];
  if (Array.isArray(requested) && requested.length > 0) {
    return requested as number[][][] | number[][][][];
  }

  if (lodLevel === 'low') {
    if (Array.isArray(lod?.mid) && lod.mid.length > 0) return lod.mid as number[][][] | number[][][][];
    if (Array.isArray(lod?.high) && lod.high.length > 0) return lod.high as number[][][] | number[][][][];
  }

  if (lodLevel === 'mid') {
    if (Array.isArray(lod?.high) && lod.high.length > 0) return lod.high as number[][][] | number[][][][];
  }

  return boundary.coordinates as number[][][] | number[][][][];
};

const toLatLngRings = (rings: number[][][]): [number, number][][] => {
  if (!Array.isArray(rings) || rings.length === 0) return [];

  return rings
    .filter(ring => Array.isArray(ring) && ring.length >= 3)
    .map((ring) =>
      ring
        .filter(coord => Array.isArray(coord) && coord.length >= 2)
        .map(coord => [coord[1], coord[0]] as [number, number])
    )
    .filter(ring => ring.length >= 3);
};

const toLatLngPolygons = (polygons: number[][][][]): [number, number][][][] => {
  if (!Array.isArray(polygons) || polygons.length === 0) return [];

  return polygons
    .filter(polygon => Array.isArray(polygon) && polygon.length > 0)
    .map((polygon) => toLatLngRings(polygon))
    .filter(polygon => polygon.length > 0);
};

const getBoundaryBounds = (
  boundary: GpsFieldBoundary,
  positions: [number, number][][] | [number, number][][][]
): L.LatLngBounds => {
  const bbox = boundary.render_meta?.bbox;
  if (Array.isArray(bbox) && bbox.length === 4) {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    if (
      Number.isFinite(minLon)
      && Number.isFinite(minLat)
      && Number.isFinite(maxLon)
      && Number.isFinite(maxLat)
      && minLon <= maxLon
      && minLat <= maxLat
    ) {
      return L.latLngBounds([minLat, minLon], [maxLat, maxLon]);
    }
  }

  if (boundary.geometry_type === 'Polygon') {
    return L.latLngBounds((positions as [number, number][][])[0] || []);
  }

  const flattened = (positions as [number, number][][][]).flat(2) as [number, number][];
  return L.latLngBounds(flattened);
};

const isPointInRing = (lng: number, lat: number, ring: number[][]): boolean => {
  if (!Array.isArray(ring) || ring.length < 3) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const current = ring[i];
    const previous = ring[j];

    if (!Array.isArray(current) || !Array.isArray(previous) || current.length < 2 || previous.length < 2) {
      continue;
    }

    const xi = Number(current[0]);
    const yi = Number(current[1]);
    const xj = Number(previous[0]);
    const yj = Number(previous[1]);

    if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) {
      continue;
    }

    const intersects = ((yi > lat) !== (yj > lat))
      && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};

const isPointInPolygon = (lng: number, lat: number, polygon: number[][][]): boolean => {
  if (!Array.isArray(polygon) || polygon.length === 0) return false;

  const outerRing = polygon[0];
  if (!isPointInRing(lng, lat, outerRing)) return false;

  for (let i = 1; i < polygon.length; i += 1) {
    if (isPointInRing(lng, lat, polygon[i])) {
      return false;
    }
  }

  return true;
};

const findBoundaryIdAtLatLng = (
  fieldBoundaries: GpsFieldBoundary[],
  lat: number,
  lng: number
): number | string | null => {
  for (const boundary of fieldBoundaries) {
    if (!boundary?.coordinates) continue;

    if (boundary.geometry_type === 'Polygon') {
      if (isPointInPolygon(lng, lat, boundary.coordinates as number[][][])) {
        return boundary.id;
      }
      continue;
    }

    if (boundary.geometry_type === 'MultiPolygon') {
      const polygons = boundary.coordinates as number[][][][];
      if (polygons.some((polygon) => isPointInPolygon(lng, lat, polygon))) {
        return boundary.id;
      }
    }
  }

  return null;
};

const getBoundaryCentroid = (boundary: GpsFieldBoundary): [number, number] | null => {
  const centroid = boundary.render_meta?.centroid;
  if (
    Array.isArray(centroid)
    && centroid.length === 2
    && Number.isFinite(centroid[0])
    && Number.isFinite(centroid[1])
  ) {
    return centroid;
  }

  if (boundary.geometry_type === 'Polygon') {
    return calculateCentroid(boundary.coordinates as number[][][]);
  }

  if (boundary.geometry_type === 'MultiPolygon') {
    const polygons = boundary.coordinates as number[][][][];
    const firstPolygon = polygons?.[0];
    return firstPolygon ? calculateCentroid(firstPolygon) : null;
  }

  return null;
};

const buildFieldViewportBounds = (
  fieldBoundaries: GpsFieldBoundary[],
  currentPosition?: GpsPosition | null
): L.LatLngBounds | null => {
  const bounds = L.latLngBounds([]);

  fieldBoundaries.forEach((boundary) => {
    if (boundary.geometry_type === 'Polygon') {
      const coords = boundary.coordinates as number[][][];
      coords[0]?.forEach((coord) => {
        if (Array.isArray(coord) && coord.length >= 2) {
          bounds.extend([coord[1], coord[0]]);
        }
      });
      return;
    }

    if (boundary.geometry_type === 'MultiPolygon') {
      const coords = boundary.coordinates as number[][][][];
      coords.forEach((polygon) => {
        polygon[0]?.forEach((coord) => {
          if (Array.isArray(coord) && coord.length >= 2) {
            bounds.extend([coord[1], coord[0]]);
          }
        });
      });
    }
  });

  if (
    currentPosition
    && Number.isFinite(currentPosition.latitude)
    && Number.isFinite(currentPosition.longitude)
  ) {
    bounds.extend([currentPosition.latitude, currentPosition.longitude]);
  }

  return bounds.isValid() ? bounds : null;
};

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

const getFieldSampleRenderLimit = (zoom: number, isMoving: boolean, isTabletPerformanceMode: boolean): number => {
  if (isTabletPerformanceMode) {
    if (isMoving) {
      if (zoom < 14) return 10;
      if (zoom < 16) return 16;
      return 24;
    }

    if (zoom < 14) return 18;
    if (zoom < 16) return 30;
    return 48;
  }

  if (isMoving) {
    if (zoom < 13) return 60;
    if (zoom < 15) return 120;
    return 220;
  }

  if (zoom < 13) return 100;
  if (zoom < 15) return 200;
  return 450;
};

const getFieldSampleCrossLimit = (zoom: number, isTabletPerformanceMode: boolean): number => {
  if (isTabletPerformanceMode) {
    return 0;
  }

  if (zoom < 14) return 0;
  if (zoom < 16) return 60;
  return 120;
};

const getFieldSampleDotLimit = (zoom: number, isMoving: boolean, isTabletPerformanceMode: boolean): number => {
  if (!isTabletPerformanceMode) {
    return 0;
  }

  if (isMoving) {
    return 0;
  }

  if (zoom < 15) return 0;
  if (zoom < 16) return 2;
  if (zoom < 17) return 4;
  return 6;
};

const getFieldSampleMinDistanceMeters = (zoom: number, isMoving: boolean, isTabletPerformanceMode: boolean): number => {
  if (!isTabletPerformanceMode) {
    return 0;
  }

  if (isMoving) {
    if (zoom < 15) return 6;
    if (zoom < 17) return 4;
    return 3;
  }

  if (zoom < 14) return 4;
  if (zoom < 16) return 2.8;
  return 1.8;
};

const thinFieldSamplesForRender = (
  samples: GpsFieldSample[],
  minDistanceMeters: number,
  maxPoints: number
): GpsFieldSample[] => {
  if (!Array.isArray(samples) || samples.length === 0) {
    return [];
  }

  let reduced = samples;

  if (maxPoints > 0 && reduced.length > maxPoints) {
    const step = Math.ceil(reduced.length / maxPoints);
    reduced = reduced.filter((_, idx) => idx % step === 0 || idx === reduced.length - 1);
  }

  if (minDistanceMeters <= 0 || reduced.length <= 2) {
    return reduced;
  }

  const thinned: GpsFieldSample[] = [reduced[0]];
  let lastKept = reduced[0];

  for (let i = 1; i < reduced.length - 1; i += 1) {
    const sample = reduced[i];
    const distance = haversineDistance(
      [lastKept.latitude, lastKept.longitude],
      [sample.latitude, sample.longitude]
    );

    if (distance >= minDistanceMeters) {
      thinned.push(sample);
      lastKept = sample;
    }
  }

  const lastSample = reduced[reduced.length - 1];
  if (thinned[thinned.length - 1] !== lastSample) {
    thinned.push(lastSample);
  }

  return thinned;
};

const getTabletSamplePathLimit = (zoom: number, isMoving: boolean): number => {
  if (isMoving) {
    if (zoom < 15) return 8;
    if (zoom < 17) return 10;
    return 14;
  }

  if (zoom < 15) return 10;
  if (zoom < 17) return 14;
  return 20;
};

const reduceSamplesToPathPoints = (samples: GpsFieldSample[], maxPoints: number): [number, number][] => {
  if (!Array.isArray(samples) || samples.length === 0) {
    return [];
  }

  const normalized = samples
    .filter((sample) => Number.isFinite(sample.latitude) && Number.isFinite(sample.longitude))
    .map((sample) => [sample.latitude, sample.longitude] as [number, number]);

  if (normalized.length <= maxPoints || maxPoints <= 0) {
    return normalized;
  }

  const stride = Math.max(1, Math.ceil((normalized.length - 1) / Math.max(1, maxPoints - 1)));
  const reduced: [number, number][] = [];

  for (let i = 0; i < normalized.length; i += stride) {
    reduced.push(normalized[i]);
  }

  const last = normalized[normalized.length - 1];
  const lastReduced = reduced[reduced.length - 1];
  if (!lastReduced || lastReduced[0] !== last[0] || lastReduced[1] !== last[1]) {
    reduced.push(last);
  }

  return reduced;
};

const _getPathWaypoints = (pathPoints: [number, number][], maxWaypoints: number): [number, number][] => {
  if (maxWaypoints <= 0 || pathPoints.length <= 2) {
    return [];
  }

  const interior = pathPoints.slice(1, -1);
  if (interior.length <= maxWaypoints) {
    return interior;
  }

  const stride = Math.max(1, Math.ceil(interior.length / maxWaypoints));
  return interior.filter((_, idx) => idx % stride === 0).slice(0, maxWaypoints);
};

const getSampleCrossArms = (
  latitude: number,
  longitude: number,
  zoom: number,
  isMoving: boolean
): [[number, number], [number, number], [number, number], [number, number]] => {
  const armPixels = isMoving ? 1.6 : (zoom >= 16 ? 3.0 : (zoom >= 14 ? 2.3 : 1.8));
  const armMeters = pixelRadiusToMeters(zoom, latitude, armPixels);
  const latDelta = armMeters / 111_320;
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  const safeCosLat = Math.abs(cosLat) < 1e-6 ? 1e-6 : Math.abs(cosLat);
  const lngDelta = armMeters / (111_320 * safeCosLat);

  return [
    [latitude - latDelta, longitude - lngDelta],
    [latitude + latDelta, longitude + lngDelta],
    [latitude - latDelta, longitude + lngDelta],
    [latitude + latDelta, longitude - lngDelta],
  ];
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

const getBoundaryPointLimit = (zoom: number, isMoving: boolean, isTabletPerformanceMode: boolean): number => {
  if (!isTabletPerformanceMode) return 0;
  // Keep a stable simplification budget on tablet to avoid shape morphing at zoom end.
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

const _MAX_TRACK_POINTS_FOR_SMOOTHING = 600;

const _getTrackBoundsFromPoints = (points: { latitude: number; longitude: number }[]): L.LatLngBounds | null => {
  if (!Array.isArray(points) || points.length === 0) return null;

  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;

  for (const point of points) {
    const lat = Number(point.latitude);
    const lng = Number(point.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  if (!Number.isFinite(minLat) || !Number.isFinite(minLng) || !Number.isFinite(maxLat) || !Number.isFinite(maxLng)) {
    return null;
  }

  return L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
};

const getBoundaryGeometryVersionKey = (boundary: GpsFieldBoundary): string => {
  const updatedAt = boundary.render_meta?.updated_at;
  if (typeof updatedAt === 'string' && updatedAt.length > 0) {
    return updatedAt;
  }

  const pointCount = boundary.render_meta?.point_count ?? getBoundaryPointCount(boundary);
  return `${boundary.geometry_type}:${pointCount}`;
};

// Advanced GPS Point Smoothing Algorithm
// Creates smooth curved paths, ignores circling and small movements
function _smoothGpsPoints(points: GpsPoint[]): GpsPoint[] {
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
    console.log('[MapView] Smoothing too aggressive, using first and last points');
    return [points[0], points[points.length - 1]];
  }

  // Return simplified points if we don't have enough for spline smoothing
  if (smoothed.length < 4) {
    console.log('[MapView] Not enough points for spline smoothing:', smoothed.length);
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

// Backward-compatible fallback (in case any stale references remain)

// Red square for start point - smaller fixed size
const _startPointIcon = new L.Icon({
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
const _endPointIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
      <rect x="6" y="6" width="12" height="12" fill="#EF4444" stroke="white" stroke-width="2"/>
    </svg>
  `),
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  popupAnchor: [0, -7],
});

// Reusable 1x1 transparent tile for safe fallback when offline tiles are missing
const BLANK_TILE_URL = getBlankTileUrl();
const LEAFLET_WORLD_BOUNDS: L.LatLngBoundsExpression = [[-85.05112878, -180], [85.05112878, 180]];

interface MapViewProps {
  currentPosition: GpsPosition | null;
  tracks: GpsTrackDetail[];
  fieldSamples: GpsFieldSample[];
  fieldBoundaries?: GpsFieldBoundary[];
  focusedBoundaryId?: number | null;
  focusedBoundaryRequestId?: number;
  focusedTrackId?: number | string | null;
  isTracking: boolean;
  showNavigationButton?: boolean;
  onNavigationClick?: () => void;
  isNavigationOpen?: boolean;
  isSidebarCollapsed?: boolean;
  isCompactLandscapeLayout?: boolean;
  recenterTrigger?: number;
  onFieldClick?: (fieldId: number | string) => void;
  onMapEmptyTap?: () => void;
}

const MapController = memo(function MapController({
  currentPosition,
  fieldBoundaries,
  focusedBoundaryId,
  focusedBoundaryRequestId,
  isTracking,
  snapState
}: {
  currentPosition: GpsPosition | null;
  fieldBoundaries: GpsFieldBoundary[];
  focusedBoundaryId?: number | null;
  focusedBoundaryRequestId?: number;
  isTracking?: boolean;
  snapState?: {
    hasZoomedRef: MutableRefObject<boolean>;
    hasZoomedToBoundariesRef: MutableRefObject<boolean>;
    trackingCenterDoneRef: MutableRefObject<boolean>;
    boundaryFocusDoneRef: MutableRefObject<boolean>;
    lastFocusedBoundaryIdRef: MutableRefObject<number | null>;
    lastFocusedBoundaryRequestKeyRef: MutableRefObject<string | null>;
  };
}) {
  const map = useMap();
  const localHasZoomedRef = useRef(false);
  const localHasZoomedToBoundariesRef = useRef(false);
  const isAnimatingRef = useRef(false);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const localTrackingCenterDoneRef = useRef(false);
  const localLastFocusedBoundaryIdRef = useRef<number | null>(null);
  const localLastFocusedBoundaryRequestKeyRef = useRef<string | null>(null);
  const localBoundaryFocusDoneRef = useRef(false);

  const hasZoomedRef = snapState?.hasZoomedRef ?? localHasZoomedRef;
  const hasZoomedToBoundariesRef = snapState?.hasZoomedToBoundariesRef ?? localHasZoomedToBoundariesRef;
  const trackingCenterDoneRef = snapState?.trackingCenterDoneRef ?? localTrackingCenterDoneRef;
  const lastFocusedBoundaryIdRef = snapState?.lastFocusedBoundaryIdRef ?? localLastFocusedBoundaryIdRef;
  const lastFocusedBoundaryRequestKeyRef = snapState?.lastFocusedBoundaryRequestKeyRef ?? localLastFocusedBoundaryRequestKeyRef;
  const boundaryFocusDoneRef = snapState?.boundaryFocusDoneRef ?? localBoundaryFocusDoneRef;

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

    if (fieldBoundaries.length > 0) {
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
  }, [currentPosition, fieldBoundaries.length, isTracking, map, trackingCenterDoneRef]);

  // Focus on specific boundary when clicked
  useEffect(() => {
    if (!focusedBoundaryId) {
      boundaryFocusDoneRef.current = false;
      lastFocusedBoundaryIdRef.current = null;
      lastFocusedBoundaryRequestKeyRef.current = null;
      return;
    }

    const focusRequestKey = `${focusedBoundaryId}:${focusedBoundaryRequestId ?? 0}`;

    if (
      boundaryFocusDoneRef.current
      && lastFocusedBoundaryIdRef.current === focusedBoundaryId
      && lastFocusedBoundaryRequestKeyRef.current === focusRequestKey
    ) {
      return;
    }

    if (fieldBoundaries.length > 0) {
      const boundary = fieldBoundaries.find(b => String(b.id) === String(focusedBoundaryId));
      if (boundary) {
        try {
          const bounds = buildFieldViewportBounds([boundary], currentPosition);

          if (bounds) {
            flyToBoundsAnimated(bounds, [90, 90], 18, true);
            boundaryFocusDoneRef.current = true;
            lastFocusedBoundaryIdRef.current = focusedBoundaryId;
            lastFocusedBoundaryRequestKeyRef.current = focusRequestKey;
          }
        } catch (error) {
          console.error('Error focusing on boundary:', error);
        }
      }
    }
  }, [currentPosition, focusedBoundaryId, focusedBoundaryRequestId, fieldBoundaries, map, flyToBoundsAnimated, boundaryFocusDoneRef, lastFocusedBoundaryIdRef, lastFocusedBoundaryRequestKeyRef]);

  // Auto-zoom to field boundaries when they're loaded (with delay to ensure rendering)
  useEffect(() => {
    if (fieldBoundaries.length > 0 && !hasZoomedToBoundariesRef.current) {
      if (isTracking && !currentPosition) {
        return;
      }

      // Add a small delay to ensure boundaries are rendered before animation
      const timer = setTimeout(() => {
        try {
          const bounds = buildFieldViewportBounds(fieldBoundaries, currentPosition);

          if (bounds) {
            flyToBoundsAnimated(bounds, [70, 70], 17);
            hasZoomedToBoundariesRef.current = true;
          }
        } catch (error) {
          console.error('Error calculating field boundary bounds:', error);
        }
      }, 150); // Small delay to ensure rendering

      return () => clearTimeout(timer);
    }
  }, [currentPosition, fieldBoundaries, flyToBoundsAnimated, isTracking, map, hasZoomedToBoundariesRef]);

  // Zoom to current position if no boundaries
  useEffect(() => {
    if (currentPosition && !hasZoomedRef.current && fieldBoundaries.length === 0) {
      map.setView([currentPosition.latitude, currentPosition.longitude], 18);
      hasZoomedRef.current = true;
    }
  }, [currentPosition, fieldBoundaries, map, hasZoomedRef]);

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

// Zoom level tracker for performance optimization
const ZoomTracker = memo(function ZoomTracker({
  onZoomChange,
  continuous = true,
  emitOnZoomEnd = true,
}: {
  onZoomChange: (zoom: number) => void;
  continuous?: boolean;
  emitOnZoomEnd?: boolean;
}) {
  const map = useMap();
  const lastZoomRef = useRef<number | null>(null);
  
  useEffect(() => {
    let frameId: number | null = null;

    const handleZoom = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }

      frameId = requestAnimationFrame(() => {
        const nextZoom = map.getZoom();
        if (lastZoomRef.current != null && Math.abs(lastZoomRef.current - nextZoom) < 0.001) {
          return;
        }

        lastZoomRef.current = nextZoom;
        onZoomChange(nextZoom);
      });
    };

    if (continuous) {
      map.on('zoom', handleZoom);
    }
    if (emitOnZoomEnd) {
      map.on('zoomend', handleZoom);
    }
    handleZoom(); // Set initial zoom
    
    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      if (continuous) {
        map.off('zoom', handleZoom);
      }
      if (emitOnZoomEnd) {
        map.off('zoomend', handleZoom);
      }
    };
  }, [map, onZoomChange, continuous, emitOnZoomEnd]);
  
  return null;
});

const LabelPaneSetup = memo(function LabelPaneSetup() {
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
});

const MapViewportTracker = memo(function MapViewportTracker({
  onBoundsChange,
  onMovingChange,
  suppressZoomMoveState = false,
  disablePostZoomUpdates = false,
}: {
  onBoundsChange: (bounds: L.LatLngBounds) => void;
  onMovingChange: (isMoving: boolean) => void;
  suppressZoomMoveState?: boolean;
  disablePostZoomUpdates?: boolean;
}) {
  const map = useMap();
  const zoomingRef = useRef(false);
  const skipNextMoveEndRef = useRef(false);

  useEffect(() => {
    const updateBounds = () => onBoundsChange(map.getBounds());
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
    const onZoomEnd = () => {
      zoomingRef.current = false;

      if (disablePostZoomUpdates) {
        // Ignore the synthetic moveend that follows pinch/zoom to avoid end-of-gesture repaint.
        skipNextMoveEndRef.current = true;
        return;
      }

      skipNextMoveEndRef.current = true;
      if (!suppressZoomMoveState) {
        onMovingChange(false);
      }
      updateBounds();
    };

    updateBounds();
    map.on('movestart', onMoveStart);
    map.on('zoomstart', onZoomStart);
    map.on('moveend', onMoveEnd);
    map.on('zoomend', onZoomEnd);

    return () => {
      map.off('movestart', onMoveStart);
      map.off('zoomstart', onZoomStart);
      map.off('moveend', onMoveEnd);
      map.off('zoomend', onZoomEnd);
    };
  }, [map, onBoundsChange, onMovingChange, suppressZoomMoveState, disablePostZoomUpdates]);

  return null;
});

const GesturePrecisionController = memo(function GesturePrecisionController({
  enabled,
}: {
  enabled: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return;

    const container = map.getContainer();
    const stopMapAnimation = () => {
      if ((map as any)._animatingZoom || map.dragging?._draggable?._moving) {
        map.stop();
      }
    };

    const handleTouchEnd = () => {
      requestAnimationFrame(stopMapAnimation);
    };

    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [map, enabled]);

  return null;
});

const MapTapSelectionController = memo(function MapTapSelectionController({
  enabled,
  fieldBoundaries,
  onFieldTap,
  onEmptyTap,
}: {
  enabled: boolean;
  fieldBoundaries: GpsFieldBoundary[];
  onFieldTap?: (fieldId: number | string) => void;
  onEmptyTap?: () => void;
}) {
  const map = useMap();
  const pointerStartRef = useRef<{ x: number; y: number; at: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const TAP_MAX_DURATION_MS = 550;
    const TAP_MAX_DISTANCE_PX = 16;
    const container = map.getContainer();

    const toContainerPoint = (event: PointerEvent): { x: number; y: number } | null => {
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x, y };
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }

      const point = toContainerPoint(event);
      if (!point) {
        pointerStartRef.current = null;
        return;
      }

      pointerStartRef.current = {
        x: point.x,
        y: point.y,
        at: Date.now(),
      };
    };

    const handlePointerUp = (event: PointerEvent) => {
      const start = pointerStartRef.current;
      pointerStartRef.current = null;
      if (!start) return;

      const point = toContainerPoint(event);
      if (!point) return;

      const dt = Date.now() - start.at;
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      const distance = Math.sqrt((dx * dx) + (dy * dy));

      if (dt > TAP_MAX_DURATION_MS || distance > TAP_MAX_DISTANCE_PX) {
        return;
      }

      const latLng = map.containerPointToLatLng(L.point(point.x, point.y));
      const matchedBoundaryId = findBoundaryIdAtLatLng(fieldBoundaries, latLng.lat, latLng.lng);

      if (matchedBoundaryId != null) {
        onFieldTap?.(matchedBoundaryId);
        return;
      }

      onEmptyTap?.();
    };

    const clearPointerStart = () => {
      pointerStartRef.current = null;
    };

    container.addEventListener('pointerdown', handlePointerDown, { passive: true });
    container.addEventListener('pointerup', handlePointerUp, { passive: true });
    container.addEventListener('pointercancel', clearPointerStart, { passive: true });

    return () => {
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointerup', handlePointerUp);
      container.removeEventListener('pointercancel', clearPointerStart);
    };
  }, [map, enabled, fieldBoundaries, onFieldTap, onEmptyTap]);

  return null;
});

const TileHandoffController = memo(function TileHandoffController({
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
  const isLoadingRef = useRef(false);
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

    const pendingCount = tilePane.querySelectorAll('img.leaflet-tile:not(.leaflet-tile-loaded)').length;
    const drawableCount = tilePane.querySelectorAll('img.leaflet-tile-loaded, canvas').length;
    const mapLoading = (map as any)._loading === true || isLoadingRef.current;

    if (pendingCount > 0) {
      return true;
    }

    // During tile swap there can be a short gap where no pending images exist yet
    // and no drawable tiles remain in the pane. Treat that as still loading.
    if (mapLoading && drawableCount === 0) {
      return true;
    }

    return false;
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
    const minimumStableMs = 140;
    let settledAt: number | null = null;

    const tick = () => {
      if (!enabled) {
        hideSnapshot(0);
        return;
      }

      const elapsed = performance.now() - startedAt;
      if (hasPendingTiles()) {
        settledAt = null;
      } else {
        if (settledAt === null) {
          settledAt = performance.now();
        }

        if ((performance.now() - settledAt) >= minimumStableMs) {
          hideSnapshot(60);
          settleTimerRef.current = null;
          return;
        }
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

    const handleLoading = () => {
      isLoadingRef.current = true;
      startHandoff();
    };
    const handleLoad = () => {
      isLoadingRef.current = false;
      waitForTilesToSettle();
    };
    const handleZoomStart = () => startHandoff();
    const handleMoveEnd = () => waitForTilesToSettle();

    map.on('loading', handleLoading);
    map.on('load', handleLoad);
    map.on('zoomstart', handleZoomStart);
    map.on('moveend', handleMoveEnd);

    return () => {
      map.off('loading', handleLoading);
      map.off('load', handleLoad);
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
});

const TouchZoomEndStabilizer = memo(function TouchZoomEndStabilizer({
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
});

const SampleCanvasLayer = memo(function SampleCanvasLayer({
  enabled,
  pathPoints,
  suppressMoveEndInvalidate = false,
}: {
  enabled: boolean;
  pathPoints: [number, number][];
  suppressMoveEndInvalidate?: boolean;
}) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const size = map.getSize();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const targetWidth = Math.max(1, Math.round(size.x * dpr));
    const targetHeight = Math.max(1, Math.round(size.y * dpr));

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
    }
  }, [map]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!enabled || pathPoints.length === 0) {
      return;
    }

    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(canvas, topLeft);
    const toCanvasPoint = (latLng: [number, number]) => {
      const layerPoint = map.latLngToLayerPoint(latLng);
      return {
        x: layerPoint.x - topLeft.x,
        y: layerPoint.y - topLeft.y,
      };
    };

    const drawCrosses = (
      points: [number, number][],
      arm: number,
      strokeStyle: string,
      lineWidthValue: number,
      alpha: number
    ) => {
      if (points.length === 0) return;
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidthValue;
      ctx.lineCap = 'round';
      ctx.globalAlpha = alpha;

      ctx.beginPath();
      for (const latLng of points) {
        const point = toCanvasPoint(latLng);
        ctx.moveTo(point.x - arm, point.y - arm);
        ctx.lineTo(point.x + arm, point.y + arm);
        ctx.moveTo(point.x - arm, point.y + arm);
        ctx.lineTo(point.x + arm, point.y - arm);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    drawCrosses(pathPoints, 2.8, '#EF4444', 1.6, 0.95);
  }, [map, enabled, pathPoints]);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
    }

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      resizeCanvas();
      draw();
    });
  }, [draw, resizeCanvas]);

  useEffect(() => {
    const overlayPane = map.getPanes().overlayPane;
    const canvas = canvasRef.current ?? document.createElement('canvas');
    canvasRef.current = canvas;

    canvas.className = 'sample-canvas-layer leaflet-zoom-animated';
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '660';
    canvas.style.display = enabled ? 'block' : 'none';
    canvas.style.transformOrigin = '0 0';

    if (!overlayPane.contains(canvas)) {
      overlayPane.appendChild(canvas);
    }

    const handleInvalidate = () => scheduleDraw();
    if (suppressMoveEndInvalidate) {
      map.on('move', handleInvalidate);
      map.on('zoom', handleInvalidate);
    } else {
      map.on('viewreset', handleInvalidate);
      map.on('moveend', handleInvalidate);
    }
    map.on('resize', handleInvalidate);

    scheduleDraw();

    return () => {
      if (suppressMoveEndInvalidate) {
        map.off('move', handleInvalidate);
        map.off('zoom', handleInvalidate);
      } else {
        map.off('viewreset', handleInvalidate);
        map.off('moveend', handleInvalidate);
      }
      map.off('resize', handleInvalidate);
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (canvas.parentElement === overlayPane) {
        overlayPane.removeChild(canvas);
      }
    };
  }, [map, enabled, scheduleDraw, suppressMoveEndInvalidate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.display = enabled ? 'block' : 'none';
    }
    scheduleDraw();
  }, [enabled, scheduleDraw, pathPoints]);

  return null;
});

function MapView({
  currentPosition,
  tracks: _tracks,
  fieldSamples,
  fieldBoundaries = [],
  focusedBoundaryId = null,
  focusedBoundaryRequestId = 0,
  focusedTrackId: _focusedTrackId = null,
  isTracking,
  showNavigationButton = false,
  onNavigationClick,
  isNavigationOpen = false,
  isSidebarCollapsed = false,
  isCompactLandscapeLayout = false,
  recenterTrigger,
  onFieldClick,
  onMapEmptyTap,
}: MapViewProps) {
  const mapRef = useRef<L.Map | null>(null);
  const hasZoomedRef = useRef(false);
  const hasZoomedToBoundariesRef = useRef(false);
  const trackingCenterDoneRef = useRef(false);
  const boundaryFocusDoneRef = useRef(false);
  const lastFocusedBoundaryIdRef = useRef<number | null>(null);
  const lastFocusedBoundaryRequestKeyRef = useRef<string | null>(null);
  const snapState = useMemo(() => ({
    hasZoomedRef,
    hasZoomedToBoundariesRef,
    trackingCenterDoneRef,
    boundaryFocusDoneRef,
    lastFocusedBoundaryIdRef,
    lastFocusedBoundaryRequestKeyRef,
  }), []);
  const [isDark] = useDarkMode();
  const isDarkMode = isDark;
  const { t } = useLanguage();
  const MAP_MODE_STORAGE_KEY = 'gpsMapMode';
  const getInitialMapMode = (): 'osm' | 'satellite' => {
    if (typeof window === 'undefined') return 'osm';
    const stored = window.localStorage.getItem(MAP_MODE_STORAGE_KEY);
    return stored === 'satellite' ? 'satellite' : 'osm';
  };
  // Map mode: OSM or satellite (online only)
  const [mapMode, setMapMode] = useState<'osm' | 'satellite'>(getInitialMapMode);
  const useSatellite = mapMode === 'satellite';
  const useOSM = mapMode === 'osm';
  const germanyTilesAvailable = initialGermanyTilesAvailable;
  const offlineRasterAvailable = (window as any).__GERMANY_TILES_AVAILABLE__ === true;
  const offlinePmtilesUri = offlinePmtilesUrl ?? null;
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);
  const [isMapMoving, setIsMapMoving] = useState(false);
  const canvasRenderer = useMemo(() => L.canvas({ padding: 0.5 }), []);
  const labelCacheRef = useRef(new Map<string, { labelIconSmall: L.DivIcon; labelIconLarge: L.DivIcon; labelIconSmallOutlined: L.DivIcon; labelIconLargeOutlined: L.DivIcon }>());
  const boundaryLodCacheRef = useRef(new Map<string, { pointCount: number; positions: [number, number][][] }>());
  const boundaryMultiLodCacheRef = useRef(new Map<string, { pointCount: number; positions: [number, number][][][] }>());
  const manualSampleCacheRef = useRef(new Map<string, [number, number][]>());
  const [currentZoom, setCurrentZoom] = useState(13);
  const [mapFps, setMapFps] = useState(0);
  const [showPerfPanel] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('gpsPerfDebug') === '1';
  });
  const [effectiveHeading, setEffectiveHeading] = useState(0);
  const lastHeadingRef = useRef(0);
  const previousHeadingPositionRef = useRef<{ latitude: number; longitude: number; timestamp: number } | null>(null);
  
  // Advanced offline detection - checks both navigator.onLine and actual internet connectivity
  const [hasInternetAccess, setHasInternetAccess] = useState(navigator.onLine);
  const isOffline = !hasInternetAccess;
  const [showOfflinePrompt, setShowOfflinePrompt] = useState(false);
  const [offlinePromptDismissed, setOfflinePromptDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('offlineMapPromptDismissed') === 'true';
  });
  const [isDownloadingOffline, setIsDownloadingOffline] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [selectedPackId, setSelectedPackId] = useState<string>(() => getDefaultPack().id);
  const [userSelectedPack, setUserSelectedPack] = useState(false);

  useEffect(() => {
    // Reset and cap caches when core datasets change
    labelCacheRef.current.clear();
    boundaryLodCacheRef.current.clear();
    boundaryMultiLodCacheRef.current.clear();
    manualSampleCacheRef.current.clear();
  }, [fieldBoundaries]);

  useEffect(() => {
    pruneCacheMap(labelCacheRef.current, 800);
    pruneCacheMap(boundaryLodCacheRef.current, 1200);
    pruneCacheMap(boundaryMultiLodCacheRef.current, 1200);
    pruneCacheMap(manualSampleCacheRef.current, 500);
  }, [currentZoom, isMapMoving, fieldBoundaries.length]);

  useEffect(() => {
    if (!showPerfPanel) return;

    let rafId = 0;
    let frameCount = 0;
    let lastMark = performance.now();

    const tick = (now: number) => {
      frameCount += 1;
      const elapsed = now - lastMark;

      if (elapsed >= 500) {
        setMapFps(Math.round((frameCount * 1000) / elapsed));
        frameCount = 0;
        lastMark = now;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [showPerfPanel]);

  useEffect(() => {
    if (!currentPosition) {
      previousHeadingPositionRef.current = null;
      lastHeadingRef.current = 0;
      setEffectiveHeading(0);
      return;
    }

    const nextPoint: [number, number] = [currentPosition.latitude, currentPosition.longitude];
    const positionTimestamp = Number(currentPosition.timestamp || Date.now());
    const directHeading = normalizeHeading(currentPosition.heading);

    if (directHeading != null) {
      lastHeadingRef.current = directHeading;
      setEffectiveHeading(prev => (Math.abs(shortestHeadingDelta(prev, directHeading)) > 0.5 ? directHeading : prev));
      previousHeadingPositionRef.current = {
        latitude: currentPosition.latitude,
        longitude: currentPosition.longitude,
        timestamp: positionTimestamp
      };
      return;
    }

    const previous = previousHeadingPositionRef.current;
    if (previous) {
      const previousPoint: [number, number] = [previous.latitude, previous.longitude];
      const distanceMeters = haversineDistance(previousPoint, nextPoint);
      const elapsedSeconds = Math.max(0, positionTimestamp - previous.timestamp) / 1000;
      const gpsSpeed = Number.isFinite(currentPosition.speed as number) ? Number(currentPosition.speed) : 0;
      const inferredSpeed = elapsedSeconds > 0 ? distanceMeters / elapsedSeconds : 0;
      const isMoving = distanceMeters >= 1.2 || gpsSpeed >= 0.7 || inferredSpeed >= 0.7;

      if (isMoving) {
        const rawBearing = calculateBearing(previousPoint, nextPoint);
        const smoothedBearing = blendHeading(lastHeadingRef.current, rawBearing, 0.4);
        lastHeadingRef.current = smoothedBearing;
        setEffectiveHeading(prev => (Math.abs(shortestHeadingDelta(prev, smoothedBearing)) > 0.5 ? smoothedBearing : prev));
      }
    }

    previousHeadingPositionRef.current = {
      latitude: currentPosition.latitude,
      longitude: currentPosition.longitude,
      timestamp: positionTimestamp
    };
  }, [currentPosition]);

  const handleDismissOfflinePrompt = useCallback(() => {
    setShowOfflinePrompt(false);
    setOfflinePromptDismissed(true);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('offlineMapPromptDismissed', 'true');
    }
  }, []);


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
  const offlineTilesDisabled = offlineTilesDisabledByEnv;
  const shouldUseOfflineTiles = !offlineTilesDisabled && isWithinOfflineBounds && (germanyTilesAvailable || offlineTilesReady);
  const isOnline = !isOffline;
  const isNative = Capacitor.isNativePlatform();
  const isTabletPerformanceMode = isNative;
  const isCoarsePointerDevice = typeof window !== 'undefined' && (
    (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches)
    || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
  );
  const usePreciseGestures = isTabletPerformanceMode || isCoarsePointerDevice;
  const useWebLikeZoomBehavior = isNative;
  const enableGesturePrecisionController = usePreciseGestures && !useWebLikeZoomBehavior;
  // Keep previously loaded tiles visible while new tiles stream in.
  const tileKeepBuffer = isTabletPerformanceMode ? 8 : (useWebLikeZoomBehavior ? 4 : 4);
  const tileUpdateWhenZooming = useWebLikeZoomBehavior ? true : !usePreciseGestures;
  const tileUpdateWhenIdle = useWebLikeZoomBehavior ? false : (isTabletPerformanceMode ? false : true);
  const satelliteTileKeepBuffer = isTabletPerformanceMode ? Math.max(tileKeepBuffer, 6) : tileKeepBuffer;
  const satelliteUpdateWhenZooming = tileUpdateWhenZooming;
  const mapZoomAnimation = isTabletPerformanceMode ? false : (useWebLikeZoomBehavior ? true : !usePreciseGestures);
  const mapFadeAnimation = isTabletPerformanceMode ? false : (useWebLikeZoomBehavior ? true : !usePreciseGestures);
  const mapMarkerZoomAnimation = isTabletPerformanceMode ? false : (useWebLikeZoomBehavior ? true : !usePreciseGestures);
  const mapPanInertia = !usePreciseGestures;
  const mapBounceAtZoomLimits = !usePreciseGestures;
  const forceOfflineTiles = !offlineTilesDisabled && isNative && offlineTilesReady && !onlineTileUrl;
  // Disable tile handoff on tablet/native mode to avoid end-of-zoom snapshot swap flicker.
  const enableTileHandoff = isTabletPerformanceMode
    ? false
    : (isNative || (!usePreciseGestures && (shouldUseOfflineTiles || forceOfflineTiles)));
  const needsOfflineDownload = false;
  const preferRasterOnNative = !offlineTilesDisabled && isNative && offlineRasterAvailable && !offlinePmtilesUri;
  const activePackName = activePack.name;
  const hasDownloadUrl = !!activePack.downloadUrl;
  const canDownloadOffline = hasDownloadUrl && isOnline;
  const boundaryVisualZoom = isTabletPerformanceMode ? TABLET_BOUNDARY_VISUAL_ZOOM : currentZoom;
  const effectiveMapBounds = isTabletPerformanceMode ? null : mapBounds;
  const boundaryPointLimit = useMemo(() => {
    return getBoundaryPointLimit(boundaryVisualZoom, isMapMoving, isTabletPerformanceMode);
  }, [boundaryVisualZoom, isMapMoving, isTabletPerformanceMode]);

  const boundaryLodLevel = useMemo(() => {
    if (isTabletPerformanceMode) {
      // Fixed LOD on tablet prevents visible geometry snap between moving/idle states.
      return 'mid' as const;
    }

    return getBoundaryLodLevel(boundaryVisualZoom, isMapMoving);
  }, [boundaryVisualZoom, isMapMoving, isTabletPerformanceMode]);

  // Zoom change handler
  const handleZoomChange = useCallback((zoom: number) => {
    if (isTabletPerformanceMode) {
      return;
    }

    setCurrentZoom((prev) => (Math.abs(prev - zoom) < 0.001 ? prev : zoom));
  }, [isTabletPerformanceMode]);

  const handleMapBoundsChange = useCallback((bounds: L.LatLngBounds) => {
    if (isTabletPerformanceMode) {
      return;
    }

    setMapBounds((prev) => {
      if (prev && prev.equals(bounds)) {
        return prev;
      }
      return bounds;
    });
  }, [isTabletPerformanceMode]);

  const handleMapMovingChange = useCallback((moving: boolean) => {
    setIsMapMoving((prev) => (prev === moving ? prev : moving));
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

  const fieldsWithSamplesKey = useMemo(() => {
    const ids = new Set<string>();
    fieldSamples.forEach((sample) => {
      if (sample?.field_boundary_id != null) {
        ids.add(String(sample.field_boundary_id));
      }
    });
    return Array.from(ids).sort().join('|');
  }, [fieldSamples]);

  const fieldsWithSamples = useMemo(() => {
    if (!fieldsWithSamplesKey) {
      return new Set<string>();
    }

    return new Set(fieldsWithSamplesKey.split('|').filter(Boolean));
  }, [fieldsWithSamplesKey]);

  const boundaryRenderData = useMemo(() => {
    const lodLevel = boundaryLodLevel;

    return uniqueFieldBoundaries.map((boundary) => {
      if (!boundary) return null;
      const coordsRaw = getBoundaryLodCoordinates(boundary, lodLevel);
      if (!coordsRaw || !Array.isArray(coordsRaw) || coordsRaw.length === 0) return null;

      const centroid = getBoundaryCentroid(boundary);
      const fieldNumber = getFieldNumber(boundary.name);
      const pointCount = getBoundaryPointCount(boundary);

      if (boundary.geometry_type === 'Polygon') {
        const cacheKey = `${boundary.id}:${lodLevel}:${boundaryPointLimit}`;
        const cached = boundaryLodCacheRef.current.get(cacheKey);
        let positions: [number, number][][];

        if (cached && cached.pointCount === pointCount) {
          positions = cached.positions;
        } else {
          const rings = toLatLngRings(coordsRaw as number[][][]);
          if (rings.length === 0) return null;
          positions = simplifyRingsForPerformance(rings, boundaryPointLimit);
          boundaryLodCacheRef.current.set(cacheKey, { pointCount, positions });
        }

        const bounds = getBoundaryBounds(boundary, positions);
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
        const cacheKey = `${boundary.id}:${lodLevel}:${boundaryPointLimit}`;
        const cached = boundaryMultiLodCacheRef.current.get(cacheKey);
        let positions: [number, number][][][];

        if (cached && cached.pointCount === pointCount) {
          positions = cached.positions;
        } else {
          positions = toLatLngPolygons(coordsRaw as number[][][][]);
          if (positions.length === 0) return null;
          positions = simplifyPolygonsForPerformance(positions, boundaryPointLimit);
          boundaryMultiLodCacheRef.current.set(cacheKey, { pointCount, positions });
        }

        const bounds = getBoundaryBounds(boundary, positions);
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
  }, [uniqueFieldBoundaries, boundaryLodLevel, boundaryPointLimit]);

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
      : boundaryRenderData.filter(item => effectiveMapBounds.intersects(item.bounds));

    const ranked = [...visible]
      .sort((a, b) => {
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
      const isFocused = focusedBoundaryId != null && String(item.boundary.id) === String(focusedBoundaryId);
      const overRenderLimit = selected.length >= boundaryRenderLimit;
      const overVertexBudget = Number.isFinite(boundaryVertexBudget) && (usedVertices + item.vertexCount) > boundaryVertexBudget;

      if (!isFocused && (overRenderLimit || overVertexBudget)) {
        continue;
      }

      selected.push(item);
      usedVertices += item.vertexCount;

      if (selected.length >= boundaryRenderLimit && (!Number.isFinite(boundaryVertexBudget) || usedVertices >= boundaryVertexBudget)) {
        break;
      }
    }

    if (focusedBoundaryId != null && !selected.some((item) => String(item.boundary.id) === String(focusedBoundaryId))) {
      const focused = ranked.find((item) => String(item.boundary.id) === String(focusedBoundaryId));
      if (focused) {
        selected.unshift(focused);
      }
    }

    return selected.slice(0, boundaryRenderLimit);
  }, [boundaryRenderData, effectiveMapBounds, boundaryRenderLimit, boundaryVertexBudget, focusedBoundaryId]);

  const activeBoundaryRenderData = useMemo(() => {
    // Keep outlines visible while moving; fill/labels are simplified separately.
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
      if (visible.size >= labelLimit) break;
    }
    return visible;
  }, [activeBoundaryRenderData, labelLimit]);

  const boundaryRenderStats = useMemo(() => {
    let rings = 0;
    let vertices = 0;

    for (const item of activeBoundaryRenderData) {
      if (item.type === 'Polygon') {
        rings += item.positions.length;
        vertices += countRingVertices(item.positions);
      } else {
        rings += item.positions.reduce((sum, polygon) => sum + polygon.length, 0);
        vertices += countPolygonVertices(item.positions);
      }
    }

    return {
      boundaries: activeBoundaryRenderData.length,
      rings,
      vertices,
    };
  }, [activeBoundaryRenderData]);

  const renderedBoundaries = useMemo(() => {
    return activeBoundaryRenderData.map((item) => {
      const boundary = item.boundary;
      const hasSamplesInField = fieldsWithSamples.has(String(boundary.id));
      const boundarySamplingState = getBoundarySamplingState(boundary);
      const fieldColor = boundarySamplingState.status === 'completed'
        ? '#16A34A'
        : hasSamplesInField
          ? '#FF4D6D'
          : (boundary.color || '#00FF00');
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
      const isFocusedField = focusedBoundaryId != null && String(boundary.id) === String(focusedBoundaryId);
      const baseFocusedWeight = boundaryVisualZoom < 14 ? 1.6 : 2.1;
      const baseRegularWeight = boundaryVisualZoom < 14 ? 0.9 : 1.2;
      const fieldWeight = isFocusedField ? baseFocusedWeight : baseRegularWeight;
      const fillOpacity = (isTabletPerformanceMode ? false : isMapMoving) ? 0 : (isFocusedField ? 0.14 : 0.10);
      const showManualSamples = !isTabletPerformanceMode && boundaryVisualZoom >= 15 && (focusedBoundaryId == null || isFocusedField);
      const showSampleX = !isMapMoving && boundaryVisualZoom >= 16;
      const startEndRadius = boundaryVisualZoom < 16 ? 6 : 8;
      const midRadius = boundaryVisualZoom < 16 ? 5 : 7;
      const renderManualSamples = () => {
        if (!showManualSamples || !boundary.manual_samples?.enabled || boundary.manual_samples.count <= 0) {
          return null;
        }

        const manualSampleCount = boundary.manual_samples.count;
        const manualSampleCacheKey = `${boundary.id}:${manualSampleCount}:${getBoundaryGeometryVersionKey(boundary)}`;
        let samplePositions = manualSampleCacheRef.current.get(manualSampleCacheKey);
        if (!samplePositions) {
          samplePositions = calculateManualSamplePositions(boundary, manualSampleCount);
          manualSampleCacheRef.current.set(manualSampleCacheKey, samplePositions);
        }

        const dotColor = fieldColor;

        return (
          <>
            {samplePositions.length > 0 && (
              <Circle
                center={samplePositions[0]}
                radius={pixelRadiusToMeters(boundaryVisualZoom, samplePositions[0][0], startEndRadius)}
                pathOptions={{
                  color: '#ffffff',
                  fillColor: dotColor,
                  fillOpacity: 1,
                  weight: 3,
                }}
                renderer={canvasRenderer}
              />
            )}

            {samplePositions.slice(1, -1).map((pos: [number, number], idx: number) => (
              <div key={`manual-sample-${boundary.id}-${idx}`}>
                <Circle
                  center={pos}
                  radius={pixelRadiusToMeters(boundaryVisualZoom, pos[0], midRadius)}
                  pathOptions={{
                    color: '#ffffff',
                    fillColor: dotColor,
                    fillOpacity: 0.9,
                    weight: 3,
                  }}
                  renderer={canvasRenderer}
                />
                {showSampleX && (
                  <CircleMarker
                    center={pos}
                    radius={boundaryVisualZoom >= 17 ? 2 : 1.5}
                    pathOptions={{
                      color: '#ffffff',
                      fillColor: '#111111',
                      fillOpacity: 0.95,
                      weight: 1,
                    }}
                    renderer={canvasRenderer}
                  />
                )}
              </div>
            ))}

            {samplePositions.length > 1 && (
              <Circle
                center={samplePositions[samplePositions.length - 1]}
                radius={pixelRadiusToMeters(boundaryVisualZoom, samplePositions[samplePositions.length - 1][0], startEndRadius)}
                pathOptions={{
                  color: '#ffffff',
                  fillColor: dotColor,
                  fillOpacity: 1,
                  weight: 3,
                }}
                renderer={canvasRenderer}
              />
            )}
          </>
        );
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
                weight: fieldWeight,
              }}
              interactive={true}
              renderer={canvasRenderer}
              eventHandlers={{
                click: (event) => {
                  if (event.originalEvent) {
                    L.DomEvent.stop(event.originalEvent);
                  }
                  onFieldClick?.(boundary.id);
                }
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

            {renderManualSamples()}
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
                  weight: fieldWeight,
                }}
                interactive={true}
                renderer={canvasRenderer}
                eventHandlers={{
                  click: (event) => {
                    if (event.originalEvent) {
                      L.DomEvent.stop(event.originalEvent);
                    }
                    onFieldClick?.(boundary.id);
                  }
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

            {renderManualSamples()}
          </div>
        );
      }

      return null;
    });
  }, [
    activeBoundaryRenderData,
    fieldsWithSamples,
    boundaryVisualZoom,
    isMapMoving,
    isTabletPerformanceMode,
    canvasRenderer,
    onFieldClick,
    visibleLabelIds,
    focusedBoundaryId,
    getLabelIcons,
    useSatellite,
  ]);

  const fieldSamplesForRender = useMemo(() => {
    const sorted = fieldSamples
      .filter((sample): sample is GpsFieldSample => Boolean(sample))
      .sort((a, b) => {
        const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        if (aTime !== bTime) return aTime - bTime;
        return (a.sample_number || 0) - (b.sample_number || 0);
      });

    if (isTabletPerformanceMode) {
      if (focusedBoundaryId == null) {
        return [] as GpsFieldSample[];
      }

      return sorted.filter((sample) => String(sample.field_boundary_id) === String(focusedBoundaryId));
    }

    if (focusedBoundaryId == null) {
      return sorted;
    }

    return sorted.filter((sample) => String(sample.field_boundary_id) === String(focusedBoundaryId));
  }, [fieldSamples, focusedBoundaryId, isTabletPerformanceMode]);

  const sampleBounds = effectiveMapBounds;

  const sampleRenderData = useMemo(() => {
    const emptyData = {
      sampleLinePoints: [] as [number, number][],
      crossArmSegmentsA: [] as [number, number][][],
      crossArmSegmentsB: [] as [number, number][][],
      anchorCenters: [] as [number, number][],
      waypointCenters: [] as [number, number][],
      visibleSampleCount: 0,
      crossSampleCount: 0,
      anchorSampleCount: 0,
      waypointSampleCount: 0,
      renderLimit: 0,
      showSampleCrosses: false,
      showSampleWaypoints: false,
    };

    if (fieldSamplesForRender.length === 0) {
      return emptyData;
    }

    if (isTabletPerformanceMode) {
      const renderLimit = getTabletSamplePathLimit(TABLET_BOUNDARY_VISUAL_ZOOM, isMapMoving);
      const sampleLinePoints = reduceSamplesToPathPoints(fieldSamplesForRender, renderLimit);

      if (sampleLinePoints.length === 0) {
        return {
          ...emptyData,
          renderLimit,
        };
      }

      return {
        ...emptyData,
        sampleLinePoints,
        visibleSampleCount: sampleLinePoints.length,
        renderLimit,
      };
    }

    const renderLimit = getFieldSampleRenderLimit(currentZoom, isMapMoving, false);
    const minDistanceMeters = getFieldSampleMinDistanceMeters(currentZoom, isMapMoving, false);
    let visibleSamples = fieldSamplesForRender;

    if (sampleBounds) {
      const padded = sampleBounds.pad(0.1);
      visibleSamples = visibleSamples.filter((sample) => padded.contains([sample.latitude, sample.longitude]));
    }

    visibleSamples = thinFieldSamplesForRender(visibleSamples, minDistanceMeters, renderLimit);

    if (visibleSamples.length === 0) {
      return {
        ...emptyData,
        renderLimit,
      };
    }

    const crossLimit = getFieldSampleCrossLimit(currentZoom, false);
    const waypointLimit = getFieldSampleDotLimit(currentZoom, isMapMoving, false);
    const showSampleCrosses = !isMapMoving && crossLimit > 0;
    const showSampleWaypoints = !isMapMoving && waypointLimit > 0;
    const sampleLinePoints = visibleSamples.map((sample) => [sample.latitude, sample.longitude] as [number, number]);
    const crossArmSegmentsA: [number, number][][] = [];
    const crossArmSegmentsB: [number, number][][] = [];
    const anchorCenters: [number, number][] = [];
    const waypointCenters: [number, number][] = [];
    const crossSamples = showSampleCrosses
      ? thinFieldSamplesForRender(visibleSamples, minDistanceMeters * 1.4, crossLimit)
      : [];
    const interiorSamples = visibleSamples.length > 2 ? visibleSamples.slice(1, -1) : [];
    const waypointSamples = showSampleWaypoints
      ? thinFieldSamplesForRender(interiorSamples, minDistanceMeters * 1.6, waypointLimit)
      : [];

    if (sampleLinePoints.length > 0) {
      anchorCenters.push(sampleLinePoints[0]);
      if (sampleLinePoints.length > 1) {
        anchorCenters.push(sampleLinePoints[sampleLinePoints.length - 1]);
      }
    }

    if (showSampleCrosses) {
      for (const sample of crossSamples) {
        const [aStart, aEnd, bStart, bEnd] = getSampleCrossArms(
          sample.latitude,
          sample.longitude,
          currentZoom,
          isMapMoving
        );
        crossArmSegmentsA.push([aStart, aEnd]);
        crossArmSegmentsB.push([bStart, bEnd]);
      }
    }

    if (showSampleWaypoints) {
      for (const sample of waypointSamples) {
        waypointCenters.push([sample.latitude, sample.longitude]);
      }
    }

    return {
      sampleLinePoints,
      crossArmSegmentsA,
      crossArmSegmentsB,
      anchorCenters,
      waypointCenters,
      visibleSampleCount: visibleSamples.length,
      crossSampleCount: crossSamples.length,
      anchorSampleCount: anchorCenters.length,
      waypointSampleCount: waypointSamples.length,
      renderLimit,
      showSampleCrosses,
      showSampleWaypoints,
    };
  }, [
    fieldSamplesForRender,
    currentZoom,
    isMapMoving,
    isTabletPerformanceMode,
    sampleBounds,
  ]);

  const fieldSampleRenderStats = useMemo(() => {
    const sampleVertices = sampleRenderData.sampleLinePoints.length +
      (sampleRenderData.showSampleCrosses ? sampleRenderData.crossSampleCount * 4 : 0) +
      sampleRenderData.anchorSampleCount +
      (sampleRenderData.showSampleWaypoints ? sampleRenderData.waypointSampleCount : 0);

    return {
      selectedSamples: fieldSamplesForRender.length,
      renderedSamples: sampleRenderData.visibleSampleCount,
      sampleVertices,
      sampleLimit: sampleRenderData.renderLimit,
      crossSamples: sampleRenderData.crossSampleCount,
      dotSamples: sampleRenderData.waypointSampleCount,
    };
  }, [fieldSamplesForRender.length, sampleRenderData]);

  const renderedFieldSamples = useMemo(() => {
    if (isTabletPerformanceMode) {
      return null;
    }

    if (sampleRenderData.sampleLinePoints.length === 0) {
      return null;
    }

    const crossWeight = isMapMoving ? 1.8 : 2.1;

    return (
      <>
        {sampleRenderData.anchorCenters.length > 0 && (
          sampleRenderData.anchorCenters.map((center, idx) => (
            <CircleMarker
              key={`sample-anchor-${idx}-${center[0]}-${center[1]}`}
              center={center}
              radius={currentZoom >= 16 ? 2.4 : 2.0}
              pathOptions={{
                color: '#ffffff',
                fillColor: '#EF4444',
                fillOpacity: 0.95,
                weight: 1,
              }}
              pane="overlayPane"
              renderer={canvasRenderer}
            />
          ))
        )}

        {sampleRenderData.showSampleWaypoints && sampleRenderData.waypointCenters.length > 0 && (
          sampleRenderData.waypointCenters.map((center, idx) => (
            <CircleMarker
              key={`sample-waypoint-${idx}-${center[0]}-${center[1]}`}
              center={center}
              radius={1.4}
              pathOptions={{
                color: '#FCA5A5',
                fillColor: '#EF4444',
                fillOpacity: 0.9,
                weight: 0.7,
              }}
              pane="overlayPane"
              renderer={canvasRenderer}
            />
          ))
        )}

        {sampleRenderData.showSampleCrosses && sampleRenderData.crossArmSegmentsA.length > 0 && (
          <Polyline
            positions={sampleRenderData.crossArmSegmentsA}
            pathOptions={{
              color: '#EF4444',
              weight: crossWeight,
              opacity: 0.98,
              lineCap: 'round',
            }}
            pane="overlayPane"
            renderer={canvasRenderer}
          />
        )}

        {sampleRenderData.showSampleCrosses && sampleRenderData.crossArmSegmentsB.length > 0 && (
          <Polyline
            positions={sampleRenderData.crossArmSegmentsB}
            pathOptions={{
              color: '#EF4444',
              weight: crossWeight,
              opacity: 0.98,
              lineCap: 'round',
            }}
            pane="overlayPane"
            renderer={canvasRenderer}
          />
        )}
      </>
    );
  }, [sampleRenderData, currentZoom, isMapMoving, isTabletPerformanceMode, canvasRenderer]);

  const renderedTracks = null;


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
      setShowOfflinePrompt(false);
    }
  }, [isDownloadingOffline, isOnline, t, activePack]);
  
  useEffect(() => {
    const handleOnline = () => {
      setHasInternetAccess(true);
    };
    const handleOffline = () => {
      setHasInternetAccess(false);
    };

    setHasInternetAccess(navigator.onLine);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Force map rerender and retry tiles on connectivity change
  useEffect(() => {
    setMapKey(k => k + 1);
    if (hasInternetAccess) {
      setTimeout(() => mapRef.current?.invalidateSize?.(), 150);
    }
  }, [hasInternetAccess]);
  const _forceOffline = isOffline;
  const [showLabels, setShowLabels] = useState(true); // Show labels on satellite
  const [mapKey, setMapKey] = useState(0); // Force map refresh on network change
  const _pmtilesVersion = import.meta.env.VITE_PMTILES_VERSION || '20260122';
  // Fixed control position just right of sidebar header; keep it closer to the menu edge
  const desiredLeftPx = isCompactLandscapeLayout ? 236 : 344;
  const controlsLeftPx = typeof window !== 'undefined'
    ? Math.min(Math.max(isCompactLandscapeLayout ? 8 : 16, desiredLeftPx), window.innerWidth - (isCompactLandscapeLayout ? 88 : 120))
    : desiredLeftPx;
  const controlPositionStyle = { left: `${controlsLeftPx}px`, right: 'auto' };
  const floatingControlsClass = isCompactLandscapeLayout
    ? 'absolute top-2 z-[4000] flex flex-col gap-0.5 transition-all duration-300 ease-in-out'
    : 'absolute top-4 z-[4000] flex flex-col gap-1 md:gap-1 transition-all duration-300 ease-in-out';
  const navigationButtonSizeClass = isCompactLandscapeLayout ? 'w-9 h-9' : 'w-10 h-10 md:w-12 md:h-12';
  const navigationButtonPositionClass = isNavigationOpen
    ? (isCompactLandscapeLayout ? 'hidden' : 'hidden md:flex md:right-[29rem] lg:right-[32rem]')
    : (isCompactLandscapeLayout ? 'right-3' : 'right-4');
  const navigationIconClass = isCompactLandscapeLayout ? 'w-4 h-4' : 'w-5 h-5 md:w-6 md:h-6';
  const mapModeButtonClass = isCompactLandscapeLayout
    ? `group h-10 flex items-center transition-all glass-panel ${isDarkMode ? 'glass-panel-dark' : 'glass-panel-light'
      } ${isOffline
        ? 'opacity-50 cursor-not-allowed'
        : isDarkMode ? 'text-white hover:text-gray-200' : 'text-black hover:text-gray-700'
      } hover:-translate-y-0.5 active:scale-95 duration-300 ease-in-out w-10 justify-center hover:w-28 hover:gap-1.5 hover:px-2.5 hover:justify-start ${isOffline ? 'hover:w-10' : ''}`
    : `group h-12 md:h-14 flex items-center transition-all glass-panel ${isDarkMode ? 'glass-panel-dark' : 'glass-panel-light'
      } ${isOffline
        ? 'opacity-50 cursor-not-allowed' 
        : isDarkMode ? 'text-white hover:text-gray-200' : 'text-black hover:text-gray-700'
      } hover:-translate-y-0.5 active:scale-95 duration-300 ease-in-out w-12 md:w-14 justify-center hover:w-36 hover:md:w-40 hover:gap-2 hover:px-3 hover:justify-start ${isOffline ? 'hover:w-12 md:hover:w-14' : ''}`;
  const mapModeIconClass = isCompactLandscapeLayout ? 'w-6 h-6 flex-shrink-0' : 'w-8 h-8 md:w-10 md:h-10 flex-shrink-0';
  const mapModeLabelClass = isCompactLandscapeLayout
    ? `text-[11px] font-medium whitespace-nowrap overflow-hidden transition-all duration-300 max-w-0 opacity-0 ${isOffline ? '' : 'group-hover:max-w-[112px] group-hover:opacity-100'}`
    : `text-xs md:text-sm font-medium whitespace-nowrap overflow-hidden transition-all duration-300 max-w-0 opacity-0 ${isOffline ? '' : 'group-hover:max-w-[140px] group-hover:opacity-100'}`;

  const centerOnCurrentLocation = useCallback(() => {
    if (currentPosition && mapRef.current) {
      const projectBounds = fieldBoundaries.length > 0
        ? buildFieldViewportBounds(fieldBoundaries, currentPosition)
        : null;

      if (projectBounds) {
        mapRef.current.fitBounds(projectBounds, {
          padding: [70, 70],
          maxZoom: 17,
          animate: !isTabletPerformanceMode,
        });
        return;
      }

      mapRef.current.setView([currentPosition.latitude, currentPosition.longitude], 19); // Zoom 19 = ~2.5m per pixel
    }
  }, [currentPosition, fieldBoundaries, isTabletPerformanceMode]);

  const DEFAULT_CENTER: [number, number] = [49.6116, 6.1319]; // Luxembourg

  // Handle external recenter trigger
  useEffect(() => {
    if (recenterTrigger && recenterTrigger > 0) {
      centerOnCurrentLocation();
    }
  }, [recenterTrigger, centerOnCurrentLocation]);

  const cycleMapMode = () => {
    setMapMode((prev) => {
      const next = prev === 'osm' ? 'satellite' : 'osm';
      if (next === 'satellite') {
        setShowLabels(true);
      }
      return next;
    });
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MAP_MODE_STORAGE_KEY, mapMode);
    window.dispatchEvent(new CustomEvent('gps-map-mode-changed', { detail: { mode: mapMode } }));
  }, [mapMode]);

  // Restrict zoom only when we actually use offline Germany tiles
  const usingOfflineGermanyTiles = shouldUseOfflineTiles && !useSatellite && !useOSM;
  const effectiveInitialZoom = usingOfflineGermanyTiles ? 13 : 18;

  // Tile source logging removed to reduce console spam

  return (
    <div className={`w-full h-full ${isCompactLandscapeLayout ? 'gps-compact-landscape' : ''}`}>
      <MapContainer
        key={mapKey}
        center={currentPosition ? [currentPosition.latitude, currentPosition.longitude] : DEFAULT_CENTER}
        zoom={effectiveInitialZoom}
        maxZoom={19}
        zoomSnap={0}
        zoomDelta={1}
        worldCopyJump={true}
        maxBounds={LEAFLET_WORLD_BOUNDS}
        maxBoundsViscosity={1}
        inertia={mapPanInertia}
        bounceAtZoomLimits={mapBounceAtZoomLimits}
        zoomControl={false}
        attributionControl={false}
        className={`w-full h-full ${shouldUseOfflineTiles ? 'pmtiles-active' : ''}`}
        ref={mapRef}
        preferCanvas={true}
        zoomAnimation={mapZoomAnimation}
        fadeAnimation={mapFadeAnimation}
        markerZoomAnimation={mapMarkerZoomAnimation}
      >
        {/* MapScaleUpdater removed for lighter rendering */}
        <LabelPaneSetup />
        <GesturePrecisionController enabled={enableGesturePrecisionController} />
        <TouchZoomEndStabilizer enabled={isTabletPerformanceMode} />
        <MapTapSelectionController
          enabled={usePreciseGestures}
          fieldBoundaries={uniqueFieldBoundaries}
          onFieldTap={onFieldClick}
          onEmptyTap={onMapEmptyTap}
        />
        <TileHandoffController enabled={enableTileHandoff} />
        {!isTabletPerformanceMode && (
          <MapViewportTracker
            onBoundsChange={handleMapBoundsChange}
            onMovingChange={handleMapMovingChange}
            suppressZoomMoveState={isTabletPerformanceMode}
            disablePostZoomUpdates={isTabletPerformanceMode}
          />
        )}
        {/* Tile Layer - Street Map or Satellite */}
        {(() => {

          if (useOSM && !isOffline) {
            return (
              <TileLayer
                key="osm-map"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                maxZoom={19}
                noWrap={true}
                attribution='© OpenStreetMap contributors'
                crossOrigin={getTileLayerCrossOrigin('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')}
                tileSize={256}
                keepBuffer={tileKeepBuffer}
                updateWhenIdle={tileUpdateWhenIdle}
                updateWhenZooming={tileUpdateWhenZooming}
                reuseTiles={true}
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
                noWrap={true}
                attribution='Offline Maps - Germany Base Map (OpenStreetMap Data)'
                errorTileUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
                crossOrigin={getTileLayerCrossOrigin('/tiles/germany/{z}/{x}/{y}.png')}
                keepBuffer={tileKeepBuffer}
                updateWhenIdle={tileUpdateWhenIdle}
                updateWhenZooming={tileUpdateWhenZooming}
                reuseTiles={true}
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
                noWrap={true}
                attribution='© OpenStreetMap contributors | Offline PMTiles'
                theme={Capacitor.isNativePlatform() && isDarkMode ? 'dark' : 'light'}
                schema="openmaptiles"
                disableLabels={isTabletPerformanceMode}
                keepBuffer={isTabletPerformanceMode ? Math.max(tileKeepBuffer, 6) : tileKeepBuffer}
                updateWhenIdle={tileUpdateWhenIdle}
                updateWhenZooming={tileUpdateWhenZooming}
                tileDelay={isTabletPerformanceMode ? 0.01 : 3}
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
                noWrap={true}
                attribution='Offline Maps - Germany Base Map (OpenStreetMap Data)'
                errorTileUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
                crossOrigin={getTileLayerCrossOrigin('/tiles/germany/{z}/{x}/{y}.png')}
                keepBuffer={tileKeepBuffer}
                updateWhenIdle={tileUpdateWhenIdle}
                updateWhenZooming={tileUpdateWhenZooming}
                reuseTiles={true}
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
                noWrap={true}
                attribution='Offline fallback (no tiles available)'
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
                  noWrap={true}
                  keepBuffer={satelliteTileKeepBuffer}
                  updateWhenIdle={tileUpdateWhenIdle}
                  updateWhenZooming={satelliteUpdateWhenZooming}
                  reuseTiles={true}
                  attribution='&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                />
                {showLabels && (
                  <TileLayer
                    key="esri-labels"
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                    maxZoom={20}
                    noWrap={true}
                    opacity={0.7}
                    keepBuffer={satelliteTileKeepBuffer}
                    updateWhenIdle={tileUpdateWhenIdle}
                    updateWhenZooming={satelliteUpdateWhenZooming}
                    reuseTiles={true}
                    attribution='&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                  />
                )}
              </>
            );
          }

          // Street map (self-hosted preferred, fallback to OSM online)
          const rasterFallback = germanyTilesAvailable ? '/tiles/germany/{z}/{x}/{y}.png' : null;
          const baseOnlineUrl = onlineTileUrl || rasterFallback || null;

          if (!baseOnlineUrl) {
            console.warn('[MapView] No online tiles configured for native; showing blank fallback.');
            return (
              <TileLayer
                key="street-map-blank"
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
              key="street-map"
              url={baseOnlineUrl}
              maxZoom={19}
              maxNativeZoom={19}
              noWrap={true}
              attribution={onlineTileUrl || rasterFallback ? 'Self-hosted tiles' : '© OpenStreetMap contributors'}
              crossOrigin={getTileLayerCrossOrigin(baseOnlineUrl)}
              tileSize={256}
              keepBuffer={tileKeepBuffer}
              updateWhenIdle={tileUpdateWhenIdle}
              updateWhenZooming={tileUpdateWhenZooming}
              reuseTiles={true}
            />
          );
        })()}
        {!isTabletPerformanceMode && (
          <ZoomTracker
            onZoomChange={handleZoomChange}
            continuous={true}
            emitOnZoomEnd={!isTabletPerformanceMode}
          />
        )}
        <MapController
          currentPosition={currentPosition}
          fieldBoundaries={uniqueFieldBoundaries}
          focusedBoundaryId={focusedBoundaryId}
          focusedBoundaryRequestId={focusedBoundaryRequestId}
          isTracking={isTracking}
          snapState={snapState}
        />

        {/* Current position marker with accuracy circle */}
        {currentPosition && (
          <>
            {/* Accuracy circle - shows reported GPS precision */}
            {!isMapMoving && (
              <Circle
                center={[currentPosition.latitude, currentPosition.longitude]}
                radius={currentPosition.accuracy ? currentPosition.accuracy : 5}
                pathOptions={{
                  color: '#3b82f6',
                  fillColor: '#3b82f6',
                  fillOpacity: 0.1,
                  weight: 2,
                  className: 'gps-accuracy-circle',
                }}
              />
            )}

            <Marker
              position={[currentPosition.latitude, currentPosition.longitude]}
              icon={createCurrentLocationArrow(effectiveHeading)}
            />
          </>
        )}

        {/* Render all field boundaries (polygons from shapefiles) */}
        {renderedBoundaries}

        <SampleCanvasLayer
          enabled={isTabletPerformanceMode && sampleRenderData.sampleLinePoints.length > 0}
          pathPoints={sampleRenderData.sampleLinePoints}
          suppressMoveEndInvalidate={isTabletPerformanceMode}
        />

        {/* Render dedicated field samples (web vector path only) */}
        {renderedFieldSamples}

        {/* Render viewport-filtered tracks - memoized for performance */}
        {renderedTracks}
      </MapContainer>

      {showPerfPanel && (
        <div className="absolute right-3 top-3 z-[5000] rounded-md bg-black/75 px-3 py-2 text-[11px] leading-4 text-white shadow-lg backdrop-blur-sm">
          <div className="font-semibold">Map Perf</div>
          <div>fps: {mapFps}</div>
          <div>moving: {isMapMoving ? 'yes' : 'no'}</div>
          <div>boundaries: {boundaryRenderStats.boundaries}</div>
          <div>boundary vertices: {boundaryRenderStats.vertices}</div>
          <div>boundary budget: {Number.isFinite(boundaryVertexBudget) ? boundaryVertexBudget : 'off'}</div>
          <div>samples in field: {fieldSampleRenderStats.selectedSamples}</div>
          <div>samples rendered: {fieldSampleRenderStats.renderedSamples}</div>
          <div>sample vertices: {fieldSampleRenderStats.sampleVertices}</div>
          <div>sample limit: {fieldSampleRenderStats.sampleLimit}</div>
          <div>sample crosses: {fieldSampleRenderStats.crossSamples}</div>
          <div>sample dots: {fieldSampleRenderStats.dotSamples}</div>
        </div>
      )}

      {import.meta.env.VITE_ENABLE_OFFLINE_PROMPT_BANNER === 'true' && showOfflinePrompt && (
        <div
          className={`fixed top-2 left-1/2 z-[6000] w-[92%] max-w-xl -translate-x-1/2 px-4 py-3 text-xs md:text-sm glass-panel ${isDarkMode ? 'glass-panel-dark text-white' : 'glass-panel-light text-gray-900'}`}
        >
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

      {/* Navigation Button - Bottom right, hidden when navigation panel is open on mobile, moves left on desktop */}
      {showNavigationButton && onNavigationClick && (
        <button
          onClick={onNavigationClick}
          className={`absolute bottom-4 z-[1500] ${navigationButtonSizeClass} flex items-center justify-center text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-full transition-all duration-300 ${navigationButtonPositionClass}`}
          title={t('common.navigation') || 'Navigation'}
        >
          <Navigation2 className={navigationIconClass} />
        </button>
      )}

      {/* Floating controls - hide when sidebar is collapsed */}
      {!isSidebarCollapsed && (
      <div
        className={floatingControlsClass}
        style={controlPositionStyle}
      >
        {/* Map Type Switch Button - Default/OSM/Satellite with Labels */}
        <div className="relative flex items-center gap-2">
          <button
            onClick={() => {
              if (isOffline) {
                console.log('[MapView] Map mode switch disabled - offline');
                return;
              }
              cycleMapMode();
            }}
            disabled={isOffline}
            className={mapModeButtonClass}
            title={
              isOffline
                ? 'Map mode switch requires internet connection'
                : mapMode === 'osm'
                ? 'Switch to Satellite'
                : 'Switch to OpenMap'
            }
          >
            <Satellite className={mapModeIconClass} />
            <span className={mapModeLabelClass}>
              {mapMode === 'osm' ? 'OpenMap' : 'Satellite'}
              {isOffline && <span className="ml-1 text-red-500">✕</span>}
            </span>
          </button>

          {/* DROPDOWN MENU - COMMENTED OUT FOR NOW */}
          {/* {showSettingsMenu && (
            <div
              className={`mt-2 w-52 md:w-56 shadow-2xl overflow-hidden glass-panel ${isDarkMode ? 'glass-panel-dark' : 'glass-panel-light'
                }`}
              style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.3))' }}
            >
              <div className={`p-2.5 md:p-3 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                <div className={`text-xs font-semibold mb-1.5 md:mb-2 uppercase ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('nav.layers') || 'Layers'}
                </div>

                <button
                  onClick={() => {
                    setUseSatellite(!useSatellite);
                    if (!useSatellite) {
                      setShowLabels(true);
                    }
                  }}
                  className={`w-full flex items-center gap-2 md:gap-3 px-2 md:px-3 py-1.5 md:py-2 rounded-md transition-colors ${isDarkMode
                      ? 'hover:bg-gray-700 active:bg-gray-700/70 text-gray-200'
                      : 'hover:bg-gray-100 active:bg-gray-100/70 text-gray-800'
                    }`}
                >
                  <Layers className="w-3.5 h-3.5 md:w-4 md:h-4 flex-shrink-0" />
                  <span className="text-xs md:text-sm flex-1 text-left">
                    {useSatellite ? (t('nav.streetMap') || 'Street Map') : (t('nav.satelliteMap') || 'Satellite Map')}
                  </span>
                  <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {useSatellite ? '○' : '●'}
                  </span>
                </button>

                {useSatellite && (
                  <button
                    onClick={() => setShowLabels(!showLabels)}
                    className={`w-full flex items-center gap-2 md:gap-3 px-2 md:px-3 py-1.5 md:py-2 rounded-md transition-colors mt-1 ${isDarkMode
                        ? 'hover:bg-gray-700 active:bg-gray-700/70 text-gray-200'
                        : 'hover:bg-gray-100 active:bg-gray-100/70 text-gray-800'
                      }`}
                  >
                    <Tag className="w-3.5 h-3.5 md:w-4 md:h-4 ml-4 md:ml-6 flex-shrink-0" />
                    <span className="text-xs md:text-sm flex-1 text-left">
                      {t('nav.labels') || 'Labels'}
                    </span>
                    <span className={`text-xs ${showLabels ? 'text-green-500' : (isDarkMode ? 'text-gray-500' : 'text-gray-400')}`}>
                      {showLabels ? '●' : '○'}
                    </span>
                  </button>
                )}
              </div>

              {onDeviceManagerClick && (
                <div className={`p-2.5 md:p-3 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                  <div className={`text-xs font-semibold mb-1.5 md:mb-2 uppercase ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {t('gps.devices.title') || 'GPS Device'}
                  </div>
                  <button
                    onClick={() => {
                      onDeviceManagerClick();
                      setShowSettingsMenu(false);
                    }}
                    className={`w-full flex items-center gap-2 md:gap-3 px-2 md:px-3 py-1.5 md:py-2 rounded-md transition-colors ${isDarkMode
                        ? 'hover:bg-gray-700 active:bg-gray-700/70 text-gray-200'
                        : 'hover:bg-gray-100 active:bg-gray-100/70 text-gray-800'
                      }`}
                  >
                    <Satellite className={`w-3.5 h-3.5 md:w-4 md:h-4 flex-shrink-0 ${connectedDevice ? 'text-green-500' : ''}`} />
                    <span className="text-xs md:text-sm flex-1 text-left truncate">
                      {connectedDevice
                        ? (t('gps.devices.connected') || 'Connected')
                        : (t('gps.devices.manage') || 'Manage Devices')}
                    </span>
                    {connectedDevice && (
                      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse flex-shrink-0"></span>
                    )}
                  </button>
                </div>
              )}

              {isTracking && onAddSample && currentPosition && (
                <div className="p-2.5 md:p-3">
                  <button
                    onClick={() => {
                      onAddSample();
                      setShowSettingsMenu(false);
                    }}
                    className={`w-full flex items-center gap-2 md:gap-3 px-2 md:px-3 py-1.5 md:py-2 rounded-md transition-colors ${isDarkMode
                        ? 'hover:bg-gray-700 active:bg-gray-700/70 text-gray-200'
                        : 'hover:bg-gray-100 active:bg-gray-100/70 text-gray-800'
                      }`}
                  >
                    <MapPin className="w-3.5 h-3.5 md:w-4 md:h-4 flex-shrink-0" />
                    <span className="text-xs md:text-sm flex-1 text-left">
                      {t('gps.sample') || 'Add Sample Point'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )} */}
        </div>

      </div>
      )}
    </div>
  );
}

export default memo(MapView);
