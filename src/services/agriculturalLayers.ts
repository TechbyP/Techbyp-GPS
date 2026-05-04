/**
 * Agricultural Map Layers Service
 * Provides specialized map overlays for agricultural soil sampling:
 * - Topographic/terrain layers
 * - Water bodies and hydrology
 * - Cadastral/parcel boundaries
 * - Soil type maps
 * - Satellite imagery with NDVI
 * - Country roads and agricultural paths
 */

import { getBundledGermanyPmtilesUrl } from '../utils/tileUtils';

export interface MapLayer {
  id: string;
  name: string;
  description: string;
  url: string;
  type: 'tile' | 'wms';
  attribution: string;
  opacity?: number;
  minZoom?: number;
  maxZoom?: number;
  // WMS-specific options
  layers?: string;
  format?: string;
  transparent?: boolean;
  // Available regions
  regions?: string[];
  requiresOnline: boolean;
  disabled?: boolean; // If true, layer should not be available for selection
}

const germanyOfflineBaseUrl = getBundledGermanyPmtilesUrl();

export const AGRICULTURAL_LAYERS: Record<string, MapLayer> = {
  // ===== TOPOGRAPHIC & TERRAIN =====
  openTopoMap: {
    id: 'openTopoMap',
    name: 'OpenTopoMap (Terrain & Contours)',
    description: 'Detailed topographic map with elevation contours, perfect for understanding field terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    type: 'tile',
    attribution: '© OpenTopoMap contributors',
    maxZoom: 17,
    requiresOnline: true,
  },

  // ===== WATER BODIES & HYDROLOGY =====
  openSeaMap: {
    id: 'openSeaMap',
    name: 'Water Bodies Overlay',
    description: 'Shows rivers, lakes, and water features',
    url: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
    type: 'tile',
    attribution: '© OpenSeaMap contributors',
    opacity: 0.7,
    transparent: true,
    requiresOnline: true,
  },

  // ===== CADASTRAL / PARCEL BOUNDARIES =====
  germanyKataster: {
    id: 'germanyKataster',
    name: 'German Cadastral Parcels',
    description: 'Official land parcel boundaries in Germany',
    url: 'https://sgx.geodatenzentrum.de/wms_topplus_open',
    type: 'wms',
    layers: 'p_wms_dtk250',
    format: 'image/png',
    transparent: true,
    attribution: '© BKG Germany',
    opacity: 0.6,
    regions: ['DE'],
    requiresOnline: true,
  },

  franceRPG: {
    id: 'franceRPG',
    name: 'French Agricultural Parcels (RPG)',
    description: 'Registre Parcellaire Graphique - official French agricultural parcels',
    url: 'https://wxs.ign.fr/agriculture/geoportail/r/wms',
    type: 'wms',
    layers: 'RPG.2023',
    format: 'image/png',
    transparent: true,
    attribution: '© IGN France',
    opacity: 0.7,
    regions: ['FR'],
    requiresOnline: true,
    disabled: true, // Disabled - Not needed for Germany-focused app
  },

  // ===== SATELLITE IMAGERY =====
  // NOTE: Sentinel Hub requires an account and instance ID
  // These layers are disabled by default - enable only if you have Sentinel Hub credentials
  sentinelHub: {
    id: 'sentinelHub',
    name: 'Sentinel-2 True Color (Requires API Key)',
    description: 'Recent satellite imagery (10m resolution) - Requires Sentinel Hub account',
    url: 'https://services.sentinel-hub.com/ogc/wms/{instance-id}',
    type: 'wms',
    layers: 'TRUE_COLOR',
    format: 'image/png',
    attribution: '© ESA Sentinel',
    requiresOnline: true,
    disabled: true, // Disabled - requires API configuration
  },

  sentinelNDVI: {
    id: 'sentinelNDVI',
    name: 'NDVI Vegetation Index (Requires API Key)',
    description: 'Vegetation health analysis - Requires Sentinel Hub account',
    url: 'https://services.sentinel-hub.com/ogc/wms/{instance-id}',
    type: 'wms',
    layers: 'NDVI',
    format: 'image/png',
    attribution: '© ESA Sentinel',
    requiresOnline: true,
    disabled: true, // Disabled - requires API configuration
  },

  // ===== SOIL DATA =====
  europeanSoilDatabase: {
    id: 'europeanSoilDatabase',
    name: 'European Soil Types',
    description: 'Soil classification across Europe (WRB system)',
    url: 'https://esdac.jrc.ec.europa.eu/content/european-soil-database-v20-vector-and-attribute-data',
    type: 'wms',
    layers: 'esdb_v2',
    format: 'image/png',
    transparent: true,
    attribution: '© European Commission JRC',
    opacity: 0.6,
    regions: ['EU'],
    requiresOnline: true,
  },

  // ===== ROADS & PATHS =====
  osmRoads: {
    id: 'osmRoads',
    name: 'Roads Overlay (Online Only)',
    description: 'Road network overlay - requires internet connection',
    // Disabled to avoid hitting OSM tile servers which block production usage without a commercial plan
    url: '',
    type: 'tile',
    attribution: '© OpenStreetMap contributors',
    opacity: 0.5,
    requiresOnline: true,
    disabled: true,
  },

  // ===== GERMANY-SPECIFIC OFFLINE LAYERS =====
  germanyOfflineBase: {
    id: 'germanyOfflineBase',
    name: 'Germany Offline Base Map',
    description: 'Offline PMTiles base map for Germany (vector, zoom 0-14)',
    url: germanyOfflineBaseUrl || '',
    type: 'tile',
    attribution: 'Offline Maps',
    maxNativeZoom: 14,
    maxZoom: 18,
    regions: ['DE'],
    requiresOnline: false,
    disabled: !germanyOfflineBaseUrl,
  },
};

