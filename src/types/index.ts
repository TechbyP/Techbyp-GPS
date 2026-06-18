// GPS Tracking Types

// German-specific enums for agricultural soil sampling
export type LandUseType = 'Acker' | 'Grünland' | 'Wald' | 'Obstbau' | 'Spargel' | 'Rasen' | 'Gehölze' | 'Untergrund' | 'Sonstiges';
export type SampleType = 'Regular' | 'Duplicate' | 'Blank' | 'Reference';
export type AnalysisPackage = 'Basic' | 'Standard' | 'Extended' | 'Custom';
export type SoilHorizon = 'Ah' | 'Ap' | 'Bv' | 'Bt' | 'Cv' | 'Go' | 'Gr' | 'C' | 'Other';
export type Bundesland = 
  | 'Baden-Württemberg'
  | 'Bayern'
  | 'Berlin'
  | 'Brandenburg'
  | 'Bremen'
  | 'Hamburg'
  | 'Hessen'
  | 'Mecklenburg-Vorpommern'
  | 'Niedersachsen'
  | 'Nordrhein-Westfalen'
  | 'Rheinland-Pfalz'
  | 'Saarland'
  | 'Sachsen'
  | 'Sachsen-Anhalt'
  | 'Schleswig-Holstein'
  | 'Thüringen';

export type UserRole = 'admin' | 'client' | 'consultant' | 'lab_manager' | 'technician';
export type GpsFieldSamplingStatus = 'pending' | 'in_progress' | 'completed';

export interface GpsFieldBoundaryProperties extends Record<string, any> {
  sampling_status?: GpsFieldSamplingStatus;
  sampling_locked?: boolean;
  sampling_completed_at?: string;
  sampling_completed_by?: string;
  barcode_primary?: string;
  barcode_count?: number;
  barcode_list?: string;
  barcode_values?: string[];
}

export interface GpsProject {
  id: number | string; // Firebase IDs are strings, local IDs are "local_xxx"
  name: string;
  description?: string;
  created_by?: string;
  created_at: string; // ISO string
  updated_at?: string; // ISO string
}

export interface GpsTrack {
  id: number | string; // Firebase IDs are strings, local IDs are "local_xxx"
  project_id: number | string;
  name: string;
  started_at?: string;
  ended_at?: string;
  color?: string;
  created_by?: string;
  created_at?: string;
  field_boundary_id?: number | string | null;
  is_active?: boolean;
}

export interface GpsPoint {
  id: number | string;
  track_id: number | string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  timestamp: string;
  source_preference?: 'internal' | 'external';
  source_policy?: 'preferred' | 'strict';
  source_used?: 'internal' | 'external';
  external_fallback?: boolean;
  external_data_age_ms?: number;
  synced_at?: string;
}

export interface GpsSample {
  id: number | string;
  track_id: number | string;
  latitude: number;
  longitude: number;
  name?: string;
  sample_number: number;
  
  // Basic metadata
  depth_cm?: number;
  depth_from_cm?: number;
  depth_to_cm?: number;
  horizon?: string;
  horizon_description?: string;
  notes?: string;
  soil_type?: string;
  sampling_method?: string;
  coordinate_system?: string;
  device_accuracy_m?: number;
  operator?: string;
  
  // Location & Cadastral Data (German regulatory requirements)
  field_id?: string;
  field_name?: string;
  parcel_id?: string;
  cadastral_district?: string; // Gemarkung - LEGALLY REQUIRED in Germany
  legal_ref?: string;
  land_use?: 'Acker' | 'Grünland' | 'Wald' | 'Obstbau' | 'Spargel' | 'Rasen' | 'Gehölze' | 'Untergrund' | 'Sonstiges'; // German land use types
  
  // Crop Information
  current_crop?: string;
  previous_crop?: string;
  crop_rotation?: string;
  crop_stage?: string;
  last_harvest_date?: string;
  days_since_harvest?: number;
  fertilization_history?: string;
  
  // Laboratory Assignment & Analysis
  laboratory_id?: string;
  laboratory_name?: string; // LUFA, SGS, Agrolab, etc.
  laboratory_customer_id?: string;
  analysis_parameters?: string[]; // ['pH', 'N', 'P', 'K', 'Mg', 'organic_carbon']
  analysis_package?: 'Basic' | 'Standard' | 'Extended' | 'Custom';
  analysis_methods?: string[]; // DIN/VDLUFA standard references
  
  // Sample Container & Chain of Custody
  container_id?: string; // Barcode/QR code
  container_type?: string;
  sample_weight_g?: number;
  preservation_method?: string;
  sampled_by_signature?: string;
  reviewed_by?: string;
  transport_date?: string;
  transport_method?: string;
  
  // Quality Assurance
  sample_type?: 'Regular' | 'Duplicate' | 'Blank' | 'Reference';
  qc_group_id?: string; // For tracking duplicates
  sample_valid?: boolean;
  rejection_reason?: string;
  
  // Regulatory & State-specific
  bundesland?: string; // German federal state
  sampling_date?: string; // Separate from timestamp for regulatory purposes
  regulatory_notes?: string;
  
  // Status tracking
  lab_export_status?: 'pending' | 'exported' | 'error';
  lab_exported_at?: string;
  timestamp?: string;
  created_at: string;
  updated_at?: string;
}

