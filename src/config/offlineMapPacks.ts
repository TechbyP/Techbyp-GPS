import { getGermanyBounds } from '../utils/tileUtils';

export interface OfflineMapPack {
  id: string;
  name: string;
  bounds: [[number, number], [number, number]];
  bundledUrl?: string;
  downloadUrl?: string;
  fileName?: string;
}

const NIEDERSACHSEN_BOUNDS: [[number, number], [number, number]] = [
  [51.293485, 6.295165],
  [54.239552, 11.607313]
];

const disableBundled = (import.meta.env.VITE_DISABLE_BUNDLED_PMTILES as string | undefined) === 'true';

export const OFFLINE_MAP_PACKS: OfflineMapPack[] = [
  {
    id: 'niedersachsen',
    name: 'Lower Saxony (Niedersachsen)',
    bounds: NIEDERSACHSEN_BOUNDS,
    bundledUrl: disableBundled ? undefined : '/tiles/germany.pmtiles',
    downloadUrl: (import.meta.env.VITE_PMTILES_DOWNLOAD_URL as string | undefined) || '',
    fileName: 'germany.pmtiles'
  },
  {
    id: 'germany-full',
    name: 'Germany (Full)',
    bounds: getGermanyBounds(),
    downloadUrl: (import.meta.env.VITE_PMTILES_GERMANY_URL as string | undefined) || '',
    fileName: 'germany-full.pmtiles'
  }
];

export const getPackForLocation = (lat: number, lng: number): OfflineMapPack | null => {
  for (const pack of OFFLINE_MAP_PACKS) {
    const [[south, west], [north, east]] = pack.bounds;
    if (lat >= south && lat <= north && lng >= west && lng <= east) {
      return pack;
    }
  }
  return null;
};

export const getDefaultPack = (): OfflineMapPack => OFFLINE_MAP_PACKS[0];
