import { useState, useEffect } from 'react';
import { X, Layers, Eye, EyeOff, Info, Wifi, WifiOff, ChevronDown, ChevronUp } from 'lucide-react';
import { useDarkMode } from '../../hooks/useDarkMode';
import { useLanguage } from '../../hooks/useLanguage';
import { 
  AGRICULTURAL_LAYERS, 
  LAYER_PRESETS, 
  MapLayer,
  agriculturalLayersService 
} from '../../services/agriculturalLayers';
import Button from '../ui/Button';

interface LayerSettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  enabledLayers: string[];
  onLayersChange: (layerIds: string[]) => void;
  layerOpacity: Record<string, number>;
  onOpacityChange: (layerId: string, opacity: number) => void;
  isOnline: boolean;
}

export default function LayerSettingsPanel({
  isOpen,
  onClose,
  enabledLayers,
  onLayersChange,
  layerOpacity,
  onOpacityChange,
  isOnline,
}: LayerSettingsPanelProps) {
  const [isDarkMode] = useDarkMode();
  const { t } = useLanguage();
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    terrain: true,
    water: false,
    boundaries: false,
    satellite: false,
    soil: false,
    roads: false,
  });

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => ({ ...prev, [category]: !prev[category] }));
  };

  const toggleLayer = (layerId: string) => {
    if (enabledLayers.includes(layerId)) {
      onLayersChange(enabledLayers.filter(id => id !== layerId));
    } else {
      onLayersChange([...enabledLayers, layerId]);
    }
  };

  const applyPreset = (presetKey: keyof typeof LAYER_PRESETS) => {
    const preset = LAYER_PRESETS[presetKey];
    onLayersChange(preset.layers);
  };

  const clearAll = () => {
    onLayersChange([]);
  };

  const layerCategories = {
    terrain: {
      name: t('layers.terrainTopography') || 'Terrain & Topography',
      icon: '🏔️',
      layers: ['openTopoMap'],
    },
    water: {
      name: t('layers.waterBodies') || 'Water Bodies',
      icon: '💧',
      layers: ['openSeaMap'],
    },
    boundaries: {
      name: t('layers.parcelBoundaries') || 'Parcel Boundaries',
      icon: '📐',
      layers: ['germanyKataster'],
    },
    satellite: {
      name: t('layers.satelliteVegetation') || 'Satellite & Vegetation',
      icon: '🛰️',
      layers: ['sentinelHub', 'sentinelNDVI'],
    },
    soil: {
      name: t('layers.soilData') || 'Soil Data',
      icon: '🌱',
      layers: ['europeanSoilDatabase'],
    },
    roads: {
      name: t('layers.roadsPaths') || 'Roads & Paths',
      icon: '🛤️',
      layers: ['osmRoads'],
    },
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Panel */}
      <div className={`relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-xl shadow-2xl ${
        isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
      }`}>
        {/* Header */}
        <div className={`sticky top-0 z-10 px-6 py-4 border-b ${
          isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Layers className="w-6 h-6 text-blue-500" />
              <div>
                <h2 className="text-xl font-bold">{t('layers.title') || 'Map Layers'}</h2>
                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('layers.subtitle') || 'Agricultural overlays and data layers'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${
                isDarkMode 
                  ? 'hover:bg-gray-700' 
                  : 'hover:bg-gray-100'
              }`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Connection Status */}
          <div className={`mt-3 flex items-center gap-2 text-sm ${
            isOnline ? 'text-green-500' : 'text-orange-500'
          }`}>
            {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            <span>{isOnline ? (t('layers.online') || 'Online - All layers available') : (t('layers.offline') || 'Offline - Limited layers')}</span>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-200px)] px-6 py-4">
          {/* Quick Presets */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              ⚡ Quick Presets
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(LAYER_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => applyPreset(key as keyof typeof LAYER_PRESETS)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isDarkMode
                      ? 'bg-gray-700 hover:bg-gray-600 text-white'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
                  }`}
                >
                  {preset.name}
                </button>
              ))}
              <button
                onClick={() => {
                  const allAvailableLayers = Object.entries(AGRICULTURAL_LAYERS)
                    .filter(([_, layer]) => !layer.disabled && (!layer.requiresOnline || isOnline))
                    .map(([id]) => id);
                  onLayersChange(allAvailableLayers);
                }}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isDarkMode
                    ? 'bg-green-900/30 hover:bg-green-900/50 text-green-400'
                    : 'bg-green-50 hover:bg-green-100 text-green-600'
                }`}
              >
                Select All
              </button>
              <button
                onClick={clearAll}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isDarkMode
                    ? 'bg-red-900/30 hover:bg-red-900/50 text-red-400'
                    : 'bg-red-50 hover:bg-red-100 text-red-600'
                }`}
              >
                Clear All
              </button>
            </div>
          </div>

          {/* Layer Categories */}
          {Object.entries(layerCategories).map(([categoryKey, category]) => {
            const categoryLayers = category.layers
              .map(id => AGRICULTURAL_LAYERS[id])
              .filter(layer => layer && !layer.disabled); // Filter out disabled layers

            if (categoryLayers.length === 0) return null;

            return (
              <div key={categoryKey} className="mb-4">
                {/* Category Header */}
                <button
                  onClick={() => toggleCategory(categoryKey)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${
                    isDarkMode
                      ? 'bg-gray-700/50 hover:bg-gray-700'
                      : 'bg-gray-100 hover:bg-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{category.icon}</span>
                    <span className="font-semibold">{category.name}</span>
                    <span className={`text-xs px-2 py-1 rounded ${
                      isDarkMode ? 'bg-gray-600' : 'bg-gray-200'
                    }`}>
                      {categoryLayers.length}
                    </span>
                  </div>
                  {expandedCategories[categoryKey] ? (
                    <ChevronUp className="w-5 h-5" />
                  ) : (
                    <ChevronDown className="w-5 h-5" />
                  )}
                </button>

                {/* Category Layers */}
                {expandedCategories[categoryKey] && (
                  <div className="mt-2 space-y-2">
                    {categoryLayers.map((layer) => {
                      const isEnabled = enabledLayers.includes(layer.id);
                      const isAvailable = isOnline || !layer.requiresOnline;
                      const opacity = layerOpacity[layer.id] ?? (layer.opacity || 1);

                      return (
                        <div
                          key={layer.id}
                          className={`p-4 rounded-lg border ${
                            isDarkMode
                              ? 'bg-gray-800/50 border-gray-700'
                              : 'bg-white border-gray-200'
                          } ${!isAvailable && 'opacity-50'}`}
                        >
                          {/* Layer Header */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="font-medium truncate">{layer.name}</h4>
                                {!layer.requiresOnline && (
                                  <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-500">
                                    Offline
                                  </span>
                                )}
                                {!isAvailable && (
                                  <span className="text-xs px-2 py-0.5 rounded bg-orange-500/20 text-orange-500">
                                    Online Only
                                  </span>
                                )}
                              </div>
                              <p className={`text-xs mt-1 ${
                                isDarkMode ? 'text-gray-400' : 'text-gray-600'
                              }`}>
                                {layer.description}
                              </p>
                            </div>

                            {/* Toggle Button */}
                            <button
                              onClick={() => isAvailable && toggleLayer(layer.id)}
                              disabled={!isAvailable}
                              className={`flex-shrink-0 p-2 rounded-lg transition-colors ${
                                isEnabled
                                  ? 'bg-blue-500 text-white'
                                  : isDarkMode
                                  ? 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                                  : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                              } ${!isAvailable && 'cursor-not-allowed'}`}
                            >
                              {isEnabled ? (
                                <Eye className="w-5 h-5" />
                              ) : (
                                <EyeOff className="w-5 h-5" />
                              )}
                            </button>
                          </div>

                          {/* Opacity Slider */}
                          {isEnabled && (
                            <div className="mt-3">
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
                                  Opacity
                                </span>
                                <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
                                  {Math.round(opacity * 100)}%
                                </span>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={opacity * 100}
                                onChange={(e) => onOpacityChange(layer.id, parseInt(e.target.value) / 100)}
                                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                                style={{
                                  background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${opacity * 100}%, ${isDarkMode ? '#374151' : '#e5e7eb'} ${opacity * 100}%, ${isDarkMode ? '#374151' : '#e5e7eb'} 100%)`,
                                }}
                              />
                            </div>
                          )}

                          {/* Attribution */}
                          <div className={`mt-2 text-xs ${
                            isDarkMode ? 'text-gray-500' : 'text-gray-500'
                          }`}>
                            {layer.attribution}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className={`sticky bottom-0 px-6 py-4 border-t ${
          isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
                {enabledLayers.length} layer{enabledLayers.length !== 1 ? 's' : ''} active
              </span>
            </div>
            <Button onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
