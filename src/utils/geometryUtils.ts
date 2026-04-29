/**
 * Geometry Validation and Normalization Utility
 * 
 * Handles GeoJSON geometry objects with proper validation and serialization.
 * Fixes Issue #13: Double serialization and type inconsistency problems.
 * 
 * Key improvements:
 * - Single source of truth for geometry validation
 * - Prevents double serialization
 * - Type-safe GeoJSON handling
 * - Coordinate precision preservation
 * - Proper error messages
 */

export interface GeoJSONGeometry {
  type: 'Point' | 'LineString' | 'Polygon' | 'MultiPoint' | 'MultiLineString' | 'MultiPolygon';
  coordinates: any; // Varies by type
}

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: GeoJSONGeometry;
  properties?: Record<string, any>;
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

export type GeoJSON = GeoJSONGeometry | GeoJSONFeature | GeoJSONFeatureCollection;

/**
 * Validate that geometry has required GeoJSON structure
 */
export function isValidGeoJSONGeometry(geometry: any): geometry is GeoJSONGeometry {
  if (!geometry || typeof geometry !== 'object') return false;
  
  const validTypes = ['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon'];
  if (!validTypes.includes(geometry.type)) return false;
  
  if (!geometry.coordinates) return false;
  if (!Array.isArray(geometry.coordinates)) return false;
  if (geometry.coordinates.length === 0) return false;
  
  return true;
}

/**
 * Validate coordinate precision (avoid floating point issues)
 */
export function validateCoordinatePrecision(coords: number, maxPrecision: number = 8): number {
  // Round to specified decimal places to avoid floating point drift
  return Math.round(coords * Math.pow(10, maxPrecision)) / Math.pow(10, maxPrecision);
}

/**
 * Normalize geometry input from various sources
 * Handles:
 * - Raw GeoJSON objects
 * - JSON strings
 * - Wrapped objects { geometry: {...} }
 * - Feature objects with nested geometry
 */
export function normalizeGeometry(input: any): GeoJSONGeometry {
  if (!input) {
    throw new Error('Geometry is required');
  }

  let geometry = input;

  // CRITICAL FIX: If it's a string, parse it repeatedly until we get an object
  // Handles single, double, or even triple serialized JSON strings
  while (typeof geometry === 'string') {
    try {
      geometry = JSON.parse(geometry);
    } catch (error) {
      throw new Error(`Invalid geometry JSON string: ${error instanceof Error ? error.message : 'parse failed'}`);
    }
  }

  // Unwrap Feature objects
  if (geometry.type === 'Feature' && geometry.geometry) {
    geometry = geometry.geometry;
  }

  // Unwrap nested { geometry: {...} } wrapper
  if (geometry.geometry && typeof geometry.geometry === 'object') {
    geometry = geometry.geometry;
  }

  // Validate final structure
  if (!isValidGeoJSONGeometry(geometry)) {
    throw new Error(
      `Invalid GeoJSON geometry: ${
        !geometry.type ? 'missing type' :
        !geometry.coordinates ? 'missing coordinates' :
        !Array.isArray(geometry.coordinates) ? 'coordinates must be an array' :
        geometry.coordinates.length === 0 ? 'coordinates cannot be empty' :
        'invalid structure'
      }`
    );
  }

  return geometry;
}

/**
 * Serialize geometry for Firestore storage
 * Firestore doesn't support nested arrays, so we store as JSON string
 * 
 * IMPORTANT: This is the ONLY place geometry should be stringified
 */
export function serializeGeometryForFirestore(geometry: GeoJSONGeometry): string {
  if (!isValidGeoJSONGeometry(geometry)) {
    throw new Error('Cannot serialize invalid geometry');
  }

  // Use JSON.stringify with NO space parameter to minimize size
  // This is deterministic and preserves precision
  return JSON.stringify(geometry);
}

/**
 * Simplify geometry by downsampling rings to a maximum number of points.
 * Keeps closure for polygon rings when needed.
 */
