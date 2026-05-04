import area from '@turf/area';
import intersect from '@turf/intersect';
import { featureCollection } from '@turf/helpers';

export type PolygonGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

type SplitAxis = 'lng' | 'lat';

export type GeometryBounds = {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
};

export type BalancedSamplingCell = {
  geometry: PolygonGeometry;
  areaHa: number;
  index: number;
  row: number;
  column: number;
};

const MIN_CELL_AREA_HA = 0.08;
const BINARY_SEARCH_ITERATIONS = 24;
const AXIS_EPSILON = 1e-9;
const DEFAULT_MIN_CELL_AREA_RATIO = 1 / 3;
const MAX_MERGED_CELL_AREA_MULTIPLIER = 1.85;

const asPolygonGeometry = (geometry: GeoJSON.Geometry | null | undefined): PolygonGeometry | null => {
  if (!geometry) return null;
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
    return geometry;
  }
  return null;
};

export const geometryAreaHa = (geometry: PolygonGeometry): number => {
  const rawArea = area({ type: 'Feature', properties: {}, geometry }) / 10000;
  if (!Number.isFinite(rawArea) || rawArea <= 0) return 0;
  return Number(rawArea.toFixed(6));
};

export const buildGeometryBounds = (geometry: PolygonGeometry): GeometryBounds | null => {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  const walk = (node: any) => {
    if (!Array.isArray(node) || node.length === 0) return;
    if (typeof node[0] === 'number') {
      const lng = Number(node[0]);
      const lat = Number(node[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      return;
    }
    node.forEach((child) => walk(child));
  };

  walk(geometry.coordinates);

  if (![minLng, maxLng, minLat, maxLat].every(Number.isFinite)) {
    return null;
  }

  return { minLng, maxLng, minLat, maxLat };
};

const toMultiPolygonCoordinates = (geometry: PolygonGeometry): number[][][][] => (
  geometry.type === 'Polygon'
    ? [geometry.coordinates as number[][][]]
    : (geometry.coordinates as number[][][][])
);

const mergeCellGeometry = (
  left: PolygonGeometry,
  right: PolygonGeometry
): PolygonGeometry => {
  const coordinates = [
    ...toMultiPolygonCoordinates(left),
    ...toMultiPolygonCoordinates(right),
  ];

  if (coordinates.length === 1) {
    return {
      type: 'Polygon',
      coordinates: coordinates[0],
    };
  }

  return {
    type: 'MultiPolygon',
    coordinates,
  };
};

const normalizeCellIndexes = (cells: BalancedSamplingCell[]): BalancedSamplingCell[] => (
  cells.map((cell, index) => ({
    ...cell,
    index: index + 1,
    row: index,
    column: 0,
  }))
);

const mergeTinyCells = (
  cells: BalancedSamplingCell[],
  targetCellAreaHa: number,
  minPreferredCellAreaHa: number
): BalancedSamplingCell[] => {
  if (cells.length <= 1) {
    return normalizeCellIndexes(cells);
  }

  const maxMergedAreaHa = Math.max(
    targetCellAreaHa * MAX_MERGED_CELL_AREA_MULTIPLIER,
    minPreferredCellAreaHa * 1.5
  );

  const working = cells.map((cell) => ({
    ...cell,
    areaHa: Number(cell.areaHa.toFixed(6)),
  }));

  let index = 0;
  while (index < working.length && working.length > 1) {
    const current = working[index];
    if (current.areaHa >= minPreferredCellAreaHa) {
      index += 1;
      continue;
    }

    const leftIndex = index > 0 ? index - 1 : -1;
    const rightIndex = index < working.length - 1 ? index + 1 : -1;

    const candidates: Array<{ neighborIndex: number; mergedArea: number; overflow: number }> = [];
    if (leftIndex >= 0) {
      const mergedArea = current.areaHa + working[leftIndex].areaHa;
      candidates.push({
        neighborIndex: leftIndex,
        mergedArea,
        overflow: Math.max(0, mergedArea - maxMergedAreaHa),
      });
    }
    if (rightIndex >= 0) {
      const mergedArea = current.areaHa + working[rightIndex].areaHa;
      candidates.push({
        neighborIndex: rightIndex,
        mergedArea,
        overflow: Math.max(0, mergedArea - maxMergedAreaHa),
      });
    }

    if (!candidates.length) {
      index += 1;
      continue;
    }

    candidates.sort((a, b) => {
      if (a.overflow !== b.overflow) return a.overflow - b.overflow;
      const aDistance = Math.abs(a.mergedArea - targetCellAreaHa);
      const bDistance = Math.abs(b.mergedArea - targetCellAreaHa);
      return aDistance - bDistance;
    });

    const neighborIndex = candidates[0].neighborIndex;
    if (neighborIndex < index) {
      const merged = {
        ...working[neighborIndex],
        geometry: mergeCellGeometry(working[neighborIndex].geometry, current.geometry),
        areaHa: Number((working[neighborIndex].areaHa + current.areaHa).toFixed(6)),
      };
      working[neighborIndex] = merged;
      working.splice(index, 1);
      index = Math.max(0, neighborIndex - 1);
      continue;
    }

    const merged = {
      ...current,
      geometry: mergeCellGeometry(current.geometry, working[neighborIndex].geometry),
      areaHa: Number((current.areaHa + working[neighborIndex].areaHa).toFixed(6)),
    };
    working[neighborIndex] = merged;
    working.splice(index, 1);
    index = Math.max(0, index - 1);
  }

  return normalizeCellIndexes(working);
};

const buildAxisWindowPolygon = (
  axis: SplitAxis,
  start: number,
  end: number,
  bounds: GeometryBounds
): GeoJSON.Polygon => {
  if (axis === 'lng') {
    return {
      type: 'Polygon',
      coordinates: [[
        [start, bounds.minLat],
        [end, bounds.minLat],
        [end, bounds.maxLat],
        [start, bounds.maxLat],
        [start, bounds.minLat],
      ]],
    };
  }

  return {
    type: 'Polygon',
    coordinates: [[
      [bounds.minLng, start],
      [bounds.maxLng, start],
      [bounds.maxLng, end],
      [bounds.minLng, end],
      [bounds.minLng, start],
    ]],
  };
};

const clipGeometryByAxisWindow = (
  sourceFeature: GeoJSON.Feature<PolygonGeometry>,
  bounds: GeometryBounds,
  axis: SplitAxis,
  start: number,
  end: number
): PolygonGeometry | null => {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start <= AXIS_EPSILON) {
    return null;
  }

  const windowFeature: GeoJSON.Feature<GeoJSON.Polygon> = {
    type: 'Feature',
    properties: {},
    geometry: buildAxisWindowPolygon(axis, start, end, bounds),
  };

  const clipped = intersect(featureCollection([
    sourceFeature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
    windowFeature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  ]));

  return asPolygonGeometry(clipped?.geometry);
};

type AxisPlan = {
  cells: BalancedSamplingCell[];
  score: number;
  minAreaHa: number;
};

const buildAxisPlan = (
  geometry: PolygonGeometry,
  bounds: GeometryBounds,
  axis: SplitAxis,
  desiredCount: number,
  targetCellAreaHa: number,
  totalAreaHa: number,
  minPreferredCellAreaHa: number
): AxisPlan | null => {
  const axisMin = axis === 'lng' ? bounds.minLng : bounds.minLat;
  const axisMax = axis === 'lng' ? bounds.maxLng : bounds.maxLat;
  if (!Number.isFinite(axisMin) || !Number.isFinite(axisMax) || axisMax - axisMin <= AXIS_EPSILON) {
    return null;
  }

  const sourceFeature: GeoJSON.Feature<PolygonGeometry> = {
    type: 'Feature',
    properties: {},
    geometry,
  };

  const cuts: number[] = [axisMin];
  for (let index = 1; index < desiredCount; index += 1) {
    const targetCumulativeArea = (totalAreaHa * index) / desiredCount;
    let low = cuts[cuts.length - 1];
    let high = axisMax;

    for (let iteration = 0; iteration < BINARY_SEARCH_ITERATIONS; iteration += 1) {
      const mid = (low + high) / 2;
      const clipped = clipGeometryByAxisWindow(sourceFeature, bounds, axis, axisMin, mid);
      const clippedAreaHa = clipped ? geometryAreaHa(clipped) : 0;
      if (clippedAreaHa < targetCumulativeArea) {
        low = mid;
      } else {
        high = mid;
      }
    }

    cuts.push((low + high) / 2);
  }
  cuts.push(axisMax);

  const cells: BalancedSamplingCell[] = [];
  for (let index = 1; index < cuts.length; index += 1) {
    const start = cuts[index - 1];
    const end = cuts[index];
    const clipped = clipGeometryByAxisWindow(sourceFeature, bounds, axis, start, end);
    if (!clipped) continue;
    const clippedAreaHa = geometryAreaHa(clipped);
    if (clippedAreaHa < MIN_CELL_AREA_HA) continue;

    const cellIndex = cells.length + 1;
    cells.push({
      geometry: clipped,
      areaHa: clippedAreaHa,
      index: cellIndex,
      row: cellIndex - 1,
      column: 0,
    });
  }

  if (!cells.length) return null;

  const mergedCells = mergeTinyCells(cells, targetCellAreaHa, minPreferredCellAreaHa);
  if (!mergedCells.length) return null;

  const areas = mergedCells.map((cell) => cell.areaHa);
  const totalCoveredArea = areas.reduce((sum, value) => sum + value, 0);
  const averageArea = totalCoveredArea / mergedCells.length;
  const minArea = Math.min(...areas);
  const maxArea = Math.max(...areas);
  const spread = maxArea - minArea;
  const tinyCount = areas.filter((value) => value < minPreferredCellAreaHa).length;
  const countPenalty = Math.abs(mergedCells.length - desiredCount) * targetCellAreaHa;
  const averagePenalty = Math.abs(averageArea - targetCellAreaHa);
  const coveragePenalty = Math.max(0, 1 - (totalCoveredArea / Math.max(totalAreaHa, AXIS_EPSILON))) * targetCellAreaHa * 8;

  const score = -(
    (averagePenalty * 2.2)
    + (spread * 0.9)
    + (tinyCount * targetCellAreaHa * 7)
    + countPenalty
    + coveragePenalty
  );

  return {
    cells: mergedCells,
    score,
    minAreaHa: minArea,
  };
};

const buildSingleCellFallback = (geometry: PolygonGeometry): BalancedSamplingCell[] => {
  const areaHa = geometryAreaHa(geometry);
  if (!areaHa) return [];
  return [{
    geometry,
    areaHa,
    index: 1,
    row: 0,
    column: 0,
  }];
};

export const buildBalancedSamplingCells = (
  geometry: PolygonGeometry,
  targetCellAreaHa: number,
  maxCells: number = 500
): BalancedSamplingCell[] => {
  const safeTargetCellAreaHa = Math.max(0.1, Number(targetCellAreaHa) || 0.1);
  const safeMaxCells = Math.max(1, Math.floor(maxCells));
  const minPreferredCellAreaHa = Math.max(MIN_CELL_AREA_HA, safeTargetCellAreaHa * DEFAULT_MIN_CELL_AREA_RATIO);
  const totalAreaHa = geometryAreaHa(geometry);

  if (!totalAreaHa) return [];
  if (totalAreaHa <= Math.max(safeTargetCellAreaHa * 0.75, MIN_CELL_AREA_HA * 1.5)) {
    return buildSingleCellFallback(geometry);
  }

  const bounds = buildGeometryBounds(geometry);
  if (!bounds) {
    return buildSingleCellFallback(geometry);
  }

  const rawCount = totalAreaHa / safeTargetCellAreaHa;
  const maxCountByMinimum = Math.max(1, Math.floor(totalAreaHa / minPreferredCellAreaHa));
  const countCandidates = Array.from(new Set([
    Math.max(1, Math.floor(rawCount)),
    Math.max(1, Math.round(rawCount)),
    Math.max(1, Math.ceil(rawCount)),
  ]))
    .filter((value) => value <= safeMaxCells && value <= maxCountByMinimum)
    .sort((a, b) => a - b);

  if (!countCandidates.length) {
    countCandidates.push(Math.max(1, Math.min(safeMaxCells, Math.round(rawCount) || 1)));
  }
  if (!countCandidates.includes(1)) {
    countCandidates.unshift(1);
  }

  let bestPlan: AxisPlan | null = null;
  countCandidates.forEach((candidateCount) => {
    (['lng', 'lat'] as SplitAxis[]).forEach((axis) => {
      const candidatePlan = buildAxisPlan(
        geometry,
        bounds,
        axis,
        candidateCount,
        safeTargetCellAreaHa,
        totalAreaHa,
        minPreferredCellAreaHa
      );
      if (!candidatePlan) return;
      if (!bestPlan) {
        bestPlan = candidatePlan;
        return;
      }

      if (
        candidatePlan.score > bestPlan.score
        || (
          Math.abs(candidatePlan.score - bestPlan.score) < 1e-6
          && candidatePlan.minAreaHa > bestPlan.minAreaHa
        )
      ) {
        bestPlan = candidatePlan;
      }
    });
  });

  if (!bestPlan || !bestPlan.cells.length) {
    return buildSingleCellFallback(geometry);
  }

  return bestPlan.cells;
};