/**
 * Layer presets for common agricultural workflows
 */
export const LAYER_PRESETS = {
  soilSampling: {
    name: 'Soil Sampling',
    description: 'Optimized for soil sample collection',
    layers: ['openTopoMap', 'openSeaMap', 'europeanSoilDatabase'],
  },
  fieldMapping: {
    name: 'Field Mapping',
    description: 'Parcel boundaries and terrain',
    layers: ['germanyKataster', 'openTopoMap'],
  },
  vegetationAnalysis: {
    name: 'Vegetation Health',
    description: 'NDVI and recent satellite imagery',
    layers: ['sentinelNDVI', 'sentinelHub'],
  },
  offlineNavigation: {
    name: 'Offline Navigation',
    description: 'Works without internet',
    layers: ['germanyOfflineBase'],
  },
};

class AgriculturalLayersService {
  /**
   * Get all available layers for current region
   */
  getAvailableLayers(regionCode?: string): MapLayer[] {
    return Object.values(AGRICULTURAL_LAYERS).filter(layer => {
      // Skip disabled layers
      if (layer.disabled) return false;
      
      // If layer has region restrictions, check them
      if (layer.regions && regionCode) {
        return layer.regions.includes(regionCode);
      }
      // Otherwise, include all layers
      return true;
    });
  }

  /**
   * Get layers that work offline
   */
  getOfflineLayers(): MapLayer[] {
    return Object.values(AGRICULTURAL_LAYERS).filter(layer => !layer.requiresOnline && !layer.disabled);
  }

  /**
   * Get layer by ID
   */
  getLayer(id: string): MapLayer | undefined {
    return AGRICULTURAL_LAYERS[id];
  }

  /**
   * Get layers for a preset workflow
   */
  getPresetLayers(presetId: keyof typeof LAYER_PRESETS): MapLayer[] {
    const preset = LAYER_PRESETS[presetId];
    if (!preset) return [];
    
    return preset.layers
      .map(layerId => AGRICULTURAL_LAYERS[layerId])
      .filter(layer => layer && !layer.disabled); // Filter out disabled layers
  }

  /**
   * Check if layer is available in current network state
   */
  isLayerAvailable(layerId: string, isOnline: boolean): boolean {
    const layer = AGRICULTURAL_LAYERS[layerId];
    if (!layer) return false;
    
    return isOnline || !layer.requiresOnline;
  }

  /**
   * Get WMS parameters for a layer
   */
  getWMSParams(layer: MapLayer): Record<string, string> {
    if (layer.type !== 'wms') {
      throw new Error('Layer is not a WMS layer');
    }

    return {
      service: 'WMS',
      version: '1.3.0',
      request: 'GetMap',
      layers: layer.layers || '',
      format: layer.format || 'image/png',
      transparent: String(layer.transparent !== false),
      attribution: layer.attribution,
    };
  }

  /**
   * Create custom layer configuration
   */
  createCustomLayer(config: Partial<MapLayer> & { id: string; name: string; url: string }): MapLayer {
    return {
      type: 'tile',
      description: '',
      attribution: 'Custom Layer',
      requiresOnline: true,
      ...config,
    };
  }
}

export const agriculturalLayersService = new AgriculturalLayersService();

/**
 * React Hook for managing agricultural layers
 */
export function useAgriculturalLayers(isOnline: boolean, regionCode?: string) {
  const availableLayers = agriculturalLayersService.getAvailableLayers(regionCode);
  const offlineLayers = agriculturalLayersService.getOfflineLayers();
  
  const workingLayers = isOnline ? availableLayers : offlineLayers;

  return {
    layers: workingLayers,
    presets: LAYER_PRESETS,
    getLayer: agriculturalLayersService.getLayer.bind(agriculturalLayersService),
    getPresetLayers: agriculturalLayersService.getPresetLayers.bind(agriculturalLayersService),
  };
}
