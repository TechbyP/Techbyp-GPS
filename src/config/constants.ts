/**
 * Database Constants
 * Centralized constants for database operations
 * Replaces magic strings and numbers scattered throughout the codebase
 */

// ID Prefixes
export const ID_PREFIXES = {
  LOCAL: 'local_',
  GPS_LOCAL: 'gps_local_',
  SAMPLE_LOCAL: 'sample_local_',
  BOUNDARY_LOCAL: 'boundary_local_',
  DEVICE_LOCAL: 'device_local_',
  SYNC_QUEUE: 'sync_',
  DELETE_QUEUE: 'delete_',
} as const;

// Collection Names (Firebase subcollections under users/{uid}/)
export const COLLECTIONS = {
  PROJECTS: 'projects',
  TRACKS: 'tracks',
  GPS_POINTS: 'gps_points',
  SAMPLES: 'samples',
  FIELD_BOUNDARIES: 'field_boundaries',
  DEVICES: 'devices',
} as const;

// Firebase Firestore Limits
export const FIRESTORE_LIMITS = {
  MAX_BATCH_SIZE: 500, // Firestore batch write limit
  SAFE_BATCH_SIZE: 450, // Leave margin for safety
  MAX_DOCUMENT_SIZE: 1048576, // 1MB in bytes
  MAX_FIELD_SIZE: 1048487, // Max bytes per field
  MAX_ARRAY_SIZE: 10000, // Max array elements
} as const;

// Cache Configuration
export const CACHE_CONFIG = {
  MAX_AGE_SHORT: 5 * 60 * 1000, // 5 minutes for frequently changing data
  MAX_AGE_LONG: 60 * 60 * 1000, // 1 hour for stable data
  MAX_AGE_PERMANENT: 24 * 60 * 60 * 1000, // 24 hours
  INVALIDATION_DELAY: 100, // ms to wait before cache invalidation
} as const;

// Sync Queue Configuration
export const SYNC_QUEUE = {
  MAX_RETRIES: 10,
  MAX_AGE_DAYS: 7,
  CLEANUP_INTERVAL: 24 * 60 * 60 * 1000, // 24 hours
  BATCH_SIZE: 50, // Process 50 items at a time
  PRIORITY: {
    URGENT: 1, // Deletions, critical updates
    HIGH: 2, // User-initiated actions
    NORMAL: 3, // Background sync
    LOW: 4, // Cleanup, maintenance
  },
} as const;

// Retry Configuration
export const RETRY_CONFIG = {
  INITIAL_DELAY: 2000, // 2 seconds
  MAX_DELAY: 60000, // 60 seconds
  BACKOFF_MULTIPLIER: 2,
  MAX_ATTEMPTS: 3,
  JITTER_MS: 1000, // Add randomness to avoid thundering herd
} as const;

// Offline Detection
export const OFFLINE_CONFIG = {
  // How long to wait before considering definitely offline
  MOBILE_TIMEOUT: 15000, // 15 seconds on mobile
  WEB_TIMEOUT: 30000, // 30 seconds on web
  
  // Background sync check interval
  SYNC_INTERVAL: 30000, // 30 seconds
  
  // Backoff after failed connection attempts
  BACKOFF_INITIAL: 5000, // 5 seconds
  BACKOFF_MAX: 120000, // 2 minutes
  BACKOFF_MULTIPLIER: 1.5,
} as const;

// GPS Point Configuration
export const GPS_CONFIG = {
  TIMEOUT: 1500, // ms to wait for GPS fix
  MIN_ACCURACY: 100, // meters - reject points with worse accuracy
  MAX_ACCURACY: 1000, // meters - warn about poor accuracy
  POINT_BATCH_SIZE: 100, // Upload GPS points in batches of 100
  MIN_DISTANCE: 0.5, // meters - minimum distance between points
  MAX_AGE: 5000, // ms - reject old GPS readings
} as const;

// Sample Configuration
export const SAMPLE_CONFIG = {
  MIN_DEPTH_CM: 0,
  MAX_DEPTH_CM: 300,
  BATCH_SIZE: 50,
  EXPORT_BATCH_SIZE: 100,
} as const;

// Storage Limits
export const STORAGE_LIMITS = {
  LOCALSTORAGE_MAX: 5 * 1024 * 1024, // 5MB typical limit
  INDEXEDDB_MIN: 50 * 1024 * 1024, // 50MB minimum quota
  SQLITE_MAX: 100 * 1024 * 1024, // 100MB soft limit for mobile
} as const;

// Error Messages (will be translated via i18n)
export const ERROR_MESSAGES = {
  AUTH_REQUIRED: 'authentication_required',
  NETWORK_ERROR: 'network_error',
  OFFLINE: 'device_offline',
  INVALID_DATA: 'invalid_data',
  NOT_FOUND: 'not_found',
  PERMISSION_DENIED: 'permission_denied',
  QUOTA_EXCEEDED: 'storage_quota_exceeded',
  DATABASE_ERROR: 'database_error',
  SYNC_FAILED: 'sync_failed',
  TIMEOUT: 'operation_timeout',
} as const;

