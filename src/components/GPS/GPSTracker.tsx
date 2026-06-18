import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { Capacitor } from '@capacitor/core';
import area from '@turf/area';
import { useDarkMode } from '../../hooks/useDarkMode';
import { useLanguage } from '../../hooks/useLanguage';
import toast from 'react-hot-toast';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { MapPin, Trash2, Upload, ChevronDown, ChevronRight, Satellite, User, LogOut, Camera, Moon, Sun, Globe, Loader2, ArrowRight, X, Hand, RefreshCw, Search, Check, Tag } from 'lucide-react';
import { db } from '../../firebase';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { AnimatedLoader } from '../ui/AnimatedLoader';
import MapView from './MapView';
import SamplingBadge from './SamplingBadge';
import { logger } from '../../utils/logger';
import { getNetworkStatus, addNetworkListener } from '../../utils/networkStatus';
import { GpsProject, GpsTrack, GpsTrackDetail, GpsPosition, GpsFieldBoundary, GpsDevice, GpsFieldSample } from '../../types';
import { hybridDB } from '../../services/hybridDatabase';
import { useBluetoothGPS } from '../../hooks/useBluetoothGPS';
import { useTcpGPS } from '../../hooks/useTcpGPS';
import { useSerialGPS } from '../../hooks/useSerialGPS';
import { useTracks } from '../../hooks/useTracks';
import { useFieldSamples } from '../../hooks/useFieldSamples';
import { useBoundaries } from '../../hooks/useBoundaries';
import { useAuth } from '../../context/AuthContext';
import { useConfirmation } from '../ui/ConfirmationProvider';
import { isCapacitor } from '../../utils/geolocation';
import { useHybridPosition, type GpsSourcePreference, type GpsSourcePolicy } from '../../hooks/useHybridPosition';
import { canTrackGPS, isCompactLandscapeScreen } from '../../utils/deviceDetection';
import {
  buildBoundarySamplingProperties,
  deriveBoundarySamplingStatus,
  getBoundarySamplingState,
  isBoundarySamplingLocked,
} from '../../utils/fieldSamplingState';
import {
  buildBoundaryBarcodeProperties,
  getBoundaryBarcodeList,
  normalizeBarcode,
  normalizeBarcodeList,
} from '../../utils/orderBarcodes';

const NavigationPanel = lazy(() => import('./NavigationPanel'));
const UnifiedDeviceManager = lazy(() => import('./UnifiedDeviceManager'));

const HARDWARE_SAMPLE_TRIGGER_KEYS = new Set(['F13', 'K', 'D']);

const HARDWARE_SAMPLE_TRIGGER_CODES = new Set(['F13', 'KEYK', 'KEYD']);

const HARDWARE_SAMPLE_TRIGGER_KEY_CODES = new Set([124, 75, 68]);

const HARDWARE_SAMPLE_DEBOUNCE_MS = 450;

