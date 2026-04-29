import type { GpsFieldBoundary } from '../types';
import { normalizeBoundaryRenderMeta } from './boundaryRenderMeta';

// Normalize boundary properties coming from imports or Firestore
export const normalizeBoundaryProperties = (rawProps: any): Record<string, any> => {
  let props: any = rawProps || {};
  if (typeof props === 'string') {
    try {
      props = JSON.parse(props);
    } catch {
      props = {};
    }
  }

  const normalized: Record<string, any> = { ...props };
  for (const [key, value] of Object.entries(props)) {
    const lower = key.toLowerCase();
    const normalizedKey = lower.replace(/[^a-z0-9]+/g, '_');

    if (normalized.CROP === undefined && normalizedKey === 'crop') normalized.CROP = value;
    if (normalized.season === undefined && (normalizedKey === 'season' || normalizedKey === 'season_nam' || normalizedKey === 'seasonname')) normalized.season = value;
    if (normalized.season_start === undefined && (normalizedKey === 'season_start' || normalizedKey === 'season_sta' || normalizedKey === 'seasonstart')) normalized.season_start = value;
    if (normalized.season_end === undefined && (normalizedKey === 'season_end' || normalizedKey === 'season_end_dat' || normalizedKey === 'season_end_date' || normalizedKey === 'seasonend')) normalized.season_end = value;
    if (normalized.uid === undefined && (normalizedKey === 'uid' || normalizedKey === 'uuid')) normalized.uid = value;
  }

  return normalized;
};

export const normalizeBoundary = (boundary: any): GpsFieldBoundary => {
  const rawGeometry = boundary?.geometry ?? boundary;
  let parsedGeometry = rawGeometry;

  if (typeof rawGeometry === 'string') {
    try {
      parsedGeometry = JSON.parse(rawGeometry);
    } catch {
      parsedGeometry = rawGeometry;
    }
  }

  const geometryType = boundary?.geometry_type || parsedGeometry?.type;
  const coordinates = boundary?.coordinates || parsedGeometry?.coordinates;
  const normalizedGeometry = geometryType && coordinates
    ? { type: geometryType, coordinates }
    : parsedGeometry;

  const properties = normalizeBoundaryProperties(boundary?.properties ?? parsedGeometry?.properties ?? {});
  const renderMeta = normalizeBoundaryRenderMeta(boundary?.render_meta, normalizedGeometry);

  return {
    ...boundary,
    geometry: normalizedGeometry,
    geometry_type: geometryType || normalizedGeometry?.type || 'Polygon',
    coordinates: coordinates || normalizedGeometry?.coordinates || [],
    render_meta: renderMeta,
    properties,
    color: boundary?.color,
    project_id: boundary?.project_id,
    created_at: boundary?.created_at || Date.now(),
  } as GpsFieldBoundary & { geometry?: any };
};

export const normalizeBoundaries = (boundaries: any[]): GpsFieldBoundary[] => {
  return (boundaries || []).map((boundary) => normalizeBoundary(boundary));
};