export function simplifyGeometryForStorage(
  geometry: GeoJSONGeometry,
  maxPointsPerRing: number = 2000
): GeoJSONGeometry {
  if (!isValidGeoJSONGeometry(geometry)) {
    throw new Error('Cannot simplify invalid geometry');
  }

  const simplifyRing = (ring: number[][]): number[][] => {
    if (!Array.isArray(ring) || ring.length <= maxPointsPerRing) {
      return ring;
    }

    const step = Math.max(1, Math.ceil(ring.length / maxPointsPerRing));
    const simplified = ring.filter((_, idx) => idx % step === 0);
    if (simplified.length < 4) {
      return ring;
    }

    const first = simplified[0];
    const last = simplified[simplified.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      simplified.push(first);
    }

    return simplified;
  };

  if (geometry.type === 'Polygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map(simplifyRing)
    };
  }

  if (geometry.type === 'MultiPolygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map(poly => poly.map(simplifyRing))
    };
  }

  return geometry;
}

/**
 * Deserialize geometry from Firestore storage
 * 
 * IMPORTANT: This is the ONLY place geometry strings should be parsed
 */
export function deserializeGeometryFromFirestore(input: any): GeoJSONGeometry {
  // If already an object, validate and return
  if (typeof input === 'object' && input !== null) {
    if (isValidGeoJSONGeometry(input)) {
      return input;
    }
    throw new Error('Invalid geometry object from Firestore');
  }

  // If string, parse once
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (!isValidGeoJSONGeometry(parsed)) {
        throw new Error('Parsed geometry is invalid');
      }
      return parsed;
    } catch (error) {
      throw new Error(`Failed to deserialize geometry: ${error instanceof Error ? error.message : 'parse failed'}`);
    }
  }

  throw new Error(`Invalid geometry type from Firestore: ${typeof input}`);
}

/**
 * Calculate approximate area of a polygon in square meters
 * Uses Shoelace formula for simple polygons
 */
export function calculatePolygonArea(geometry: GeoJSONGeometry): number {
  if (geometry.type !== 'Polygon') {
    throw new Error('Can only calculate area for Polygon geometry');
  }

  const coords = geometry.coordinates[0]; // Outer ring
  if (!coords || coords.length < 3) {
    return 0;
  }

  // Approximate conversion: 1 degree latitude ≈ 111km, longitude varies by latitude
  const latToMeters = 111000;
  let area = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];
    
    const lonToMeters = 111000 * Math.cos((lat1 * Math.PI) / 180);
    const x1 = lon1 * lonToMeters;
    const y1 = lat1 * latToMeters;
    const x2 = lon2 * lonToMeters;
    const y2 = lat2 * latToMeters;
    
    area += (x1 * y2) - (x2 * y1);
  }

  return Math.abs(area / 2);
}

/**
 * Calculate length of a LineString in meters
 */
export function calculateLineStringLength(geometry: GeoJSONGeometry): number {
  if (geometry.type !== 'LineString') {
    throw new Error('Can only calculate length for LineString geometry');
  }

  const coords = geometry.coordinates;
  if (!coords || coords.length < 2) {
    return 0;
  }

  let totalLength = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];
    
    // Haversine formula for great-circle distance
    const R = 6371000; // Earth radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    totalLength += R * c;
  }

  return totalLength;
}

/**
 * Get bounding box for geometry [minLon, minLat, maxLon, maxLat]
 */
export function getBoundingBox(geometry: GeoJSONGeometry): [number, number, number, number] {
  let allCoords: number[][] = [];

  // Extract all coordinates based on geometry type
  switch (geometry.type) {
    case 'Point':
      allCoords = [geometry.coordinates];
      break;
    case 'LineString':
      allCoords = geometry.coordinates;
      break;
    case 'Polygon':
      allCoords = geometry.coordinates.flat();
      break;
    case 'MultiPoint':
      allCoords = geometry.coordinates;
      break;
    case 'MultiLineString':
      allCoords = geometry.coordinates.flat();
      break;
    case 'MultiPolygon':
      allCoords = geometry.coordinates.flat(2);
      break;
  }

  if (allCoords.length === 0) {
    throw new Error('No coordinates found in geometry');
  }

  let minLon = Infinity, minLat = Infinity;
  let maxLon = -Infinity, maxLat = -Infinity;

  for (const [lon, lat] of allCoords) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }

  return [minLon, minLat, maxLon, maxLat];
}