export default function GPSTracker() {
  // Hooks and refs
  const [isDark, toggleDarkMode] = useDarkMode();
  const { t, language, changeLanguage } = useLanguage();
  const { showConfirmation } = useConfirmation();
  const lastSavedPosition = useRef<GpsPosition | null>(null);
  const lastPointSavedAtRef = useRef(0);
  const fieldListContainerRef = useRef<HTMLDivElement | null>(null);
  const unassignedTracksContainerRef = useRef<HTMLDivElement | null>(null);
  const loadProjectsAbortController = useRef<AbortController | null>(null);
  const { user, logout } = useAuth();

  const [userRole, setUserRole] = useState<'client' | 'admin'>('client');
  const isAdmin = userRole === 'admin';
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [userOptions, setUserOptions] = useState<{ id: string; name: string; email: string }[]>([]);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [isRefreshingGps, setIsRefreshingGps] = useState(false);
  
  // Helper to extract field identifier by removing project name prefix (e.g., "Miercuri - 508067, 20" -> "508067, 20")
  const getFieldNumber = useCallback((fieldName: string): string => {
    // Remove project name prefix (everything before " - ")
    const dashIndex = fieldName.indexOf(' - ');
    return dashIndex !== -1 ? fieldName.substring(dashIndex + 3) : fieldName;
  }, []);

  // Memoized helper to calculate distance between two points (Haversine formula)
  const calculateDistance = useCallback((lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }, []);

  // External GPS state
  const [connectedDevice, setConnectedDevice] = useState<GpsDevice | null>(null);
  const [externalGpsPosition, setExternalGpsPosition] = useState<GpsPosition | null>(null);
  const [isExternalGpsConnected, setIsExternalGpsConnected] = useState(false);
  const [lastTelemetryAt, setLastTelemetryAt] = useState<number | null>(null);
  const [gpsSourcePreference, setGpsSourcePreference] = useState<GpsSourcePreference>(() => {
    const saved = localStorage.getItem('gpsSourcePreference');
    return saved === 'external' ? 'external' : 'internal';
  });
  const [gpsSourcePolicy, setGpsSourcePolicy] = useState<GpsSourcePolicy>(() => {
    const saved = localStorage.getItem('gpsSourcePolicy');
    return saved === 'strict' ? 'strict' : 'preferred';
  });
  const [mockLocationActive, setMockLocationActive] = useState(false);
  const [mockLocationProvider, setMockLocationProvider] = useState('');

  // Network state
  const [isNetworkOnline, setIsNetworkOnline] = useState(true);
  const [_connectionType, setConnectionType] = useState<string>('unknown');

  // Project and UI state
  const [projects, setProjects] = useState<GpsProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<GpsProject | null>(null);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [_isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isStartingTracking, setIsStartingTracking] = useState(false);
  const [isAddingSample, setIsAddingSample] = useState(false);
  
  // UI dropdown and modal states
  const [showAvatarDropdown, setShowAvatarDropdown] = useState(false);
  const [showAvatarSubmenu, setShowAvatarSubmenu] = useState(false);
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const [showLanguageDropdownExpanded, setShowLanguageDropdownExpanded] = useState(false);
  const [showGpsSourceMenu, setShowGpsSourceMenu] = useState(false);
  const [showGpsAdvancedControls, setShowGpsAdvancedControls] = useState(false);
  const [showNavigationPanel, setShowNavigationPanel] = useState(false);
  const [showDeviceManager, setShowDeviceManager] = useState(false);
  const [showDevicePopup, setShowDevicePopup] = useState(false);
  const [showManualSampleModal, setShowManualSampleModal] = useState(false);
  const [showBagCodesModal, setShowBagCodesModal] = useState(false);
  const [showOutsideFieldConfirm, setShowOutsideFieldConfirm] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState<number | null>(null);
  const [showTrackAssignDropdown, setShowTrackAssignDropdown] = useState<number | null>(null);
  const [_dropdownPosition, setDropdownPosition] = useState<{top: number; left: number} | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'fields' | 'projects'>('fields');
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [showFieldScrollIndicator, setShowFieldScrollIndicator] = useState(false);
  const [showUnassignedScrollIndicator, setShowUnassignedScrollIndicator] = useState(false);
  const [selectedBagCodeBoundaryId, setSelectedBagCodeBoundaryId] = useState<number | string | null>(null);
  const [bagCodeInput, setBagCodeInput] = useState('');
  const [editingBagCodeIndex, setEditingBagCodeIndex] = useState<number | null>(null);
  const lastHardwareSampleTriggerAtRef = useRef(0);
  const bagCodeInputRef = useRef<HTMLInputElement | null>(null);

  const manualSamplesTrackPrefix = t('gps.manualSamplesTrackPrefix') || t('gps.manualSamples') || 'Manual Samples';
  const isManualSamplesTrackName = useCallback((trackName?: string) => {
    if (!trackName) return false;
    const normalizedName = trackName.toLowerCase();
    const normalizedPrefix = manualSamplesTrackPrefix.toLowerCase();
    return normalizedName.includes('manual samples') || (normalizedPrefix.length > 0 && normalizedName.includes(normalizedPrefix));
  }, [manualSamplesTrackPrefix]);

  const toggleNavigationPanel = useCallback(() => {
    setShowNavigationPanel(prev => !prev);
  }, []);

  const [isCompactLandscapeLayout, setIsCompactLandscapeLayout] = useState(() => isCompactLandscapeScreen());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateCompactLandscapeLayout = () => {
      setIsCompactLandscapeLayout(isCompactLandscapeScreen());
    };

    updateCompactLandscapeLayout();
    window.addEventListener('resize', updateCompactLandscapeLayout);
    window.addEventListener('orientationchange', updateCompactLandscapeLayout);

    return () => {
      window.removeEventListener('resize', updateCompactLandscapeLayout);
      window.removeEventListener('orientationchange', updateCompactLandscapeLayout);
    };
  }, []);

  useEffect(() => {
    if (!showGpsSourceMenu) {
      setShowGpsAdvancedControls(false);
    }
  }, [showGpsSourceMenu]);

  const handleSidebarHeaderClick = useCallback((event: { target: EventTarget | null }) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, select, textarea, label, [data-sidebar-no-collapse="true"]')) {
      return;
    }

    setIsSidebarCollapsed(true);
  }, []);
  
  // Project and field input states
  const [selectedFieldForManualSample, setSelectedFieldForManualSample] = useState<GpsFieldBoundary | null>(null);
  const [manualSampleCount, setManualSampleCount] = useState(1);
  const [userAvatar, setUserAvatar] = useState(localStorage.getItem('userAvatar') || '👤');
  const isImageAvatar = Boolean(
    userAvatar && (userAvatar.startsWith('data:') || userAvatar.startsWith('http') || userAvatar.startsWith('blob:'))
  );

  const isNativeApp = isCapacitor();
  const canTrack = canTrackGPS(isNativeApp);

  const normalizePositionTimestamp = useCallback((rawTimestamp: unknown): number => {
    const fallback = Date.now();
    const numeric = typeof rawTimestamp === 'number'
      ? rawTimestamp
      : Number(rawTimestamp);

    if (!Number.isFinite(numeric) || numeric <= 0) {
      return fallback;
    }

    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }, []);

  const toExternalGpsPosition = useCallback((input: any): GpsPosition | null => {
    if (!input) {
      return null;
    }

    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    const hdop = Number(input.hdop);
    const rawAccuracy = Number(input.accuracy);
    const derivedAccuracy = Number.isFinite(hdop) && hdop > 0
      ? Math.max(0.3, hdop * 2.5)
      : NaN;
    const normalizedAccuracy = Number.isFinite(rawAccuracy) && rawAccuracy > 0
      ? rawAccuracy
      : (Number.isFinite(derivedAccuracy) ? derivedAccuracy : 5);

    return {
      ...input,
      latitude,
      longitude,
      accuracy: normalizedAccuracy,
      timestamp: normalizePositionTimestamp(input.timestamp),
    } as GpsPosition;
  }, [normalizePositionTimestamp]);

  const updateGpsSourcePreference = useCallback((preference: GpsSourcePreference) => {
    setGpsSourcePreference(preference);
    localStorage.setItem('gpsSourcePreference', preference);
  }, []);

  const updateGpsSourcePolicy = useCallback((policy: GpsSourcePolicy) => {
    setGpsSourcePolicy(policy);
    localStorage.setItem('gpsSourcePolicy', policy);
  }, []);

  const preferExternalGpsSource = useCallback(() => {
  }, []);

  // Bluetooth GPS integration
  const bluetoothGPS = useBluetoothGPS({
    onPosition: (btPosition) => {
      const nextPosition = toExternalGpsPosition(btPosition);
      if (!nextPosition) {
        return;
      }

      setExternalGpsPosition(nextPosition);
      setLastTelemetryAt(nextPosition.timestamp);
      setIsExternalGpsConnected(true);
      preferExternalGpsSource();
    },
    onConnect: () => {
      if (!isExternalGpsConnected) { // Prevent duplicate notifications
        setIsExternalGpsConnected(true);
        preferExternalGpsSource();
        toast.success(t('gps.bluetoothGpsConnected') || 'Bluetooth GPS validated - receiving data', {
          duration: 4000,
          icon: '📱',
          id: 'bluetooth-gps-connected'
        });
      }
    },
    onDisconnect: () => {
      setIsExternalGpsConnected(false);
      
      // Clear device connection state when disconnected
      if (connectedDevice?.connection_type === 'bluetooth') {
        setConnectedDevice(null);
        setExternalGpsPosition(null);
        setLastTelemetryAt(null);
      }
      
      toast(t('gps.bluetoothGpsDisconnected') || 'Bluetooth GPS disconnected', {
        icon: '📱',
        duration: 3000,
        id: 'bluetooth-gps-disconnected'
      });
    },
    onError: (error) => {
      logger.error('Bluetooth GPS error', error, { component: 'BluetoothGPS' });
      setIsExternalGpsConnected(false);
      
      // Clear device connection state on critical errors
      const isCriticalError = error.includes('Failed to connect') || 
                             error.includes('connection lost') || 
                             error.includes('disconnected') ||
                             error.includes('timeout');
      
      if (isCriticalError) {
        setConnectedDevice(null);
        setExternalGpsPosition(null);
        setLastTelemetryAt(null);
      }
      
      // Show user-friendly error messages with reduced frequency
      if (error.includes('not supported')) {
        toast.error(t('gps.bluetoothNotCompatible') || 'Bluetooth device not compatible. Try WiFi connection instead.', { 
          duration: 5000,
          id: 'bluetooth-not-supported' // Prevent duplicate toasts
        });
      } else if (error.includes('not found')) {
        toast.error(t('gps.gpsDeviceNotFound') || 'GPS device not found. Make sure it\'s powered on and in range.', { 
          duration: 4000,
          id: 'device-not-found'
        });
      } else if (error.includes('No GPS data')) {
        toast.error(t('gps.connectedButNoData') || 'Connected but no GPS data received. Check device NMEA output settings.', { 
          duration: 5000,
          id: 'no-gps-data'
        });
      } else if (isCriticalError) {
        toast.error(`${t('common.gpsConnectionLostError')}: ${error}`, { 
          duration: 4000,
          id: 'gps-connection-error'
        });
      }
    }
  });

  // TCP/WiFi GPS integration (Reach RS3 over WiFi)
  const tcpGPS = useTcpGPS({
    onPosition: (tcpPosition) => {
      // Only log GPS positions occasionally to avoid console spam
      logger.once('tcp-gps-active', 'info', 'TCP GPS Position updates active');
      const nextPosition = toExternalGpsPosition(tcpPosition);
      if (!nextPosition) {
        return;
      }

      setExternalGpsPosition(nextPosition);
      setLastTelemetryAt(nextPosition.timestamp);
      setIsExternalGpsConnected(true);
      preferExternalGpsSource();
    },
    onConnect: () => {
      if (!isExternalGpsConnected) { // Prevent duplicate notifications
        setIsExternalGpsConnected(true);
        preferExternalGpsSource();
        logger.debug('TCP GPS validated successfully', { component: 'TCPGPS', device: 'TCP GPS', type: 'wifi' });
        toast.success(t('common.tcpGpsValidated'), {
          duration: 4000,
          icon: '📡',
          id: 'tcp-gps-connected'
        });
      }
    },
    onDisconnect: () => {
      setIsExternalGpsConnected(false);
      logger.debug('TCP GPS disconnected', { component: 'TCPGPS', device: 'TCP GPS', type: 'wifi' });
      
      // Clear device connection state when disconnected
      if (connectedDevice?.connection_type === 'wifi' || connectedDevice?.connection_type === 'tcp') {
        setConnectedDevice(null);
        setExternalGpsPosition(null);
        setLastTelemetryAt(null);
      }
      
      toast(t('gps.gpsDeviceDisconnected') || 'GPS device disconnected', {
        icon: '📡',
        duration: 3000,
        id: 'tcp-gps-disconnected'
      });
    },
    onError: (error) => {
      // Always handle errors properly and update connection status
      setIsExternalGpsConnected(false);
      logger.error('TCP GPS error', error, { component: 'TCPGPS' });
      
      // Clear connected device if this error indicates connection failure
      const isConnectionFailure = error.includes('Cannot connect') || 
                                 error.includes('timeout') || 
                                 error.includes('disconnected') ||
                                 error.includes('refused');
      
      if (isConnectionFailure) {
        setConnectedDevice(null);
        setExternalGpsPosition(null);
        setLastTelemetryAt(null);
      }
      
      // Show user-friendly error messages with throttling
      if (!error.includes('WebSocket unavailable') && !error.includes('trying HTTP polling')) {
        if (isConnectionFailure) {
          toast.error(`${t('common.gpsConnectionError')}: ${error}`, {
            duration: 5000,
            id: 'tcp-connection-error' // Prevent spam
          });
        }
      } else {
        logger.debug('WebSocket unavailable, trying HTTP polling fallback', { component: 'TCPGPS' });
      }
    }
  });

  // USB Serial GPS integration
  const serialGPS = useSerialGPS({
    onPosition: (usbPosition) => {
      logger.once('usb-gps-active', 'info', 'USB Serial GPS Position updates active');
      const nextPosition = toExternalGpsPosition(usbPosition);
      if (!nextPosition) {
        return;
      }

      setExternalGpsPosition(nextPosition);
      setLastTelemetryAt(nextPosition.timestamp);
      setIsExternalGpsConnected(true);
      preferExternalGpsSource();
    },
    onConnect: () => {
      if (!isExternalGpsConnected) {
        setIsExternalGpsConnected(true);
        preferExternalGpsSource();
        usbGpsWasConnected.current = true;
        logger.debug('USB Serial GPS connected successfully', { component: 'SerialGPS', device: 'USB Serial GPS', type: 'usb' });
        toast.success(t('common.usbGpsConnected'), {
          duration: 4000,
          icon: '🔌'
        });
      }
    },
    onDisconnect: () => {
      // Only show disconnect toast if we were actually connected before
      if (usbGpsWasConnected.current) {
        setIsExternalGpsConnected(false);
        logger.debug('USB Serial GPS disconnected', { component: 'SerialGPS', device: 'USB Serial GPS', type: 'usb' });
        
        if (connectedDevice?.connection_type === 'usb') {
          setConnectedDevice(null);
          setExternalGpsPosition(null);
          setLastTelemetryAt(null);
        }
        
        toast(t('gps.gpsDeviceDisconnected') || 'GPS device disconnected', {
          icon: '🔌',
          duration: 3000,
          id: 'usb-gps-disconnect' // Prevent duplicates
        });
        
        usbGpsWasConnected.current = false;
      }
    },
    onError: (error) => {
      setIsExternalGpsConnected(false);
      logger.error('USB Serial GPS error', error, { component: 'SerialGPS' });
      
      if (connectedDevice?.connection_type === 'usb') {
        setConnectedDevice(null);
        setExternalGpsPosition(null);
        setLastTelemetryAt(null);
      }
      
      toast.error(`${t('common.usbGpsError')}: ${error.message}`, {
        duration: 5000,
        id: 'usb-gps-error'
      });
    }
  });

  // Enhanced connection monitoring with recovery
  useEffect(() => {
    if (!connectedDevice) {
      setIsExternalGpsConnected(false);
      return;
    }

    const checkStaleness = () => {
      if (!lastTelemetryAt) {
        setIsExternalGpsConnected(false);
        return;
      }

      const ageMs = Date.now() - lastTelemetryAt;

      if (ageMs <= 15000) {
        setIsExternalGpsConnected(true);
        return;
      }

      setIsExternalGpsConnected(false);

      logger.warn('GPS connection stale', {
        component: 'ConnectionMonitor',
        ageMs,
        deviceName: connectedDevice.name
      });

      if (ageMs > 45000) {
        setConnectedDevice(null);
        setExternalGpsPosition(null);
        setLastTelemetryAt(null);

        toast(t('gps.gpsConnectionLost') || 'GPS connection lost - device may have disconnected', {
          icon: '📶',
          duration: 3000,
          id: 'gps-connection-lost'
        });
      }
    };

    checkStaleness();
    const timer = window.setInterval(checkStaleness, 2000);
    return () => window.clearInterval(timer);
  }, [connectedDevice, lastTelemetryAt, t]);

  // React instantly to network changes (including cellular data) so the device status badge reflects reality
  useEffect(() => {
    // Initial network status check
    getNetworkStatus().then(status => {
      setIsNetworkOnline(status.connected);
      setConnectionType(status.connectionType);
    });

    // Listen for network changes with cellular support
    const cleanup = addNetworkListener((status) => {
      setIsNetworkOnline(status.connected);
      setConnectionType(status.connectionType);

      if (!status.connected) {
        // If we were on a WiFi/TCP device, mark it disconnected immediately so the UI updates
        const wifiBased = connectedDevice?.connection_type === 'wifi' || connectedDevice?.connection_type === 'tcp' || tcpGPS.isConnected;
        if (wifiBased) {
          setIsExternalGpsConnected(false);
          setExternalGpsPosition(null);
          setLastTelemetryAt(null);
        }
      }

      // Log connection type for debugging
      if (status.connectionType === 'cellular') {
        console.log('📱 [GPSTracker] Using cellular data');
      } else if (status.connectionType === 'wifi') {
        console.log('📶 [GPSTracker] Using WiFi');
      }
    });

    return cleanup;
  }, [connectedDevice, tcpGPS.isConnected]);

  const {
    position,
    error: gpsError,
    isTracking,
    startTracking,
    stopTracking,
    refreshPosition,
    isMockLocation,
    positionSource,
    isExternalFallback,
    externalDataAgeMs,
  } = useHybridPosition(
    externalGpsPosition, 
    gpsSourcePreference,
    gpsSourcePolicy
  );

  // Tracks and boundaries hooks
  const { tracks, setTracks, currentTrack, setCurrentTrack, sampleCount, setSampleCount, loadTracks } = useTracks();
  const { fieldSamples, loadFieldSamples } = useFieldSamples();
  const { fieldBoundaries, loadFieldBoundaries } = useBoundaries(selectedProject);
  const mapTracks = useMemo(() => [] as GpsTrackDetail[], []);
  const shouldShowGpsErrorBanner = Boolean(gpsError) && positionSource !== 'internal';
  const gpsDetailsExpanded = true;

  const filteredProjects = useMemo(() => {
    const normalizedQuery = projectSearchQuery.trim().toLowerCase();
    const matchingProjects = normalizedQuery.length === 0
      ? projects
      : projects.filter((project) => {
          const haystacks = [project.name, project.description || ''];
          return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
        });

    return [...matchingProjects].sort((left, right) => {
      if (selectedProject?.id === left.id) return -1;
      if (selectedProject?.id === right.id) return 1;
      return left.name.localeCompare(right.name);
    });
  }, [projects, projectSearchQuery, selectedProject?.id]);

  const shouldShowProjectSearch = projects.length > 5 || projectSearchQuery.trim().length > 0;

  const handleGpsRescan = useCallback(async () => {
    if (isRefreshingGps) {
      return;
    }

    setIsRefreshingGps(true);
    refreshPosition();

    const activeDevice = connectedDevice;

    try {
      if (activeDevice?.connection_type === 'wifi' || activeDevice?.connection_type === 'tcp') {
        await tcpGPS.connect(activeDevice.address, activeDevice.config?.tcp_port ?? 9001);
      } else if (activeDevice?.connection_type === 'bluetooth') {
        await bluetoothGPS.connect(activeDevice.address, activeDevice.name);
      } else if (activeDevice?.connection_type === 'usb' || activeDevice?.connection_type === 'serial') {
        await serialGPS.autoConnect();
      }

      toast.success(t('gps.refreshingGps') || 'Refreshing GPS search...', {
        duration: 2000,
        id: 'gps-refreshing'
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(`${t('gps.refreshGpsFailed') || 'GPS refresh failed'}: ${errorMessage}`, {
        duration: 4000,
        id: 'gps-refresh-failed'
      });
    } finally {
      window.setTimeout(() => setIsRefreshingGps(false), 800);
    }
  }, [isRefreshingGps, refreshPosition, connectedDevice, tcpGPS, bluetoothGPS, serialGPS, t]);

  // Expanded boundaries and focus states
  const [expandedBoundaries, setExpandedBoundaries] = useState<Set<number>>(new Set());
  const [focusedBoundary, setFocusedBoundary] = useState<number | null>(null);
  const [focusedBoundaryRequestId, setFocusedBoundaryRequestId] = useState(0);
  const [_focusedTrack, setFocusedTrack] = useState<string | number | null>(null);
  const [loading] = useState(false);
  const [recenterTrigger, setRecenterTrigger] = useState(0);

  const legacyTrackSamples = useMemo((): GpsFieldSample[] => {
    if (!selectedProject?.id) {
      return [];
    }

    return tracks.flatMap((track) => {
      if (!track || track.field_boundary_id == null) {
        return [] as GpsFieldSample[];
      }

      const boundaryId = String(track.field_boundary_id);
      const trackSamples = Array.isArray(track.samples) ? track.samples : [];

      return trackSamples
        .filter((sample) => Number.isFinite(sample?.latitude) && Number.isFinite(sample?.longitude))
        .map((sample, index) => ({
          id: `legacy_${track.id}_${sample.id ?? index}`,
          project_id: selectedProject.id,
          field_boundary_id: boundaryId,
          latitude: Number(sample.latitude),
          longitude: Number(sample.longitude),
          sample_number: sample.sample_number ?? (index + 1),
          name: sample.name,
          notes: sample.notes,
          timestamp: sample.timestamp ?? sample.created_at,
          created_at: sample.created_at,
          updated_at: sample.updated_at,
        }));
    });
  }, [tracks, selectedProject?.id]);

  const effectiveFieldSamples = useMemo((): GpsFieldSample[] => {
    const merged = new Map<string, GpsFieldSample>();

    legacyTrackSamples.forEach((sample) => {
      merged.set(String(sample.id), sample);
    });

    fieldSamples.forEach((sample) => {
      merged.set(String(sample.id), sample);
    });

    return Array.from(merged.values());
  }, [legacyTrackSamples, fieldSamples]);

  const manualTrackSampleCountByField = useMemo(() => {
    const counts = new Map<string, number>();

    tracks.forEach((track) => {
      if (!track || track.field_boundary_id == null || !isManualSamplesTrackName(track.name)) {
        return;
      }

      counts.set(String(track.field_boundary_id), track.samples?.length || 0);
    });

    return counts;
  }, [tracks, isManualSamplesTrackName]);

  const _directFieldSampleCountByField = useMemo(() => {
    const counts = new Map<string, number>();

    fieldSamples.forEach((sample) => {
      const fieldId = String(sample.field_boundary_id);
      counts.set(fieldId, (counts.get(fieldId) || 0) + 1);
    });

    return counts;
  }, [fieldSamples]);

  const effectiveFieldSampleCountByField = useMemo(() => {
    const counts = new Map<string, number>();

    effectiveFieldSamples.forEach((sample) => {
      const fieldId = String(sample.field_boundary_id);
      counts.set(fieldId, (counts.get(fieldId) || 0) + 1);
    });

    return counts;
  }, [effectiveFieldSamples]);

  const boundarySamplingStateByField = useMemo(() => {
    const states = new Map<string, { sampleCount: number; status: 'pending' | 'in_progress' | 'completed'; locked: boolean }>();

    fieldBoundaries.forEach((boundary) => {
      const fieldId = String(boundary.id);
      const sampleCount = effectiveFieldSampleCountByField.get(fieldId) || 0;
      states.set(fieldId, {
        sampleCount,
        status: deriveBoundarySamplingStatus(sampleCount, boundary),
        locked: isBoundarySamplingLocked(boundary),
      });
    });

    return states;
  }, [effectiveFieldSampleCountByField, fieldBoundaries]);

  const boundaryAreaHaByField = useMemo(() => {
    const parseNumber = (value: unknown): number | null => {
      if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
      }

      if (typeof value !== 'string') {
        return null;
      }

      const trimmed = value.trim();
      if (!trimmed) return null;

      let normalized = trimmed;
      if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(normalized)) {
        normalized = normalized.replace(/\./g, '').replace(',', '.');
      } else {
        normalized = normalized.replace(',', '.');
      }

      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const getAreaFromProperties = (properties?: Record<string, any>): number | null => {
      if (!properties) return null;

      const normalizedProperties = Object.entries(properties).reduce<Record<string, unknown>>((acc, [key, value]) => {
        acc[key.toLowerCase()] = value;
        return acc;
      }, {});

      const areaHaKeys = ['area_ha', 'ha', 'hectares', 'hectare', 'flaeche_ha', 'flache_ha', 'shape_area_ha'];
      for (const key of areaHaKeys) {
        const candidate = parseNumber(normalizedProperties[key]);
        if (candidate != null && candidate > 0) {
          return candidate;
        }
      }

      const areaM2Keys = ['area_m2', 'shape_area', 'area'];
      for (const key of areaM2Keys) {
        const candidate = parseNumber(normalizedProperties[key]);
        if (candidate != null && candidate > 0) {
          return candidate / 10000;
        }
      }

      return null;
    };

    const result = new Map<string, number>();

    fieldBoundaries.forEach((boundary) => {
      const boundaryId = String(boundary.id);
      const fromProps = getAreaFromProperties(boundary.properties);

      if (fromProps != null) {
        result.set(boundaryId, fromProps);
        return;
      }

      if (boundary.geometry_type !== 'Polygon' && boundary.geometry_type !== 'MultiPolygon') {
        return;
      }

      try {
        const rawArea = area({
          type: 'Feature',
          properties: {},
          geometry: {
            type: boundary.geometry_type,
            coordinates: boundary.coordinates as any,
          },
        });

        const areaHa = rawArea / 10000;
        if (Number.isFinite(areaHa) && areaHa > 0) {
          result.set(boundaryId, areaHa);
        }
      } catch {
        // Ignore malformed geometry and keep rendering remaining fields.
      }
    });

    return result;
  }, [fieldBoundaries]);

  const boundaryInfoBadgesByField = useMemo(() => {
    const normalizedServiceLabels: Record<string, string> = {
      basic_nutrients: t('orders.wizard.serviceBasic') || 'Basic Nutrients',
      nmin: t('orders.wizard.serviceNmin') || 'NMIN',
      nematodes: t('orders.wizard.serviceNematodes') || 'Nematodes',
    };

    const parseList = (value: unknown): string[] => {
      if (Array.isArray(value)) {
        return value
          .map((item) => String(item || '').trim())
          .filter(Boolean);
      }

      if (typeof value === 'string') {
        return value
          .split(/[;,|]/)
          .map((item) => item.trim())
          .filter(Boolean);
      }

      if (value && typeof value === 'object' && 'services' in (value as Record<string, unknown>)) {
        return parseList((value as Record<string, unknown>).services);
      }

      return [];
    };

    const isTruthy = (value: unknown): boolean => {
      if (value === true || value === 1) return true;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === 'true' || normalized === 'yes' || normalized === 'y' || normalized === '1' || normalized === 'x';
      }
      return false;
    };

    const result = new Map<string, string[]>();

    fieldBoundaries.forEach((boundary) => {
      const normalizedProperties = Object.entries(boundary.properties || {}).reduce<Record<string, unknown>>((acc, [key, value]) => {
        acc[key.toLowerCase()] = value;
        return acc;
      }, {});

      const badges: string[] = [];
      const addBadge = (value: unknown) => {
        if (value == null) return;
        const label = String(value).trim();
        if (!label) return;

        const exists = badges.some((item) => item.toLowerCase() === label.toLowerCase());
        if (!exists) {
          badges.push(label);
        }
      };

      const landUseValue = [
        normalizedProperties.landuse,
        normalizedProperties.land_use,
        normalizedProperties.land_use_type,
        normalizedProperties.landusetype,
        normalizedProperties.landnutzung,
        normalizedProperties.nutzungsart,
        normalizedProperties.lu,
      ].find((value) => (typeof value === 'string' || typeof value === 'number') && String(value).trim().length > 0);

      if (landUseValue != null) {
        const normalizedLandUse = String(landUseValue).trim();
        addBadge(normalizedLandUse.toUpperCase().startsWith('LU ') ? normalizedLandUse : `LU ${normalizedLandUse}`);
      }

      const services = [
        ...((boundary.services || []) as string[]),
        ...parseList(normalizedProperties.services || normalizedProperties.service || normalizedProperties.service_selection || normalizedProperties.selected_services),
      ];

      services.forEach((service) => {
        const normalized = String(service || '').toLowerCase().trim();
        if (!normalized) return;
        addBadge(normalizedServiceLabels[normalized] || service);
      });

      if (services.length === 0) {
        if (isTruthy(normalizedProperties.nmin)) addBadge(normalizedServiceLabels.nmin);
        if (isTruthy(normalizedProperties.nematodes)) addBadge(normalizedServiceLabels.nematodes);
        if (isTruthy(normalizedProperties.basic_nutrients) || isTruthy(normalizedProperties.basicnutrients)) {
          addBadge(normalizedServiceLabels.basic_nutrients);
        }
      }

      parseList(normalizedProperties.badges || normalizedProperties.badge || normalizedProperties.tags).forEach(addBadge);

      if (badges.length > 0) {
        result.set(String(boundary.id), badges.slice(0, 8));
      }
    });

    return result;
  }, [fieldBoundaries, t]);

  const activeFieldSampleCount = useMemo(() => {
    const activeFieldId = focusedBoundary != null ? String(focusedBoundary) : null;

    if (!activeFieldId) {
      return sampleCount;
    }

    return effectiveFieldSamples.filter((sample) => String(sample.field_boundary_id) === activeFieldId).length;
  }, [focusedBoundary, sampleCount, effectiveFieldSamples]);

  const getBagCodesForBoundary = useCallback((boundary?: GpsFieldBoundary | null) => {
    if (!boundary) return [] as string[];
    return getBoundaryBarcodeList(boundary.properties);
  }, []);

  const selectedBagCodeBoundary = useMemo(() => {
    if (selectedBagCodeBoundaryId == null) return null;
    return fieldBoundaries.find((boundary) => String(boundary.id) === String(selectedBagCodeBoundaryId)) || null;
  }, [fieldBoundaries, selectedBagCodeBoundaryId]);

  const selectedBagCodes = useMemo(() => (
    getBagCodesForBoundary(selectedBagCodeBoundary)
  ), [getBagCodesForBoundary, selectedBagCodeBoundary]);

  const closeBagCodesModal = useCallback(() => {
    setShowBagCodesModal(false);
    setSelectedBagCodeBoundaryId(null);
    setBagCodeInput('');
    setEditingBagCodeIndex(null);
  }, []);

  const openBagCodesModal = useCallback((boundary: GpsFieldBoundary) => {
    setFocusedBoundary(boundary.id as number);
    setSelectedBagCodeBoundaryId(boundary.id);
    setBagCodeInput('');
    setEditingBagCodeIndex(null);
    setShowBagCodesModal(true);
  }, []);

  useEffect(() => {
    if (!showBagCodesModal) return;

    const timeoutId = window.setTimeout(() => {
      bagCodeInputRef.current?.focus();
      bagCodeInputRef.current?.select();
    }, 40);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [editingBagCodeIndex, showBagCodesModal]);

  useEffect(() => {
    if (!showBagCodesModal) return;
    if (!selectedBagCodeBoundary) {
      closeBagCodesModal();
    }
  }, [closeBagCodesModal, selectedBagCodeBoundary, showBagCodesModal]);

  const findBagCodeConflict = useCallback((code: string, boundaryId: number | string) => {
    const normalized = normalizeBarcode(code);
    if (!normalized) return null;

    for (const boundary of fieldBoundaries) {
      if (String(boundary.id) === String(boundaryId)) continue;
      const existing = getBoundaryBarcodeList(boundary.properties);
      if (existing.includes(normalized)) {
        return getFieldNumber(boundary.name);
      }
    }

    return null;
  }, [fieldBoundaries, getFieldNumber]);

  const persistBagCodesForBoundary = useCallback(async (boundary: GpsFieldBoundary, codesInput: unknown) => {
    const nextProperties = buildBoundaryBarcodeProperties(boundary.properties, codesInput);

    await hybridDB.updateFieldBoundary(
      String(boundary.id),
      boundary.name,
      undefined,
      boundary.color,
      nextProperties,
    );

    await loadFieldBoundaries();
    setSelectedBagCodeBoundaryId(boundary.id);
  }, [loadFieldBoundaries]);

  const handleSubmitBagCode = useCallback(async () => {
    if (!selectedBagCodeBoundary) return;

    const nextCode = normalizeBarcode(bagCodeInput);
    if (!nextCode) {
      toast.error(t('gps.bagCodes.emptyInput') || 'Scan or enter a bag code first');
      return;
    }

    const duplicateField = findBagCodeConflict(nextCode, selectedBagCodeBoundary.id);
    if (duplicateField) {
      toast.error(t('gps.bagCodes.duplicateConflict', {
        code: nextCode,
        field: duplicateField,
      }) || `${nextCode} is already assigned to ${duplicateField}`);
      return;
    }

    const nextCodes = editingBagCodeIndex == null
      ? normalizeBarcodeList([...selectedBagCodes, nextCode])
      : normalizeBarcodeList(selectedBagCodes.map((code, index) => (index === editingBagCodeIndex ? nextCode : code)));

    try {
      await persistBagCodesForBoundary(selectedBagCodeBoundary, nextCodes);
      setBagCodeInput('');
      setEditingBagCodeIndex(null);
      toast.success(t(
        editingBagCodeIndex == null ? 'gps.bagCodes.addedSuccess' : 'gps.bagCodes.replacedSuccess',
        {
          code: nextCode,
          field: getFieldNumber(selectedBagCodeBoundary.name),
        },
      ) || `${nextCode} saved`);
    } catch (error) {
      logger.error('Failed to save bag codes', error, {
        component: 'GPSTracker',
        fieldBoundaryId: selectedBagCodeBoundary.id,
      });
      toast.error(t('gps.bagCodes.saveFailed') || 'Failed to save bag codes');
    }
  }, [bagCodeInput, editingBagCodeIndex, findBagCodeConflict, getFieldNumber, persistBagCodesForBoundary, selectedBagCodeBoundary, selectedBagCodes, t]);

  const handleDeleteBagCode = useCallback(async (index: number) => {
    if (!selectedBagCodeBoundary) return;

    const removedCode = selectedBagCodes[index];
    const nextCodes = selectedBagCodes.filter((_, entryIndex) => entryIndex !== index);

    try {
      await persistBagCodesForBoundary(selectedBagCodeBoundary, nextCodes);
      if (editingBagCodeIndex === index) {
        setEditingBagCodeIndex(null);
        setBagCodeInput('');
      }
      toast.success(t('gps.bagCodes.deletedSuccess', {
        code: removedCode,
        field: getFieldNumber(selectedBagCodeBoundary.name),
      }) || `${removedCode} removed`);
    } catch (error) {
      logger.error('Failed to delete bag code', error, {
        component: 'GPSTracker',
        fieldBoundaryId: selectedBagCodeBoundary.id,
      });
      toast.error(t('gps.bagCodes.saveFailed') || 'Failed to save bag codes');
    }
  }, [editingBagCodeIndex, getFieldNumber, persistBagCodesForBoundary, selectedBagCodeBoundary, selectedBagCodes, t]);

  const handleEditBagCode = useCallback((index: number) => {
    setEditingBagCodeIndex(index);
    setBagCodeInput(selectedBagCodes[index] || '');
  }, [selectedBagCodes]);

  // USB GPS connection tracking ref
  const usbGpsWasConnected = useRef(false);

  // Cache keys for localStorage
  const _cacheKeys = useMemo(() => ({
    projects: `gps_projects_${user?.uid || 'guest'}`,
    selectedProject: `gps_selected_project_${user?.uid || 'guest'}`
  }), [user?.uid]);

  // Monitor mock location status and show notifications
  useEffect(() => {
    if (!isTracking || !position) return;
    
    const checkMockLocation = () => {
      try {
        const isMock = (position as any)?.mocked === true;
        
        if (isMock !== mockLocationActive) {
          setMockLocationActive(isMock);
          
          if (isMock) {
            console.log('🛰️ ========== MOCK LOCATION DETECTED! ==========');
            console.log('🛰️ External GNSS is now active');
            console.log('🛰️ Accuracy:', position.accuracy, 'm');
            console.log('🛰️ ===========================================');
            setMockLocationProvider('Bluetooth GNSS');
          } else if (mockLocationActive && !isMock) {
            console.log('📍 Switched back to internal GPS');
            setMockLocationProvider('');
          }
        }
      } catch (error) {
        console.log('Mock location check failed:', error);
      }
    };
    
    checkMockLocation();
    const interval = setInterval(checkMockLocation, 3000);
    
    return () => clearInterval(interval);
  }, [isTracking, position, mockLocationActive]);

  const externalTelemetrySummary = useMemo(() => {
    if (!externalGpsPosition) {
      return '';
    }

    const telem: any = externalGpsPosition;
    const parts: string[] = [];

    if (telem?.satellites !== undefined && telem?.satellites !== null) {
      parts.push(`${telem.satellites} sats`);
    }

    const fixRaw = telem?.fix_type || telem?.fixType;
    if (fixRaw) {
      const fix = String(fixRaw).toLowerCase();
      const fixLabel = fix === 'fix'
        ? 'RTK FIX'
        : fix === 'float'
          ? 'RTK FLOAT'
          : fix === 'single'
            ? 'GPS'
            : String(fixRaw).toUpperCase();
      parts.push(fixLabel);
    }

    if (telem?.hdop !== undefined && telem?.hdop !== null && !Number.isNaN(Number(telem.hdop))) {
      parts.push(`HDOP ${Number(telem.hdop).toFixed(1)}`);
    }

    if (telem?.accuracy !== undefined && telem?.accuracy !== null && !Number.isNaN(Number(telem.accuracy))) {
      parts.push(`±${Number(telem.accuracy).toFixed(1)} m`);
    }

    return parts.join(' • ');
  }, [externalGpsPosition]);

  const externalSourceMenuMeta = useMemo(() => {
    if (!connectedDevice) {
      return t('gps.notConnected') || 'Not connected';
    }

    const deviceLabel = externalGpsPosition
      ? connectedDevice.name
      : `${connectedDevice.name} (${t('gps.waitingForData') || 'waiting for data...'})`;

    return [deviceLabel, externalGpsPosition ? externalTelemetrySummary : '']
      .filter(Boolean)
      .join(' • ');
  }, [connectedDevice, externalGpsPosition, externalTelemetrySummary, t]);

  const gpsSourceState = useMemo(() => {
    const wifiBased = connectedDevice?.connection_type === 'wifi' || connectedDevice?.connection_type === 'tcp' || tcpGPS.isConnected;
    const externalAgeSeconds = externalDataAgeMs !== null
      ? Math.max(0, Math.floor(externalDataAgeMs / 1000))
      : null;

    // Network lost for WiFi/TCP devices
    if (wifiBased && !isNetworkOnline) {
      return {
        style: 'bg-red-50/90 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200/50 dark:border-red-700/50',
        emoji: '📶',
        label: t('gps.networkLost') || 'Network lost',
        subtitle: connectedDevice?.name || t('gps.reconnectNetwork') || 'Reconnect to keep GPS data streaming'
      };
    }

    if (gpsSourcePreference === 'external') {
      if (positionSource === 'external' && externalGpsPosition) {
        return {
          style: 'bg-green-50/90 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200/50 dark:border-green-700/50',
          emoji: '🛰️',
          label: t('gps.externalGps') || 'External GPS',
          subtitle: [connectedDevice?.name, externalTelemetrySummary].filter(Boolean).join(' • ')
        };
      }

      if (gpsSourcePolicy === 'strict') {
        return {
          style: 'bg-red-50/90 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200/50 dark:border-red-700/50',
          emoji: '🚫',
          label: t('gps.externalGpsStrictLabel') || 'External GPS (strict)',
          subtitle: connectedDevice
            ? [
                connectedDevice.name,
                t('gps.externalNoFallback') || 'Waiting for external data only',
                externalAgeSeconds !== null ? `${externalAgeSeconds}s` : ''
              ].filter(Boolean).join(' • ')
            : (t('gps.externalStrictNotConnected') || 'Connect an external GPS to continue')
        };
      }

      if (connectedDevice && isExternalFallback) {
        return {
          style: 'bg-yellow-50/90 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border-yellow-200/50 dark:border-yellow-700/50',
          emoji: '↩️',
          label: t('gps.externalGpsFallbackLabel') || 'External GPS (fallback)',
          subtitle: [
            connectedDevice.name,
            t('gps.usingInternal') || 'Using internal GPS temporarily',
            externalAgeSeconds !== null ? `${externalAgeSeconds}s` : ''
          ].filter(Boolean).join(' • ')
        };
      }

      if (connectedDevice) {
        return {
          style: 'bg-yellow-50/90 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border-yellow-200/50 dark:border-yellow-700/50',
          emoji: '⏳',
          label: `${t('gps.externalGps') || 'External GPS'} (${t('gps.waitingForData') || 'waiting'})`,
          subtitle: connectedDevice.name
        };
      }

      return {
        style: 'bg-orange-50/90 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-200/50 dark:border-orange-700/50',
        emoji: '⚠️',
        label: t('gps.externalGps') || 'External GPS',
        subtitle: gpsSourcePolicy === 'preferred'
          ? `${t('gps.notConnected') || 'Not connected'} - ${t('gps.usingInternal') || 'using internal'}`
          : (t('gps.externalStrictNotConnected') || 'Connect an external GPS to continue')
      };
    }

    if (isMockLocation && positionSource === 'external') {
      return {
        style: 'bg-green-50/90 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200/50 dark:border-green-700/50',
        emoji: '🛰️',
        label: t('gps.externalGps') || 'External GPS',
        subtitle: 'Mock Location (Bluetooth GNSS)'
      };
    }

    return {
      style: 'bg-blue-50/90 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200/50 dark:border-blue-700/50',
      emoji: '📱',
      label: t('gps.internalGps') || 'Internal GPS',
      subtitle: connectedDevice ? `${connectedDevice.name} ${t('gps.available') || 'available'}` : ''
    };
  }, [
    connectedDevice,
    externalDataAgeMs,
    externalGpsPosition,
    externalTelemetrySummary,
    gpsSourcePolicy,
    gpsSourcePreference,
    isExternalFallback,
    isMockLocation,
    isNetworkOnline,
    positionSource,
    t,
    tcpGPS.isConnected,
  ]);

  // Load data once per user session and avoid duplicate project loads
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    // Always reset local state when the user identity changes to prevent bleed-over
    setProjects([]);
    setSelectedProject(null);

    // Abort any in-flight load when switching users or logging out
    if (loadProjectsAbortController.current) {
      loadProjectsAbortController.current.abort();
      loadProjectsAbortController.current = null;
    }

    if (!user?.uid) {
      return;
    }

    // Small delay smooths out rapid auth state changes without double-loading
    const timer = setTimeout(() => {
      loadProjects();
    }, 120);

    return () => clearTimeout(timer);
  }, [user?.uid]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Load tracks when project changes
  useEffect(() => {
    void loadTracks(selectedProject?.id ?? null);
    void loadFieldSamples(selectedProject?.id ?? null);
  }, [selectedProject, loadTracks, loadFieldSamples]);

  // Listen for sync-complete to refresh data after coming back online
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const handleSyncComplete = (event: CustomEvent) => {
      if (event.detail?.syncedItems > 0) {
        loadProjects().then(() => {
          if (selectedProject?.id) {
            void loadTracks(selectedProject.id);
            void loadFieldSamples(selectedProject.id);
            void loadFieldBoundaries();
          }
        }).catch(err => {
          console.error('❌ [GPSTracker] Error reloading after sync:', err);
        });
      }
    };

    window.addEventListener('hybriddb-sync-complete', handleSyncComplete as EventListener);
    return () => {
      window.removeEventListener('hybriddb-sync-complete', handleSyncComplete as EventListener);
    };
  }, [selectedProject, loadFieldBoundaries, loadTracks, loadFieldSamples]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Initialize scroll indicator when field boundaries change
  useEffect(() => {
    if (fieldBoundaries.length > 0) {
      // Small delay to ensure DOM is updated
      const timer = setTimeout(() => {
        try {
          const fieldsContainer = document.querySelector('.scrollbar-modern.pr-1') as HTMLElement;
          if (fieldsContainer && fieldsContainer.scrollHeight && fieldsContainer.clientHeight) {
            const hasMoreContent = fieldsContainer.scrollHeight > fieldsContainer.clientHeight;
            setShowFieldScrollIndicator(hasMoreContent);
          }
        } catch (error) {
          logger.warn('DOM query error (safe to ignore)', { error });
          setShowFieldScrollIndicator(false);
        }
      }, 100);
      return () => clearTimeout(timer);
    } else {
      setShowFieldScrollIndicator(false);
    }
  }, [fieldBoundaries]);

  // Initialize scroll indicator when unassigned tracks change
  useEffect(() => {
    const unassignedCount = tracks.filter(t => {
      if (!t) return false;
      const fid = t?.field_boundary_id;
      if (!fid || fid === 'null' || fid === 'undefined') return true;
      return !fieldBoundaries.some(b => String(b.id) === String(fid));
    }).length;

    if (unassignedCount > 0) {
      // Small delay to ensure DOM is updated
      const timer = setTimeout(() => {
        if (unassignedTracksContainerRef.current) {
          const container = unassignedTracksContainerRef.current;
          const hasMoreContent = container.scrollHeight > container.clientHeight;
          setShowUnassignedScrollIndicator(hasMoreContent);
        }
      }, 100);
      return () => clearTimeout(timer);
    } else {
      setShowUnassignedScrollIndicator(false);
    }
  }, [tracks, fieldBoundaries]);

  const saveGpsPoint = useCallback(async () => {
    if (!isTracking || !position || !currentTrack) {
      return;
    }

    const now = Date.now();
    if (now - lastPointSavedAtRef.current < 900) {
      return;
    }

    // Save when movement is meaningful or for the first point
    if (lastSavedPosition.current) {
      const dist = calculateDistance(
        lastSavedPosition.current.latitude,
        lastSavedPosition.current.longitude,
        position.latitude,
        position.longitude
      );
      if (dist < 2) {
        return;
      }
    }

    try {
      logger.once('gps-tracking-active', 'info', 'GPS tracking active');

      await hybridDB.addGpsPoint(
        currentTrack.id.toString(),
        position.latitude,
        position.longitude,
        position.altitude,
        position.accuracy,
        {
          source_preference: gpsSourcePreference,
          source_policy: gpsSourcePolicy,
          source_used: positionSource === 'external' ? 'external' : 'internal',
          external_fallback: isExternalFallback,
          external_data_age_ms: externalDataAgeMs ?? undefined,
        },
        {
          skipProjectCacheUpdate: true,
        }
      );

      lastPointSavedAtRef.current = now;
      lastSavedPosition.current = position;

      const newPoint = {
        id: Date.now(),
        track_id: currentTrack.id,
        latitude: position.latitude,
        longitude: position.longitude,
        altitude: position.altitude,
        accuracy: position.accuracy,
        source_preference: gpsSourcePreference,
        source_policy: gpsSourcePolicy,
        source_used: positionSource === 'external' ? 'external' : 'internal',
        external_fallback: isExternalFallback,
        external_data_age_ms: externalDataAgeMs ?? undefined,
        timestamp: new Date().toISOString()
      };

      setTracks(prev => {
        const trackExists = prev.some(t => t.id === currentTrack.id);

        if (!trackExists) {
          const trackDetail = {
            ...currentTrack,
            gps_points: [newPoint],
            samples: []
          };
          return [...prev, trackDetail];
        }

        return prev.map(t =>
          t.id === currentTrack.id
            ? { ...t, gps_points: [...(t.gps_points || []), newPoint] }
            : t
        );
      });
    } catch (error) {
      logger.error('Error saving GPS point', error, { component: 'GPSTracker' });
    }
  }, [
    calculateDistance,
    currentTrack,
    externalDataAgeMs,
    gpsSourcePolicy,
    gpsSourcePreference,
    isExternalFallback,
    isTracking,
    position,
    positionSource,
    setTracks,
  ]);

  useEffect(() => {
    void saveGpsPoint();
  }, [position?.timestamp, saveGpsPoint]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (showAvatarDropdown && !(e.target as Element).closest('.avatar-dropdown-container')) {
        setShowAvatarDropdown(false);
        setShowAvatarSubmenu(false);
        setShowLanguageDropdown(false);
        setShowLanguageDropdownExpanded(false);
      }
      if (showUserDropdown && !(e.target as Element).closest('.user-selector-dropdown')) {
        setShowUserDropdown(false);
      }
      // Close GPS source menu when clicking outside
      if (showGpsSourceMenu && !(e.target as Element).closest('.gps-source-menu-container')) {
        setShowGpsSourceMenu(false);
      }
      // Note: Track assign modal handles its own click-outside via backdrop
      // Close color picker when clicking outside
      if (showColorPicker && !(e.target as Element).closest('.color-picker-container')) {
        setShowColorPicker(null);
      }
    };
    
    // ESC key to close modals
    const handleEscKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showTrackAssignDropdown) {
          setShowTrackAssignDropdown(null);
        }
        if (showGpsSourceMenu) {
          setShowGpsSourceMenu(false);
        }
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleEscKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleEscKey);
    };
  }, [showAvatarDropdown, showTrackAssignDropdown, showColorPicker, showGpsSourceMenu, showUserDropdown]);

  const loadProjects = async (ownerIdOverride?: string | null) => {
    // Abort any existing loading operation
    if (loadProjectsAbortController.current) {
      loadProjectsAbortController.current.abort();
    }
    
    // Create new abort controller for this operation
    loadProjectsAbortController.current = new AbortController();
    const { signal } = loadProjectsAbortController.current;
    
    try {
      setIsLoadingProjects(true);
      
      // Check if operation was cancelled
      if (signal.aborted) {
        return;
      }
      
      // Loading GPS projects - logging suppressed to reduce console spam
      const isOffline = !navigator.onLine;
      setLoadingMessage(isOffline ? t('common.loadingOfflineData') || 'Loading offline data...' : t('common.connectingToFirebase') || 'Connecting to Firebase...');
      
      // Test Firebase connection first (non-blocking diagnostic) - only if online
      let _connectionTest = Promise.resolve();
      if (!isOffline) {
        _connectionTest = hybridDB.testFirebaseConnection()
          .then(result => {
            if (result.success) {
              logger.performance('Firebase connection test', result.duration, { status: 'ok' });
            } else {
              logger.warn('Firebase connection issue', { error: result.error });
            }
          })
          .catch(err => logger.warn('Connection test error', { error: err }));
      }
      
      // Trust hybridDB's timeout - don't add another one
      let projectList = [];
      try {
        // CRITICAL: Ensure hybridDB has the user ID set before calling
        const activeOwnerId = ownerIdOverride ?? selectedOwnerId;
        const targetUserId = (isAdmin && activeOwnerId) ? activeOwnerId : user?.uid;
        if (!targetUserId) {
          console.error('📋 [GPSTracker] ❌ CRITICAL: No user UID available!');
          throw new Error('No user UID - cannot load projects');
        }
        await hybridDB.setUserId(targetUserId);
        
        // Check if operation was cancelled before proceeding
        if (signal.aborted) {
          return;
        }
        
        projectList = await hybridDB.getProjects() as any[];
        
        if (projectList.length > 0) {
          console.log('📋 [GPSTracker] 📦 Project list:', projectList.map(p => ({ id: p.id, name: p.name })));
        } else {
          console.log('📋 [GPSTracker] ⚠️ No projects returned from hybridDB');
        }
        
        setLoadingMessage(t('common.projectsLoadedInitializing') || 'Projects loaded, initializing...');
      } catch (error) {
        console.error('📋 [GPSTracker] ❌ Error loading projects from hybridDB:', error);
        console.error('📋 [GPSTracker] Error details:', error instanceof Error ? error.message : String(error));
        projectList = [];
        setLoadingMessage(t('common.usingOfflineData') || 'Using offline data...');
      }
      
      // Filter out invalid projects and ensure all have required fields
      projectList = projectList.filter(p => {
        try {
          return p && (p.id || p.name) && typeof p === 'object';
        } catch (e) {
          console.warn('Invalid project object:', p);
          return false;
        }
      });
      
      if (projectList.length === 0) {
        console.log('📝 No projects found');
        
        // Check if this is truly a first-time user or if data is still syncing from Firebase
        // Only wait for sync if we're online - skip delay on offline tablets
        let recheckProjects = [];
        if (!isOffline) {
          console.log('⏳ Waiting for potential Firebase sync to complete...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Re-check projects after waiting for sync
          recheckProjects = await hybridDB.getProjects() as any[];
          console.log('🔄 After sync wait, found', recheckProjects.length, 'projects');
        } else {
          console.log('📴 Offline mode - skipping sync wait, proceeding with local data');
        }
        
        if (recheckProjects.length > 0) {
          // Check if operation was cancelled before updating state
          if (signal.aborted) {
            console.log('🚫 Project loading cancelled before state update');
            return;
          }
          
          // Projects were synced from Firebase!
          const validProjects = recheckProjects.filter(p => p && (p.id || p.name));
          setProjects(validProjects);
          const mostRecentProject = validProjects.reduce((latest: GpsProject, current: GpsProject) => {
            const latestTime = new Date(latest.updated_at || latest.created_at).getTime();
            const currentTime = new Date(current.updated_at || current.created_at).getTime();
            return currentTime > latestTime ? current : latest;
          }, validProjects[0]);
          setSelectedProject(mostRecentProject);
          // Found project after sync - logging suppressed
          return; // Exit early, don't create default project
        }
        
        // No projects found - user must create their own
        // No projects found - user will need to create their own
        setProjects([]);
        setSelectedProject(null);
      } else {
        // Projects set in state - logging suppressed to reduce console spam
        setProjects(projectList);

        // Preserve the user’s current selection whenever possible, especially during active tracking
        const currentSelectionId = selectedProject?.id;
        const currentSelection = currentSelectionId
          ? projectList.find(p => p.id === currentSelectionId)
          : null;

        const trackingActive = Boolean(currentTrack) || Boolean(isTracking);

        if (currentSelection) {
          // Keep the existing selection (prevents mid-session project switches)
          setSelectedProject(currentSelection);
        } else if (projectList.length > 0) {
          try {
            // Fallback: most recently updated/created project, but only if not actively tracking
            const mostRecentProject = projectList.reduce((latest: GpsProject, current: GpsProject) => {
              if (!latest || !current) return latest || current;
              const latestTime = new Date(latest.updated_at || latest.created_at || 0).getTime();
              const currentTime = new Date(current.updated_at || current.created_at || 0).getTime();
              return currentTime > latestTime ? current : latest;
            }, projectList[0]);

            if (trackingActive) {
              // Do not auto-switch during tracking; keep the prior selection reference
              setSelectedProject(selectedProject || mostRecentProject || null);
            } else if (mostRecentProject?.id) {
              setSelectedProject(mostRecentProject);
            } else {
              setSelectedProject(null);
              console.log('⚠️ No valid project found to select');
            }
          } catch (error) {
            console.warn('⚠️ Error selecting project:', error);
            setSelectedProject(selectedProject || null);
          }
        } else {
          setSelectedProject(null);
          console.log('📝 No projects to select from');
        }
      }
    } catch (error) {
      console.error('❌ Error loading projects:', error);
      console.error('📊 Current HybridDB Status:', hybridDB.getStatus());
      // Don't show error toast - just log it and continue with empty projects
      // This allows the app to be usable even if Firebase is unreachable
      setProjects([]);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  // Cleanup AbortController on unmount
  useEffect(() => {
    return () => {
      if (loadProjectsAbortController.current) {
        loadProjectsAbortController.current.abort();
      }
    };
  }, []);

  // Load user role once auth is ready
  useEffect(() => {
    const loadUserRole = async () => {
      if (!user?.uid) return;

      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const firestoreRole = userDoc.data().role;
          setUserRole((firestoreRole || 'client') === 'admin' ? 'admin' : 'client');
          return;
        }

        const tokenResult = await user.getIdTokenResult();
        setUserRole(tokenResult.claims.admin === true ? 'admin' : 'client');
      } catch {
        try {
          const tokenResult = await user.getIdTokenResult();
          setUserRole(tokenResult.claims.admin === true ? 'admin' : 'client');
        } catch {
          setUserRole('client');
        }
      }
    };

    void loadUserRole();
  }, [user]);

  // Load selectable users for admin owner-switching
  useEffect(() => {
    const loadUserList = async () => {
      if (!isAdmin) {
        setUserOptions([]);
        setSelectedOwnerId(null);
        return;
      }

      try {
        const profilesSnapshot = await getDocs(collection(db, 'user_profiles'));
        const users = profilesSnapshot.docs
          .map(profile => {
            const profileData = profile.data();
            const resolvedUid = String(profileData.uid || profile.id || '').trim();
            if (!resolvedUid) return null;

            return {
              id: resolvedUid,
              name: `${profileData.firstName || ''} ${profileData.lastName || ''}`.trim() || profileData.email || resolvedUid,
              email: profileData.email || ''
            };
          })
          .filter((entry): entry is { id: string; name: string; email: string } => entry !== null);

        const deduped = Array.from(new Map(users.map(entry => [entry.id, entry])).values());
        setUserOptions(deduped);

        if (!selectedOwnerId && user?.uid) {
          const selfExists = deduped.some(entry => entry.id === user.uid);
          setSelectedOwnerId(selfExists ? user.uid : (deduped[0]?.id ?? null));
        }
      } catch (error) {
        logger.warn('Admin user list load failed', { error });
      }
    };

    void loadUserList();
  }, [isAdmin, user?.uid, selectedOwnerId]);

  // Reload projects/contracts when admin switches selected owner
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!isAdmin || !selectedOwnerId) return;
    void loadProjects(selectedOwnerId);
  }, [isAdmin, selectedOwnerId]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Periodic refresh for non-native environments only.
  // Native tablet uses HybridDB background sync and sync-complete events.
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      return;
    }

    if (!selectedProject?.id) {
      return;
    }
    
    const refreshInterval = setInterval(async () => {
      try {
        const [refreshedTracks, refreshedSamples] = await Promise.all([
          loadTracks(selectedProject.id),
          loadFieldSamples(selectedProject.id),
        ]);
        if ((refreshedTracks && refreshedTracks.length > 0) || (refreshedSamples && refreshedSamples.length > 0)) {
          console.log(`[PC] Refreshed: ${refreshedTracks?.length || 0} tracks, ${refreshedSamples?.length || 0} field samples`);
        }
      } catch (error) {
        console.debug('[Periodic refresh] Error (non-critical):', error);
      }
    }, 60000);

    return () => {
      // Cleanup: stopping periodic refresh
      clearInterval(refreshInterval);
    };
  }, [selectedProject?.id, loadTracks, loadFieldSamples]);

  // Point-in-polygon algorithm (ray casting)
  const isPointInPolygon = useCallback((point: [number, number], polygon: number[][]): boolean => {
    const [lat, lng] = point;
    let inside = false;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [lng_i, lat_i] = polygon[i];
      const [lng_j, lat_j] = polygon[j];
      
      const intersect = ((lat_i > lat) !== (lat_j > lat)) &&
        (lng < (lng_j - lng_i) * (lat - lat_i) / (lat_j - lat_i) + lng_i);
      
      if (intersect) inside = !inside;
    }
    
    return inside;
  }, []);

  const resolveBoundaryForPosition = useCallback((currentPosition: GpsPosition | null) => {
    if (!currentPosition || fieldBoundaries.length === 0) return null;

    const point: [number, number] = [currentPosition.latitude, currentPosition.longitude];

    for (const boundary of fieldBoundaries) {
      if (boundary.geometry_type === 'MultiPolygon') {
        const polygons = boundary.coordinates as number[][][][];
        for (const polygon of polygons) {
          const ring = polygon?.[0];
          if (ring && ring.length > 2 && isPointInPolygon(point, ring)) {
            return boundary.id;
          }
        }
      } else {
        const rings = boundary.coordinates as number[][][];
        const ring = rings?.[0];
        if (ring && ring.length > 2 && isPointInPolygon(point, ring)) {
          return boundary.id;
        }
      }
    }

    return null;
  }, [fieldBoundaries, isPointInPolygon]);

  // Helper function to calculate manual sample positions (same as in MapView)
  const calculateManualSamplePositions = useCallback((
    boundary: GpsFieldBoundary,
    count: number
  ): [number, number][] => {
    if (count <= 0) return [];

    // Get coordinates based on geometry type
    let coords: number[][];
    if (boundary.geometry_type === 'MultiPolygon') {
      const polygons = boundary.coordinates as number[][][][];
      if (!polygons || polygons.length === 0 || !polygons[0] || polygons[0].length === 0) return [];
      coords = polygons[0][0];
    } else {
      const rings = boundary.coordinates as number[][][];
      if (!rings || rings.length === 0) return [];
      coords = rings[0];
    }
    
    if (!coords || coords.length < 3) return [];

    // Calculate centroid
    let sumLat = 0;
    let sumLng = 0;
    for (const coord of coords) {
      if (!coord || coord.length < 2) continue;
      sumLng += coord[0];
      sumLat += coord[1];
    }
    const centroid: [number, number] = [sumLat / coords.length, sumLng / coords.length];

    // Calculate bounding box
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    
    for (const coord of coords) {
      if (!coord || coord.length < 2) continue;
      minLng = Math.min(minLng, coord[0]);
      maxLng = Math.max(maxLng, coord[0]);
      minLat = Math.min(minLat, coord[1]);
      maxLat = Math.max(maxLat, coord[1]);
    }

    const fieldWidth = maxLng - minLng;
    const fieldHeight = maxLat - minLat;
    const fieldSize = Math.min(fieldWidth, fieldHeight);
    
    // Use 50% of smaller dimension to stay well within boundaries
    const availableSpace = fieldSize * 0.5;
    const dotSpacing = count > 1 ? availableSpace / (count - 1) : 0;

    const positions: [number, number][] = [];
    
    // Always use horizontal line pattern, regardless of count
    // This keeps all points in a single line within the field
    const startLng = centroid[1] - availableSpace / 2;
    for (let i = 0; i < count; i++) {
      const lng = startLng + i * dotSpacing;
      const position: [number, number] = [centroid[0], lng];
      positions.push(position);
    }

    return positions;
  }, []);

  const handleSaveManualSamples = useCallback(async () => {
    if (!selectedFieldForManualSample || !selectedProject?.id) return;

    const projectId = String(selectedProject.id);

    try {
      const latestTracks = await hybridDB.getTracks(projectId);
      const existingManualTrackIds = Array.from(new Set((Array.isArray(latestTracks) ? latestTracks : [])
        .filter(t =>
        t &&
        String(t.field_boundary_id) === String(selectedFieldForManualSample.id) &&
        isManualSamplesTrackName(t.name)
        )
        .map(t => String(t.id))
        .filter(Boolean)));

      if (manualSampleCount <= 0) {
        if (existingManualTrackIds.length > 0) {
          for (const trackId of existingManualTrackIds) {
            await hybridDB.deleteTrack(trackId);
          }
          toast.success(t('gps.manualSamplesRemoved') || 'Manual samples removed');
        }
      } else {
        if (existingManualTrackIds.length > 0) {
          for (const trackId of existingManualTrackIds) {
            await hybridDB.deleteTrack(trackId);
          }
        }

        const trackName = `${manualSamplesTrackPrefix} (${manualSampleCount})`;
        const createdTrack = await hybridDB.createTrack(
          String(selectedProject.id),
          trackName,
          String(selectedFieldForManualSample.id)
        );
        const trackId = String((createdTrack as any)?.id || '');
        if (!trackId || trackId === '[object Object]') {
          throw new Error('Invalid manual sample track ID');
        }

        const positions = calculateManualSamplePositions(selectedFieldForManualSample, manualSampleCount);
        for (let i = 0; i < positions.length; i++) {
          const [lat, lng] = positions[i];
          const sampleNumber = `${i + 1}`;
          await hybridDB.addSample(
            String(trackId),
            lat,
            lng,
            sampleNumber,
            `Manual ${sampleNumber}`
          );
        }

        toast.success(t('gps.manualSamplesCreated', { count: manualSampleCount }) || `Manual track created with ${manualSampleCount} samples`);
      }

      setShowManualSampleModal(false);
      setSelectedFieldForManualSample(null);

      await loadTracks(projectId);
    } catch (error) {
      logger.error('Error saving manual samples', error, { component: 'GPSTracker' });
      toast.error(t('gps.manualSamplesFailed') || 'Failed to save manual samples');
    }
  }, [selectedFieldForManualSample, selectedProject, manualSampleCount, calculateManualSamplePositions, loadTracks, t, isManualSamplesTrackName, manualSamplesTrackPrefix]);

  const toggleBoundaryExpansion = (boundaryId: number) => {
    const newExpanded = new Set(expandedBoundaries);
    if (newExpanded.has(boundaryId)) {
      newExpanded.delete(boundaryId);
    } else {
      newExpanded.add(boundaryId);
    }
    setExpandedBoundaries(newExpanded);
  };



  /* eslint-disable react-hooks/exhaustive-deps */
  const _handleStartTracking = useCallback(async () => {
    // Check if a field boundary is selected when field boundaries exist
    if (fieldBoundaries.length > 0 && !focusedBoundary) {
      setShowOutsideFieldConfirm(true);
      return;
    }

    startTrackingProcess();
  }, [fieldBoundaries.length, focusedBoundary]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const startTrackingProcess = async (): Promise<GpsTrack | null> => {
    const startTime = Date.now();
    console.log('🚀 Starting tracking process...');
    setIsStartingTracking(true);
    
    // REQUIRE project selection - don't auto-create
    if (!selectedProject) {
      console.log('❌ No project selected - user must select a project first');
      toast.error(t('gps.selectProjectFirst') || 'Please select a project before starting tracking');
      setIsStartingTracking(false);
      return null;
    }
    
    const project = selectedProject;

    try {
      let boundaryId = focusedBoundary;
      if (!boundaryId) {
        const autoBoundaryId = resolveBoundaryForPosition(position);
        if (autoBoundaryId) {
          boundaryId = autoBoundaryId;
          setFocusedBoundary(autoBoundaryId);
        }
      }

      const trackName = `Track ${tracks.length + 1}`;
      console.log('⏱️ Creating track:', trackName, 'for project:', project!.id, 'field boundary:', boundaryId);
      const createStart = Date.now();
      const newTrack = await hybridDB.createTrack(project!.id, trackName, boundaryId || undefined);
      console.log(`✅ Track created in ${Date.now() - createStart}ms:`, newTrack);
      
      // Set track immediately without waiting for full details
      setCurrentTrack(newTrack);
      setSampleCount(0);
      lastSavedPosition.current = null;
      lastPointSavedAtRef.current = 0;

      // Add the new track to the tracks list with empty points
      const trackDetail = { ...newTrack, gps_points: [], samples: [] };
      setTracks(prev => [...prev, trackDetail]);
      console.log('Track added to tracks list');
      
      console.log('Starting GPS tracking...');
      startTracking();
      
      const totalTime = Date.now() - startTime;
      console.log(`🎉 Tracking started in ${totalTime}ms`);
      toast.success(t('gps.trackingStarted') || 'GPS tracking started');
      return newTrack as GpsTrack;
    } catch (error) {
      logger.error('Error starting track', error, { component: 'TrackingManager', projectId: project?.id });
      toast.error(t('gps.trackingFailed') || 'Failed to start tracking');
      return null;
    } finally {
      setIsStartingTracking(false);
    }
  };

  const _handleStopTracking = async () => {
    if (!currentTrack) return;

    try {
      console.log('Stopping tracking for track:', currentTrack.id);
      // Track stop is handled by simply stopping the tracking
      stopTracking();
      setCurrentTrack(null);
      setSampleCount(0); // CRITICAL FIX: Reset sample count
      lastSavedPosition.current = null;
      lastPointSavedAtRef.current = 0;
      
      console.log('Reloading tracks after stop...');
      await loadTracks(selectedProject?.id ?? null);
      
      toast.success(t('gps.trackingStopped') || 'GPS tracking stopped');
    } catch (error) {
      logger.error('Error stopping track', error, { component: 'TrackingManager', trackId: currentTrack?.id });
      toast.error(t('gps.stoppingFailed') || 'Failed to stop tracking');
    }
  };

  const handleFieldClickFromMap = (fieldId: number | string) => {
    // Focus the field in sidebar
    setFocusedBoundary(fieldId as number);
    
    // Expand the field if not already expanded
    setExpandedBoundaries(prev => {
      const newSet = new Set(prev);
      newSet.add(fieldId as number);
      return newSet;
    });
    
    // Scroll the field into view at the top of the sidebar
    if (fieldListContainerRef.current) {
      setTimeout(() => {
        const fieldElement = document.querySelector(`[data-field-id="${fieldId}"]`);
        if (fieldElement) {
          fieldElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 0);
    }
  };

  const handleMapEmptyTap = () => {
    setFocusedBoundary(null);
  };

  const handleDeleteFieldSamples = useCallback(async (fieldBoundaryId: number | string) => {
    if (!isNativeApp || !selectedProject?.id) {
      return;
    }

    const projectId = String(selectedProject.id);
    const normalizedFieldId = String(fieldBoundaryId);
    const latestFieldSamples = await hybridDB.getFieldSamples(projectId);
    const latestTracks = await hybridDB.getTracks(projectId);

    const dedicatedSamples = latestFieldSamples.filter(
      sample => String(sample.field_boundary_id) === normalizedFieldId
    );

    const manualSamplesTracks = latestTracks.filter(track =>
      track
      && String(track.field_boundary_id) === normalizedFieldId
      && isManualSamplesTrackName(track.name)
    );

    const gpsTrackSamples = latestTracks.flatMap(track => {
      if (
        !track
        || String(track.field_boundary_id) !== normalizedFieldId
        || isManualSamplesTrackName(track.name)
      ) {
        return [] as Array<{ trackId: string; sampleId: string }>;
      }

      return (track.samples || [])
        .filter((sample): sample is { id: string | number } => sample?.id != null)
        .map(sample => ({
          trackId: String(track.id),
          sampleId: String(sample.id)
        }));
    });

    const manualSamplesCount = manualSamplesTracks.reduce(
      (total, track) => total + (track.samples?.length || 0),
      0
    );
    const totalSamplesToDelete = dedicatedSamples.length + gpsTrackSamples.length + manualSamplesCount;

    if (totalSamplesToDelete === 0) {
      return;
    }

    const confirmed = await showConfirmation(
      t('gps.deleteSamplesTitle') || 'Delete Samples?',
      t('gps.deleteSamplesConfirm', { count: totalSamplesToDelete }) || `Delete ${totalSamplesToDelete} samples from this field?`,
      {
        confirmText: t('common.delete') || 'Delete',
        cancelText: t('common.cancel') || 'Cancel',
        type: 'danger'
      }
    );

    if (!confirmed) {
      return;
    }

    try {
      if (dedicatedSamples.length > 0) {
        for (const sample of dedicatedSamples) {
          await hybridDB.deleteFieldSample(String(sample.id), projectId);
        }
      }

      if (gpsTrackSamples.length > 0) {
        for (const sample of gpsTrackSamples) {
          await hybridDB.deleteSample(sample.sampleId);
        }
      }

      if (manualSamplesTracks.length > 0) {
        for (const track of manualSamplesTracks) {
          if (track?.id != null) {
            await hybridDB.deleteTrack(String(track.id));
          }
        }
      }

      await Promise.all([
        loadFieldSamples(projectId),
        loadTracks(projectId),
        loadFieldBoundaries()
      ]);

      toast.success(
        t('gps.samplesDeleted', { count: totalSamplesToDelete }) || `${totalSamplesToDelete} samples deleted`
      );
    } catch (error) {
      logger.error('Error deleting field samples', error, {
        component: 'GPSTracker',
        fieldBoundaryId,
        projectId,
        totalSamplesToDelete
      });
      toast.error(t('gps.samplesDeleteFailed') || 'Failed to delete field samples');
    }
  }, [
    isNativeApp,
    selectedProject?.id,
    isManualSamplesTrackName,
    showConfirmation,
    t,
    loadFieldSamples,
    loadTracks,
    loadFieldBoundaries
  ]);

  const handleMarkFieldDone = useCallback(async (boundary: GpsFieldBoundary) => {
    if (!selectedProject?.id) {
      return;
    }

    const fieldId = String(boundary.id);
    const sampleCount = effectiveFieldSampleCountByField.get(fieldId) || 0;
    if (sampleCount <= 0) {
      return;
    }

    const currentState = getBoundarySamplingState(boundary);
    if (currentState.status === 'completed' && currentState.locked) {
      return;
    }

    const completedAt = new Date().toISOString();
    const completedBy = user?.displayName || user?.email || user?.uid || 'unknown';
    const nextProperties = buildBoundarySamplingProperties(boundary.properties, {
      status: 'completed',
      locked: true,
      completedAt,
      completedBy,
    });

    try {
      await hybridDB.updateFieldBoundary(
        String(boundary.id),
        boundary.name,
        undefined,
        boundary.color,
        nextProperties,
      );
      await loadFieldBoundaries();
      toast.success(t('gps.fieldDone') || 'Field marked as done');
    } catch (error) {
      logger.error('Error marking field done', error, {
        component: 'GPSTracker',
        fieldBoundaryId: boundary.id,
        projectId: selectedProject.id,
      });
      toast.error(t('gps.fieldDoneFailed') || 'Failed to mark field as done');
    }
  }, [effectiveFieldSampleCountByField, loadFieldBoundaries, selectedProject?.id, t, user]);

  const handleReopenField = useCallback(async (boundary: GpsFieldBoundary) => {
    if (!selectedProject?.id) {
      return;
    }

    const fieldId = String(boundary.id);
    const sampleCount = effectiveFieldSampleCountByField.get(fieldId) || 0;
    const currentState = getBoundarySamplingState(boundary);
    if (currentState.status !== 'completed' && !currentState.locked) {
      return;
    }

    const nextProperties = buildBoundarySamplingProperties(boundary.properties, {
      status: sampleCount > 0 ? 'in_progress' : 'pending',
      locked: false,
    });

    try {
      await hybridDB.updateFieldBoundary(
        String(boundary.id),
        boundary.name,
        undefined,
        boundary.color,
        nextProperties,
      );
      await loadFieldBoundaries();
      toast.success(t('gps.fieldReopened') || 'Field reopened');
    } catch (error) {
      logger.error('Error reopening field', error, {
        component: 'GPSTracker',
        fieldBoundaryId: boundary.id,
        projectId: selectedProject.id,
      });
      toast.error(t('gps.fieldReopenFailed') || 'Failed to reopen field');
    }
  }, [effectiveFieldSampleCountByField, loadFieldBoundaries, selectedProject?.id, t]);

  /* eslint-disable react-hooks/exhaustive-deps */
  const handleAddSample = async () => {
    if (!position) {
      console.log('handleAddSample: Missing current position');
      return;
    }

    if (!selectedProject?.id) {
      toast.error(t('gps.selectProjectFirst') || 'Please select a project before sampling');
      return;
    }

    const activeFieldId = resolveBoundaryForPosition(position);

    if (!activeFieldId) {
      toast.error(t('gps.sampleOutsideField') || 'You are outside of a field. Move inside a field to take a sample.');
      return;
    }

    if (focusedBoundary !== activeFieldId) {
      setFocusedBoundary(activeFieldId);
      setExpandedBoundaries((previous) => {
        const next = new Set(previous);
        next.add(activeFieldId as number);
        return next;
      });
    }

    const activeBoundary = fieldBoundaries.find((boundary) => String(boundary.id) === String(activeFieldId));
    if (isBoundarySamplingLocked(activeBoundary)) {
      toast.error(t('gps.fieldLocked') || 'This field is marked as done and is locked for sampling.');
      return;
    }

    if (!isTracking) {
      startTracking();
    }

    const fieldIdText = String(activeFieldId);
    const existingFieldSampleCount = effectiveFieldSamples.filter(
      sample => String(sample.field_boundary_id) === fieldIdText
    ).length;
    const newSampleNumber = existingFieldSampleCount + 1;
    setIsAddingSample(true);
    
    try {
      console.log('Adding sample:', {
        projectId: selectedProject.id,
        fieldBoundaryId: activeFieldId,
        sampleNumber: newSampleNumber,
        lat: position.latitude,
        lon: position.longitude
      });
      
      await hybridDB.addFieldSample(
        String(selectedProject.id),
        fieldIdText,
        position.latitude,
        position.longitude,
        `Sample #${newSampleNumber}`,
        undefined, // notes
        {
          device_accuracy_m: position.accuracy,
          coordinate_system: positionSource === 'external' ? 'WGS84 (external)' : 'WGS84 (internal)',
          regulatory_notes: `source_preference=${gpsSourcePreference}; source_policy=${gpsSourcePolicy}; source_used=${positionSource}; external_fallback=${isExternalFallback ? 'yes' : 'no'}`
        }
      );
      
      setSampleCount(newSampleNumber);
      toast.success(t('gps.sampleAdded', { number: newSampleNumber }) || `Sample #${newSampleNumber} added`);
      
      console.log('Sample saved locally, refreshing field samples...');
      await loadFieldSamples(selectedProject.id);
      
    } catch (error) {
      logger.error('Error adding sample', error, { component: 'TrackingManager', fieldBoundaryId: activeFieldId });
      toast.error(t('gps.sampleAddFailed') || 'Failed to add sample');
    } finally {
      setIsAddingSample(false);
    }
  };
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;

      const tagName = element.tagName.toLowerCase();
      return tagName === 'input'
        || tagName === 'textarea'
        || tagName === 'select'
        || element.isContentEditable;
    };

    const isHardwareSampleTriggerKey = (event: KeyboardEvent) => {
      const pressedKey = event.key?.toUpperCase?.() || '';
      const pressedCode = event.code?.toUpperCase?.() || '';
      const pressedKeyCode = Number(event.keyCode || event.which || 0);

      return HARDWARE_SAMPLE_TRIGGER_KEYS.has(pressedKey)
        || HARDWARE_SAMPLE_TRIGGER_CODES.has(pressedCode)
        || HARDWARE_SAMPLE_TRIGGER_KEY_CODES.has(pressedKeyCode);
    };

    const handleHardwareSampleTrigger = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;

      if (!isHardwareSampleTriggerKey(event)) {
        return;
      }

      if (isEditableTarget(event.target)) return;
      if (showBagCodesModal) return;

      // Mirror Take Sample button availability in the UI.
      if (isAddingSample || isStartingTracking || !selectedProject) return;

      const now = Date.now();
      if (now - lastHardwareSampleTriggerAtRef.current < HARDWARE_SAMPLE_DEBOUNCE_MS) {
        return;
      }
      lastHardwareSampleTriggerAtRef.current = now;

      event.preventDefault();
      void handleAddSample();
    };

    // Use capture phase so map/control listeners cannot swallow the event first.
    window.addEventListener('keydown', handleHardwareSampleTrigger, true);
    return () => {
      window.removeEventListener('keydown', handleHardwareSampleTrigger, true);
    };
  }, [handleAddSample, isAddingSample, isStartingTracking, selectedProject, showBagCodesModal]);

  const handleDeleteTrack = async (trackId: number) => {
    const confirmed = await showConfirmation(
      t('gps.deleteTrackTitle') || 'Delete Track?',
      t('gps.confirmDelete') || 'Are you sure you want to delete this track?',
      {
        confirmText: t('common.delete') || 'Delete',
        cancelText: t('common.cancel') || 'Cancel',
        type: 'danger'
      }
    );
    if (!confirmed) return;

    try {
      await hybridDB.deleteTrack(trackId);
      setTracks(prev => prev.filter(t => t !== null && t.id !== trackId));
      toast.success(t('gps.pathDeleted') || 'Path deleted');
    } catch (error) {
      logger.error('Error deleting track', error, { component: 'TrackingManager', trackId });
      toast.error(t('gps.pathDeleteFailed') || 'Failed to delete path');
    }
  };

  const handleAssignTrack = async (trackId: number, fieldBoundaryId: number | null) => {
    try {
      console.log('[handleAssignTrack] Starting:', { trackId, fieldBoundaryId, currentTracksCount: tracks.length });
      
      await hybridDB.updateTrack(trackId.toString(), { field_boundary_id: fieldBoundaryId ? fieldBoundaryId.toString() : null });
      
      console.log('[handleAssignTrack] Database updated, refreshing UI...');
      
      // Reload tracks to update the UI
      if (selectedProject) {
        const refreshedTracks = await loadTracks(selectedProject.id);
        console.log('[handleAssignTrack] Tracks refreshed:', { count: refreshedTracks?.length || tracks.length });
      }
      
      // Also refresh field boundaries to update counts
      await loadFieldBoundaries();
      
      console.log('[handleAssignTrack] Complete - tracks still visible:', tracks.length);
      
      const fieldName = fieldBoundaryId 
        ? fieldBoundaries.find(f => f.id === fieldBoundaryId)?.name || t('gps.unknownField') || 'Unknown Field'
        : t('gps.unassigned') || 'Unassigned';
      
      toast.success(t('gps.pathAssigned') || `Path assigned to ${fieldName}`);
    } catch (error) {
      logger.error('Error assigning track', error, { component: 'TrackingManager', trackId, fieldBoundaryId });
      toast.error(t('gps.pathAssignFailed') || 'Failed to assign path');
    } finally {
      // Close dropdown after assignment
      console.log('[handleAssignTrack] Closing dropdown');
      setShowTrackAssignDropdown(null);
      setDropdownPosition(null);
    }
  };

  // Field colors now auto-change to pink when tracks are assigned - no manual color picker needed

  // Handle avatar upload
  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast.error(t('gps.avatarTooLarge') || 'Avatar image must be less than 5MB');
        return;
      }
      
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setUserAvatar(result);
        localStorage.setItem('userAvatar', result);
        toast.success(t('gps.avatarUpdated') || 'Avatar updated successfully');
      };
      reader.readAsDataURL(file);
    }
  };

  if (loading) {
    return <AnimatedLoader message={loadingMessage} />;
  }

  const sidebarWrapperClass = isCompactLandscapeLayout
    ? 'gps-tracker-sidebar fixed left-2 top-2 z-[2000] w-[14rem] max-w-[calc(100vw-1rem)]'
    : 'gps-tracker-sidebar fixed left-4 top-4 z-[2000] w-72 sm:w-80 lg:w-80';
  const shouldHideSidebarForNavigation = isCompactLandscapeLayout && showNavigationPanel;
  const sidebarDockClass = isCompactLandscapeLayout ? 'bottom-2' : 'bottom-4';
  const sidebarRadiusClass = isCompactLandscapeLayout ? 'rounded-xl' : 'rounded-2xl';
  const collapsedSidebarContentClass = isCompactLandscapeLayout
    ? 'p-2 flex flex-col gap-1.5 animate-in fade-in slide-in-from-top-2 duration-500'
    : 'p-3 flex flex-col gap-2 animate-in fade-in slide-in-from-top-2 duration-500';
  const collapsedProjectTitleClass = isCompactLandscapeLayout
    ? `text-xs font-semibold truncate block ${isDark ? 'text-white' : 'text-gray-900'}`
    : `text-sm font-semibold truncate block ${isDark ? 'text-white' : 'text-gray-900'}`;
  const avatarDropdownWidthClass = isCompactLandscapeLayout ? 'w-48 max-w-[calc(100vw-1rem)]' : 'w-56';
  const expandedSidebarHeaderClass = isCompactLandscapeLayout
    ? 'flex items-center justify-between px-1.5 py-1 gap-1 cursor-pointer'
    : 'flex items-center justify-between px-2 py-1.5 gap-1.5 cursor-pointer';
  const expandedSidebarContentClass = isCompactLandscapeLayout
    ? 'flex-shrink-0 px-2.5 pt-1.5 pb-2 animate-in fade-in slide-in-from-top-4 duration-700'
    : 'flex-shrink-0 px-4 pt-2.5 pb-3 animate-in fade-in slide-in-from-top-4 duration-700';
  const expandedProjectHeaderClass = isCompactLandscapeLayout ? 'flex-1 min-w-0 text-left p-0.5' : 'flex-1 min-w-0 text-left p-1';
  const expandedProjectTitleClass = isCompactLandscapeLayout
    ? `text-xs font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`
    : `text-sm font-bold truncate ${isDark ? 'text-white' : 'text-gray-900'}`;
  const expandedProjectDescriptionClass = isCompactLandscapeLayout
    ? 'text-[10px] text-gray-600 dark:text-gray-300 truncate'
    : 'text-xs text-gray-600 dark:text-gray-300 truncate mt-0.5';
  const expandedAvatarButtonClass = `rounded-full flex items-center justify-center ${
    isDark ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'
  } transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg active:scale-95 ${
    isCompactLandscapeLayout
      ? (showAvatarDropdown ? 'h-8 w-16 px-2' : 'h-8 w-8')
      : (showAvatarDropdown ? 'h-9 w-20 px-3' : 'h-9 w-9')
  }`;
  const expandedAvatarImageClass = isCompactLandscapeLayout
    ? `flex-shrink-0 rounded-full object-cover transition-all duration-300 ${showAvatarDropdown ? 'w-6 h-6' : 'w-4.5 h-4.5'}`
    : `flex-shrink-0 rounded-full object-cover transition-all duration-300 ${showAvatarDropdown ? 'w-7 h-7' : 'w-5 h-5'}`;
  const expandedAvatarTextClass = isCompactLandscapeLayout
    ? `flex-shrink-0 transition-all duration-300 ${showAvatarDropdown ? 'text-lg' : 'text-sm'}`
    : `flex-shrink-0 transition-all duration-300 ${showAvatarDropdown ? 'text-xl' : 'text-base'}`;
  const expandedAvatarIconClass = isCompactLandscapeLayout
    ? `flex-shrink-0 transition-all duration-300 ${showAvatarDropdown ? 'w-6 h-6' : 'w-4.5 h-4.5'} ${isDark ? 'text-white' : 'text-gray-700'}`
    : `flex-shrink-0 transition-all duration-300 ${showAvatarDropdown ? 'w-7 h-7' : 'w-5 h-5'} ${isDark ? 'text-white' : 'text-gray-700'}`;
  const sidebarSectionClass = isCompactLandscapeLayout
    ? 'flex-1 flex flex-col px-2.5 pb-2 min-h-0'
    : 'flex-1 flex flex-col px-4 pb-3 min-h-0';
  const fieldCardBaseClass = isCompactLandscapeLayout ? 'p-2.5 rounded-lg' : 'p-3 md:p-4 rounded-xl';
  const fieldTitleClass = isCompactLandscapeLayout
    ? `block text-sm truncate font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`
    : `block text-base md:text-lg truncate font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`;
  const fieldMetaClass = isCompactLandscapeLayout
    ? `mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] ${isDark ? 'text-gray-300' : 'text-gray-600'}`
    : `mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs md:text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`;
  const fieldChevronClass = isCompactLandscapeLayout
    ? 'w-4 h-4 flex-shrink-0 text-gray-600 dark:text-gray-300'
    : 'w-5 h-5 md:w-6 md:h-6 flex-shrink-0 text-gray-600 dark:text-gray-300';
  const fieldExpandedRowClass = isCompactLandscapeLayout
    ? 'flex items-start gap-1.5 pl-0.5'
    : 'flex items-start gap-2 md:gap-3 pl-1';
  const fieldStatsClass = isCompactLandscapeLayout
    ? 'flex items-center gap-2 text-[11px]'
    : 'flex items-center gap-3 md:gap-4 text-xs md:text-sm';
  const fieldStatsIconClass = isCompactLandscapeLayout ? 'w-3.5 h-3.5' : 'w-4 h-4 md:w-5 md:h-5';
  const infoBadgeClass = isCompactLandscapeLayout
    ? `${isDark ? 'bg-blue-900/40 text-blue-200 border border-blue-800/50' : 'bg-blue-100 text-blue-700 border border-blue-200'} px-1.5 py-0.5 rounded-full text-[9px] font-medium`
    : `${isDark ? 'bg-blue-900/40 text-blue-200 border border-blue-800/50' : 'bg-blue-100 text-blue-700 border border-blue-200'} px-2 py-0.5 rounded-full text-[10px] md:text-xs font-medium`;
  const fieldActionButtonClass = isCompactLandscapeLayout ? 'p-1 rounded-lg transition-colors' : 'p-1.5 rounded-lg transition-colors';
  const fieldActionIconClass = isCompactLandscapeLayout ? 'w-3.5 h-3.5' : 'w-4 h-4 md:w-5 md:h-5';
  const projectButtonPaddingClass = isCompactLandscapeLayout ? 'p-1.5' : 'p-2';
  const projectTitleClass = isCompactLandscapeLayout ? 'text-xs font-semibold truncate' : 'text-sm font-semibold truncate';
  const projectDescriptionClass = isCompactLandscapeLayout
    ? `${isDark ? 'text-gray-400' : 'text-gray-600'} text-[11px] truncate`
    : `${isDark ? 'text-gray-400' : 'text-gray-600'} text-xs truncate`;
  const compactSidebarInfoBlockClass = isCompactLandscapeLayout ? 'mb-1 space-y-0.5' : 'mb-2 space-y-1';
  const compactSidebarStatusRowClass = isCompactLandscapeLayout ? 'mb-1 flex gap-1.5 min-w-0' : 'mb-2 flex gap-2 min-w-0';
  const compactSidebarActionButtonClass = isCompactLandscapeLayout ? 'w-full py-1.5 text-[11px]' : 'w-full py-2 text-sm';
  const compactSidebarTabsContainerClass = isCompactLandscapeLayout ? 'px-2.5 pb-0.5' : 'px-4 pb-1';
  const compactSidebarTabButtonClass = isCompactLandscapeLayout ? 'flex-1 py-1 rounded-md text-[11px] font-semibold transition-colors' : 'flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors';
  const compactSidebarFieldHeaderClass = isCompactLandscapeLayout ? 'px-2.5 pb-0' : 'px-4 pb-0';
  const projectUserDropdownMenuClass = `${isDark ? 'bg-gray-900/95 border border-gray-700' : 'bg-white/95 border border-gray-200'} mt-1 rounded-lg shadow-xl overflow-y-auto overscroll-contain ${isCompactLandscapeLayout ? 'max-h-[calc(100vh-18rem)]' : 'max-h-48'}`;
  const projectListScrollClass = isCompactLandscapeLayout ? 'h-full space-y-0.5 overflow-y-auto overscroll-contain scrollbar-modern pr-1' : 'h-full space-y-1 overflow-y-auto overscroll-contain scrollbar-modern pr-1';
  const gpsSummaryToneClass = shouldShowGpsErrorBanner
    ? (isDark ? 'bg-red-900/30 text-red-300 border-red-700/50' : 'bg-red-50/90 text-red-700 border-red-200/70')
    : gpsSourceState.style;
  const gpsSummaryTitle = position
    ? (gpsSourceState.label || (t('gps.gpsStatus') || 'GPS Status'))
    : (t('gps.requestingGps') || 'Getting location...');
  const gpsSummaryMeta = position
    ? `±${Math.max(1, Math.round(position.accuracy))}m`
    : (gpsSourceState.subtitle || (t('gps.selectGpsSource') || 'Select GPS Source'));
  const gpsSummaryToggleClass = `w-full rounded-xl border px-2.5 py-2 text-left transition-colors ${gpsSummaryToneClass}`;
  const gpsSummaryTitleClass = isCompactLandscapeLayout ? 'text-[11px] font-semibold truncate' : 'text-xs font-semibold truncate';
  const gpsSummaryMetaClass = isCompactLandscapeLayout ? 'mt-0.5 text-[10px] opacity-80 truncate' : 'mt-0.5 text-[11px] opacity-80 truncate';
  const gpsAdvancedToggleClass = `w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${
    isDark ? 'hover:bg-gray-800 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
  }`;
  const gpsSourceMenuPanelClass = `absolute top-full left-0 right-auto mt-1 min-w-full w-max max-w-[min(22rem,calc(100vw-1rem))] max-h-[min(24rem,calc(100vh-8rem))] overflow-y-auto overscroll-contain rounded-lg shadow-2xl z-[10001] border ${
    isDark
      ? 'bg-gray-900/80 border-gray-700'
      : 'bg-white/80 border-gray-200'
  }`;
  const renderGpsSourceMenu = () => (
    <div className={gpsSourceMenuPanelClass}>
      <div className="p-1">
        <button
          onClick={() => {
            updateGpsSourcePreference('internal');
            setShowGpsSourceMenu(false);
          }}
          className={`w-full min-w-0 flex items-start gap-2 px-3 py-2 rounded-md text-left transition-colors ${
            gpsSourcePreference === 'internal'
              ? (isDark ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-700')
              : (isDark ? 'hover:bg-gray-800 text-gray-200' : 'hover:bg-gray-100 text-gray-700')
          }`}
        >
          <span className="text-lg">📱</span>
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="text-sm font-medium truncate">{t('gps.internalGps') || 'Internal GPS'}</div>
            <div className="text-xs opacity-75 break-words leading-tight">{t('gps.internalGpsDescription') || 'Use device\'s built-in GPS'}</div>
          </div>
          {gpsSourcePreference === 'internal' && (
            <span className="text-green-500">✓</span>
          )}
        </button>

        <button
          onClick={() => {
            if (connectedDevice) {
              updateGpsSourcePreference('external');
              setShowGpsSourceMenu(false);
            } else {
              toast.error(t('common.noExternalGpsConnected'), { duration: 2000 });
            }
          }}
          disabled={!connectedDevice}
          className={`w-full min-w-0 flex items-start gap-2 px-3 py-2 rounded-md text-left transition-colors ${
            gpsSourcePreference === 'external'
              ? (isDark ? 'bg-green-900/50 text-green-300' : 'bg-green-100 text-green-700')
              : (!connectedDevice)
              ? (isDark ? 'opacity-50 cursor-not-allowed text-gray-500' : 'opacity-50 cursor-not-allowed text-gray-400')
              : (isDark ? 'hover:bg-gray-800 text-gray-200' : 'hover:bg-gray-100 text-gray-700')
          }`}
        >
          <span className="text-lg">🛰️</span>
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className={`text-sm font-medium truncate ${isDark ? 'text-gray-200' : 'text-gray-900'}`}>{t('gps.externalGps') || 'External GPS'}</div>
            <div className={`text-xs opacity-75 truncate leading-tight ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              {externalSourceMenuMeta}
            </div>
          </div>
          {gpsSourcePreference === 'external' && externalGpsPosition && (
            <span className="text-green-500">✓</span>
          )}
          {connectedDevice && !externalGpsPosition && (
            <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
          )}
        </button>

        {mockLocationActive && (
          <button
            onClick={() => {
              updateGpsSourcePreference('external');
              setShowGpsSourceMenu(false);
            }}
            className={`w-full min-w-0 flex items-start gap-2 px-3 py-2 rounded-md text-left transition-colors ${
              mockLocationActive && gpsSourcePreference === 'external'
                ? (isDark ? 'bg-yellow-900/50 text-yellow-300' : 'bg-yellow-100 text-yellow-700')
                : (isDark ? 'hover:bg-gray-800 text-gray-200' : 'hover:bg-gray-100 text-gray-700')
            }`}
          >
            <span className="text-lg">🎯</span>
            <div className="flex-1 min-w-0 overflow-hidden">
              <div className="text-sm font-medium truncate">{t('gps.mockGps') || 'Mock GPS'}</div>
              <div className="text-xs opacity-75 break-words leading-tight">{mockLocationProvider || (t('gps.mockLocationActive') || 'Mock location active')}</div>
            </div>
            {mockLocationActive && gpsSourcePreference === 'external' && (
              <span className="text-green-500">✓</span>
            )}
          </button>
        )}

        <button
          onClick={() => setShowGpsAdvancedControls((previous) => !previous)}
          className={gpsAdvancedToggleClass}
        >
          <ChevronRight className={`w-4 h-4 flex-shrink-0 transition-transform ${showGpsAdvancedControls ? 'rotate-90' : ''}`} />
          <div className="text-sm font-medium">{t('gps.advancedSettings') || 'Advanced GPS settings'}</div>
        </button>

        {showGpsAdvancedControls && (
          <>
            <div className={`mt-1 mb-1 rounded-md border px-2 py-2 ${
              isDark ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-gray-50'
            }`}>
              <div className={`text-[11px] font-semibold ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                {t('gps.sourcePolicyTitle') || 'External source policy'}
              </div>
              <div className="mt-1 grid grid-cols-2 gap-1">
                <button
                  onClick={() => updateGpsSourcePolicy('preferred')}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                    gpsSourcePolicy === 'preferred'
                      ? (isDark ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-700')
                      : (isDark ? 'bg-gray-700/40 text-gray-300 hover:bg-gray-700/70' : 'bg-white text-gray-700 hover:bg-gray-100')
                  }`}
                >
                  {t('gps.sourcePolicyPreferred') || 'Preferred'}
                </button>
                <button
                  onClick={() => updateGpsSourcePolicy('strict')}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                    gpsSourcePolicy === 'strict'
                      ? (isDark ? 'bg-red-900/50 text-red-300' : 'bg-red-100 text-red-700')
                      : (isDark ? 'bg-gray-700/40 text-gray-300 hover:bg-gray-700/70' : 'bg-white text-gray-700 hover:bg-gray-100')
                  }`}
                >
                  {t('gps.sourcePolicyStrict') || 'Strict'}
                </button>
              </div>
              <div className={`mt-1 text-[10px] ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                {gpsSourcePolicy === 'strict'
                  ? (t('gps.sourcePolicyStrictDescription') || 'No fallback to internal GPS when external data is missing.')
                  : (t('gps.sourcePolicyPreferredDescription') || 'Fallback to internal GPS if external data is stale.')}
              </div>
            </div>

            <div className={`h-px my-1 ${
              isDark ? 'bg-gray-700' : 'bg-gray-200'
            }`} />

            <button
              onClick={() => {
                setShowDeviceManager(true);
                setShowGpsSourceMenu(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                isDark ? 'hover:bg-blue-900/30 text-blue-400' : 'hover:bg-blue-50 text-blue-600'
              }`}
            >
              <Satellite className="w-4 h-4" />
              <div className="text-sm font-medium">{t('gps.manageDevices') || 'Manage Devices'}</div>
            </button>
          </>
        )}
      </div>
    </div>
  );
  const projectsSearchInputClass = `${
    isDark ? 'bg-gray-800/70 border-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
  } w-full rounded-lg border ${isCompactLandscapeLayout ? 'pl-8 pr-8 py-1.5 text-xs' : 'pl-9 pr-9 py-2 text-sm'} focus:outline-none focus:ring-2 focus:ring-blue-500`;
  const currentProjectCardClass = `${
    isDark ? 'bg-blue-900/20 border-blue-800/50' : 'bg-blue-50/90 border-blue-200/70'
  } mb-2.5 rounded-xl border ${isCompactLandscapeLayout ? 'p-2' : 'p-2.5'}`;
  const currentProjectEyebrowClass = isCompactLandscapeLayout
    ? 'text-[9px] font-semibold uppercase tracking-[0.14em] text-blue-400/90 dark:text-blue-300/90'
    : 'text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-500 dark:text-blue-300/90';
  const currentProjectTitleClass = isCompactLandscapeLayout
    ? `mt-1 text-xs font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`
    : `mt-1 text-sm font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`;
  const projectSelectedBadgeClass = `${
    isDark ? 'bg-blue-900/40 text-blue-200 border-blue-800/50' : 'bg-blue-100 text-blue-700 border-blue-200'
  } inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold`;
  const deviceInfoButtonSizeClass = isCompactLandscapeLayout ? 'w-9 h-9' : 'w-10 h-10 md:w-12 md:h-12';
  const deviceInfoButtonPositionClass = showNavigationPanel
    ? (isCompactLandscapeLayout ? 'hidden' : 'hidden md:flex md:right-[30.5rem] lg:right-[33.5rem]')
    : (isCompactLandscapeLayout ? 'right-14' : 'right-20');
  const deviceInfoIconClass = isCompactLandscapeLayout ? 'text-base' : 'text-lg md:text-xl';

  return (
    <div className={`fixed inset-0 overflow-hidden ${isCompactLandscapeLayout ? 'gps-compact-landscape' : ''}`}>
      {/* HTTPS Warning Banner - Only show in web browser, NOT in Capacitor APK */}
      {window.location.protocol === 'https:' && Capacitor.getPlatform() === 'web' && (
        <div className="fixed top-0 left-0 right-0 z-[10000] bg-red-600 text-white px-4 py-3 shadow-lg">
          <div className="flex items-center justify-between max-w-7xl mx-auto">
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <div className="font-bold">{t('common.httpsMode') || 'HTTPS Mode - GPS Devices Won\'t Connect'}</div>
                <div className="text-sm">{t('common.restartDevServer') || 'Restart dev server and use:'} <strong>http://localhost:5173</strong></div>
              </div>
            </div>
            <button
              onClick={() => {
                const httpUrl = window.location.href.replace('https://', 'http://');
                window.location.href = httpUrl;
              }}
              className="px-4 py-2 bg-white text-red-600 rounded-lg font-semibold hover:bg-gray-100 transition-colors"
            >
              Switch to HTTP
            </button>
          </div>
        </div>
      )}
      {/* Hidden file inputs for avatar upload */}
      <input
        type="file"
        id="avatarUpload"
        accept="image/*"
        onChange={handleAvatarUpload}
        className="hidden"
      />
      
      {/* Toast-style Sidebar */}
      {!shouldHideSidebarForNavigation && (
      <div 
        className={`
          ${sidebarWrapperClass}
          ${isSidebarCollapsed ? 'h-auto' : sidebarDockClass}
          transition-all duration-500 ease-in-out
        `}
      >
        <div 
          className={`
            ${isSidebarCollapsed ? 'h-auto' : 'h-full'}
            ${sidebarRadiusClass} shadow-lg
            ${isDark ? 'bg-gray-900/80 border border-gray-700/30' : 'bg-white/80 border border-gray-200/50'}
            flex flex-col
            transition-all duration-500 ease-in-out
            overflow-visible
          `}
        >
          {/* Collapsed Header */}
          {isSidebarCollapsed && (
            <div className={collapsedSidebarContentClass}>
              <div className="flex items-center justify-between gap-2">
                {/* Project Name */}
                <button
                  onClick={() => setIsSidebarCollapsed(false)}
                  className="flex-1 min-w-0 text-left"
                >
                  <span className={collapsedProjectTitleClass}>
                    {selectedProject?.name || t('gps.gpsTracker') || 'TECHBYP - GPS Pro'}
                  </span>
                </button>

                {/* Avatar */}
                <div className="relative avatar-dropdown-container flex-shrink-0">
                  <button
                    onClick={() => setShowAvatarDropdown(!showAvatarDropdown)}
                    className={`
                      h-8 rounded-full flex items-center justify-center
                      ${isDark ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}
                      transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg active:scale-95
                      ${showAvatarDropdown ? 'w-16 px-2' : 'w-8'}
                      relative
                    `}
                  >
                    {isImageAvatar ? (
                      <img src={userAvatar} alt="Avatar" className={`flex-shrink-0 rounded-full object-cover transition-all duration-300 ${showAvatarDropdown ? 'w-6 h-6' : 'w-4 h-4'}`} />
                    ) : userAvatar ? (
                      <span className={`flex-shrink-0 transition-all duration-300 ${showAvatarDropdown ? 'text-lg' : 'text-sm'}`}>{userAvatar}</span>
                    ) : (
                      <User className={`flex-shrink-0 transition-all duration-300 ${showAvatarDropdown ? 'w-6 h-6' : 'w-4 h-4'} ${isDark ? 'text-white' : 'text-gray-700'}`} />
                    )}
                  </button>
                
                  {/* Avatar Dropdown (Collapsed) */}
                  {showAvatarDropdown && (
                    <div 
                      className={`
                        absolute left-1/2 -translate-x-1/2 ${avatarDropdownWidthClass} rounded-2xl shadow-2xl z-50 mt-2
                        ${isDark ? 'bg-gray-900/80 border border-gray-700/30' : 'bg-white/80 border border-gray-200/50'}
                        avatar-dropdown
                      `}
                      style={{
                        top: '100%'
                      }}
                    >
                      <div className={`px-4 py-3 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                        <p className={`text-sm font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {user?.email || t('gps.user') || 'User'}
                        </p>
                      </div>
                      {/* Avatar Image Submenu */}
                      <div>
                        <button
                          onClick={() => setShowAvatarSubmenu(!showAvatarSubmenu)}
                          className={`w-full px-4 py-2 flex items-center gap-3 transition-colors ${
                            isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
                          }`}
                        >
                          <User className="w-4 h-4" />
                          <span className="text-sm flex-1 text-left">{t('gps.addAvatarImage') || 'Add Avatar Image'}</span>
                          <ChevronRight className={`w-4 h-4 transition-transform ${showAvatarSubmenu ? 'rotate-90' : ''}`} />
                        </button>
                      
                      {/* Inline Submenu Options */}
                      {showAvatarSubmenu && (
                        <div className={`border-l-2 ml-4 ${isDark ? 'border-gray-600' : 'border-gray-300'}`}>
                          <label
                            className={`w-full px-4 py-2 flex items-center gap-3 transition-colors cursor-pointer ${
                              isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
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
                              isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
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
                          isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
                        }`}
                      >
                        <Globe className="w-4 h-4" />
                        <span className="text-sm flex-1 text-left">{t('auth.selectLanguage') || 'Language'}</span>
                        <ChevronRight className={`w-4 h-4 transition-transform ${showLanguageDropdown ? 'rotate-90' : ''}`} />
                      </button>
                      
                      {/* Inline Language Options */}
                      {showLanguageDropdown && (
                        <div className={`border-l-2 ml-4 ${isDark ? 'border-gray-600' : 'border-gray-300'}`}>
                          <button
                            onClick={() => {
                              changeLanguage('en');
                              setShowLanguageDropdown(false);
                              setShowAvatarDropdown(false);
                            }}
                            className={`w-full px-4 py-2 text-sm text-left transition-colors ${
                              language === 'en'
                                ? (isDark ? 'bg-blue-600/20 text-blue-400' : 'bg-blue-50 text-blue-600')
                                : (isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700')
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
                                ? (isDark ? 'bg-blue-600/20 text-blue-400' : 'bg-blue-50 text-blue-600')
                                : (isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700')
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
                        isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
                      }`}
                    >
                      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                      <span className="text-sm">{isDark ? (t('gps.lightTheme') || 'Light Theme') : (t('gps.darkTheme') || 'Dark Theme')}</span>
                    </button>
                    {/* Phase 4: GPS Device Configuration */}
                    <button
                      onClick={() => {
                        setShowDeviceManager(true);
                        setShowAvatarDropdown(false);
                      }}
                      className={`w-full px-4 py-2 text-left flex items-center gap-3 transition-colors border-t ${
                        isDark ? 'hover:bg-blue-900/30 text-blue-400 border-gray-700' : 'hover:bg-blue-50 text-blue-600 border-gray-200'
                      }`}
                    >
                      <Satellite className="w-4 h-4" />
                      <span className="text-sm">{t('gps.manageDevices') || 'Manage GPS Devices'}</span>
                    </button>
                    <button
                      onClick={async () => {
                        setShowAvatarDropdown(false);
                        await logout();
                        toast.success(t('gps.loggedOut') || 'Logged out successfully');
                      }}
                      className={`w-full px-4 py-2 text-left flex items-center gap-3 transition-colors border-t ${
                        isDark ? 'hover:bg-red-900/30 text-red-400 border-gray-700' : 'hover:bg-red-50 text-red-600 border-gray-200'
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
                    p-1.5 rounded-lg transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg active:scale-95 flex-shrink-0
                    ${isDark ? 'hover:bg-gray-700/50 text-gray-300' : 'hover:bg-gray-100/50 text-gray-700'}
                  `}
                  title={t('common.expandSidebar') || 'Expand sidebar'}
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2">
                <div className="flex gap-1">
                  {position ? (
                    <div
                      onClick={() => setRecenterTrigger(prev => prev + 1)}
                      className={`flex-1 p-1.5 rounded-lg border cursor-pointer transition-colors ${
                        isDark ? 'bg-gray-900/30 border-gray-700/40 text-gray-200 hover:bg-gray-800/40' : 'bg-white/70 border-gray-200/60 text-gray-800 hover:bg-white'
                      }`}
                      title={t('gps.recenter') || 'Recenter Map'}
                    >
                      <div className="flex items-center gap-1 text-[10px] md:text-xs truncate">
                        <span>📍</span>
                        <span className="truncate">
                          {position.latitude.toFixed(4)}, {position.longitude.toFixed(4)}
                        </span>
                        <span className="opacity-80">±{position.accuracy.toFixed(1)}m</span>
                      </div>
                    </div>
                  ) : (
                    <div className={`flex-1 p-1.5 rounded-lg border text-[10px] md:text-xs ${isDark ? 'bg-gray-900/30 border-gray-700/40 text-gray-300' : 'bg-white/70 border-gray-200/60 text-gray-700'}`}>
                      📍 {t('gps.requestingGps') || 'Getting location...'}
                    </div>
                  )}

                  <div className="relative flex-1 min-w-0">
                    <button
                      onClick={() => setShowGpsSourceMenu(!showGpsSourceMenu)}
                      className={`w-full min-w-0 p-1.5 rounded-lg border text-[10px] md:text-xs transition-colors overflow-hidden ${
                        isDark ? 'bg-gray-900/30 border-gray-700/40 text-gray-200 hover:bg-gray-800/40' : 'bg-white/70 border-gray-200/60 text-gray-800 hover:bg-white'
                      }`}
                      title={t('gps.selectGpsSource') || 'Select GPS Source'}
                    >
                      <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                        <span>{gpsSourceState.emoji}</span>
                        <span className="font-semibold truncate">{gpsSourceState.label}</span>
                      </div>
                    </button>

                    {showGpsSourceMenu && (
                      <div
                        className={`absolute top-full left-0 right-auto mt-1 min-w-full w-max max-w-[min(22rem,calc(100vw-1rem))] rounded-lg shadow-2xl z-[10001] border overflow-hidden ${
                          isDark 
                            ? 'bg-gray-900/80 border-gray-700' 
                            : 'bg-white/80 border-gray-200'
                        }`}
                      >
                        <div className="p-1">
                          <button
                            onClick={() => {
                              updateGpsSourcePreference('internal');
                              setShowGpsSourceMenu(false);
                            }}
                            className={`w-full min-w-0 flex items-start gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                              gpsSourcePreference === 'internal'
                                ? (isDark ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-700')
                                : (isDark ? 'hover:bg-gray-800 text-gray-200' : 'hover:bg-gray-100 text-gray-700')
                            }`}
                          >
                            <span className="text-lg">📱</span>
                            <div className="flex-1 min-w-0 overflow-hidden">
                              <div className="text-sm font-medium truncate">{t('gps.internalGps') || 'Internal GPS'}</div>
                              <div className="text-xs opacity-75 break-words leading-tight">{t('gps.internalGpsDescription') || 'Use device\'s built-in GPS'}</div>
                            </div>
                            {gpsSourcePreference === 'internal' && (
                              <span className="text-green-500">✓</span>
                            )}
                          </button>

                          <button
                            onClick={() => {
                              if (connectedDevice) {
                                updateGpsSourcePreference('external');
                                setShowGpsSourceMenu(false);
                              } else {
                                toast.error(t('common.noExternalGpsConnected'), { duration: 2000 });
                              }
                            }}
                            disabled={!connectedDevice}
                            className={`w-full min-w-0 flex items-start gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                              gpsSourcePreference === 'external'
                                ? (isDark ? 'bg-green-900/50 text-green-300' : 'bg-green-100 text-green-700')
                                : (!connectedDevice)
                                ? (isDark ? 'opacity-50 cursor-not-allowed text-gray-500' : 'opacity-50 cursor-not-allowed text-gray-400')
                                : (isDark ? 'hover:bg-gray-800 text-gray-200' : 'hover:bg-gray-100 text-gray-700')
                            }`}
                          >
                            <span className="text-lg">🛰️</span>
                            <div className="flex-1 min-w-0 overflow-hidden">
                              <div className={`text-sm font-medium truncate ${isDark ? 'text-gray-200' : 'text-gray-900'}`}>{t('gps.externalGps') || 'External GPS'}</div>
                              <div className={`text-xs opacity-75 truncate leading-tight ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                                {externalSourceMenuMeta}
                              </div>
                            </div>
                            {gpsSourcePreference === 'external' && externalGpsPosition && (
                              <span className="text-green-500">✓</span>
                            )}
                            {connectedDevice && !externalGpsPosition && (
                              <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                            )}
                          </button>

                          <div className={`mt-1 mb-1 rounded-md border px-2 py-2 ${
                            isDark ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-gray-50'
                          }`}>
                            <div className={`text-[11px] font-semibold ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                              {t('gps.sourcePolicyTitle') || 'External source policy'}
                            </div>
                            <div className="mt-1 grid grid-cols-2 gap-1">
                              <button
                                onClick={() => updateGpsSourcePolicy('preferred')}
                                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                                  gpsSourcePolicy === 'preferred'
                                    ? (isDark ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-700')
                                    : (isDark ? 'bg-gray-700/40 text-gray-300 hover:bg-gray-700/70' : 'bg-white text-gray-700 hover:bg-gray-100')
                                }`}
                              >
                                {t('gps.sourcePolicyPreferred') || 'Preferred'}
                              </button>
                              <button
                                onClick={() => updateGpsSourcePolicy('strict')}
                                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                                  gpsSourcePolicy === 'strict'
                                    ? (isDark ? 'bg-red-900/50 text-red-300' : 'bg-red-100 text-red-700')
                                    : (isDark ? 'bg-gray-700/40 text-gray-300 hover:bg-gray-700/70' : 'bg-white text-gray-700 hover:bg-gray-100')
                                }`}
                              >
                                {t('gps.sourcePolicyStrict') || 'Strict'}
                              </button>
                            </div>
                            <div className={`mt-1 text-[10px] ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                              {gpsSourcePolicy === 'strict'
                                ? (t('gps.sourcePolicyStrictDescription') || 'No fallback to internal GPS when external data is missing.')
                                : (t('gps.sourcePolicyPreferredDescription') || 'Fallback to internal GPS if external data is stale.')}
                            </div>
                          </div>

                          {mockLocationActive && (
                            <button
                              onClick={() => {
                                updateGpsSourcePreference('external');
                                setShowGpsSourceMenu(false);
                              }}
                              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                                mockLocationActive && gpsSourcePreference === 'external'
                                  ? (isDark ? 'bg-yellow-900/50 text-yellow-300' : 'bg-yellow-100 text-yellow-700')
                                  : (isDark ? 'hover:bg-gray-800 text-gray-200' : 'hover:bg-gray-100 text-gray-700')
                              }`}
                            >
                              <span className="text-lg">🎯</span>
                              <div className="flex-1">
                                <div className="text-sm font-medium">{t('gps.mockGps') || 'Mock GPS'}</div>
                                <div className="text-xs opacity-75">{mockLocationProvider || (t('gps.mockLocationActive') || 'Mock location active')}</div>
                              </div>
                              {mockLocationActive && gpsSourcePreference === 'external' && (
                                <span className="text-green-500">✓</span>
                              )}
                            </button>
                          )}

                          <div className={`h-px my-1 ${
                            isDark ? 'bg-gray-700' : 'bg-gray-200'
                          }`} />

                          <button
                            onClick={() => {
                              setShowDeviceManager(true);
                              setShowGpsSourceMenu(false);
                            }}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${
                              isDark ? 'hover:bg-blue-900/30 text-blue-400' : 'hover:bg-blue-50 text-blue-600'
                            }`}
                          >
                            <Satellite className="w-4 h-4" />
                            <div className="text-sm font-medium">{t('gps.manageDevices') || 'Manage Devices'}</div>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {canTrack && (
                  <Button
                    onClick={handleAddSample}
                    variant={selectedProject ? 'success' : 'secondary'}
                    className={`w-full py-2 text-xs font-medium ${!selectedProject ? 'opacity-60' : ''}`}
                    disabled={isAddingSample || isStartingTracking || !selectedProject}
                    title={!selectedProject ? (t('gps.selectProjectFirst') || 'Please select a project first') : ''}
                  >
                    {isStartingTracking ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        {t('gps.starting') || 'Starting...'}
                      </>
                    ) : isAddingSample ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        {t('gps.adding') || 'Adding...'}
                      </>
                    ) : (
                      <>
                        <MapPin className="w-3.5 h-3.5 mr-1.5" />
                        {t('gps.takeSample') || 'Take Sample'} ({activeFieldSampleCount})
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Expanded Sidebar Content */}
          {!isSidebarCollapsed && (
            <>
              {/* Header with Project Selector, Avatar and Chevron */}
              <div className="border-b border-gray-200/50 dark:border-gray-700/50 animate-in fade-in duration-500">
                <div
                  className={expandedSidebarHeaderClass}
                  onClick={handleSidebarHeaderClick}
                  title={t('gps.collapseToTop') || 'Collapse to top'}
                >
                  {/* Project Selector */}
                  <div className={expandedProjectHeaderClass}>
                    <h2 className={expandedProjectTitleClass}>
                      {selectedProject ? selectedProject.name : (t('gps.selectProject') || 'Select Project')}
                    </h2>
                    {selectedProject?.description && (
                      <p className={expandedProjectDescriptionClass}>
                        {selectedProject.description}
                      </p>
                    )}
                  </div>

                  {/* Avatar */}
                  <div className="relative avatar-dropdown-container flex-shrink-0">
                    <button
                      onClick={() => setShowAvatarDropdown(!showAvatarDropdown)}
                      className={expandedAvatarButtonClass}
                    >
                      {isImageAvatar ? (
                        <img src={userAvatar} alt="Avatar" className={expandedAvatarImageClass} />
                      ) : userAvatar ? (
                        <span className={expandedAvatarTextClass}>{userAvatar}</span>
                      ) : (
                        <User className={expandedAvatarIconClass} />
                      )}
                    </button>
                    
                    {/* Avatar Dropdown (Expanded) */}
                    {showAvatarDropdown && (
                      <div 
                        className={`
                          absolute left-1/2 -translate-x-1/2 ${avatarDropdownWidthClass} rounded-2xl shadow-2xl z-[10001] mt-2
                          ${isDark ? 'bg-gray-900/80 border border-gray-700/30' : 'bg-white/80 border border-gray-200/50'}
                          avatar-dropdown
                        `}
                        style={{
                          top: '100%'
                        }}
                      >
                        <div className={`px-4 py-3 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                          <p className={`text-sm font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                            {user?.email || 'User'}
                          </p>
                        </div>
                        {/* Avatar Image Submenu */}
                        <div>
                          <button
                            onClick={() => setShowAvatarSubmenu(!showAvatarSubmenu)}
                            className={`w-full px-4 py-2 flex items-center gap-3 transition-colors ${
                              isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
                            }`}
                          >
                            <User className="w-4 h-4" />
                            <span className="text-sm flex-1 text-left">{t('gps.addAvatarImage') || 'Add Avatar Image'}</span>
                            <ChevronRight className={`w-4 h-4 transition-transform ${showAvatarSubmenu ? 'rotate-90' : ''}`} />
                          </button>
                          
                          {/* Inline Submenu Options */}
                          {showAvatarSubmenu && (
                            <div className={`border-l-2 ml-4 ${isDark ? 'border-gray-600' : 'border-gray-300'}`}>
                              <label
                                className={`w-full px-4 py-2 flex items-center gap-3 transition-colors cursor-pointer ${
                                  isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
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
                                  isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
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
                            onClick={() => setShowLanguageDropdownExpanded(!showLanguageDropdownExpanded)}
                            className={`w-full px-4 py-2 flex items-center gap-3 transition-colors ${
                              isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
                            }`}
                          >
                            <Globe className="w-4 h-4" />
                            <span className="text-sm flex-1 text-left">{t('auth.selectLanguage') || 'Language'}</span>
                            <ChevronRight className={`w-4 h-4 transition-transform ${showLanguageDropdownExpanded ? 'rotate-90' : ''}`} />
                          </button>
                          
                          {/* Inline Language Options */}
                          {showLanguageDropdownExpanded && (
                            <div className={`border-l-2 ml-4 ${isDark ? 'border-gray-600' : 'border-gray-300'}`}>
                              <button
                                onClick={() => {
                                  changeLanguage('en');
                                  setShowLanguageDropdownExpanded(false);
                                  setShowAvatarDropdown(false);
                                }}
                                className={`w-full px-4 py-2 text-sm text-left transition-colors ${
                                  language === 'en'
                                    ? (isDark ? 'bg-blue-600/20 text-blue-400' : 'bg-blue-50 text-blue-600')
                                    : (isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700')
                                }`}
                              >
                                English
                              </button>
                              <button
                                onClick={() => {
                                  changeLanguage('de');
                                  setShowLanguageDropdownExpanded(false);
                                  setShowAvatarDropdown(false);
                                }}
                                className={`w-full px-4 py-2 text-sm text-left transition-colors ${
                                  language === 'de'
                                    ? (isDark ? 'bg-blue-600/20 text-blue-400' : 'bg-blue-50 text-blue-600')
                                    : (isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700')
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
                            isDark ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
                          }`}
                        >
                          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                          <span className="text-sm">{isDark ? (t('gps.lightTheme') || 'Light Theme') : (t('gps.darkTheme') || 'Dark Theme')}</span>
                        </button>
                        {/* Phase 4: GPS Device Configuration */}
                        <button
                          onClick={() => {
                            setShowDeviceManager(true);
                            setShowAvatarDropdown(false);
                          }}
                          className={`w-full px-4 py-2 text-left flex items-center gap-3 transition-colors border-t ${
                            isDark ? 'hover:bg-blue-900/30 text-blue-400 border-gray-700' : 'hover:bg-blue-50 text-blue-600 border-gray-200'
                          }`}
                        >
                          <Satellite className="w-4 h-4" />
                          <span className="text-sm">{t('gps.manageDevices') || 'Manage GPS Devices'}</span>
                        </button>
                        <button
                          onClick={async () => {
                            setShowAvatarDropdown(false);
                            await logout();
                            toast.success(t('gps.loggedOut') || 'Logged out successfully');
                          }}
                          className={`w-full px-4 py-2 text-left flex items-center gap-3 transition-colors border-t ${
                            isDark ? 'hover:bg-red-900/30 text-red-400 border-gray-700' : 'hover:bg-red-50 text-red-600 border-gray-200'
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
                      p-2 rounded-lg transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg active:scale-95 flex-shrink-0
                      ${isDark ? 'hover:bg-gray-700/50 text-gray-300' : 'hover:bg-gray-100/50 text-gray-700'}
                    `}
                    title={t('gps.collapseToTop') || 'Collapse to top'}
                  >
                    <ChevronDown className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Fixed Top Content */}
              <div className={expandedSidebarContentClass}>

          {/* Mock Location Banner */}
          {mockLocationActive && (
            <div className={`${isCompactLandscapeLayout ? 'mb-2 px-2 py-1.5 rounded-md' : 'mb-3 px-3 py-2 rounded-lg'} bg-blue-500/20 border-2 border-blue-500 animate-pulse`}>
              <div className="flex items-center gap-2">
                <span className={isCompactLandscapeLayout ? 'text-lg' : 'text-2xl'}>🛰️</span>
                <div className="flex-1">
                  <div className={`${isCompactLandscapeLayout ? 'text-[11px]' : 'text-sm'} font-bold text-blue-600 dark:text-blue-400`}>{t('gps.externalGnss') || 'External GNSS'}</div>
                  <div className={`${isCompactLandscapeLayout ? 'text-[10px]' : 'text-xs'} opacity-70`}>{mockLocationProvider || (t('gps.mockLocation') || 'Mock Location')}</div>
                </div>
                <div className={`${isCompactLandscapeLayout ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'} bg-green-500/30 rounded font-bold`}>{t('gps.rtk') || 'RTK'}</div>
              </div>
            </div>
          )}

          {isCompactLandscapeLayout && !shouldShowGpsErrorBanner && (
            <div className="relative gps-source-menu-container">
              <button
                type="button"
                onClick={() => setShowGpsSourceMenu((previous) => !previous)}
                className={gpsSummaryToggleClass}
                title={t('gps.selectGpsSource') || 'Select GPS Source'}
                data-sidebar-no-collapse="true"
              >
                <div className="flex items-start gap-2">
                  <span className="text-sm flex-shrink-0">{position ? gpsSourceState.emoji : '📍'}</span>
                  <div className="min-w-0 flex-1">
                    <div className={gpsSummaryTitleClass}>{gpsSummaryTitle}</div>
                    <div className={gpsSummaryMetaClass}>{gpsSummaryMeta}</div>
                  </div>
                </div>
              </button>

              {showGpsSourceMenu && renderGpsSourceMenu()}
            </div>
          )}

          {/* GPS Status & Position - Combined Layout (hidden on web/PC) */}
          {position && gpsDetailsExpanded && !isCompactLandscapeLayout && (
            <div className={compactSidebarStatusRowClass}>
              {/* Location Status Display */}
              <div 
                onClick={() => setRecenterTrigger(prev => prev + 1)}
                className={`flex-1 ${isCompactLandscapeLayout ? 'p-0.5 rounded-md' : 'p-1 rounded-lg'} bg-green-50/90 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200/50 dark:border-green-700/50 cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors`}
                title={t('gps.recenter') || 'Recenter Map'}
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="font-semibold truncate text-[9px] md:text-[10px] flex items-center gap-1">
                    <span>📍</span>
                    {(position as any).mocked && (
                      <span className="text-blue-600 dark:text-blue-400 font-bold" title="External GNSS (Mock Location)">🛰️</span>
                    )}
                    <span>±{position.accuracy.toFixed(1)}m</span>
                    <span className={position.accuracy <= 10 ? 'text-green-600 dark:text-green-400' : position.accuracy <= 20 ? 'text-yellow-600 dark:text-yellow-400' : 'text-orange-600 dark:text-orange-400'}>
                      {position.accuracy <= 10 ? 'High' : position.accuracy <= 20 ? 'Mid' : 'Low'}
                    </span>
                  </div>
                  {(externalGpsPosition as any)?.satellites && (
                    <div className="text-[8px] md:text-[9px] opacity-80 flex-shrink-0 hidden sm:block">
                      • {(externalGpsPosition as any).satellites} sats
                    </div>
                  )}
                </div>
              </div>
              
              {/* GPS Source Indicator (Blue/Green/Yellow) */}
              <div className="relative flex-1 min-w-0 gps-source-menu-container">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setShowGpsSourceMenu(!showGpsSourceMenu)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setShowGpsSourceMenu(!showGpsSourceMenu);
                    }
                  }}
                  className={`w-full min-w-0 p-1 rounded-lg border cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-2 overflow-hidden ${gpsSourceState.style} focus:ring-blue-400 dark:focus:ring-blue-600 focus:ring-offset-transparent`}
                  title={t('gps.selectGpsSource') || 'Select GPS Source'}
                >
                  <div className="flex items-center justify-between gap-1 min-w-0">
                    <div className="flex items-center gap-1 min-w-0 text-[9px] md:text-[10px] overflow-hidden">
                      <span className="text-xs md:text-sm flex-shrink-0">{gpsSourceState.emoji}</span>
                      <span className="font-semibold truncate">{gpsSourceState.label}</span>
                      {gpsSourceState.subtitle && (
                        <span className="opacity-75 truncate hidden sm:inline">• {gpsSourceState.subtitle}</span>
                      )}
                    </div>
                    {(externalGpsPosition as any)?.satellites && (
                      <div className="text-[8px] md:text-[9px] opacity-75 flex-shrink-0 sm:hidden">
                        {(externalGpsPosition as any).satellites}
                      </div>
                    )}
                  </div>
                </div>

                {/* GPS Source Dropdown Menu */}
                {showGpsSourceMenu && renderGpsSourceMenu()}
              </div>
              
              {/* GPS Source Selector */}
              {externalGpsPosition && (
                <div className="flex gap-1 min-w-0">
                  <button
                    onClick={() => {
                      const newPref: GpsSourcePreference = gpsSourcePreference === 'internal' ? 'external' : 'internal';
                      updateGpsSourcePreference(newPref);
                    }}
                    className={`p-1 rounded-lg border text-[9px] md:text-[10px] font-medium focus:outline-none focus:ring-2 min-w-0 max-w-full overflow-hidden whitespace-nowrap ${
                      gpsSourcePreference === 'internal'
                        ? 'bg-blue-50/90 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200/50 dark:border-blue-700/50'
                        : 'bg-green-50/90 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200/50 dark:border-green-700/50'
                    }`}
                    title={t('gps.toggleGpsSource') || 'Toggle GPS Source'}
                  >
                    <span className="inline-flex items-center gap-1 max-w-full">
                      <span className="flex-shrink-0">{gpsSourcePreference === 'internal' ? '📱' : '🛰️'}</span>
                      <span className="truncate">{gpsSourcePreference === 'internal' ? (t('gps.sourceShort.internal') || 'Int') : (t('gps.sourceShort.external') || 'Ext')}</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}

          {!position && !shouldShowGpsErrorBanner && gpsDetailsExpanded && (
            <div className={compactSidebarInfoBlockClass}>
              <div className={`${isCompactLandscapeLayout ? 'p-1.5 rounded-md text-[11px]' : 'p-1.5 md:p-2 rounded-lg text-xs'} bg-blue-50/90 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200/50 dark:border-blue-700/50`}>
                📍 {t('gps.requestingGps') || 'Getting location...'}
              </div>
              <Button
                onClick={() => setShowDeviceManager(true)}
                variant="secondary"
                className={compactSidebarActionButtonClass}
              >
                <Satellite className="w-4 h-4 mr-2" />
                {t('gps.manageDevices') || 'Manage GPS Devices'}
              </Button>
            </div>
          )}

          {shouldShowGpsErrorBanner && (
            <div className={compactSidebarInfoBlockClass}>
              <button
                onClick={() => void handleGpsRescan()}
                className={`inline-flex items-center gap-1.5 ${isCompactLandscapeLayout ? 'px-2 py-1 rounded-md text-[11px]' : 'px-2.5 py-1.5 rounded-lg text-xs'} bg-red-50/90 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200/50 dark:border-red-700/50 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors`}
                title={t('gps.gpsError') || 'GPS Error'}
              >
                <span className="font-semibold">❌ {t('gps.gpsError') || 'GPS Error'}</span>
                {isRefreshingGps ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              </button>
            </div>
          )}

          {/* Fixed Tracking Controls (hidden on web/PC) */}
          {canTrack && sidebarTab !== 'projects' && (
            <div className="mb-0 space-y-0.5">
              <Button 
                onClick={handleAddSample} 
                variant={selectedProject ? 'success' : 'secondary'}
                className={`${compactSidebarActionButtonClass} font-medium ${!selectedProject ? 'opacity-60' : ''}`}
                disabled={isAddingSample || isStartingTracking || !selectedProject}
                title={!selectedProject ? (t('gps.selectProjectFirst') || 'Please select a project first') : ''}
              >
                {isStartingTracking ? (
                  <>
                    <Loader2 className={`${isCompactLandscapeLayout ? 'w-3.5 h-3.5 mr-1.5' : 'w-4 h-4 mr-2'} animate-spin`} />
                    {t('gps.starting') || 'Starting...'}
                  </>
                ) : isAddingSample ? (
                  <>
                    <Loader2 className={`${isCompactLandscapeLayout ? 'w-3.5 h-3.5 mr-1.5' : 'w-4 h-4 mr-2'} animate-spin`} />
                    {t('gps.adding') || 'Adding...'}
                  </>
                ) : (
                  <>
                    <MapPin className={`${isCompactLandscapeLayout ? 'w-3.5 h-3.5 mr-1.5' : 'w-4 h-4 mr-2'}`} />
                    {t('gps.takeSample') || 'Take Sample'} ({activeFieldSampleCount})
                  </>
                )}
              </Button>
            </div>
          )}
              </div>

              {sidebarTab === 'fields' && (
                <div className={compactSidebarFieldHeaderClass}>
                  <div className="hidden lg:flex gap-2 justify-end" />
                </div>
              )}

              {/* Tabs */}
              <div className={compactSidebarTabsContainerClass}>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setSidebarTab('fields')}
                    className={`${compactSidebarTabButtonClass} ${
                      sidebarTab === 'fields'
                        ? isDark ? 'bg-blue-600/30 text-blue-200' : 'bg-blue-100 text-blue-700'
                        : isDark ? 'bg-gray-700/30 text-gray-300 hover:bg-gray-600/40' : 'bg-white/70 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {t('gps.fieldBoundaries') || 'Fields'}
                  </button>
                  <button
                    onClick={() => setSidebarTab('projects')}
                    className={`${compactSidebarTabButtonClass} ${
                      sidebarTab === 'projects'
                        ? isDark ? 'bg-blue-600/30 text-blue-200' : 'bg-blue-100 text-blue-700'
                        : isDark ? 'bg-gray-700/30 text-gray-300 hover:bg-gray-600/40' : 'bg-white/70 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {t('gps.projects') || 'Projects'}
                  </button>
                </div>
              </div>
              {sidebarTab === 'fields' && (
                <>
                  {/* Field Boundaries Section - Mobile Optimized */}
                  <div className={sidebarSectionClass}>

                    {/* Fixed Field Header - Smaller on tablets */}
                    <div className={`${isCompactLandscapeLayout ? 'flex items-center justify-between mb-0 flex-shrink-0 h-0' : 'flex items-center justify-between mb-1 lg:mb-3 flex-shrink-0 h-5'}`}>
                      {/* Compact header: hide field count and edit actions on mobile */}
                      <div className="text-[10px] font-semibold text-gray-800 dark:text-gray-200 hidden lg:block">
                        {t('gps.fieldBoundaries') || 'Fields'} ({fieldBoundaries.length})
                      </div>
                      <div className="hidden lg:flex gap-2" />
                    </div>

                    {fieldBoundaries.length > 0 ? (
                      <>
                        {/* Scrollable Field List */}
                        <div className="flex-1 min-h-0 relative">
                          <div 
                            ref={fieldListContainerRef}
                            className="h-full space-y-0.5 overflow-y-auto overflow-x-visible scrollbar-modern pr-1"
                            onScroll={(e) => {
                              const container = e.currentTarget;
                              const hasMoreContent = container.scrollHeight > container.clientHeight;
                              const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 5;
                              setShowFieldScrollIndicator(hasMoreContent && !isAtBottom);
                            }}
                          >
                            {fieldBoundaries.map((boundary) => {
                            const isExpanded = expandedBoundaries.has(boundary.id);
                            const existingManualSampleCount = manualTrackSampleCountByField.get(String(boundary.id));
                            const totalSamplesInField = effectiveFieldSampleCountByField.get(String(boundary.id)) || 0;
                            const hasSamplesInField = totalSamplesInField > 0;
                            const samplingState = boundarySamplingStateByField.get(String(boundary.id));
                            const isCompletedField = samplingState?.status === 'completed';
                            const isLockedField = Boolean(samplingState?.locked);
                            const canDeleteFieldSamples = totalSamplesInField > 0 && !isLockedField;
                            const areaHa = boundaryAreaHaByField.get(String(boundary.id));
                            const infoBadges = boundaryInfoBadgesByField.get(String(boundary.id)) || [];
                            const bagCodeCount = getBagCodesForBoundary(boundary).length;
                            const areaDisplay = areaHa != null
                              ? (areaHa >= 10 ? areaHa.toFixed(1) : areaHa.toFixed(2))
                              : null;
                            
                            return (
                              <div key={boundary.id} className={`${isCompactLandscapeLayout ? 'mb-1' : 'mb-2'} relative`} data-field-id={boundary.id}>
                                <div
                                  onClick={() => {
                                    setFocusedBoundary(boundary.id);
                                    setFocusedBoundaryRequestId((prev) => prev + 1);
                                    toggleBoundaryExpansion(boundary.id);
                                  }}
                                  className={`
                                    ${fieldCardBaseClass} cursor-pointer transition-all
                                    ${focusedBoundary === boundary.id 
                                      ? isCompletedField
                                        ? isDark ? 'bg-green-500/25 border-green-400/60 shadow-lg' : 'bg-green-100/90 border-green-500/60 shadow-lg'
                                        : hasSamplesInField
                                        ? isDark ? 'bg-pink-500/25 border-pink-400/60 shadow-lg' : 'bg-pink-100/90 border-pink-500/60 shadow-lg'
                                        : isDark ? 'bg-blue-500/30 border-blue-400/50 shadow-lg' : 'bg-blue-100/90 border-blue-500/50 shadow-lg'
                                      : isCompletedField
                                        ? isDark ? 'bg-green-900/20 hover:bg-green-900/30 border-green-400/60' : 'bg-green-50/90 hover:bg-green-100/90 border-green-400/70'
                                      : hasSamplesInField
                                        ? isDark ? 'bg-gray-700/30 hover:bg-gray-600/40 border-pink-400/60' : 'bg-white/90 hover:bg-gray-100/90 border-pink-400/70'
                                        : isDark ? 'bg-gray-700/30 hover:bg-gray-600/40 border-gray-600/30' : 'bg-white/90 hover:bg-gray-100/90 border-gray-300/50'
                                    }
                                    ${isCompletedField ? (isDark ? 'ring-1 ring-green-400/40' : 'ring-1 ring-green-300/70') : hasSamplesInField ? (isDark ? 'ring-1 ring-pink-400/40' : 'ring-1 ring-pink-300/70') : ''}
                                    border-2
                                  `}
                                >
                                  {/* Top row: field name with area details and expand button */}
                                  <div className="flex items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className={fieldTitleClass}>
                                          {getFieldNumber(boundary.name)}
                                        </span>
                                        {bagCodeCount > 0 && (
                                          <button
                                            type="button"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              openBagCodesModal(boundary);
                                            }}
                                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                                              isDark
                                                ? 'border-amber-400/40 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30'
                                                : 'border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200'
                                            }`}
                                            title={t('gps.bagCodes.open') || 'Bag codes'}
                                            aria-label={t('gps.bagCodes.open') || 'Bag codes'}
                                          >
                                            <Tag className="h-3 w-3" />
                                            <span>{t('gps.bagCodes.countBadge', { count: bagCodeCount }) || `${bagCodeCount} bag codes`}</span>
                                          </button>
                                        )}
                                      </div>
                                      <div className={fieldMetaClass}>
                                        {areaDisplay && (
                                          <span>{`${areaDisplay} ha`}</span>
                                        )}
                                        <span>{`${totalSamplesInField} ${totalSamplesInField === 1 ? (t('gps.sampleCount') || 'sample') : (t('gps.samplesCount') || 'samples')}`}</span>
                                        {isCompletedField && (
                                          <span className={isDark ? 'text-green-300' : 'text-green-700'}>{t('gps.done') || 'Done'}</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-center gap-1">
                                      {isExpanded ? (
                                        <ChevronDown className={fieldChevronClass} />
                                      ) : (
                                        <ChevronRight className={fieldChevronClass} />
                                      )}
                                      {hasSamplesInField && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (isCompletedField) {
                                              void handleReopenField(boundary);
                                              return;
                                            }
                                            void handleMarkFieldDone(boundary);
                                          }}
                                          className={`flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${
                                            isCompletedField
                                              ? isDark
                                                ? 'border-amber-400/40 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                                                : 'border-amber-300 bg-amber-100 text-amber-700 hover:bg-amber-200'
                                              : isDark
                                                ? 'border-green-400/40 bg-green-500/20 text-green-300 hover:bg-green-500/30'
                                                : 'border-green-300 bg-green-100 text-green-700 hover:bg-green-200'
                                          }`}
                                          title={isCompletedField ? (t('gps.reopen') || 'Reopen') : (t('gps.done') || 'Done')}
                                          aria-label={isCompletedField ? (t('gps.reopen') || 'Reopen') : (t('gps.done') || 'Done')}
                                        >
                                          {isCompletedField ? <RefreshCw className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  
                                    {/* Sampling requirements badge (compact mode for field card) */}
                                    {boundary.samplingRequirements && (
                                      <SamplingBadge 
                                        requirements={boundary.samplingRequirements} 
                                        compact={true}
                                      />
                                    )}
                                </div>

                                {/* Tracks under this field */}
                                {isExpanded && (
                                  <div className="ml-4 mt-0.5 space-y-1">
                                    <div className={fieldExpandedRowClass}>
                                      <div className="min-w-0 flex-1">
                                        <div className={fieldStatsClass}>
                                          <div className={`flex items-center gap-1 md:gap-1.5 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                                            <MapPin className={fieldStatsIconClass} />
                                            <span className="font-medium">{totalSamplesInField}</span>
                                            <span className="opacity-70">{totalSamplesInField === 1 ? (t('gps.sampleCount') || 'sample') : (t('gps.samplesCount') || 'samples')}</span>
                                          </div>
                                        </div>
                                        {infoBadges.length > 0 && (
                                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                            {infoBadges.map((badge) => (
                                              <span
                                                key={`${boundary.id}-${badge}`}
                                                className={infoBadgeClass}
                                              >
                                                {badge}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                      <div className="ml-auto flex items-center gap-1.5">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openBagCodesModal(boundary);
                                          }}
                                          className={`${fieldActionButtonClass} ${
                                            bagCodeCount > 0
                                              ? isDark ? 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/30' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                              : isDark ? 'bg-gray-600/40 text-gray-300 hover:bg-gray-600/60' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                                          }`}
                                          title={t('gps.bagCodes.open') || 'Bag codes'}
                                          aria-label={t('gps.bagCodes.open') || 'Bag codes'}
                                        >
                                          <Tag className={fieldActionIconClass} />
                                        </button>
                                        {isNativeApp && canDeleteFieldSamples && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              void handleDeleteFieldSamples(boundary.id);
                                            }}
                                            className={`${fieldActionButtonClass} ${
                                              isDark
                                                ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                                                : 'bg-red-100 text-red-600 hover:bg-red-200'
                                            }`}
                                            title={t('gps.deleteSamples') || 'Delete samples'}
                                          >
                                            <Trash2 className={fieldActionIconClass} />
                                          </button>
                                        )}
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (isLockedField) {
                                              return;
                                            }
                                            setSelectedFieldForManualSample(boundary);
                                            setManualSampleCount(existingManualSampleCount || 5);
                                            setShowManualSampleModal(true);
                                          }}
                                          disabled={isLockedField}
                                          className={`${fieldActionButtonClass} ${
                                            isLockedField
                                              ? isDark ? 'bg-gray-700/40 text-gray-500 cursor-not-allowed' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                              : existingManualSampleCount != null
                                              ? isDark ? 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30' : 'bg-purple-100 text-purple-600 hover:bg-purple-200'
                                              : isDark ? 'bg-gray-600/40 text-gray-300 hover:bg-gray-600/60' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                                          }`}
                                          title={t('gps.manualSamples') || 'Manual samples'}
                                        >
                                          <Hand className={fieldActionIconClass} />
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                            })}
                          </div>
                          
                          {/* Scroll Indicator - appears when there's more content to scroll */}
                          {showFieldScrollIndicator && (
                            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white/80 via-white/40 to-transparent dark:from-gray-900/80 dark:via-gray-900/40 pointer-events-none flex items-end justify-center pb-2">
                              <div className={`flex items-center gap-1 px-2 py-1 rounded-full ${
                                isDark ? 'bg-gray-800/60 text-gray-300' : 'bg-white/60 text-gray-600'
                              }`}>
                                <ChevronDown className="w-3 h-3 animate-pulse" />
                                <span className="text-xs font-medium">{t('gps.moreFields') || 'More fields'}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-center">
                        <div className="text-sm text-gray-600 dark:text-gray-300">
                          {t('gps.noFieldBoundaries') || 'No field boundaries imported yet'}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Fixed Unassigned Tracks at bottom */}
                  {import.meta.env.VITE_ENABLE_UNASSIGNED_TRACKS_PANEL === 'true' && (() => {
                    // Tracks are unassigned if they have no field_boundary_id OR if the field_boundary_id doesn't match any existing boundary
                    const unassignedTracks = tracks.filter(t => {
                      if (!t) return false;
                      const fid = t?.field_boundary_id;
                      if (!fid || fid === 'null' || fid === 'undefined') return true;
                      // Check if the field boundary still exists
                      const fieldExists = fieldBoundaries.some(b => String(b.id) === String(fid));
                      return !fieldExists;
                    });
                    return unassignedTracks.length > 0;
                  })() && (
                    <div className="px-3 pb-3 flex-shrink-0">
                      <div className="h-px bg-gray-300 dark:bg-gray-600 mb-2" />
                      <h3 className="text-xs font-semibold text-gray-800 dark:text-gray-200 mb-1.5">
                        📍 {t('gps.unassignedTracks') || 'Unassigned Tracks'} ({tracks.filter(t => {
                          if (!t) return false;
                          const fid = t?.field_boundary_id;
                          if (!fid || fid === 'null' || fid === 'undefined') return true;
                          return !fieldBoundaries.some(b => String(b.id) === String(fid));
                        }).length})
                      </h3>
                      <div className="relative">
                        <div 
                          ref={unassignedTracksContainerRef}
                          className="space-y-0.5 max-h-40 overflow-y-auto scrollbar-modern pr-1"
                          onScroll={(e) => {
                            const container = e.currentTarget;
                            const hasMoreContent = container.scrollHeight > container.clientHeight;
                            const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 5;
                            setShowUnassignedScrollIndicator(hasMoreContent && !isAtBottom);
                          }}
                        >
                          {tracks.filter(t => {
                            if (!t) return false;
                            const fid = t?.field_boundary_id;
                            if (!fid || fid === 'null' || fid === 'undefined') return true;
                            return !fieldBoundaries.some(b => String(b.id) === String(fid));
                          }).map(track => (
                            <div
                              key={track.id}
                              className={`
                                flex items-center gap-2 p-1.5 rounded text-xs border cursor-pointer
                                ${isDark ? 'bg-gray-700/25 hover:bg-gray-600/35 border-gray-600/25' : 'bg-white/90 hover:bg-gray-100/90 border-gray-300/50'}
                                transition-colors
                              `}
                              onClick={() => setFocusedTrack(track.id)}
                            >
                              <div 
                                className="w-2 h-2 rounded-full flex-shrink-0" 
                                style={{ backgroundColor: track.color }}
                              />
                              <span className={`flex-1 truncate ${isDark ? 'text-gray-200' : 'text-gray-900'}`}>
                                {track.name}
                              </span>
                              <span className="text-gray-500 dark:text-gray-400 text-[10px] flex-shrink-0" title={t('gps.samples') || 'Samples'}>
                                {track.samples?.length || 0}
                              </span>
                              
                              {/* Assign Track Dropdown */}
                              <div className="relative track-assign-dropdown">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowTrackAssignDropdown(
                                      showTrackAssignDropdown === track.id ? null : track.id
                                    );
                                  }}
                                  className="p-1 rounded hover:bg-blue-500/20 text-blue-500 transition-colors"
                                  title={t('gps.assignToField') || 'Assign to field'}
                                >
                                  <ArrowRight className="w-3 h-3" />
                                </button>
                              </div>
                              
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteTrack(track.id);
                                }}
                                className="p-1 rounded hover:bg-red-500/20 text-red-500 transition-colors"
                                title={t('gps.confirmDelete') || 'Delete track'}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                        
                        {/* Scroll Indicator - appears when there's more content to scroll */}
                        {showUnassignedScrollIndicator && (
                          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white/80 via-white/40 to-transparent dark:from-gray-900/80 dark:via-gray-900/40 pointer-events-none flex items-end justify-center pb-2">
                            <div className={`flex items-center gap-1 px-2 py-1 rounded-full ${
                              isDark ? 'bg-gray-800/60 text-gray-300' : 'bg-white/60 text-gray-600'
                            }`}>
                              <ChevronDown className="w-3 h-3 animate-pulse" />
                              <span className="text-xs font-medium">{t('gps.moreTracks') || 'More tracks'}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {sidebarTab === 'projects' && (
                <div className={sidebarSectionClass}>
                  <div className="h-px bg-gray-300 dark:bg-gray-600 mb-2 lg:mb-4" />
                  {isAdmin && (
                    <div className="mb-2 user-selector-dropdown">
                      <label className={`block text-[11px] font-semibold mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        {t('orders.selectUser') || 'Select User'}
                      </label>
                      <button
                        onClick={() => setShowUserDropdown(prev => !prev)}
                        className={`w-full px-2 py-2 rounded-lg text-left text-xs transition-colors border ${
                          isDark
                            ? 'bg-gray-700/40 hover:bg-gray-600/50 text-gray-200 border-gray-600'
                            : 'bg-white/80 hover:bg-gray-100 text-gray-700 border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">
                            {selectedOwnerId
                              ? (userOptions.find(entry => entry.id === selectedOwnerId)?.name || (t('orders.selectUser') || 'Select User'))
                              : (t('orders.selectUserPlaceholder') || 'Select a user')}
                          </span>
                          <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${showUserDropdown ? 'rotate-180' : ''}`} />
                        </div>
                      </button>

                      {showUserDropdown && (
                        <div className={projectUserDropdownMenuClass}>
                          {userOptions.map(entry => (
                            <button
                              key={entry.id}
                              onClick={() => {
                                setProjects([]);
                                setSelectedProject(null);
                                setSelectedOwnerId(entry.id);
                                setShowUserDropdown(false);
                                void loadProjects(entry.id);
                              }}
                              className={`w-full px-3 py-2 text-left text-xs transition-colors ${
                                selectedOwnerId === entry.id
                                  ? (isDark ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700')
                                  : (isDark ? 'hover:bg-gray-800 text-gray-200' : 'hover:bg-gray-100 text-gray-700')
                              }`}
                            >
                              <div className="truncate font-medium">{entry.name}</div>
                              <div className="truncate opacity-75">{entry.email}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {selectedProject && (
                    <div className={currentProjectCardClass}>
                      <div className={currentProjectEyebrowClass}>{t('gps.currentProject') || 'Current project'}</div>
                      <div className={currentProjectTitleClass}>{selectedProject.name}</div>
                      {selectedProject.description && (
                        <div className={`${projectDescriptionClass} mt-0.5`}>
                          {selectedProject.description}
                        </div>
                      )}
                    </div>
                  )}
                  {shouldShowProjectSearch && (
                    <div className="relative mb-2.5">
                      <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                      <input
                        value={projectSearchQuery}
                        onChange={(event) => setProjectSearchQuery(event.target.value)}
                        placeholder={t('gps.searchProjects') || 'Search projects'}
                        className={projectsSearchInputClass}
                      />
                      {projectSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setProjectSearchQuery('')}
                          className={`absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded ${isDark ? 'text-gray-400 hover:bg-gray-700 hover:text-gray-200' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between mb-2">
                    <div className={`text-xs font-semibold ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                      {t('gps.projects') || 'Projects'} ({filteredProjects.length}{projectSearchQuery ? `/${projects.length}` : ''})
                    </div>
                  </div>

                  <div className="flex-1 min-h-0">
                    <div className={projectListScrollClass}>
                      {filteredProjects.length > 0 ? (
                        filteredProjects.map(project => (
                          <button
                            key={project.id}
                            onClick={() => {
                              setSelectedProject(project);
                              setSidebarTab('fields');
                            }}
                            className={`w-full text-left ${projectButtonPaddingClass} rounded-lg border transition-colors ${
                              selectedProject?.id === project.id
                                ? isDark ? 'bg-blue-600/30 border-blue-400/50 text-blue-200' : 'bg-blue-100 border-blue-400/50 text-blue-800'
                                : isDark ? 'bg-gray-700/25 hover:bg-gray-600/35 border-gray-600/25 text-gray-200' : 'bg-white/80 hover:bg-gray-100/80 border-gray-300/50 text-gray-900'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className={projectTitleClass}>{project.name}</div>
                                {project.description && (
                                  <div className={projectDescriptionClass}>
                                    {project.description}
                                  </div>
                                )}
                              </div>
                              {selectedProject?.id === project.id && (
                                <span className={projectSelectedBadgeClass}>
                                  {t('gps.current') || 'Current'}
                                </span>
                              )}
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="flex items-center justify-center text-center py-6">
                          <div className="text-sm text-gray-600 dark:text-gray-300">
                            {projectSearchQuery
                              ? (t('gps.noMatchingProjects') || 'No matching projects')
                              : (t('gps.noProjectsCreate') || 'No projects - Create one below')}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      )}

      {/* Map Container - Full screen */}
      {(!showNavigationPanel || !isCompactLandscapeLayout) && (
        <div className="absolute inset-0 w-full h-full z-0">
          <MapView
              currentPosition={position}
            tracks={mapTracks}
              fieldSamples={selectedProject ? effectiveFieldSamples : []}
              fieldBoundaries={fieldBoundaries}
              focusedBoundaryId={focusedBoundary}
              focusedBoundaryRequestId={focusedBoundaryRequestId}
            focusedTrackId={null}
              isTracking={isTracking}
              showNavigationButton={!!selectedProject}
              onNavigationClick={toggleNavigationPanel}
              isNavigationOpen={showNavigationPanel}
              isSidebarCollapsed={isSidebarCollapsed}
              isCompactLandscapeLayout={isCompactLandscapeLayout}
              recenterTrigger={recenterTrigger}
              onFieldClick={handleFieldClickFromMap}
              onMapEmptyTap={handleMapEmptyTap}
            />
        </div>
      )}

      {/* Navigation Panel */}
      {showNavigationPanel && (
        <Suspense fallback={null}>
          <NavigationPanel
            isOpen={showNavigationPanel}
            onClose={() => setShowNavigationPanel(false)}
            currentPosition={position}
            fieldBoundaries={fieldBoundaries}
            projectName={selectedProject?.name}
            isCompactLandscapeLayout={isCompactLandscapeLayout}
          />
        </Suspense>
      )}

      {/* Manual Sample Modal */}
      {showBagCodesModal && selectedBagCodeBoundary && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4" style={{ zIndex: 9999 }}>
          <div className={`w-full max-w-md p-6 rounded-2xl shadow-2xl ${
            isDark ? 'bg-gray-900/95 border border-gray-700/30' : 'bg-white/95 border border-gray-200/50'
          }`}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {t('gps.bagCodes.title') || 'Bag Codes'}
                </h2>
                <p className={`text-sm mt-1 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  {t('gps.bagCodes.description', { field: getFieldNumber(selectedBagCodeBoundary.name) }) || `Manage bag codes for ${getFieldNumber(selectedBagCodeBoundary.name)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={closeBagCodesModal}
                className={`rounded-lg p-2 transition-colors ${isDark ? 'text-gray-400 hover:text-white hover:bg-gray-800' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}
                aria-label={t('common.close') || 'Close'}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className={`rounded-lg px-3 py-2 text-xs ${isDark ? 'bg-amber-900/20 text-amber-200 border border-amber-800/40' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
                {t('gps.bagCodes.scanHint') || 'Tap this field first, then scan into the input below. Manual entry also works.'}
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  ref={bagCodeInputRef}
                  type="text"
                  value={bagCodeInput}
                  onChange={(event) => setBagCodeInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleSubmitBagCode();
                    }
                  }}
                  placeholder={t('gps.bagCodes.inputPlaceholder') || 'Scan or enter a bag code'}
                  className={`flex-1 rounded-lg border px-3 py-2.5 text-sm ${
                    isDark
                      ? 'bg-gray-800/90 border-gray-700 text-white'
                      : 'bg-white border-gray-300 text-gray-900'
                  } focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors`}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <Button onClick={() => void handleSubmitBagCode()} variant="primary">
                  {editingBagCodeIndex == null
                    ? (t('gps.bagCodes.addAction') || 'Add code')
                    : (t('gps.bagCodes.replaceAction') || 'Replace code')}
                </Button>
              </div>

              {editingBagCodeIndex != null && (
                <div className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs ${
                  isDark ? 'bg-blue-900/20 text-blue-200 border border-blue-800/40' : 'bg-blue-50 text-blue-800 border border-blue-200'
                }`}>
                  <span>{t('gps.bagCodes.editingHint') || 'Editing selected code. Save to replace it or cancel to keep the current value.'}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingBagCodeIndex(null);
                      setBagCodeInput('');
                    }}
                    className="font-semibold"
                  >
                    {t('common.cancel') || 'Cancel'}
                  </button>
                </div>
              )}

              <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-modern pr-1">
                {selectedBagCodes.length === 0 ? (
                  <div className={`rounded-lg border border-dashed px-4 py-5 text-sm text-center ${
                    isDark ? 'border-gray-700 text-gray-400' : 'border-gray-300 text-gray-500'
                  }`}>
                    {t('gps.bagCodes.emptyState') || 'No bag codes assigned to this field yet.'}
                  </div>
                ) : (
                  selectedBagCodes.map((code, index) => (
                    <div
                      key={`${selectedBagCodeBoundary.id}-bag-code-${code}-${index}`}
                      className={`rounded-lg border px-3 py-2.5 flex items-center gap-3 ${
                        isDark ? 'border-gray-700 bg-gray-800/60' : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>{code}</div>
                        {index === 0 && (
                          <div className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
                            {t('gps.bagCodes.primaryLabel') || 'Primary export code'}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleEditBagCode(index)}
                        className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg ${
                          isDark ? 'bg-blue-900/30 text-blue-200 hover:bg-blue-900/50' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                        }`}
                      >
                        {t('common.edit') || 'Edit'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteBagCode(index)}
                        className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg ${
                          isDark ? 'bg-red-900/30 text-red-200 hover:bg-red-900/50' : 'bg-red-100 text-red-700 hover:bg-red-200'
                        }`}
                      >
                        {t('common.delete') || 'Delete'}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showManualSampleModal && selectedFieldForManualSample && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4" style={{ zIndex: 9999 }}>
          <div className={`w-full max-w-md p-6 rounded-2xl shadow-2xl ${
            isDark ? 'bg-gray-900/95 border border-gray-700/30' : 'bg-white/95 border border-gray-200/50'
          }`}>
            <h2 className={`text-xl font-bold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {t('gps.manualSamples') || 'Manual Samples'}
            </h2>
            <p className={`text-sm mb-4 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              {t('gps.manualSamplesDesc') || 'Set the number of manual samples to be visualized for'} <strong>{getFieldNumber(selectedFieldForManualSample.name)}</strong>
            </p>
            
            <div className="space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
                  {t('gps.numberOfSamples') || 'Number of Samples'}
                </label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setManualSampleCount(Math.max(0, manualSampleCount - 1))}
                    className={`w-10 h-10 rounded-lg font-bold text-lg transition-colors ${
                      isDark ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                    }`}
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={manualSampleCount}
                    onChange={(e) => setManualSampleCount(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
                    className={`flex-1 px-4 py-2 text-center text-lg font-bold rounded-lg border ${
                      isDark
                        ? 'bg-gray-800/90 border-gray-700 text-white'
                        : 'bg-white border-gray-300 text-gray-900'
                    } focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors`}
                  />
                  <button
                    onClick={() => setManualSampleCount(Math.min(100, manualSampleCount + 1))}
                    className={`w-10 h-10 rounded-lg font-bold text-lg transition-colors ${
                      isDark ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                    }`}
                  >
                    +
                  </button>
                </div>
                <p className={`text-xs mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('gps.manualSamplesNote') || 'Dots will be displayed in the center of the field. Set to 0 to disable.'}
                </p>
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <Button
                  onClick={() => {
                    setShowManualSampleModal(false);
                    setSelectedFieldForManualSample(null);
                  }}
                  variant="ghost"
                >
                  {t('common.cancel') || 'Cancel'}
                </Button>
                <Button
                  onClick={handleSaveManualSamples}
                  variant="primary"
                >
                  {t('common.save') || 'Save'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Outside Field Confirmation */}
      {showOutsideFieldConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4" style={{ zIndex: 9999 }}>
          <Card className={`w-full max-w-md p-6 ${isDark ? 'bg-gray-900/95' : 'bg-white/95'}`}>
            <h2 className="text-xl font-bold mb-4 text-orange-600 dark:text-orange-500">{t('gps.pathOutsideField') || 'Path Outside Field?'}</h2>
            <p className="mb-6 text-gray-700 dark:text-gray-300">
              {t('gps.pathOutsideFieldConfirm') || 'Are you sure you want to track outside of the project field boundaries?'}
              <br /><br />
              {t('gps.pathOutsideFieldNote') || 'This path will not be associated with any field boundary and will appear in the unassigned paths list.'}
            </p>
            <div className="flex gap-3 justify-end">
              <Button
                onClick={() => setShowOutsideFieldConfirm(false)}
                variant="secondary"
              >
                {t('gps.cancel') || 'Cancel'}
              </Button>
              <Button
                onClick={() => {
                  setShowOutsideFieldConfirm(false);
                  startTrackingProcess();
                }}
                variant="primary"
              >
                {t('gps.continueTracking') || 'Yes, Continue'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* GPS Device Manager Modal */}
      {showDeviceManager && (
        <Suspense fallback={null}>
          <UnifiedDeviceManager
            currentDevice={connectedDevice}
            serialGPS={serialGPS}
            tcpGPS={tcpGPS}
            bluetoothGPS={bluetoothGPS}
            onClose={() => setShowDeviceManager(false)}
            onDeviceConnected={async (device, _positionCallback) => {
              setConnectedDevice(device);
              
              // The hooks will handle the actual connection and call positionCallback
              // We just need to update our external GPS position state
              if (device.connection_type === 'wifi' || device.connection_type === 'tcp') {
                setExternalGpsPosition(tcpGPS.lastPosition);
              } else if (device.connection_type === 'bluetooth') {
                setExternalGpsPosition(bluetoothGPS.lastPosition);
              } else if (device.connection_type === 'usb') {
                setExternalGpsPosition(serialGPS.lastPosition);
              }
            }}
          />
        </Suspense>
      )}

      {/* Track Assignment Modal - Centered popup with scrollable list */}
      {showTrackAssignDropdown && (
        <div 
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
          onClick={() => {
            setShowTrackAssignDropdown(null);
          }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" />
          
          {/* Modal Content */}
          <div 
            onClick={(e) => e.stopPropagation()}
            className={`relative w-full max-w-md max-h-[70vh] rounded-2xl shadow-2xl border ${
              isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
            }`}
          >
            {/* Header */}
            <div className={`flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b ${
              isDark ? 'border-gray-700' : 'border-gray-200'
            }`}>
              <h3 className={`text-base md:text-lg font-semibold ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}>
                {t('gps.moveTrackTo') || 'Move Track To'}
              </h3>
              <button
                onClick={() => {
                  setShowTrackAssignDropdown(null);
                }}
                className={`p-2 rounded-lg transition-colors ${
                  isDark ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-600'
                }`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Scrollable List */}
            <div className="overflow-y-auto max-h-[calc(70vh-5rem)] px-2 py-2">
              {(() => {
                const currentTrack = tracks.find(t => t && t.id === showTrackAssignDropdown);
                const isUnassigned = !currentTrack?.field_boundary_id;
                const currentBoundary = fieldBoundaries.find(b => b.id === currentTrack?.field_boundary_id);
                
                return (
                  <div className="space-y-1">
                    {/* Show unassign option only if track is currently assigned */}
                    {!isUnassigned && (
                      <button
                        onClick={() => {
                          handleAssignTrack(showTrackAssignDropdown!, null);
                          setShowTrackAssignDropdown(null);
                        }}
                        className={`w-full px-4 py-3 md:py-4 text-left rounded-xl transition-all ${
                          isDark 
                            ? 'hover:bg-gray-800 active:bg-gray-700 text-gray-200' 
                            : 'hover:bg-gray-100 active:bg-gray-200 text-gray-700'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-500/20">
                            📍
                          </div>
                          <span className="text-sm md:text-base font-medium">
                            {t('gps.unassigned') || 'Unassigned'}
                          </span>
                        </div>
                      </button>
                    )}
                    
                    {/* Show available field boundaries (excluding current one) */}
                    {fieldBoundaries
                      .filter(boundary => boundary.id !== currentBoundary?.id)
                      .map(boundary => (
                        <button
                          key={boundary.id}
                          onClick={() => {
                            handleAssignTrack(showTrackAssignDropdown!, boundary.id);
                            setShowTrackAssignDropdown(null);
                          }}
                          className={`w-full px-4 py-3 md:py-4 text-left rounded-xl transition-all ${
                            isDark 
                              ? 'hover:bg-gray-800 active:bg-gray-700 text-gray-200' 
                              : 'hover:bg-gray-100 active:bg-gray-200 text-gray-700'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div 
                              className="w-8 h-8 flex items-center justify-center rounded-lg border-2"
                              style={{ 
                                borderColor: boundary.color || '#00FF00', 
                                backgroundColor: `${boundary.color || '#00FF00'}20` 
                              }}
                            >
                              <div 
                                className="w-3 h-3 rounded"
                                style={{ backgroundColor: boundary.color || '#00FF00' }}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm md:text-base font-medium truncate">
                                {getFieldNumber(boundary.name)}
                              </div>
                              {/* Show track count in this field */}
                              {(() => {
                                const trackCount = tracks.filter(t => 
                                  t && String(t.field_boundary_id) === String(boundary.id)
                                ).length;
                                return trackCount > 0 ? (
                                  <div className={`text-xs ${
                                    isDark ? 'text-gray-400' : 'text-gray-500'
                                  }`}>
                                    {trackCount} {trackCount === 1 ? 'track' : 'tracks'}
                                  </div>
                                ) : null;
                              })()}
                            </div>
                          </div>
                        </button>
                      ))}
                    
                    {/* Empty state */}
                    {fieldBoundaries.filter(boundary => boundary.id !== currentBoundary?.id).length === 0 && isUnassigned && (
                      <div className={`text-center py-8 px-4 ${
                        isDark ? 'text-gray-400' : 'text-gray-500'
                      }`}>
                        <p className="text-sm md:text-base">
                          {t('gps.noFieldsAvailable') || 'No fields available'}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Floating Device Button - Bottom Right, left of Navigation button */}
      {connectedDevice && isExternalGpsConnected && externalGpsPosition && (Date.now() - externalGpsPosition.timestamp < 15000) && !showDevicePopup && (
        <button
          onClick={() => setShowDevicePopup(true)}
          className={`fixed bottom-4 z-[1500] ${deviceInfoButtonSizeClass} flex items-center justify-center rounded-full shadow-lg transition-all duration-300 ${deviceInfoButtonPositionClass}`}
          style={{
            backgroundColor: isDark ? 'rgba(59, 130, 246, 0.8)' : 'rgba(37, 99, 235, 0.8)',
          }}
          title={t('common.gpsDeviceInfo') || 'GPS Device Info'}
        >
          <span className={deviceInfoIconClass}>📡</span>
        </button>
      )}

      {/* Device Info Popup - Bottom Right */}
      {showDevicePopup && connectedDevice && (
        <div 
          className="fixed inset-0 bg-black/20 z-[9999]"
          onClick={() => setShowDevicePopup(false)}
        >
          <div 
            className="fixed bottom-6 right-6 w-80 rounded-xl shadow-2xl border animate-in slide-in-from-bottom-8 duration-300"
            style={{
              backgroundColor: isDark ? 'rgba(17, 24, 39, 0.8)' : 'rgba(255, 255, 255, 0.8)',
              borderColor: isDark ? 'rgba(59, 130, 246, 0.5)' : 'rgba(37, 99, 235, 0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b" style={{
              borderColor: isDark ? 'rgba(75, 85, 99, 0.5)' : 'rgba(229, 231, 235, 0.5)'
            }}>
              <div className="flex items-center justify-between">
                <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  📡 Connected Device
                </h3>
                <button
                  onClick={() => setShowDevicePopup(false)}
                  className={`p-1 rounded hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors ${isDark ? 'text-gray-400' : 'text-gray-600'}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-4 space-y-3">
              {(() => {
                const telem: any = externalGpsPosition;
                const lastUpdateSeconds = telem?.timestamp ? Math.max(0, Math.floor((Date.now() - telem.timestamp) / 1000)) : null;

                const labelClass = `text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`;
                const valueClass = `font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`;

                return (
                  <div className={`p-3 rounded-lg border ${isDark ? 'bg-gray-900/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className={`text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                        {t('gps.devices.connectedToGps') || 'Connected to GPS device'}
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${isDark ? 'bg-blue-900/40 text-blue-200' : 'bg-blue-50 text-blue-700'}`}>
                        {t('gps.connectionSource') || 'Source'}: {connectedDevice.connection_type.toUpperCase()}
                      </span>
                    </div>
                    <div className={`mt-3 grid grid-cols-2 gap-3 text-sm ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                      <div>
                        <div className={labelClass}>{t('gps.devices.satellites') || 'Satellites'}</div>
                        <div className={valueClass}>{telem?.satellites ?? '—'}</div>
                      </div>
                      <div>
                        <div className={labelClass}>{t('gps.devices.fixType') || 'Fix type'}</div>
                        <div className={`${valueClass} uppercase`}>{telem?.fix_type || telem?.fixType || '—'}</div>
                      </div>
                      <div>
                        <div className={labelClass}>{t('gps.devices.rangeEstimated') || 'Range (est.)'}</div>
                        <div className={valueClass}>{telem?.accuracy !== undefined ? `${telem.accuracy.toFixed(2)} m` : '—'}</div>
                      </div>
                      <div>
                        <div className={labelClass}>{t('gps.devices.lastUpdate') || 'Last update'}</div>
                        <div className={valueClass}>{lastUpdateSeconds !== null ? (t('gps.devices.secondsAgo', { seconds: lastUpdateSeconds }) || `${lastUpdateSeconds}s ago`) : '—'}</div>
                      </div>
                      <div>
                        <div className={labelClass}>{t('gps.hdop') || 'HDOP'}</div>
                        <div className={valueClass}>{telem?.hdop !== undefined ? telem.hdop.toFixed(2) : '—'}</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div>
                <div className={`text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  Device Name
                </div>
                <div className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {connectedDevice.name}
                </div>
              </div>

              <div>
                <div className={`text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  Connection Type
                </div>
                <div className={`text-sm ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                  {connectedDevice.connection_type.toUpperCase()}
                </div>
              </div>

              <div>
                <div className={`text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  Address
                </div>
                <div className={`text-sm font-mono ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                  {connectedDevice.address}
                </div>
              </div>

              {connectedDevice.config?.tcp_port && (
                <div>
                  <div className={`text-sm font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    Port
                  </div>
                  <div className={`text-sm font-mono ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                    {connectedDevice.config.tcp_port}
                  </div>
                </div>
              )}

              {/* GPS Signal Quality Section */}
              {(isExternalGpsConnected || externalGpsPosition) && (
                <>
                  <div className="pt-3 border-t" style={{
                    borderColor: isDark ? 'rgba(75, 85, 99, 0.5)' : 'rgba(229, 231, 235, 0.5)'
                  }}>
                    <div className={`text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      📊 GPS Signal Quality
                    </div>

                    {/* Satellites */}
                    {(externalGpsPosition as any)?.satellites !== undefined && (
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                          🛰️ Satellites
                        </span>
                        <span className={`text-sm font-semibold ${
                          (externalGpsPosition as any).satellites >= 8 
                            ? 'text-green-500' 
                            : (externalGpsPosition as any).satellites >= 5 
                            ? 'text-yellow-500' 
                            : 'text-red-500'
                        }`}>
                          {(externalGpsPosition as any).satellites}
                        </span>
                      </div>
                    )}

                    {/* Fix Type */}
                    {(externalGpsPosition as any)?.fix_type && (
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                          📍 Fix Type
                        </span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                          (externalGpsPosition as any).fix_type === 'fix' 
                            ? 'bg-green-500/20 text-green-400' 
                            : (externalGpsPosition as any).fix_type === 'float'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : (externalGpsPosition as any).fix_type === 'single'
                            ? 'bg-blue-500/20 text-blue-400'
                            : 'bg-gray-500/20 text-gray-400'
                        }`}>
                          {(externalGpsPosition as any).fix_type === 'fix' ? 'RTK Fixed' :
                           (externalGpsPosition as any).fix_type === 'float' ? 'RTK Float' :
                           (externalGpsPosition as any).fix_type === 'single' ? 'GPS' : 'No Fix'}
                        </span>
                      </div>
                    )}

                    {/* Accuracy */}
                    {externalGpsPosition?.accuracy !== undefined && (
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                          🎯 Accuracy
                        </span>
                        <span className={`text-sm font-semibold ${
                          externalGpsPosition.accuracy < 1 
                            ? 'text-green-500' 
                            : externalGpsPosition.accuracy < 5 
                            ? 'text-yellow-500' 
                            : 'text-orange-500'
                        }`}>
                          {externalGpsPosition.accuracy < 1 
                            ? `${(externalGpsPosition.accuracy * 100).toFixed(0)} cm` 
                            : `${externalGpsPosition.accuracy.toFixed(1)} m`}
                        </span>
                      </div>
                    )}

                    {/* HDOP */}
                    {(externalGpsPosition as any)?.hdop !== undefined && (
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                          📐 HDOP
                        </span>
                        <span className={`text-sm font-semibold ${
                          (externalGpsPosition as any).hdop < 2 
                            ? 'text-green-500' 
                            : (externalGpsPosition as any).hdop < 5 
                            ? 'text-yellow-500' 
                            : 'text-red-500'
                        }`}>
                          {(externalGpsPosition as any).hdop.toFixed(1)}
                        </span>
                      </div>
                    )}

                    {/* Altitude */}
                    {externalGpsPosition?.altitude !== undefined && (
                      <div className="flex items-center justify-between">
                        <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                          ⛰️ Altitude
                        </span>
                        <span className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                          {externalGpsPosition.altitude.toFixed(1)} m
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}

              {externalGpsPosition && (
                <>
                  <div className="pt-3 border-t" style={{
                    borderColor: isDark ? 'rgba(75, 85, 99, 0.5)' : 'rgba(229, 231, 235, 0.5)'
                  }}>
                    <div className={`text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('gps.status') || 'GPS Status'}
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{t('gps.currentPosition') || 'Position'}</span>
                        <span className={`text-xs font-mono ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                          {externalGpsPosition.latitude.toFixed(6)}, {externalGpsPosition.longitude.toFixed(6)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{t('gps.accuracy') || 'Accuracy'}</span>
                        <span className={`text-xs ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                          ±{externalGpsPosition.accuracy.toFixed(1)}m
                        </span>
                      </div>
                      {(externalGpsPosition as any)?.satellites && (
                        <div className="flex justify-between items-center">
                          <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{t('gps.devices.satellites') || 'Satellites'}</span>
                          <span className={`text-xs ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                            {(externalGpsPosition as any).satellites}
                          </span>
                        </div>
                      )}
                      {(externalGpsPosition as any)?.fixType && (
                        <div className="flex justify-between items-center">
                          <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{t('gps.devices.fixType') || 'Fix Type'}</span>
                          <span className={`text-xs font-semibold ${
                            (externalGpsPosition as any).fixType === 'fix' ? 'text-green-500' :
                            (externalGpsPosition as any).fixType === 'float' ? 'text-yellow-500' :
                            'text-blue-500'
                          }`}>
                            {(externalGpsPosition as any).fixType.toUpperCase()}
                          </span>
                        </div>
                      )}
                      {(externalGpsPosition as any)?.hdop && (
                        <div className="flex justify-between items-center">
                          <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{t('gps.hdopPrecision') || 'HDOP (Precision)'}</span>
                          <span className={`text-xs ${
                            (externalGpsPosition as any).hdop <= 1 ? 'text-green-500' :
                            (externalGpsPosition as any).hdop <= 2 ? 'text-yellow-500' :
                            'text-orange-500'
                          }`}>
                            {(externalGpsPosition as any).hdop.toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Disconnect Button */}
              <button
                onClick={() => {
                  if (connectedDevice.connection_type === 'bluetooth') {
                    bluetoothGPS.disconnect();
                  } else if (connectedDevice.connection_type === 'wifi' || connectedDevice.connection_type === 'tcp') {
                    tcpGPS.disconnect();
                  }
                  setConnectedDevice(null);
                  setExternalGpsPosition(null);
                  setLastTelemetryAt(null);
                  setShowDevicePopup(false);
                }}
                className="w-full px-4 py-2.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-600 dark:text-red-400 transition-colors text-sm font-medium border border-red-500/30"
              >
                {t('gps.devices.disconnect') || 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Old device config dialog removed - now using UnifiedDeviceManager */}
    </div>
  );
}