// Device Types
export const DEVICE_TYPES = {
  INTERNAL_GPS: 'internal_gps',
  BLUETOOTH_GPS: 'bluetooth_gps',
  USB_GPS: 'usb_gps',
  WIFI_GPS: 'wifi_gps',
  NETWORK_GPS: 'network_gps',
} as const;

// Connection Types
export const CONNECTION_TYPES = {
  BLUETOOTH: 'bluetooth',
  USB: 'usb',
  WIFI: 'wifi',
  NETWORK: 'network',
  INTERNAL: 'internal',
} as const;

// Track Colors (default palette)
export const TRACK_COLORS = [
  '#FF6B6B', // Red
  '#4ECDC4', // Teal
  '#45B7D1', // Blue
  '#FFA07A', // Orange
  '#98D8C8', // Mint
  '#F7DC6F', // Yellow
  '#BB8FCE', // Purple
  '#85C1E2', // Sky Blue
  '#F8B739', // Gold
  '#52B788', // Green
] as const;

// Field Boundary Colors
export const BOUNDARY_COLORS = {
  DEFAULT: '#00FF00',
  ACTIVE: '#00FF00',
  INACTIVE: '#808080',
  SELECTED: '#0080FF',
} as const;

// Log Retention
export const LOG_CONFIG = {
  MAX_HISTORY_SIZE: 100, // Keep last 100 log entries
  MAX_AGE_HOURS: 24, // Clear logs older than 24 hours
  ERROR_RETENTION_DAYS: 7, // Keep errors for 7 days
} as const;

// API Configuration
export const API_CONFIG = {
  DEFAULT_TIMEOUT: 60000, // 60 seconds
  UPLOAD_TIMEOUT: 120000, // 2 minutes for file uploads
  DOWNLOAD_TIMEOUT: 180000, // 3 minutes for downloads
  KEEPALIVE_INTERVAL: 30000, // 30 seconds
} as const;

// Validation Rules
export const VALIDATION = {
  PROJECT_NAME_MIN: 1,
  PROJECT_NAME_MAX: 100,
  TRACK_NAME_MIN: 1,
  TRACK_NAME_MAX: 100,
  SAMPLE_NAME_MIN: 1,
  SAMPLE_NAME_MAX: 50,
  DESCRIPTION_MAX: 1000,
  NOTES_MAX: 5000,
  UID_PATTERN: /^[a-zA-Z0-9-_]{10,128}$/,
  COORDINATE_PRECISION: 8, // Decimal places for lat/lon
} as const;

// Map Configuration
export const MAP_CONFIG = {
  DEFAULT_ZOOM: 13,
  MIN_ZOOM: 1,
  MAX_ZOOM: 19,
  TILE_SIZE: 256,
  MAX_TILES_CACHE: 1000,
  ATTRIBUTION: '© OpenStreetMap contributors',
} as const;

// Export Formats
export const EXPORT_FORMATS = {
  GEOJSON: 'geojson',
  KML: 'kml',
  GPX: 'gpx',
  CSV: 'csv',
  SHAPEFILE: 'shapefile',
} as const;

// Database Table Names (SQLite)
export const DB_TABLES = {
  PROJECTS: 'projects',
  TRACKS: 'tracks',
  GPS_POINTS: 'gps_points',
  SAMPLES: 'samples',
  FIELD_BOUNDARIES: 'field_boundaries',
  DEVICES: 'devices',
  SCHEMA_VERSION: 'schema_version',
} as const;

// IndexedDB Store Names
export const IDB_STORES = {
  PROJECTS: 'projects',
  TRACKS: 'tracks',
  GPS_POINTS: 'gps_points',
  SAMPLES: 'samples',
  FIELD_BOUNDARIES: 'field_boundaries',
  CACHE: 'cache',
  SYNC_QUEUE: 'sync_queue',
  METADATA: 'metadata',
} as const;

// Status Values
export const STATUS = {
  ACTIVE: 1,
  INACTIVE: 0,
  PENDING: 'pending',
  SYNCED: 'synced',
  FAILED: 'failed',
  DELETED: 'deleted',
} as const;

// Timestamp Safety
export const TIMESTAMP_CONFIG = {
  // Don't delete data modified in the last 24 hours during background sync
  SAFETY_WINDOW_MS: 24 * 60 * 60 * 1000,
  // Timestamps before this year are invalid (Unix epoch issues)
  MIN_VALID_YEAR: 2020,
} as const;

// Type-safe helper to get collection path
export function getCollectionPath(uid: string, collection: keyof typeof COLLECTIONS): string {
  return `users/${uid}/${COLLECTIONS[collection]}`;
}

// Type-safe helper to generate local IDs
export function generateLocalId(prefix: keyof typeof ID_PREFIXES = 'LOCAL'): string {
  return `${ID_PREFIXES[prefix]}${crypto.randomUUID()}`;
}

// Check if ID is local (not synced to Firebase yet)
export function isLocalId(id: string): boolean {
  return Object.values(ID_PREFIXES).some(prefix => id.startsWith(prefix));
}
