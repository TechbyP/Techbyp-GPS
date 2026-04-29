import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, FeatureGroup, Polygon, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Capacitor } from '@capacitor/core';
import 'leaflet-draw';
import { getCurrentPosition } from '../../utils/geolocation';
import { hasInternetAccess } from '../../utils/networkDetection';
import { getBlankTileUrl, getGermanyBounds } from '../../utils/tileUtils';
import PMTilesVectorLayer from './PMTilesVectorLayer';

// Check for Germany offline tiles at runtime
const checkGermanyTilesAvailable = (): boolean => {
  if ((window as any).__GERMANY_TILES_AVAILABLE__ === true) {
    return true;
  }
  if (typeof window !== 'undefined' && Capacitor.getPlatform() !== 'web') {
    return true;
  }
  return false;
};

const germanyTilesAvailable = checkGermanyTilesAvailable();
const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
const isCapacitorApp = typeof window !== 'undefined' && Capacitor.getPlatform() !== 'web';
const forceOffline = isOffline || isCapacitorApp;
const offlinePmtilesUrl = (window as any).__VITE_PMTILES_URL__ || (import.meta.env.VITE_PMTILES_URL as string | undefined) || '/tiles/germany.pmtiles';
const BLANK_TILE_URL = getBlankTileUrl();
const onlineTileUrl = (window as any).__VITE_ONLINE_TILE_URL__ || (import.meta.env.VITE_ONLINE_TILE_URL as string | undefined);
const usePmtilesVector = (() => {
  if (typeof window === 'undefined') return false;
  const stored = window.localStorage.getItem('gpsUsePmtilesVector');
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return !isCapacitorApp;
})();

// Calculate centroid of a polygon
function calculateCentroid(coordinates: number[][][]): [number, number] | null {
  try {
    const ring = coordinates[0]; // Use exterior ring
    if (!ring || ring.length === 0) return null;
    
    let sumLat = 0;
    let sumLng = 0;
    
    for (const coord of ring) {
      sumLng += coord[0];
      sumLat += coord[1];
    }
    
    return [sumLat / ring.length, sumLng / ring.length];
  } catch (error) {
    console.error('Error calculating centroid:', error);
    return null;
  }
}
import { useNavigate, useParams } from 'react-router-dom';
import { useLanguage } from '../../hooks/useLanguage';
import { useDarkMode } from '../../hooks/useDarkMode';
import { Save, ArrowLeft, Trash2, User, LogOut, Camera, Moon, Sun, Globe, Upload, ChevronRight, ChevronDown, Square, Edit3, MousePointer, Maximize2, RotateCcw, Layers, Check, X } from 'lucide-react';
import { hybridDB } from '../../services/hybridDatabase';
import { GpsFieldBoundary } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { showNotification } from '../ui/NotificationContainer';
import { useConfirmation } from '../ui/ConfirmationProvider';
import shp from 'shpjs';
// toast removed - using showNotification instead to prevent duplicates
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';

// Configure default Leaflet Draw localization (will be updated dynamically)
if (!(L as any).drawLocal) {
  (L as any).drawLocal = {
    draw: {
      toolbar: {
        buttons: {
          polygon: 'Draw a polygon',
          rectangle: 'Draw a rectangle',
        }
      },
      handlers: {
        polygon: {
          tooltip: {
            start: 'Click to start drawing shape',
            cont: 'Click to continue drawing shape',
            end: 'Click first point to close this shape'
          }
        },
        rectangle: {
          tooltip: {
            start: 'Click and drag to draw rectangle',
          }
        }
      }
    }
  };
}

// Fix Leaflet default marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface FieldBoundaryEditorProps {
  projectId?: number | string;
}

interface NewBoundary {
  name: string;
  color: string;
  geometry_type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
  properties: {
    CROP?: string;
    season?: string;
    season_start?: string;
    season_end?: string;
    uid?: string;
  };
}

interface BoundaryDraft {
  name: string;
  color: string;
  properties: {
    CROP?: string;
    season?: string;
    season_start?: string;
    season_end?: string;
    uid?: string;
  };
}

const MapController: React.FC<{ center: [number, number]; zoom: number }> = ({ center, zoom }) => {
  const map = useMap();
  
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  
  return null;
};

const MapRefSetter: React.FC<{ mapRef: React.MutableRefObject<L.Map | null> }> = ({ mapRef }) => {
  const map = useMap();
  
  useEffect(() => {
    mapRef.current = map;
  }, [map, mapRef]);
  
  return null;
};