export interface GpsFieldSample {
  id: number | string;
  project_id: number | string;
  field_boundary_id: number | string;
  latitude: number;
  longitude: number;
  sample_number: number;
  name?: string;
  notes?: string;
  timestamp?: string;
  created_at?: string;
  updated_at?: string;
  // Keep metadata extensible for compliance fields without requiring migrations for every new key.
  [key: string]: any;
}

export interface GpsTrackDetail extends GpsTrack {
  gps_points: GpsPoint[];
  samples: GpsSample[];
}

export interface GpsPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude?: number;
  timestamp: number;
  source_used?: 'internal' | 'external';
  external_fallback?: boolean;
  external_data_age_ms?: number;
  fix_type?: string;
  satellites?: number;
  heading?: number;
  speed?: number;
  hdop?: number;
}

export interface GpsFieldBoundary {
  id: number | string;
  project_id: number | string;
  name: string;
  geometry_type: 'Polygon' | 'MultiPolygon' | 'Point' | 'LineString';
  coordinates: number[][][] | number[][][][];
  render_meta?: GpsFieldBoundaryRenderMeta;
  properties?: GpsFieldBoundaryProperties;
  color?: string;
  created_at: string;
  created_by?: string;
  services?: Array<'basic_nutrients' | 'nmin' | 'nematodes'>;
  includeGpsDocumentation?: boolean;
  manual_samples?: {
    enabled: boolean;
    count: number;
  };
    samplingRequirements?: {
      depth?: string;
      depthFrom?: number;
      depthTo?: number;
      cores?: number;
      timing?: string;
      notes?: string;
    };
}

export interface GpsFieldBoundaryLodCoordinates {
  low?: number[][][] | number[][][][];
  mid?: number[][][] | number[][][][];
  high?: number[][][] | number[][][][];
}

export interface GpsFieldBoundaryRenderMeta {
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  centroid: [number, number] | null; // [lat, lon]
  point_count: number;
  lod: GpsFieldBoundaryLodCoordinates;
  schema_version: number;
  updated_at: string;
}

export interface GpsDevice {
  id?: number | string;
  name: string;
  device_type: 'reach_rs3' | 'generic_bluetooth' | 'serial' | 'network' | 'usb_serial';
  connection_type: 'bluetooth' | 'wifi' | 'serial' | 'tcp' | 'usb';
  address: string;
  manufacturer?: string;
  model?: string;
  capabilities?: Record<string, any>;
  last_connected?: string;
  config?: GpsDeviceConfig;
  created_at?: string;
  
  // Persistence & state
  user_id?: string;           // Owner of this device configuration
  is_favorite?: boolean;      // Quick access device
  connection_state?: 'disconnected' | 'connecting' | 'connected' | 'error';
  last_error?: string;        // Last connection error message
  connection_attempts?: number; // Failed connection attempts
  
  // Auto-reconnect settings
  auto_reconnect?: boolean;   // Automatically reconnect on disconnect
  reconnect_delay_ms?: number; // Delay between reconnect attempts
  max_reconnect_attempts?: number; // Max attempts before giving up
  
  // Device profile
  profile?: 'custom' | 'reach_rs3_rtk' | 'reach_rs3_ppk' | 'trimble_rtk' | 'generic_nmea';
  profile_settings?: Record<string, any>; // Profile-specific settings
  
  // Multi-device support
  priority?: number;          // Device priority (1 = highest) for multi-device mode
  use_for_tracking?: boolean; // Use this device for track recording
  use_for_samples?: boolean;  // Use this device for sample recording
  
  // Statistics
  total_connections?: number;
  total_uptime_seconds?: number;
  average_accuracy_m?: number;
  last_position?: GpsPosition;
  
  updated_at?: string;
}

export interface GpsDeviceConfig {
  // Serial/Bluetooth settings
  baudrate?: number;
  data_bits?: 8 | 7;
  stop_bits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd';
  
  // Network settings
  tcp_port?: number;
  tcp_host?: string;
  use_ssl?: boolean;
  
  // NMEA settings
  nmea_sentences?: string[];  // e.g., ['GGA', 'RMC', 'GSA']
  nmea_output_rate_hz?: number; // Output frequency
  
  // RTK/NTRIP settings
  correction_input?: 'ntrip' | 'lora' | 'bluetooth' | 'radio' | 'none';
  ntrip_enabled?: boolean;
  ntrip_server?: string;
  ntrip_port?: number;
  ntrip_mountpoint?: string;
  ntrip_username?: string;
  ntrip_password?: string;
  ntrip_version?: '1.0' | '2.0';
  ntrip_requires_gga?: boolean; // Send position to NTRIP caster
  
  // Positioning settings
  positioning_mode?: 'kinematic' | 'static' | 'single' | 'dgps';
  elevation_mask?: number;      // Minimum satellite elevation (degrees)
  snr_mask?: number;            // Minimum signal-to-noise ratio
  
  // Output settings
  output_format?: 'nmea' | 'lla' | 'xyz' | 'rtcm';
  coordinate_system?: 'WGS84' | 'ETRS89' | 'custom';
  
  // Advanced RTK
  rtk_timeout_seconds?: number; // Time before dropping to float
  ambiguity_resolution?: 'fix_and_hold' | 'continuous' | 'instantaneous';
  max_baseline_km?: number;     // Maximum distance to base station
}

export interface DeviceScanResult {
  name: string;
  address: string;
  connection_type: 'bluetooth' | 'wifi' | 'serial' | 'usb';
  rssi?: number;
  manufacturer?: string;
  services?: string[];
}

export type GpsPositionUpdate = GpsPosition;

export * from './orders';
