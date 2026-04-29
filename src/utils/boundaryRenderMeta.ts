import type { GeoJSONGeometry } from './geometryUtils';
import { getBoundingBox, normalizeGeometry, simplifyGeometryForStorage } from './geometryUtils';
import type { GpsFieldBoundaryRenderMeta } from '../types';

export type BoundaryLodLevel = 'low' | 'mid' | 'high';

const LOD_TARGET_POINTS = {
  low: 160,
  mid: 520,
  high: 1200,
} as const;

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value);
};

const isValidBbox = (value: unknown): value is [number, number, number, number] => {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const [minLon, minLat, maxLon, maxLat] = value;
  if (!isFiniteNumber(minLon) || !isFiniteNumber(minLat) || !isFiniteNumber(maxLon) || !isFiniteNumber(maxLat)) {
    return false;
  }
  return minLon <= maxLon && minLat <= maxLat;
};

const isValidCentroid = (value: unknown): value is [number, number] | null => {
  if (value === null) return true;
  if (!Array.isArray(value) || value.length !== 2) return false;
  return isFiniteNumber(value[0]) && isFiniteNumber(value[1]);
};

const countGeometryPoints = (geometry: GeoJSONGeometry): number => {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.reduce((sum: number, ring: number[][]) => sum + (ring?.length || 0), 0);
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.reduce(
      (sum: number, polygon: number[][][]) => sum + polygon.reduce((pSum, ring) => pSum + (ring?.length || 0), 0),
      0
    );
  }

  if (geometry.type === 'LineString') {
    return geometry.coordinates.length;
  }

  return 0;
};

const centroidFromPolygonCoordinates = (rings: number[][][] | undefined): [number, number] | null => {
  if (!rings || !Array.isArray(rings) || rings.length === 0) return null;

  const outerRing = rings[0];
  if (!outerRing || outerRing.length === 0) return null;

  let sumLat = 0;
  let sumLon = 0;
  let validPoints = 0;

  for (const coord of outerRing) {
    if (!Array.isArray(coord) || coord.length < 2) continue;
    const lon = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    sumLat += lat;
    sumLon += lon;
    validPoints += 1;
  }

  if (validPoints === 0) return null;
  return [sumLat / validPoints, sumLon / validPoints];
};

const calculateGeometryCentroid = (geometry: GeoJSONGeometry): [number, number] | null => {
  if (geometry.type === 'Polygon') {
    return centroidFromPolygonCoordinates(geometry.coordinates as number[][][]);
  }

  if (geometry.type === 'MultiPolygon') {
    const polygons = geometry.coordinates as number[][][][];
    const firstPolygon = polygons[0];
    return centroidFromPolygonCoordinates(firstPolygon);
  }

  return null;
};

const extractCoordinates = (geometry: GeoJSONGeometry): number[][][] | number[][][][] => {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates as number[][][];
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates as number[][][][];
  }

  return [] as number[][][];
};

export const getBoundaryLodLevel = (zoom: number, isMoving: boolean): BoundaryLodLevel => {
  if (isMoving || zoom < 13) return 'low';
  if (zoom < 15) return 'mid';
  return 'high';
};

export const buildBoundaryRenderMeta = (rawGeometry: unknown): GpsFieldBoundaryRenderMeta => {
  const geometry = normalizeGeometry(rawGeometry);
  const bbox = getBoundingBox(geometry);
  const pointCount = countGeometryPoints(geometry);

  const lowGeometry = simplifyGeometryForStorage(geometry, LOD_TARGET_POINTS.low);
  const midGeometry = simplifyGeometryForStorage(geometry, LOD_TARGET_POINTS.mid);
  const highGeometry = simplifyGeometryForStorage(geometry, LOD_TARGET_POINTS.high);

  return {
    bbox,
    centroid: calculateGeometryCentroid(geometry),
    point_count: pointCount,
    lod: {
      low: extractCoordinates(lowGeometry),
      mid: extractCoordinates(midGeometry),
      high: extractCoordinates(highGeometry),
    },
    schema_version: 1,
    updated_at: new Date().toISOString(),
  };
};

export const normalizeBoundaryRenderMeta = (
  rawMeta: unknown,
  rawGeometry?: unknown
): GpsFieldBoundaryRenderMeta | undefined => {
  const meta = rawMeta as Partial<GpsFieldBoundaryRenderMeta> | undefined;

  if (
    meta &&
    isValidBbox(meta.bbox) &&
    isValidCentroid(meta.centroid) &&
    typeof meta.point_count === 'number' &&
    Number.isFinite(meta.point_count) &&
    meta.point_count >= 0
  ) {
    return {
      bbox: meta.bbox,
      centroid: meta.centroid,
      point_count: Math.floor(meta.point_count),
      lod: {
        low: meta.lod?.low,
        mid: meta.lod?.mid,
        high: meta.lod?.high,
      },
      schema_version: typeof meta.schema_version === 'number' ? meta.schema_version : 1,
      updated_at: typeof meta.updated_at === 'string' ? meta.updated_at : new Date().toISOString(),
    };
  }

  if (rawGeometry == null) {
    return undefined;
  }

  try {
    return buildBoundaryRenderMeta(rawGeometry);
  } catch {
    return undefined;
  }
};