const FieldBoundaryEditor: React.FC<FieldBoundaryEditorProps> = () => {
  const { t, language, changeLanguage } = useLanguage();
  const [isDarkMode, toggleDarkMode] = useDarkMode();
  
  // Extract translations to avoid runtime issues
  const savingText = t('common.saving') || 'Saving...';
  const saveText = t('common.save') || 'Save';
  const navigate = useNavigate();
  const { projectId: paramProjectId } = useParams<{ projectId: string }>();
  const { user, logout } = useAuth();
  const { showConfirmation } = useConfirmation();
  const boundaryImportInputRef = useRef<HTMLInputElement | null>(null);
  
  // Validate projectId - redirect if missing
  useEffect(() => {
    if (!paramProjectId) {
      showNotification('error', 'No Project Selected', 'Please select a project first');
      navigate('/gps');
    }
  }, [paramProjectId, navigate]);
  
  // Show loading state while redirecting
  if (!paramProjectId) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gray-900/20 backdrop-blur-sm">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className={isDarkMode ? 'text-white' : 'text-gray-900'}>No project selected. Redirecting...</p>
        </div>
      </div>
    );
  }
  
  const projectId = paramProjectId;
  
  const [boundaries, setBoundaries] = useState<GpsFieldBoundary[]>([]);
  const [newBoundaries, setNewBoundaries] = useState<NewBoundary[]>([]);
  const [center, setCenter] = useState<[number, number]>([51.505, -0.09]); // Default center (London)
  const [zoom, setZoom] = useState(13);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // Disable satellite view in offline/Capacitor mode - force offline tiles
  const [useSatellite, setUseSatellite] = useState(!forceOffline);
  const [editingBoundaryId, setEditingBoundaryId] = useState<number | null>(null);
  const [boundaryDrafts, setBoundaryDrafts] = useState<Record<string, BoundaryDraft>>({});

  const normalizeBoundaryProperties = (boundary: GpsFieldBoundary): GpsFieldBoundary => {
    let rawProps: any = boundary.properties || {};
    if (typeof rawProps === 'string') {
      try {
        rawProps = JSON.parse(rawProps);
      } catch (_) {
        rawProps = {};
      }
    }
    const props: Record<string, any> = { ...rawProps };
    for (const [key, value] of Object.entries(rawProps)) {
      const lower = key.toLowerCase();
      const normalizedKey = lower.replace(/[^a-z0-9]+/g, '_');
      if (props.CROP === undefined && normalizedKey === 'crop') props.CROP = value;
      if (props.season === undefined && (normalizedKey === 'season' || normalizedKey === 'season_nam' || normalizedKey === 'seasonname')) props.season = value;
      if (props.season_start === undefined && (normalizedKey === 'season_start' || normalizedKey === 'season_sta' || normalizedKey === 'seasonstart')) props.season_start = value;
      if (props.season_end === undefined && (normalizedKey === 'season_end' || normalizedKey === 'season_end_dat' || normalizedKey === 'season_end_date' || normalizedKey === 'seasonend')) props.season_end = value;
      if (props.uid === undefined && (normalizedKey === 'uid' || normalizedKey === 'uuid')) props.uid = value;
    }
    return { ...boundary, properties: props };
  };
  
  // Initialize and update Leaflet Draw localization
  const initializeDrawLocalization = () => {
    // Initialize L.drawLocal if it doesn't exist
    if (!(L as any).drawLocal) {
      (L as any).drawLocal = {
        draw: {
          toolbar: {
            buttons: {}
          },
          handlers: {
            polygon: {
              tooltip: {}
            },
            rectangle: {
              tooltip: {}
            }
          }
        }
      };
    }
  };

  // Update Leaflet Draw localization when language changes
  const updateDrawLocalization = () => {
    // Ensure localization object exists
    initializeDrawLocalization();
    
    const drawLocal = (L as any).drawLocal;
    // Update existing localization object
    drawLocal.draw = drawLocal.draw || {};
    drawLocal.draw.toolbar = drawLocal.draw.toolbar || {};
    drawLocal.draw.toolbar.buttons = drawLocal.draw.toolbar.buttons || {};
    drawLocal.draw.handlers = drawLocal.draw.handlers || {};
    drawLocal.draw.handlers.polygon = drawLocal.draw.handlers.polygon || {};
    drawLocal.draw.handlers.polygon.tooltip = drawLocal.draw.handlers.polygon.tooltip || {};
    drawLocal.draw.handlers.rectangle = drawLocal.draw.handlers.rectangle || {};
    drawLocal.draw.handlers.rectangle.tooltip = drawLocal.draw.handlers.rectangle.tooltip || {};
    
    // Update with translations
    drawLocal.draw.toolbar.buttons.polygon = t('gps.drawingHelpers.polygonButton') || 'Draw a polygon';
    drawLocal.draw.toolbar.buttons.rectangle = t('gps.drawingHelpers.rectangleButton') || 'Draw a rectangle';
    drawLocal.draw.handlers.polygon.tooltip.start = t('gps.drawingHelpers.polygonStart') || 'Click to start drawing shape';
    drawLocal.draw.handlers.polygon.tooltip.cont = t('gps.drawingHelpers.polygonContinue') || 'Click to continue drawing shape';
    drawLocal.draw.handlers.polygon.tooltip.end = t('gps.drawingHelpers.polygonEnd') || 'Click first point to close this shape';
    drawLocal.draw.handlers.rectangle.tooltip.start = t('gps.drawingHelpers.rectangleStart') || 'Click and drag to draw rectangle';
  };

  // Initialize localization on mount and update when language changes
  useEffect(() => {
    initializeDrawLocalization();
    updateDrawLocalization();
  }, [language]); // Remove 't' dependency to prevent re-runs
  
  // Detect online/offline state with actual internet connectivity check
  useEffect(() => {
    // Test actual internet connectivity, not just WiFi connection
    const checkInternetConnectivity = async () => {
      try {
        const online = await hasInternetAccess();
        setIsOffline(!online);
      } catch (error) {
        setIsOffline(true);
      }
    };

    const handleOnline = () => {
      checkInternetConnectivity();
      showNotification('success', 'Back Online', 'Connection restored. Changes will sync automatically.');
    };
    const handleOffline = () => {
      setIsOffline(true);
      showNotification('warning', 'Offline Mode', 'Working offline. Changes will sync when connection is restored.');
    };
    
    // Initial check
    checkInternetConnectivity();
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Check connectivity every 30 seconds
    const intervalId = setInterval(checkInternetConnectivity, 30000);
    
    const offlineCleanup = () => {
      clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
    cleanupFunctions.current.push(offlineCleanup);
    
    return offlineCleanup;
  }, []);

  // Sidebar state (with localStorage persistence)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('fieldEditor_sidebarCollapsed');
    return saved ? JSON.parse(saved) : false;
  });
  
  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem('fieldEditor_sidebarCollapsed', JSON.stringify(isSidebarCollapsed));
  }, [isSidebarCollapsed]);
  const [showAvatarDropdown, setShowAvatarDropdown] = useState(false);
  const [showAvatarSubmenu, setShowAvatarSubmenu] = useState(false);
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  
  // Drawing mode state
  const [drawingMode, setDrawingMode] = useState<'none' | 'rectangle' | 'polygon'>('none');
  const [drawingLayer, setDrawingLayer] = useState<L.Layer | null>(null);
  // Rectangle drawing state (use React state instead of closure variables)
  const [rectangleState, setRectangleState] = useState<{
    isDrawing: boolean;
    startPoint: L.LatLng | null;
    isDragging: boolean;
    hasMouseDown: boolean;
  }>({ isDrawing: false, startPoint: null, isDragging: false, hasMouseDown: false });
  
  const mapRef = useRef<L.Map | null>(null);
  const featureGroupRef = useRef<L.FeatureGroup | null>(null);
  const [activeDrawHandler, setActiveDrawHandler] = useState<any>(null);
  // Rectangle drawing cleanup ref
  const rectangleCleanupRef = useRef<(() => void) | null>(null);
  // Track all cleanup functions to prevent memory leaks
  const cleanupFunctions = useRef<(() => void)[]>([]);

  const boundaryKey = (b: GpsFieldBoundary) => b.id?.toString() || '';

  const createDraftFromBoundary = (boundary: GpsFieldBoundary): BoundaryDraft => {
    const props = boundary.properties || {};
    return {
      name: boundary.name || '',
      color: boundary.color || '#00FF00',
      properties: {
        CROP: props.CROP || '',
        season: props.season || '',
        season_start: props.season_start || '',
        season_end: props.season_end || '',
        uid: props.uid || ''
      }
    };
  };

  const getBoundaryDraft = (boundary: GpsFieldBoundary): BoundaryDraft => {
    const key = boundaryKey(boundary);
    if (!key) return createDraftFromBoundary(boundary);
    return boundaryDrafts[key] || createDraftFromBoundary(boundary);
  };

  const isBoundaryDirty = (boundary: GpsFieldBoundary) => {
    const key = boundaryKey(boundary);
    if (!key || !boundaryDrafts[key]) return false;
    const draft = boundaryDrafts[key];
    const props = boundary.properties || {};

    const clean = (value: any) => (value === undefined || value === null ? '' : value);

    return (
      clean(draft.name) !== clean(boundary.name) ||
      clean(draft.color) !== clean(boundary.color || '#00FF00') ||
      clean(draft.properties?.CROP) !== clean(props.CROP) ||
      clean(draft.properties?.season) !== clean(props.season) ||
      clean(draft.properties?.season_start) !== clean(props.season_start) ||
      clean(draft.properties?.season_end) !== clean(props.season_end) ||
      clean(draft.properties?.uid) !== clean(props.uid)
    );
  };

  const upsertDraft = (boundary: GpsFieldBoundary, updates: Partial<BoundaryDraft>) => {
    const key = boundaryKey(boundary);
    if (!key) return;
    setBoundaryDrafts(prev => {
      const base = prev[key] || createDraftFromBoundary(boundary);
      const nextProps = {
        ...base.properties,
        ...(updates.properties || {})
      };
      const nextDraft: BoundaryDraft = {
        ...base,
        ...updates,
        properties: nextProps
      };
      return { ...prev, [key]: nextDraft };
    });
  };

  useEffect(() => {
    setBoundaryDrafts(prev => {
      const next: Record<string, BoundaryDraft> = {};
      boundaries.forEach(b => {
        const key = boundaryKey(b);
        if (key && prev[key]) {
          next[key] = prev[key];
        }
      });
      return next;
    });
  }, [boundaries]);

  const dirtyBoundaryCount = boundaries.filter(isBoundaryDirty).length;
  const hasDirtyDrafts = dirtyBoundaryCount > 0;
  
  // Memoize boundaries with centroids to prevent recalculation on every render
  const boundariesWithCentroids = useMemo(() => {
    return boundaries.map(b => {
      if (b.geometry_type === 'Polygon') {
        return {
          ...b,
          centroid: calculateCentroid(b.coordinates as number[][][])
        };
      }
      return { ...b, centroid: null };
    });
  }, [boundaries]);
  
  // Memoize new boundaries with centroids
  const newBoundariesWithCentroids = useMemo(() => {
    return newBoundaries.map(b => ({
      ...b,
      centroid: calculateCentroid(b.coordinates as number[][][])
    }));
  }, [newBoundaries]);

  // Input styles for dark mode support
  const getInputStyles = () => {
    return isDarkMode
      ? 'w-full px-3 py-2 bg-gray-800/50 border border-gray-600/50 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-100 placeholder-gray-400'
      : 'w-full px-3 py-2 bg-white/90 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder-gray-500';
  };

  // Handle avatar upload
  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setUserAvatar(result);
        localStorage.setItem('userAvatar', result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Drawing tool functions
  const startDrawing = (mode: 'rectangle' | 'polygon') => {
    // Cancel any existing drawing first
    if (activeDrawHandler) {
      activeDrawHandler.disable();
      setActiveDrawHandler(null);
    }

    // Clean up rectangle drawing if active
    if (rectangleCleanupRef.current) {
      rectangleCleanupRef.current();
      rectangleCleanupRef.current = null;
    }
    
    // Update localization before starting drawing
    updateDrawLocalization();
    
    setDrawingMode(mode);
    // Remove any existing drawing layer
    if (drawingLayer && featureGroupRef.current) {
      featureGroupRef.current.removeLayer(drawingLayer);
    }
    setDrawingLayer(null);
    
    // Start drawing by enabling the appropriate drawing handler
    if (mapRef.current) {
      const map = mapRef.current;
      
      // Create drawing options
      const drawOptions = {
        shapeOptions: {
          color: '#3b82f6',
          fillColor: '#3b82f6',
          fillOpacity: 0.3,
          weight: 2
        },
        // Don't show area to avoid leaflet-draw bugs
        showArea: false,
        // Ensure repeatMode is false so it doesn't auto-create
        repeatMode: false
      };
      
      let drawHandler;
      if (mode === 'rectangle') {
        // Custom rectangle drawing with click-move-click support
        setDrawingMode('rectangle');
        startCustomRectangleDrawing(map);
        return;
      } else {
        // For polygon: click multiple points, double-click or click first point to finish
        drawHandler = new (L.Draw as any).Polygon(map, drawOptions);
      }
      
      drawHandler.enable();
      setActiveDrawHandler(drawHandler);
      
      // Listen for the draw:created event (use on instead of once to prevent missing events)
      const handleDrawCreated = (e: any) => {
        const layer = e.layer;
        handleDrawingComplete(layer);
        setDrawingMode('none');
        setActiveDrawHandler(null);
        showNotification('success', t('gps.drawing.shapeCreated') || 'Shape Created', 'Shape created successfully!');
        // Clean up listener after handling
        map.off('draw:created', handleDrawCreated);
      };
      map.on('draw:created', handleDrawCreated);
    } else {
      showNotification('error', 'Map Not Ready', 'Map not ready. Please try again.');
    }
  };

  const cancelDrawing = () => {
    if (activeDrawHandler) {
      activeDrawHandler.disable();
      setActiveDrawHandler(null);
    }
    
    // Clean up rectangle drawing if active
    if (rectangleCleanupRef.current) {
      rectangleCleanupRef.current();
      rectangleCleanupRef.current = null;
    }
    
    setDrawingMode('none');
    if (drawingLayer && featureGroupRef.current) {
      featureGroupRef.current.removeLayer(drawingLayer);
    }
    setDrawingLayer(null);
  };

  // Map control functions
  const fitBounds = () => {
    if (mapRef.current && (boundaries.length > 0 || newBoundaries.length > 0)) {
      const allLatLngs: L.LatLngExpression[] = [];
      
      // Add existing boundaries
      boundaries.forEach(boundary => {
        if (boundary.geometry_type === 'Polygon') {
          const coords = boundary.coordinates as number[][][];
          coords[0].forEach(coord => {
            allLatLngs.push([coord[1], coord[0]]);
          });
        }
      });
      
      // Add new boundaries
      newBoundaries.forEach(boundary => {
        const coords = boundary.coordinates as number[][][];
        coords[0].forEach(coord => {
          allLatLngs.push([coord[1], coord[0]]);
        });
      });
      
      if (allLatLngs.length > 0) {
        const bounds = L.latLngBounds(allLatLngs);
        mapRef.current.fitBounds(bounds, { padding: [20, 20] });
      }
    }
  };

  const resetView = () => {
    getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 })
      .then((position) => {
        setCenter([position.coords.latitude, position.coords.longitude]);
        setZoom(15);
      })
      .catch(() => {
        setCenter([51.505, -0.09]);
        setZoom(13);
      });
  };

  // Load avatar from local storage
  useEffect(() => {
    const savedAvatar = localStorage.getItem('userAvatar');
    if (savedAvatar) {
      setUserAvatar(savedAvatar);
    }
  }, []);

  // Load existing boundaries
  useEffect(() => {
    // Always try to get user's current position first
    getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 })
      .then((position) => {
        setCenter([position.coords.latitude, position.coords.longitude]);
        setZoom(15);
      })
      .catch((error) => {
        console.error('Error getting location:', error);
      });
    
    // Then load boundaries if projectId exists
    if (projectId) {
      loadBoundaries();
    }
  }, [projectId]);

  // Cleanup rectangle drawing when switching away from rectangle mode
  useEffect(() => {
    // Cleanup when switching from rectangle mode to another mode
    if (drawingMode !== 'rectangle' && rectangleCleanupRef.current) {
      console.log('Cleaning up rectangle drawing - switching away from rectangle mode');
      rectangleCleanupRef.current();
      rectangleCleanupRef.current = null;
    }
  }, [drawingMode]);

  // Cleanup on component unmount - guaranteed execution
  useEffect(() => {
    return () => {
      // Call all registered cleanup functions
      cleanupFunctions.current.forEach(fn => {
        try {
          fn();
        } catch (error) {
          console.error('Cleanup function error:', error);
        }
      });
      cleanupFunctions.current = [];
      
      // Fallback for rectangle cleanup
      if (rectangleCleanupRef.current) {
        try {
          rectangleCleanupRef.current();
        } catch (error) {
          console.error('Rectangle cleanup error:', error);
        }
      }
    };
  }, []);

  const loadBoundaries = async () => {
    if (!projectId) return;

    setIsLoading(true);
    try {
      const data = await hybridDB.getFieldBoundaries(projectId);
      const normalized = data.map(normalizeBoundaryProperties);
      setBoundaries(normalized);
      
      // Center map on boundaries if any exist
      if (data.length > 0) {
        const firstBoundary = data[0];
        let lat = 0, lng = 0, count = 0;
        
        if (firstBoundary.geometry_type === 'Polygon') {
          const coords = firstBoundary.coordinates as number[][][];
          coords[0].forEach(coord => {
            lng += coord[0];
            lat += coord[1];
            count++;
          });
        }
        
        if (count > 0) {
          setCenter([lat / count, lng / count]);
          setZoom(14);
        }
      }
    } catch (error: any) {
      console.error('Failed to load field boundaries:', error);
      showNotification('error', 'Load Failed', error.message || 'Failed to load field boundaries');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle completed drawings
  const handleDrawingComplete = (layer: L.Layer) => {
    if (layer instanceof L.Polygon || layer instanceof L.Rectangle) {
      const latlngs = (layer as L.Polygon).getLatLngs()[0] as L.LatLng[];
      const coordinates = latlngs.map((latlng: L.LatLng) => [latlng.lng, latlng.lat]);
      coordinates.push(coordinates[0]); // Close the polygon
      
      const newBoundary: NewBoundary = {
        name: `Field ${newBoundaries.length + boundaries.length + 1}`,
        color: '#3b82f6',
        geometry_type: 'Polygon',
        coordinates: [coordinates],
        properties: {
          CROP: '',
          season: '',
          season_start: '',
          season_end: ''
        }
      };
      
      setNewBoundaries([...newBoundaries, newBoundary]);
      
      // Remove the temporary layer from the feature group
      if (featureGroupRef.current) {
        featureGroupRef.current.removeLayer(layer);
      }
    }
  };

  const handleBoundaryImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    const isZip = fileName.endsWith('.zip');
    const isGeoJson = fileName.endsWith('.geojson') || fileName.endsWith('.json');

    if (!isZip && !isGeoJson) {
      showNotification('error', 'Unsupported File', 'Use a .zip shapefile or .geojson/.json file.');
      e.target.value = '';
      return;
    }

    try {
      setIsLoading(true);

      let parsedGeoJson: any;
      if (isZip) {
        const buffer = await file.arrayBuffer();
        parsedGeoJson = await shp(buffer);
      } else {
        parsedGeoJson = JSON.parse(await file.text());
      }

      const features = parsedGeoJson?.type === 'FeatureCollection'
        ? parsedGeoJson.features || []
        : parsedGeoJson?.type === 'Feature'
        ? [parsedGeoJson]
        : [];

      if (features.length === 0) {
        showNotification('error', 'Import Failed', 'No features found in uploaded boundary file.');
        return;
      }

      const imported: NewBoundary[] = [];
      const defaultColor = '#3b82f6';
      let nextIndexBase = boundaries.length + newBoundaries.length + 1;

      for (const feature of features) {
        const geometry = feature?.geometry;
        if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
          continue;
        }

        const props = feature?.properties || {};
        const importedName = props.name || props.NAME || props.field_name || props.FIELD_NAME || props.id || props.ID;
        const normalizedProperties = {
          ...props,
          CROP: props.CROP || props.crop || props.Crop || props.CROP_TYPE || props.crop_type || props.CropType || '',
          season: props.season || props.Season || props.SEASON || props.year || props.Year || props.YEAR || '',
          season_start: props.season_start || props.PLANT_DATE || props.plant_date || props.PlantDate || props.START_DATE || props.start_date || '',
          season_end: props.season_end || props.HARVEST_DATE || props.harvest_date || props.HarvestDate || props.END_DATE || props.end_date || '',
          uid: props.uid || props.UID || props.ID || props.id || props.FIELD_ID || props.field_id || props.FieldID || ''
        };

        imported.push({
          name: importedName ? String(importedName) : `Field ${nextIndexBase++}`,
          color: defaultColor,
          geometry_type: geometry.type,
          coordinates: geometry.coordinates,
          properties: normalizedProperties
        });
      }

      if (imported.length === 0) {
        showNotification('error', 'Import Failed', 'No polygon or multipolygon boundaries found in file.');
        return;
      }

      setNewBoundaries(prev => [...prev, ...imported]);
      showNotification('success', 'Boundaries Imported', `${imported.length} boundary${imported.length === 1 ? '' : 'ies'} added locally.`);
      setTimeout(() => fitBounds(), 100);
    } catch (error: any) {
      console.error('Boundary import failed:', error);
      showNotification('error', 'Import Failed', error?.message || 'Could not parse boundary file.');
    } finally {
      setIsLoading(false);
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    if (!projectId) {
      showNotification('error', t('gps.selectProjectFirst') || 'Please select a project first');
      return;
    }

    const dirtyBoundaries = boundaries.filter((b) => isBoundaryDirty(b));

    if (newBoundaries.length === 0 && dirtyBoundaries.length === 0) {
      showNotification('warning', t('gps.noBoundariesToSave') || 'No boundaries to save');
      return;
    }
    
    setIsSaving(true);
    
    try {
      // Show offline feedback
      if (isOffline) {
        showNotification('warning', 'Saving Offline', 'Boundaries saved locally. Will sync when connection is restored.');
      }
      
      // Create each new boundary
      for (const boundary of newBoundaries) {
        const geometry = {
          type: boundary.geometry_type,
          coordinates: boundary.coordinates
        };
        await hybridDB.createFieldBoundary(
          projectId.toString(),
          boundary.name,
          geometry,
          boundary.color,
          boundary.properties
        );
      }

      // Persist edits for existing boundaries
      for (const boundary of dirtyBoundaries) {
        const key = boundaryKey(boundary);
        const draft = getBoundaryDraft(boundary);
        const mergedProps = { ...(boundary.properties || {}), ...(draft.properties || {}) };
        await hybridDB.updateFieldBoundary(
          key,
          draft.name,
          undefined,
          draft.color,
          mergedProps
        );
      }
      
      // Reload boundaries
      await loadBoundaries();
      setNewBoundaries([]);
      setBoundaryDrafts(prev => {
        const next = { ...prev };
        dirtyBoundaries.forEach(b => { delete next[boundaryKey(b)]; });
        return next;
      });
      
      // Notify GPSTracker that boundaries have changed
      window.dispatchEvent(new CustomEvent('boundariesUpdated', { 
        detail: { projectId: projectId.toString() } 
      }));
      
      showNotification('success', t('gps.notifications.boundariesSavedTitle') || 'Boundaries Saved', t('gps.boundariesSaved') || 'Field boundaries saved successfully!');
    } catch (error) {
      console.error('Failed to save boundaries:', error);
      showNotification('error', t('gps.notifications.saveFailedTitle') || 'Save Failed', t('gps.saveFailed') || 'Failed to save field boundaries');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteBoundary = async (boundaryId: number) => {
    const confirmed = await showConfirmation(
      t('gps.confirmations.deleteBoundaryTitle') || 'Delete Field Boundary?',
      t('gps.confirmations.deleteBoundaryMessage') || 'Are you sure you want to delete this field boundary?',
      {
        confirmText: t('gps.confirmations.confirm') || 'Confirm',
        cancelText: t('gps.confirmations.cancel') || 'Cancel',
        type: 'danger'
      }
    );
    if (!confirmed) return;
    
    try {
      await hybridDB.deleteFieldBoundary(boundaryId.toString());
      await loadBoundaries();
      showNotification('success', t('gps.notifications.boundaryDeletedTitle') || 'Boundary Deleted');
    } catch (error: any) {
      console.error('Failed to delete boundary:', error);
      const errorMsg = error.message || 'Failed to delete field boundary';
      showNotification('error', t('gps.notifications.deleteFailedTitle') || 'Delete Failed', errorMsg);
    }
  };

  const updateNewBoundary = (index: number, updates: Partial<NewBoundary>) => {
    const updated = [...newBoundaries];
    
    // Validate name if provided
    if (updates.name !== undefined) {
      const trimmed = updates.name.trim();
      if (trimmed.length === 0) {
        showNotification('error', 'Invalid Name', 'Field name cannot be empty');
        return;
      }
      if (trimmed.length > 100) {
        showNotification('error', 'Name Too Long', 'Maximum 100 characters allowed');
        return;
      }
      // Check for duplicates
      const isDuplicate = [...boundaries, ...newBoundaries].some(
        (b, i) => i !== index && b.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (isDuplicate) {
        showNotification('warning', 'Duplicate Name', 
          'A field with this name already exists');
      }
      updates.name = trimmed;
    }
    
    updated[index] = { ...updated[index], ...updates };
    setNewBoundaries(updated);
  };

  const removeNewBoundary = (index: number) => {
    setNewBoundaries(newBoundaries.filter((_, i) => i !== index));
  };

  const acceptNewBoundary = async (index: number) => {
    const boundary = newBoundaries[index];
    
    if (!boundary) {
      showNotification('error', 'Error', 'Boundary not found');
      return;
    }
    
    if (!projectId) {
      showNotification('error', t('gps.notifications.saveFailedTitle') || 'Save Failed', 'No project ID found. Please reload the page.');
      return;
    }

    try {
      // Save the new boundary to the database
      const geometry = {
        type: boundary.geometry_type,
        coordinates: boundary.coordinates
      };
      await hybridDB.createFieldBoundary(
        projectId.toString(),
        boundary.name,
        geometry,
        boundary.color,
        boundary.properties
      );

      // Remove from new boundaries and refresh the existing boundaries list
      setNewBoundaries(newBoundaries.filter((_, i) => i !== index));
      await loadBoundaries();
      
      // Notify GPSTracker that boundaries have changed
      window.dispatchEvent(new CustomEvent('boundariesUpdated', { 
        detail: { projectId: projectId.toString() } 
      }));
      
      showNotification('success', t('gps.notifications.boundaryAccepted') || 'Field Added', `"${boundary.name}" ${t('gps.notifications.boundaryAcceptedMessage') || 'has been added successfully!'}`);
    } catch (error: any) {
      console.error('Failed to accept boundary:', error);
      const errorMsg = error.message || 'Failed to save boundary. Please try again.';
      showNotification('error', t('gps.notifications.saveFailedTitle') || 'Save Failed', errorMsg);
    }
  };

  const discardNewBoundary = (index: number) => {
    // Simply remove the boundary without saving
    setNewBoundaries(newBoundaries.filter((_, i) => i !== index));
  };

  const saveBoundaryDraft = async (boundary: GpsFieldBoundary) => {
    const key = boundaryKey(boundary);
    if (!projectId || !key) {
      showNotification('error', t('gps.notifications.saveFailedTitle') || 'Save Failed', 'No project ID found. Please reload the page.');
      return;
    }

    if (!isBoundaryDirty(boundary)) return;

    setIsSaving(true);
    try {
      const draft = getBoundaryDraft(boundary);
      const mergedProps = { ...(boundary.properties || {}), ...(draft.properties || {}) };
      await hybridDB.updateFieldBoundary(
        key,
        draft.name,
        undefined,
        draft.color,
        mergedProps
      );

      setBoundaryDrafts(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      await loadBoundaries();

      window.dispatchEvent(new CustomEvent('boundariesUpdated', { 
        detail: { projectId: projectId.toString() } 
      }));

      // Notification removed to prevent duplicate toasts - save operation is silent
    } catch (error: any) {
      console.error('Failed to save boundary draft:', error);
      const errorMsg = error.message || 'Failed to save boundary. Please try again.';
      showNotification('error', t('gps.notifications.saveFailedTitle') || 'Save Failed', errorMsg);
    } finally {
      setIsSaving(false);
    }
  };

  const discardBoundaryDraft = (boundary: GpsFieldBoundary) => {
    const key = boundaryKey(boundary);
    if (!key) return;
    setBoundaryDrafts(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const startCustomRectangleDrawing = (map: L.Map) => {
    console.log('Starting custom rectangle drawing mode');
    
    // Reset state
    setRectangleState({ isDrawing: false, startPoint: null, isDragging: false, hasMouseDown: false });
    
    // Disable map dragging and other interactions
    map.dragging.disable();
    map.touchZoom.disable();
    map.doubleClickZoom.disable();
    map.scrollWheelZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
    if ((map as any).tap) (map as any).tap.disable();
    
    // Change cursor to crosshair
    map.getContainer().style.cursor = 'crosshair';
    
    // Create helper tooltip
    let helperTooltip: HTMLDivElement | null = null;
    const createHelperTooltip = () => {
      helperTooltip = document.createElement('div');
      helperTooltip.className = 'leaflet-draw-tooltip leaflet-draw-tooltip-single';
      helperTooltip.style.position = 'absolute';
      helperTooltip.style.zIndex = '1000';
      helperTooltip.style.pointerEvents = 'none';
      helperTooltip.style.background = 'rgba(0, 0, 0, 0.8)';
      helperTooltip.style.color = 'white';
      helperTooltip.style.padding = '4px 8px';
      helperTooltip.style.borderRadius = '4px';
      helperTooltip.style.fontSize = '12px';
      helperTooltip.style.display = 'none';
      helperTooltip.innerText = t('gps.drawingHelpers.rectangleStart') || 'Click and drag to draw rectangle';
      document.body.appendChild(helperTooltip);
    };
    
    const updateHelperTooltip = (e: L.LeafletMouseEvent, text: string) => {
      if (helperTooltip) {
        helperTooltip.innerText = text;
        helperTooltip.style.left = (e.originalEvent.pageX + 10) + 'px';
        helperTooltip.style.top = (e.originalEvent.pageY - 30) + 'px';
        helperTooltip.style.display = 'block';
      }
    };
    
    const hideHelperTooltip = () => {
      if (helperTooltip) {
        helperTooltip.style.display = 'none';
      }
    };
    
    createHelperTooltip();
    
    // State for rectangle drawing (local to this function)
    let tempRectangle: L.Rectangle | null = null;
    let localState = { isDrawing: false, startPoint: null as L.LatLng | null, isDragging: false, hasMouseDown: false };

    const finishRectangle = (start: L.LatLng, end: L.LatLng) => {
      // Ensure we have a valid rectangle (not just a point)
      const distance = start.distanceTo(end);
      if (distance < 5) { // Minimum 5 meters
        return;
      }

      // Remove temp rectangle
      if (tempRectangle) {
        map.removeLayer(tempRectangle);
        tempRectangle = null;
      }

      const bounds = L.latLngBounds(start, end);
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const nw = L.latLng(ne.lat, sw.lng);
      const se = L.latLng(sw.lat, ne.lng);
      
      // Create rectangle coordinates in GeoJSON format
      const coordinates = [[
        [sw.lng, sw.lat],
        [nw.lng, nw.lat], 
        [ne.lng, ne.lat],
        [se.lng, se.lat],
        [sw.lng, sw.lat] // Close the polygon
      ]];

      // Create new boundary
      const newBoundary: NewBoundary = {
        geometry_type: 'Polygon',
        coordinates,
        name: `Field ${newBoundaries.length + boundaries.length + 1}`,
        color: '#3b82f6',
        properties: {
          CROP: '',
          season: '',
          season_start: '',
          season_end: ''
        }
      };
      
      setNewBoundaries(prev => [...prev, newBoundary]);
      showNotification('success', t('gps.drawing.shapeCreated') || 'Rectangle Created', 'Rectangle created successfully!');
      
      // Reset state for next rectangle
      localState = { isDrawing: false, startPoint: null, isDragging: false, hasMouseDown: false };
    };

    const onMouseDown = (e: L.LeafletMouseEvent) => {
      e.originalEvent.preventDefault();
      
      localState.hasMouseDown = true;
      
      if (!localState.isDrawing) {
        // Start new rectangle
        localState.isDrawing = true;
        localState.startPoint = e.latlng;
        localState.isDragging = false;
        
        // Create temporary rectangle for preview
        const bounds = L.latLngBounds(e.latlng, e.latlng);
        tempRectangle = L.rectangle(bounds, {
          color: '#3388ff',
          weight: 2,
          opacity: 0.8,
          fillOpacity: 0.2,
          dashArray: '5, 5'
        }).addTo(map);
      }
    };

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      if (localState.hasMouseDown && localState.isDrawing) {
        localState.isDragging = true;
      }
      
      if (tempRectangle && localState.startPoint && localState.isDrawing) {
        const bounds = L.latLngBounds(localState.startPoint, e.latlng);
        tempRectangle.setBounds(bounds);
      }
      
      // Update helper tooltip
      if (!localState.isDrawing) {
        updateHelperTooltip(e, t('gps.drawingHelpers.rectangleStart') || 'Click and drag to draw rectangle');
      }
    };

    const onMouseUp = (e: L.LeafletMouseEvent) => {
      if (localState.isDrawing && localState.startPoint && localState.hasMouseDown) {
        if (localState.isDragging) {
          // Finish rectangle with drag method
          hideHelperTooltip();
          finishRectangle(localState.startPoint, e.latlng);
        } else {
          // First click in click-click pattern - just mark point
          // Second click will be handled by onMapClick
        }
      }
      
      localState.hasMouseDown = false;
    };

    const onMapClick = (e: L.LeafletMouseEvent) => {
      // Handle click-click pattern (only if not dragging)
      if (!localState.isDragging) {
        if (!localState.isDrawing) {
          // First click - start drawing
          localState.isDrawing = true;
          localState.startPoint = e.latlng;
          
          const bounds = L.latLngBounds(e.latlng, e.latlng);
          tempRectangle = L.rectangle(bounds, {
            color: '#3388ff',
            weight: 2,
            opacity: 0.8,
            fillOpacity: 0.2,
            dashArray: '5, 5'
          }).addTo(map);
        } else if (localState.startPoint) {
          // Second click - finish rectangle
          hideHelperTooltip();
          finishRectangle(localState.startPoint, e.latlng);
        }
      }
      // Reset dragging flag after handling
      localState.isDragging = false;
    };

    const cleanup = () => {
      if (tempRectangle) {
        map.removeLayer(tempRectangle);
        tempRectangle = null;
      }
      
      // Remove helper tooltip
      if (helperTooltip) {
        document.body.removeChild(helperTooltip);
        helperTooltip = null;
      }
      
      // Remove event listeners
      map.off('mousedown', onMouseDown);
      map.off('mousemove', onMouseMove);
      map.off('mouseup', onMouseUp);
      map.off('click', onMapClick);
      
      // Re-enable map interactions
      map.dragging.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.enable();
      map.scrollWheelZoom.enable();
      map.boxZoom.enable();
      map.keyboard.enable();
      if ((map as any).tap) (map as any).tap.enable();
      
      // Reset cursor
      map.getContainer().style.cursor = '';
      
      // Reset state
      localState = { isDrawing: false, startPoint: null, isDragging: false, hasMouseDown: false };
    };

    // Add event listeners
    map.on('mousedown', onMouseDown);
    map.on('mousemove', onMouseMove);
    map.on('mouseup', onMouseUp);
    map.on('click', onMapClick);
    
    // Add global escape key handler to exit rectangle mode
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup();
        setDrawingMode('none');
        document.removeEventListener('keydown', onKeyDown);
        showNotification('info', t('gps.drawingCancelled') || 'Drawing Cancelled', 'Drawing operation cancelled');
      }
    };
    
    document.addEventListener('keydown', onKeyDown);
    
    // Store cleanup function for external cleanup
    const externalCleanup = () => {
      cleanup();
      document.removeEventListener('keydown', onKeyDown);
    };
    rectangleCleanupRef.current = externalCleanup;
    // Register in cleanup tracking array
    cleanupFunctions.current.push(externalCleanup);
  };

  const focusOnBoundary = (boundary: GpsFieldBoundary) => {
    if (mapRef.current && boundary.geometry_type === 'Polygon') {
      const coords = boundary.coordinates as number[][][];
      const latLngs = coords[0].map(coord => [coord[1], coord[0]] as L.LatLngExpression);
      const bounds = L.latLngBounds(latLngs);
      const map = mapRef.current;
      
      // Set editing state first to ensure boundary is highlighted during animation
      setEditingBoundaryId(boundary.id);
      
      // Add small delay to ensure boundary rendering before animation
      setTimeout(() => {
        try {
          (map as any).flyToBounds(bounds, {
            padding: [60, 60],
            maxZoom: 18,
            duration: 1.0, // Slightly faster
            easeLinearity: 0.25 // Smoother easing
          });
        } catch {
          map.fitBounds(bounds, { padding: [60, 60], maxZoom: 18 });
        }
      }, 100);
    }
  };
  
  // Handle back navigation with unsaved changes confirmation
  const handleBackNavigation = async () => {
    if (newBoundaries.length > 0 || hasDirtyDrafts) {
      const confirmed = await showConfirmation(
        'Unsaved Changes',
        'You have unsaved boundaries. Discard changes and go back?',
        {
          confirmText: 'Discard',
          cancelText: 'Stay',
          type: 'warning'
        }
      );
      if (!confirmed) return;
    }
    navigate(-1);
  };

  return (
    <div className="fixed inset-0 overflow-hidden">
      {/* Offline Indicator */}
      {isOffline && (
        <div className="fixed top-4 right-4 z-[2001] animate-in slide-in-from-top-2 duration-300">
          <div className={`
            px-4 py-2 rounded-lg shadow-lg flex items-center gap-2
            ${isDarkMode ? 'bg-yellow-900/90 border border-yellow-700' : 'bg-yellow-500 border border-yellow-600'}
          `}>
            <div className="w-2 h-2 rounded-full bg-yellow-200 animate-pulse"></div>
            <span className="text-white text-sm font-medium">
              Offline Mode - Changes saved locally
            </span>
          </div>
        </div>
      )}
      
      {/* Loading Overlay */}
      {isLoading && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/20 backdrop-blur-sm z-[2002] animate-in fade-in duration-200">
          <div className={`
            rounded-lg p-6 shadow-xl flex flex-col items-center gap-3
            ${isDarkMode ? 'bg-gray-800' : 'bg-white'}
          `}>
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
            <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              Loading boundaries...
            </p>
          </div>
        </div>
      )}
      
      {/* Full-screen Map */}
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%', zIndex: 0 }}
        zoomControl={false}
        attributionControl={false}
        preferCanvas={true}
      >
        <MapRefSetter mapRef={mapRef} />
        <MapController center={center} zoom={zoom} />
        
        {/* Tile layers - offline within Germany bounds, online outside */}
        {(() => {
          const germanyBounds = getGermanyBounds();
          const isWithinOfflineBounds = center && germanyBounds && 
            center[0] >= germanyBounds[0][0] && center[0] <= germanyBounds[1][0] &&
            center[1] >= germanyBounds[0][1] && center[1] <= germanyBounds[1][1];
          const shouldUseOfflineTiles = germanyTilesAvailable && isWithinOfflineBounds;
          
          // Satellite view (online only)
          if (useSatellite && !shouldUseOfflineTiles && !forceOffline) {
            return (
              <TileLayer
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maxZoom={19}
                attribution='&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
              />
            );
          }
          
          // When within offline bounds and tiles available, use them
          if (shouldUseOfflineTiles) {
            return (
              <>
                <TileLayer
                  url="/tiles/germany/{z}/{x}/{y}.png"
                  maxZoom={18}
                  maxNativeZoom={12}
                  attribution='Offline Maps - Germany Base Map'
                  errorTileUrl={BLANK_TILE_URL}
                  crossOrigin="anonymous"
                />
                {usePmtilesVector && <PMTilesVectorLayer url={offlinePmtilesUrl} schema="openmaptiles" />}
              </>
            );
          }
          
          // Default: Online tiles (self-hosted or OpenStreetMap fallback)
          if (onlineTileUrl) {
            return (
              <TileLayer
                url={onlineTileUrl}
                maxZoom={20}
                attribution='&copy; Online Tiles'
                crossOrigin="anonymous"
              />
            );
          }
          
          // Fallback: OpenStreetMap
          return (
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={20}
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              crossOrigin="anonymous"
              tileSize={256}
            />
          );
        })()}
        <FeatureGroup ref={featureGroupRef} />
        
        {/* Render existing boundaries */}
        {boundariesWithCentroids.map((boundary) => {
          if (boundary.geometry_type === 'Polygon') {
            const coords = boundary.coordinates as number[][][];
            const positions = coords[0].map(coord => [coord[1], coord[0]] as [number, number]);
            const centroid = boundary.centroid;
              
            // Create field name label
            const labelIcon = centroid ? L.divIcon({
              className: 'field-label',
              html: `<div style="
                position: absolute;
                left: 0;
                top: 0;
                font-weight: bold;
                font-size: 14px;
                color: #000000;
                text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff, 0 0 4px #fff;
                white-space: nowrap;
                pointer-events: none;
                transform: translate(-50%, -50%);
              ">${boundary.name}</div>`,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            }) : null;
            
            return (
              <div key={boundary.id}>
                <Polygon
                  positions={positions}
                  pathOptions={{
                    color: boundary.color || '#00FF00',
                    fillColor: boundary.color || '#00FF00',
                    fillOpacity: editingBoundaryId === boundary.id ? 0.5 : 0.2,
                    weight: editingBoundaryId === boundary.id ? 3 : 2,
                  }}
                  eventHandlers={{
                    click: () => {
                      setEditingBoundaryId(prev => (prev === boundary.id ? null : boundary.id));
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
              
        {/* Render new boundaries */}
        {newBoundariesWithCentroids.map((boundary, idx) => {
          const coords = boundary.coordinates as number[][][];
          const positions = coords[0].map(coord => [coord[1], coord[0]] as [number, number]);
          const centroid = boundary.centroid;
          
          // Create field name label
          const labelIcon = centroid ? L.divIcon({
            className: 'field-label',
            html: `<div style="
              position: absolute;
              left: 0;
              top: 0;
              font-weight: bold;
              font-size: 14px;
              color: #000000;
              text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff, 0 0 4px #fff;
              white-space: nowrap;
              pointer-events: none;
              transform: translate(-50%, -50%);
            ">${boundary.name}</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }) : null;
          
          return (
            <div key={`new-${idx}`}>
              <Polygon
                positions={positions}
                pathOptions={{
                  color: boundary.color,
                  fillColor: boundary.color,
                  fillOpacity: 0.3,
                  weight: 2,
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
        })}
      </MapContainer>

      <input
        ref={boundaryImportInputRef}
        type="file"
        accept=".zip,.geojson,.json,application/zip,application/json"
        className="hidden"
        onChange={handleBoundaryImport}
      />

      {/* Toast-style Sidebar */}
      <div 
        className={`
          fixed left-4 top-4 z-[2000] w-64 lg:w-80
          ${isSidebarCollapsed ? 'h-auto' : 'bottom-4'}
          transition-all duration-500 ease-in-out
        `}
      >
        <div 
          className={`
            ${isSidebarCollapsed ? 'h-auto' : 'h-full'}
            rounded-2xl shadow-lg
            ${isDarkMode ? 'bg-gray-900/20 border border-gray-700/30' : 'bg-white/40 border border-gray-200/50'}
            backdrop-blur-2xl
            flex flex-col
            transition-all duration-500 ease-in-out
          `}
          style={{ 
            WebkitBackdropFilter: 'blur(12px)',
            backdropFilter: 'blur(12px)',
            WebkitTransform: 'translateZ(0)',
            transform: 'translateZ(0)'
          }}
        >
          {/* Collapsed Header */}
          {isSidebarCollapsed && (
            <div className="p-3 flex items-center justify-between gap-2 animate-in fade-in slide-in-from-top-2 duration-500">
              {/* Title */}
              <button
                onClick={() => setIsSidebarCollapsed(false)}
                className="flex-1 min-w-0 text-left"
              >
                <span className={`text-sm font-semibold truncate block ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  {t('gps.fieldBoundaryEditor') || 'Field Editor'}
                </span>
              </button>

              {/* Avatar */}
              <div className="relative avatar-dropdown-container flex-shrink-0">
                <button
                  onClick={() => setShowAvatarDropdown(!showAvatarDropdown)}
                  className={`
                    w-8 h-8 rounded-full flex items-center justify-center
                    ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}
                    transition-all duration-300
                    overflow-hidden
                  `}
                >
                  {userAvatar ? (
                    <img src={userAvatar} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <User className={`w-4 h-4 ${isDarkMode ? 'text-white' : 'text-gray-700'}`} />
                  )}
                </button>
                
                {/* Avatar Dropdown (Collapsed) */}
                {showAvatarDropdown && (
                  <div 
                    className={`
                      fixed top-16 left-1/2 transform -translate-x-1/2 w-56 rounded-2xl shadow-2xl z-[99999]
                      ${isDarkMode ? 'bg-gray-900/20 border border-gray-700/30' : 'bg-white/40 border border-gray-200/50'}
                      backdrop-blur-2xl
                    `}
                  >
                    <div className={`px-4 py-3 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                      <p className={`text-sm font-semibold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        {user?.email || 'User'}
                      </p>
                    </div>
                    {/* Avatar Image Submenu */}
                    <div>
                      <button
                        onClick={() => setShowAvatarSubmenu(!showAvatarSubmenu)}
                        className={`w-full px-4 py-2 flex items-center gap-3 transition-colors ${
                          isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
                        }`}
                      >
                        <User className="w-4 h-4" />
                        <span className="text-sm flex-1 text-left">{t('gps.addAvatarImage') || 'Add Avatar Image'}</span>
                        <ChevronRight className={`w-4 h-4 transition-transform ${showAvatarSubmenu ? 'rotate-90' : ''}`} />
                      </button>
                      
                      {/* Inline Submenu Options */}
                      {showAvatarSubmenu && (
                        <div className={`border-l-2 ml-4 ${isDarkMode ? 'border-gray-600' : 'border-gray-300'}`}>
                          <label
                            className={`w-full px-4 py-2 flex items-center gap-3 transition-colors cursor-pointer ${
                              isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
                            }`}
                          >
                            <Upload className="w-4 h-4" />
                            <span className="text-sm">{t('gps.uploadAvatar') || 'Upload from Device'}</span>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                handleAvatarUpload(e);
                                setShowAvatarDropdown(false);
                                setShowAvatarSubmenu(false);
                              }}
                              className="hidden"
                            />
                          </label>
                          <label
                            className={`w-full px-4 py-2 flex items-center gap-3 transition-colors cursor-pointer ${
                              isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
                            }`}
                          >
                            <Camera className="w-4 h-4" />
                            <span className="text-sm">{t('gps.takePhoto') || 'Take Photo'}</span>
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              onChange={(e) => {
                                handleAvatarUpload(e);
                                setShowAvatarDropdown(false);
                                setShowAvatarSubmenu(false);
                              }}
                              className="hidden"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                    
                    {/* Language Selection */}
                    <div>
                      <button
                        onClick={() => setShowLanguageDropdown(!showLanguageDropdown)}
                        className={`w-full px-4 py-2 flex items-center gap-3 transition-colors ${
                          isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
                        }`}
                      >
                        <Globe className="w-4 h-4" />
                        <span className="text-sm flex-1 text-left">{t('auth.selectLanguage') || 'Language'}</span>
                        <ChevronRight className={`w-4 h-4 transition-transform ${showLanguageDropdown ? 'rotate-90' : ''}`} />
                      </button>
                      
                      {/* Inline Language Options */}
                      {showLanguageDropdown && (
                        <div className={`border-l-2 ml-4 ${isDarkMode ? 'border-gray-600' : 'border-gray-300'}`}>
                          <button
                            onClick={() => {
                              changeLanguage('en');
                              setShowLanguageDropdown(false);
                              setShowAvatarDropdown(false);
                            }}
                            className={`w-full px-4 py-2 text-sm text-left transition-colors ${
                              language === 'en'
                                ? (isDarkMode ? 'bg-blue-600/20 text-blue-400' : 'bg-blue-50 text-blue-600')
                                : (isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700')
                            }`}
                          >
                            English
                          </button>
                          <button
                            onClick={() => {
                              changeLanguage('de');
                              setShowLanguageDropdown(false);
                              setShowAvatarDropdown(false);
                            }}
                            className={`w-full px-4 py-2 text-sm text-left transition-colors ${
                              language === 'de'
                                ? (isDarkMode ? 'bg-blue-600/20 text-blue-400' : 'bg-blue-50 text-blue-600')
                                : (isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700')
                            }`}
                          >
                            Deutsch
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        toggleDarkMode();
                        setShowAvatarDropdown(false);
                      }}
                      className={`w-full px-4 py-2 text-left flex items-center gap-3 transition-colors ${
                        isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
                      }`}
                    >
                      {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                      <span className="text-sm">{isDarkMode ? (t('gps.lightTheme') || 'Light Theme') : (t('gps.darkTheme') || 'Dark Theme')}</span>
                    </button>
                    <button
                      onClick={async () => {
                        setShowAvatarDropdown(false);
                        await logout();
                        toast.success(t('gps.loggedOut') || 'Logged out successfully');
                      }}
                      className={`w-full px-4 py-2 text-left flex items-center gap-3 transition-colors border-t ${
                        isDarkMode ? 'hover:bg-red-900/30 text-red-400 border-gray-700' : 'hover:bg-red-50 text-red-600 border-gray-200'
                      }`}
                    >
                      <LogOut className="w-4 h-4" />
                      <span className="text-sm">{t('gps.logout') || 'Logout'}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Chevron for expanding */}
              <button
                onClick={() => setIsSidebarCollapsed(false)}
                className={`
                  p-1.5 rounded-lg transition-colors flex-shrink-0
                  ${isDarkMode ? 'hover:bg-gray-700/50 text-gray-300' : 'hover:bg-gray-100/50 text-gray-700'}
                `}
                title={t('common.expandSidebar') || 'Expand sidebar'}
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Expanded Sidebar Content */}
          {!isSidebarCollapsed && (
            <>
              {/* Header with Back Button, Avatar and Chevron */}
              <div className="border-b border-gray-200/50 dark:border-gray-700/50 animate-in fade-in duration-500">
                <div className="flex items-center justify-between p-4 gap-3">
                  {/* Back Button and Title */}
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <button
                      onClick={handleBackNavigation}
                      className={`p-2 rounded-lg transition-colors flex-shrink-0 ${
                        isDarkMode 
                          ? 'hover:bg-gray-700/50 text-gray-300' 
                          : 'hover:bg-gray-100/50 text-gray-700'
                      }`}
                      title={t('common.back') || 'Back'}
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                    <h2 className={`text-lg font-bold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {t('gps.fieldBoundaryEditor') || 'Field Editor'}
                    </h2>
                  </div>

                  {/* Avatar */}
                  <div className="relative avatar-dropdown-container flex-shrink-0">
                    <button
                      onClick={() => setShowAvatarDropdown(!showAvatarDropdown)}
                      className={`
                        w-9 h-9 rounded-full flex items-center justify-center
                        ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}
                        transition-all duration-300
                        overflow-hidden
                      `}
                    >
                      {userAvatar ? (
                        <img src={userAvatar} alt="Avatar" className="w-full h-full object-cover" />
                      ) : (
                        <User className={`w-5 h-5 ${isDarkMode ? 'text-white' : 'text-gray-700'}`} />
                      )}
                    </button>
                    
                    {/* Avatar Dropdown (Expanded) */}
                    {showAvatarDropdown && (
                      <div 
                        className={`
                          absolute top-full left-1/2 transform -translate-x-1/2 mt-2 w-56 rounded-2xl shadow-2xl z-[10001]
                          ${isDarkMode ? 'bg-gray-900/20 border border-gray-700/30' : 'bg-white/40 border border-gray-200/50'}
                          backdrop-blur-2xl
                        `}
                      >
                        <div className={`px-4 py-3 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                          <p className={`text-sm font-semibold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            {user?.email || 'User'}
                          </p>
                        </div>
                        {/* Avatar Image Submenu */}
                        <div>
                          <button
                            onClick={() => setShowAvatarSubmenu(!showAvatarSubmenu)}
                            className={`w-full px-4 py-2 flex items-center gap-3 transition-colors ${
                              isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
                            }`}
                          >
                            <User className="w-4 h-4" />
                            <span className="text-sm flex-1 text-left">{t('gps.addAvatarImage') || 'Add Avatar Image'}</span>
                            <ChevronRight className={`w-4 h-4 transition-transform ${showAvatarSubmenu ? 'rotate-90' : ''}`} />
                          </button>
                          
                          {/* Inline Submenu Options */}
                          {showAvatarSubmenu && (
                            <div className={`border-l-2 ml-4 ${isDarkMode ? 'border-gray-600' : 'border-gray-300'}`}>
                              <label
                                className={`w-full px-4 py-2 flex items-center gap-3 transition-colors cursor-pointer ${
                                  isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
                                }`}
                              >
                                <Upload className="w-4 h-4" />
                                <span className="text-sm">{t('gps.uploadAvatar') || 'Upload from Device'}</span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => {
                                    handleAvatarUpload(e);
                                    setShowAvatarDropdown(false);
                                    setShowAvatarSubmenu(false);
                                  }}
                                  className="hidden"
                                />
                              </label>
                              <label
                                className={`w-full px-4 py-2 flex items-center gap-3 transition-colors cursor-pointer ${
                                  isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
                                }`}
                              >
                                <Camera className="w-4 h-4" />
                                <span className="text-sm">{t('gps.takePhoto') || 'Take Photo'}</span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  capture="environment"
                                  onChange={(e) => {
                                    handleAvatarUpload(e);
                                    setShowAvatarDropdown(false);
                                    setShowAvatarSubmenu(false);
                                  }}
                                  className="hidden"
                                />
                              </label>
                            </div>
                          )}
                        </div>
                        
                        {/* Language Selection */}
                        <div>
                          <button
                            onClick={() => setShowLanguageDropdown(!showLanguageDropdown)}
                            className={`w-full px-4 py-2 flex items-center gap-3 transition-colors ${
                              isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
                            }`}
                          >
                            <Globe className="w-4 h-4" />
                            <span className="text-sm flex-1 text-left">{t('auth.selectLanguage') || 'Language'}</span>
                            <ChevronRight className={`w-4 h-4 transition-transform ${showLanguageDropdown ? 'rotate-90' : ''}`} />
                          </button>
                          
                          {/* Inline Language Options */}
                          {showLanguageDropdown && (
                            <div className={`border-l-2 ml-4 ${isDarkMode ? 'border-gray-600' : 'border-gray-300'}`}>
                              <button
                                onClick={() => {
                                  changeLanguage('en');
                                  setShowLanguageDropdown(false);
                                  setShowAvatarDropdown(false);
                                }}
                                className={`w-full px-4 py-2 text-sm text-left transition-colors ${
                                  language === 'en'
                                    ? (isDarkMode ? 'bg-blue-600/20 text-blue-400' : 'bg-blue-50 text-blue-600')
                                    : (isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700')
                                }`}
                              >
                                English
                              </button>
                              <button
                                onClick={() => {
                                  changeLanguage('de');
                                  setShowLanguageDropdown(false);
                                  setShowAvatarDropdown(false);
                                }}
                                className={`w-full px-4 py-2 text-sm text-left transition-colors ${
                                  language === 'de'
                                    ? (isDarkMode ? 'bg-blue-600/20 text-blue-400' : 'bg-blue-50 text-blue-600')
                                    : (isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700')
                                }`}
                              >
                                Deutsch
                              </button>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            toggleDarkMode();
                            setShowAvatarDropdown(false);
                          }}
                          className={`w-full px-4 py-2 text-left flex items-center gap-3 transition-colors ${
                            isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
                          }`}
                        >
                          {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                          <span className="text-sm">{isDarkMode ? (t('gps.lightTheme') || 'Light Theme') : (t('gps.darkTheme') || 'Dark Theme')}</span>
                        </button>
                        <button
                          onClick={async () => {
                            setShowAvatarDropdown(false);
                            await logout();
                            showNotification('success', t('gps.loggedOut') || 'Logged Out', 'Logged out successfully');
                          }}
                          className={`w-full px-4 py-2 text-left flex items-center gap-3 transition-colors border-t ${
                            isDarkMode ? 'hover:bg-red-900/30 text-red-400 border-gray-700' : 'hover:bg-red-50 text-red-600 border-gray-200'
                          }`}
                        >
                          <LogOut className="w-4 h-4" />
                          <span className="text-sm">{t('gps.logout') || 'Logout'}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Chevron for collapsing */}
                  <button
                    onClick={() => setIsSidebarCollapsed(true)}
                    className={`
                      p-2 rounded-lg transition-colors flex-shrink-0
                      ${isDarkMode ? 'hover:bg-gray-700/50 text-gray-300' : 'hover:bg-gray-100/50 text-gray-700'}
                    `}
                    title={t('gps.collapseToTop') || 'Collapse to top'}
                  >
                    <ChevronDown className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Scrollable Content */}
              <div className="overflow-y-auto overflow-x-hidden flex-1 p-4 animate-in fade-in slide-in-from-top-4 duration-700" style={{ maxHeight: 'calc(100vh - 12rem)' }}>


                {/* New Boundaries List */}
                {newBoundaries.length > 0 && (
                  <div className="mb-6">
                    <h3 className={`text-sm font-semibold mb-3 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('gps.newBoundaries') || 'New Boundaries'} ({newBoundaries.length})
                    </h3>
                    <div className="space-y-3">
                      {newBoundaries.map((boundary, idx) => (
                        <div
                          key={idx}
                          className={`p-3 rounded-lg border backdrop-blur-xl ${
                            isDarkMode ? 'bg-gray-800/40 border-gray-700/50' : 'bg-white/60 border-gray-200/70'
                          }`}
                        >
                          <div className="space-y-2">
                            <div>
                              <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                {t('gps.fieldName') || 'Field Name'}
                              </label>
                              <input
                                type="text"
                                value={boundary.name}
                                onChange={(e) => updateNewBoundary(idx, { name: e.target.value })}
                                className={`${getInputStyles()} text-sm`}
                              />
                            </div>
                            <div>
                              <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                {t('gps.color') || 'Color'}
                              </label>
                              <input
                                type="color"
                                value={boundary.color}
                                onChange={(e) => updateNewBoundary(idx, { color: e.target.value })}
                                className="w-full h-8 rounded-lg cursor-pointer"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                  {t('gps.crop') || 'Crop'}
                                </label>
                                <input
                                  type="text"
                                  value={boundary.properties.CROP || ''}
                                  onChange={(e) => updateNewBoundary(idx, {
                                    properties: { ...boundary.properties, CROP: e.target.value }
                                  })}
                                  placeholder="Wheat"
                                  className={`${getInputStyles()} text-sm`}
                                />
                              </div>
                              <div>
                                <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                  {t('gps.season') || 'Season'}
                                </label>
                                <input
                                  type="text"
                                  value={boundary.properties.season || ''}
                                  onChange={(e) => updateNewBoundary(idx, {
                                    properties: { ...boundary.properties, season: e.target.value }
                                  })}
                                  placeholder="Winter 2025"
                                  className={`${getInputStyles()} text-sm`}
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                  {t('gps.seasonStart') || 'Season Start'}
                                </label>
                                <input
                                  type="text"
                                  value={boundary.properties.season_start || ''}
                                  onChange={(e) => updateNewBoundary(idx, {
                                    properties: { ...boundary.properties, season_start: e.target.value }
                                  })}
                                  placeholder="Jan 2025"
                                  className={`${getInputStyles()} text-sm`}
                                />
                              </div>
                              <div>
                                <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                  {t('gps.seasonEnd') || 'Season End'}
                                </label>
                                <input
                                  type="text"
                                  value={boundary.properties.season_end || ''}
                                  onChange={(e) => updateNewBoundary(idx, {
                                    properties: { ...boundary.properties, season_end: e.target.value }
                                  })}
                                  placeholder="Jun 2025"
                                  className={`${getInputStyles()} text-sm`}
                                />
                              </div>
                            </div>
                            <div>
                              <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                {t('gps.uid') || 'UID'}
                              </label>
                              <input
                                type="text"
                                value={boundary.properties.uid || ''}
                                onChange={(e) => updateNewBoundary(idx, {
                                  properties: { ...boundary.properties, uid: e.target.value }
                                })}
                                placeholder="F-001"
                                className={`${getInputStyles()} text-sm`}
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => acceptNewBoundary(idx)}
                                title={t('gps.acceptTooltip') || 'I want to keep this boundary and save it'}
                                className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-xs font-medium ${
                                  isDarkMode
                                    ? 'bg-green-900/20 text-green-400 hover:bg-green-900/30'
                                    : 'bg-green-50 text-green-600 hover:bg-green-100'
                                }`}
                              >
                                <Check className="w-3 h-3" />
                                {t('gps.accept') || 'Accept'}
                              </button>
                              <button
                                onClick={() => discardNewBoundary(idx)}
                                title={t('gps.discardTooltip') || 'I want to remove this boundary without saving'}
                                className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-xs font-medium ${
                                  isDarkMode
                                    ? 'bg-yellow-900/20 text-yellow-400 hover:bg-yellow-900/30'
                                    : 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100'
                                }`}
                              >
                                <X className="w-3 h-3" />
                                {t('gps.discard') || 'Discard'}
                              </button>
                            </div>
                            <button
                              onClick={() => removeNewBoundary(idx)}
                              className={`w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-xs font-medium mt-2 ${
                                isDarkMode
                                  ? 'bg-red-900/20 text-red-400 hover:bg-red-900/30'
                                  : 'bg-red-50 text-red-600 hover:bg-red-100'
                              }`}
                            >
                              <Trash2 className="w-3 h-3" />
                              {t('common.delete') || 'Delete'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Existing Boundaries in Sidebar */}
                {boundaries.length > 0 && (
                  <div className="mb-6">
                    <h3 className={`text-sm font-semibold mb-3 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('gps.existingBoundaries') || 'Existing Boundaries'} ({boundaries.length})
                    </h3>
                    <div className="space-y-2">
                      {boundaries.map((boundary) => (
                        <div key={boundary.id} className="space-y-0">
                          {/* Field Header - Clickable */}
                          <div
                            onClick={() => {
                              focusOnBoundary(boundary);
                              setEditingBoundaryId(editingBoundaryId === boundary.id ? null : boundary.id);
                            }}
                            className={`p-2.5 rounded-lg border backdrop-blur-xl cursor-pointer transition-all ${
                              editingBoundaryId === boundary.id
                                ? isDarkMode 
                                  ? 'bg-blue-900/40 border-blue-700/70 ring-1 ring-blue-500/50' 
                                  : 'bg-blue-50/80 border-blue-300/70 ring-1 ring-blue-400/50'
                                : isDarkMode 
                                ? 'bg-gray-800/40 border-gray-700/50 hover:bg-gray-800/60' 
                                : 'bg-white/60 border-gray-200/70 hover:bg-white/80'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <div
                                className="w-5 h-5 rounded border-2 border-white flex-shrink-0"
                                style={{ backgroundColor: boundary.color || '#00FF00' }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className={`font-medium text-sm truncate ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                                  {boundary.name}
                                </div>
                                {boundary.properties?.CROP && (
                                  <div className={`text-xs truncate ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                    {boundary.properties.CROP}
                                  </div>
                                )}
                              </div>
                              <ChevronDown className={`w-4 h-4 transition-transform ${
                                editingBoundaryId === boundary.id ? 'rotate-180' : ''
                              } ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`} />
                            </div>
                          </div>
                          
                          {/* Expanded Edit Form */}
                          {editingBoundaryId === boundary.id && (
                            <div className={`mt-1 p-3 rounded-lg border backdrop-blur-xl border-t-0 rounded-t-none ${
                              isDarkMode ? 'bg-gray-800/60 border-gray-700/50' : 'bg-white/80 border-gray-200/70'
                            }`}>
                              <form 
                                data-boundary-id={boundary.id}
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  if (isBoundaryDirty(boundary)) {
                                    saveBoundaryDraft(boundary);
                                  }
                                }}
                              >
                              {(() => {
                                const draft = getBoundaryDraft(boundary);
                                const dirty = isBoundaryDirty(boundary);
                                return (
                              <div className="space-y-2">
                                <div>
                                  <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                    {t('gps.fieldName') || 'Field Name'}
                                  </label>
                                  <input
                                    type="text"
                                    value={draft.name}
                                    onChange={(e) => upsertDraft(boundary, { name: e.target.value })}
                                    className={`${getInputStyles()} text-sm`}
                                  />
                                </div>
                                <div>
                                  <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                    {t('gps.color') || 'Color'}
                                  </label>
                                  <input
                                    type="color"
                                    value={draft.color || '#00FF00'}
                                    onChange={(e) => upsertDraft(boundary, { color: e.target.value })}
                                    className="w-full h-8 rounded-lg cursor-pointer"
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                      {t('gps.crop') || 'Crop'}
                                    </label>
                                    <input
                                      type="text"
                                      value={draft.properties?.CROP || ''}
                                      onChange={(e) => upsertDraft(boundary, { properties: { CROP: e.target.value } })}
                                      className={`${getInputStyles()} text-sm`}
                                    />
                                  </div>
                                  <div>
                                    <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                      {t('gps.season') || 'Season'}
                                    </label>
                                    <input
                                      type="text"
                                      value={draft.properties?.season || ''}
                                      onChange={(e) => upsertDraft(boundary, { properties: { season: e.target.value } })}
                                      className={`${getInputStyles()} text-sm`}
                                    />
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                      {t('gps.seasonStart') || 'Season Start'}
                                    </label>
                                    <input
                                      type="text"
                                      value={draft.properties?.season_start || ''}
                                      onChange={(e) => upsertDraft(boundary, { properties: { season_start: e.target.value } })}
                                      className={`${getInputStyles()} text-sm`}
                                    />
                                  </div>
                                  <div>
                                    <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                      {t('gps.seasonEnd') || 'Season End'}
                                    </label>
                                    <input
                                      type="text"
                                      value={draft.properties?.season_end || ''}
                                      onChange={(e) => upsertDraft(boundary, { properties: { season_end: e.target.value } })}
                                      placeholder="Jun 2025"
                                      className={`${getInputStyles()} text-sm`}
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                    {t('gps.uuid') || 'UUID'}
                                  </label>
                                  <input
                                    type="text"
                                    value={draft.properties?.uid || ''}
                                    onChange={(e) => upsertDraft(boundary, { properties: { uid: e.target.value } })}
                                    className={`${getInputStyles()} text-sm`}
                                  />
                                </div>
                                {dirty && (
                                  <div className="flex gap-2 mt-3">
                                    <button
                                      onClick={async () => {
                                        await saveBoundaryDraft(boundary);
                                      }}
                                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-xs font-medium ${
                                        isDarkMode
                                          ? 'bg-green-900/20 text-green-400 hover:bg-green-900/30'
                                          : 'bg-green-50 text-green-600 hover:bg-green-100'
                                      }`}
                                    >
                                      <Check className="w-3 h-3" />
                                      {t('gps.accept') || 'Accept'}
                                    </button>
                                    <button
                                      onClick={() => discardBoundaryDraft(boundary)}
                                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-xs font-medium ${
                                        isDarkMode
                                          ? 'bg-yellow-900/20 text-yellow-400 hover:bg-yellow-900/30'
                                          : 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100'
                                      }`}
                                    >
                                      <X className="w-3 h-3" />
                                      {t('gps.discard') || 'Discard'}
                                    </button>
                                  </div>
                                )}
                                <button
                                  onClick={async () => {
                                    await handleDeleteBoundary(boundary.id);
                                    setEditingBoundaryId(null);
                                  }}
                                  className={`w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-xs font-medium mt-2 ${
                                    isDarkMode
                                      ? 'bg-red-900/20 text-red-400 hover:bg-red-900/30'
                                      : 'bg-red-50 text-red-600 hover:bg-red-100'
                                  }`}
                                >
                                  <Trash2 className="w-3 h-3" />
                                  {t('common.delete') || 'Delete'}
                                </button>
                              </div>
                                );
                              })()}
                              </form>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>


                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Custom Drawing Tools Panel */}
      <div 
        className={`
          fixed z-[1999] w-16 transition-all duration-500 ease-in-out
          ${isSidebarCollapsed ? 'left-4' : 'left-[17.5rem] lg:left-[21.5rem]'}
        `} 
        style={{ top: '80px' }}
      >
        <div 
          className={`
            rounded-2xl shadow-lg p-3
            ${isDarkMode ? 'bg-gray-900/20 border border-gray-700/30' : 'bg-white/40 border border-gray-200/50'}
            backdrop-blur-2xl
            flex flex-col gap-2
            transition-all duration-500 ease-in-out
          `}
          style={{ 
            WebkitBackdropFilter: 'blur(12px)',
            backdropFilter: 'blur(12px)',
            WebkitTransform: 'translateZ(0)',
            transform: 'translateZ(0)'
          }}
        >
          {/* Selection Tool */}
          <button
            onClick={() => cancelDrawing()}
            className={`
              w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200 group relative
              ${
                drawingMode === 'none'
                  ? isDarkMode
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'bg-blue-600 text-white shadow-lg'
                  : isDarkMode
                  ? 'bg-gray-700/60 hover:bg-gray-600 text-gray-300 hover:text-white'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-800'
              }
            `}
            title={t('gps.selectMode') || 'Select Mode'}
          >
            <MousePointer className="w-5 h-5" />
            {/* Tooltip */}
            <div className={`
              absolute left-full ml-3 px-2 py-1 rounded text-xs font-medium
              opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap
              ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-gray-900 text-white'}
            `}>
              {t('gps.selectMode') || 'Select'}
            </div>
          </button>

          <button
            onClick={() => boundaryImportInputRef.current?.click()}
            className={`
              w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200 group relative
              ${isDarkMode
                ? 'bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 hover:text-blue-200'
                : 'bg-blue-50 hover:bg-blue-100 text-blue-600 hover:text-blue-700'
              }
            `}
            title={'Import boundaries (.zip/.geojson)'}
          >
            <Upload className="w-4 h-4" />
            <div className={`
              absolute left-full ml-3 px-2 py-1 rounded text-xs font-medium
              opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap
              ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-gray-900 text-white'}
            `}>
              {'Import Boundaries'}
            </div>
          </button>

          {/* Polygon Tool */}
          <button
            onClick={() => startDrawing('polygon')}
            className={`
              w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200 group relative
              ${
                drawingMode === 'polygon'
                  ? isDarkMode
                    ? 'bg-green-600 text-white shadow-lg'
                    : 'bg-green-600 text-white shadow-lg'
                  : isDarkMode
                  ? 'bg-gray-700/60 hover:bg-gray-600 text-gray-300 hover:text-white'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-800'
              }
            `}
            title={t('gps.drawPolygon') || 'Draw Polygon'}
          >
            <Edit3 className="w-4 h-4" />
            {/* Tooltip */}
            <div className={`
              absolute left-full ml-3 px-2 py-1 rounded text-xs font-medium
              opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap
              ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-gray-900 text-white'}
            `}>
              {t('gps.drawPolygon') || 'Polygon'}
            </div>
          </button>

        </div>


      </div>

      {/* Map Controls Panel */}
      <div 
        className={`
          fixed z-[1999] w-16 transition-all duration-500 ease-in-out
          hidden lg:block
          ${isSidebarCollapsed ? 'left-4' : 'left-[17.5rem] lg:left-[21.5rem]'}
        `} 
        style={{ top: '395px' }}
      >
        <div 
          className={`
            rounded-2xl shadow-lg p-3
            ${isDarkMode ? 'bg-gray-900/20 border border-gray-700/30' : 'bg-white/40 border border-gray-200/50'}
            backdrop-blur-2xl
            flex flex-col gap-2
            transition-all duration-500 ease-in-out
          `}
          style={{ 
            WebkitBackdropFilter: 'blur(12px)',
            backdropFilter: 'blur(12px)',
            WebkitTransform: 'translateZ(0)',
            transform: 'translateZ(0)'
          }}
        >
          {/* Map Layers Toggle */}
          <button
            onClick={() => {
              // Disable satellite toggle in offline/Capacitor mode
              if (forceOffline && germanyTilesAvailable) {
                return;
              }
              setUseSatellite(!useSatellite);
            }}
            disabled={forceOffline && germanyTilesAvailable}
            className={`
              w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200 group relative
              ${forceOffline && germanyTilesAvailable
                ? 'opacity-50 cursor-not-allowed bg-gray-500'
                : useSatellite
                ? isDarkMode
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-blue-600 text-white shadow-lg'
                : isDarkMode
                ? 'bg-gray-700/60 hover:bg-gray-600 text-gray-300 hover:text-white'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-800'
              }
            `}
            title={forceOffline && germanyTilesAvailable 
              ? 'Offline mode - using local tiles'
              : useSatellite ? (t('gps.streetView') || 'Street View') : (t('gps.satelliteView') || 'Satellite View')
            }
          >
            <Layers className="w-4 h-4" />
            <div className={`
              absolute left-full ml-3 px-2 py-1 rounded text-xs font-medium
              opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap
              ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-gray-900 text-white'}
            `}>
              {useSatellite ? (t('gps.streetView') || 'Street') : (t('gps.satelliteView') || 'Satellite')}
            </div>
          </button>

          {/* Fit to Bounds */}
          <button
            onClick={fitBounds}
            disabled={boundaries.length === 0 && newBoundaries.length === 0}
            className={`
              w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200 group relative
              ${
                boundaries.length === 0 && newBoundaries.length === 0
                  ? isDarkMode
                    ? 'bg-gray-800/40 text-gray-600 cursor-not-allowed'
                    : 'bg-gray-100/40 text-gray-400 cursor-not-allowed'
                  : isDarkMode
                  ? 'bg-gray-700/60 hover:bg-gray-600 text-gray-300 hover:text-white'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-800'
              }
            `}
            title={t('gps.fitBounds') || 'Fit to Boundaries'}
          >
            <Maximize2 className="w-4 h-4" />
            <div className={`
              absolute left-full ml-3 px-2 py-1 rounded text-xs font-medium
              opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap
              ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-gray-900 text-white'}
            `}>
              {t('gps.fitBounds') || 'Fit All'}
            </div>
          </button>

          {/* Reset View */}
          <button
            onClick={resetView}
            className={`
              w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200 group relative
              ${isDarkMode
                ? 'bg-gray-700/60 hover:bg-gray-600 text-gray-300 hover:text-white'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-800'
              }
            `}
            title={t('gps.resetView') || 'Reset View'}
          >
            <RotateCcw className="w-4 h-4" />
            <div className={`
              absolute left-full ml-3 px-2 py-1 rounded text-xs font-medium
              opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap
              ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-gray-900 text-white'}
            `}>
              {t('gps.resetView') || 'Reset View'}
            </div>
          </button>
        </div>
      </div>

      {/* Save Controls Panel */}
      <div 
        className={`
          fixed z-[1999] w-16 transition-all duration-500 ease-in-out
          ${isSidebarCollapsed ? 'left-4' : 'left-[17.5rem] lg:left-[21.5rem]'}
        `} 
        style={{ top: '260px' }}
      >
        <div 
          className={`
            rounded-2xl shadow-lg p-3
            ${isDarkMode ? 'bg-gray-900/20 border border-gray-700/30' : 'bg-white/40 border border-gray-200/50'}
            backdrop-blur-2xl
            flex flex-col gap-2
            transition-all duration-500 ease-in-out
          `}
          style={{ 
            WebkitBackdropFilter: 'blur(12px)',
            backdropFilter: 'blur(12px)',
            WebkitTransform: 'translateZ(0)',
            transform: 'translateZ(0)'
          }}
        >
          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={isSaving || (newBoundaries.length === 0 && !hasDirtyDrafts)}
            className={`
              w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200 group relative
              ${
                isSaving || (newBoundaries.length === 0 && !hasDirtyDrafts)
                  ? isDarkMode
                    ? 'bg-gray-800/40 text-gray-600 cursor-not-allowed'
                    : 'bg-gray-100/40 text-gray-400 cursor-not-allowed'
                  : isDarkMode
                  ? 'bg-green-600 hover:bg-green-700 text-white shadow-lg'
                  : 'bg-green-600 hover:bg-green-700 text-white shadow-lg'
              }
            `}
            title={
              isSaving 
                ? savingText
                : newBoundaries.length === 0 && !hasDirtyDrafts
                ? (t('gps.noBoundariesToSave') || 'No Changes to Save')
                : `${saveText} (${newBoundaries.length + dirtyBoundaryCount})`
            }
          >
            <Save className="w-4 h-4" />
            <div className={`
              absolute left-full ml-3 px-2 py-1 rounded text-xs font-medium
              opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap
              ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-gray-900 text-white'}
            `}>
              {isSaving 
                ? savingText
                : newBoundaries.length === 0 && !hasDirtyDrafts
                ? (t('gps.noBoundariesToSave') || 'No Changes to Save')
                : `${saveText} (${newBoundaries.length + dirtyBoundaryCount})`
              }
            </div>
          </button>

          {/* Clear All Button */}
          <button
            onClick={async () => {
              if (newBoundaries.length === 0) return;
              const confirmed = await showConfirmation(
                t('gps.confirmations.clearAllBoundariesTitle') || 'Clear All Boundaries?',
                t('gps.confirmations.clearAllBoundariesMessage') || 'Are you sure you want to clear all new boundaries?',
                {
                  confirmText: t('gps.confirmations.confirm') || 'Confirm',
                  cancelText: t('gps.confirmations.cancel') || 'Cancel',
                  type: 'warning'
                }
              );
              if (confirmed) {
                setNewBoundaries([]);
                setDrawingMode('none');
              }
            }}
            disabled={newBoundaries.length === 0}
            className={`
              w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200 group relative
              ${newBoundaries.length === 0
                ? isDarkMode
                  ? 'bg-gray-800/40 text-gray-600 cursor-not-allowed'
                  : 'bg-gray-100/40 text-gray-400 cursor-not-allowed'
                : isDarkMode
                  ? 'bg-red-600/20 hover:bg-red-600/30 text-red-400 hover:text-red-300'
                  : 'bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700'}
            `}
            title={t('gps.clearAll') || 'Clear All'}
          >
            <Trash2 className="w-4 h-4" />
            <div className={`
              absolute left-full ml-3 px-2 py-1 rounded text-xs font-medium
              opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap
              ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-gray-900 text-white'}
           `}>
              {t('gps.clearAll') || 'Clear All'}
            </div>
          </button>

          {/* Save indicator */}
          {(newBoundaries.length > 0 || hasDirtyDrafts) && (
            <div className={`
              text-center text-xs font-medium px-1 py-0.5 rounded
              ${isDarkMode ? 'bg-green-600/20 text-green-400' : 'bg-green-50 text-green-600'}
            `}>
              {newBoundaries.length + dirtyBoundaryCount}
            </div>
          )}
        </div>
      </div>

    </div>
  );
};

export default FieldBoundaryEditor;

