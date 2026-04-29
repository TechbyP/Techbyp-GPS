export interface DrawnField {
  id: string;
  baseId: string;
  baseName: string;
  areaHa: number;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  color?: string;
}