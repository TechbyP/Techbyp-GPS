/**
 * GPS Device Profiles & Presets
 * Pre-configured settings for common GPS devices used in agricultural soil sampling
 */

import { GpsDevice, GpsDeviceConfig } from '../types';

export interface DeviceProfile {
  id: string;
  name: string;
  description: string;
  device_type: GpsDevice['device_type'];
  connection_type: GpsDevice['connection_type'];
  manufacturer?: string;
  model?: string;
  config: GpsDeviceConfig;
  icon?: string;
}

/**
 * Pre-configured device profiles for common agricultural GPS receivers
 */
export const DEVICE_PROFILES: Record<string, DeviceProfile> = {
  // Emlid Reach RS3 - RTK mode (high precision)
  reach_rs3_rtk: {
    id: 'reach_rs3_rtk',
    name: 'Emlid Reach RS3 (RTK)',
    description: 'High-precision RTK positioning (cm accuracy)',
    device_type: 'reach_rs3',
    connection_type: 'wifi',
    manufacturer: 'Emlid',
    model: 'Reach RS3',
    config: {
      tcp_port: 9001,
      use_ssl: false,
      positioning_mode: 'kinematic',
      elevation_mask: 15,
      snr_mask: 35,
      output_format: 'nmea',
      nmea_sentences: ['GGA', 'RMC', 'GSA', 'GSV'],
      nmea_output_rate_hz: 5,
      coordinate_system: 'WGS84',
      correction_input: 'ntrip',
      ntrip_enabled: true,
      ntrip_version: '2.0',
      ntrip_requires_gga: true,
      rtk_timeout_seconds: 60,
      ambiguity_resolution: 'fix_and_hold',
      max_baseline_km: 40,
    },
    icon: '📡'
  },

  // Emlid Reach RS3 - PPK mode (post-processing)
  reach_rs3_ppk: {
    id: 'reach_rs3_ppk',
    name: 'Emlid Reach RS3 (PPK)',
    description: 'Post-processing kinematic (process later for cm accuracy)',
    device_type: 'reach_rs3',
    connection_type: 'wifi',
    manufacturer: 'Emlid',
    model: 'Reach RS3',
    config: {
      tcp_port: 9001,
      use_ssl: false,
      positioning_mode: 'kinematic',
      elevation_mask: 15,
      snr_mask: 35,
      output_format: 'nmea',
      nmea_sentences: ['GGA', 'RMC', 'GSA', 'GSV'],
      nmea_output_rate_hz: 5,
      coordinate_system: 'WGS84',
      correction_input: 'none', // No real-time corrections
    },
    icon: '📡'
  },

  // Generic Bluetooth GPS (e.g., Bad Elf, Garmin GLO)
  generic_bluetooth: {
    id: 'generic_bluetooth',
    name: 'Bluetooth GPS (Generic)',
    description: 'Standard Bluetooth GPS receiver (3-5m accuracy)',
    device_type: 'generic_bluetooth',
    connection_type: 'bluetooth',
    config: {
      baudrate: 9600,
      data_bits: 8,
      stop_bits: 1,
      parity: 'none',
      positioning_mode: 'single',
      elevation_mask: 10,
      output_format: 'nmea',
      nmea_sentences: ['GGA', 'RMC', 'GSA'],
      nmea_output_rate_hz: 1,
      coordinate_system: 'WGS84',
      correction_input: 'none',
    },
    icon: '📱'
  },

  // Trimble RTK GPS
  trimble_rtk: {
    id: 'trimble_rtk',
    name: 'Trimble RTK GPS',
    description: 'Trimble professional RTK receiver (cm accuracy)',
    device_type: 'network',
    connection_type: 'tcp',
    manufacturer: 'Trimble',
    config: {
      tcp_port: 5017,
      use_ssl: false,
      positioning_mode: 'kinematic',
      elevation_mask: 15,
      snr_mask: 40,
      output_format: 'nmea',
      nmea_sentences: ['GGA', 'RMC', 'GSA', 'GSV', 'VTG'],
      nmea_output_rate_hz: 5,
      coordinate_system: 'WGS84',
      correction_input: 'ntrip',
      ntrip_enabled: true,
      ntrip_version: '2.0',
      ntrip_requires_gga: true,
      rtk_timeout_seconds: 60,
      ambiguity_resolution: 'continuous',
      max_baseline_km: 50,
    },
    icon: '🛰️'
  },

  // Generic NMEA device (serial or network)
  generic_nmea: {
    id: 'generic_nmea',
    name: 'Generic NMEA GPS',
    description: 'Any GPS device outputting NMEA sentences',
    device_type: 'serial',
    connection_type: 'serial',
    config: {
      baudrate: 9600,
      data_bits: 8,
      stop_bits: 1,
      parity: 'none',
      positioning_mode: 'single',
      elevation_mask: 10,
      output_format: 'nmea',
      nmea_sentences: ['GGA', 'RMC'],
      nmea_output_rate_hz: 1,
      coordinate_system: 'WGS84',
      correction_input: 'none',
    },
    icon: '📍'
  },
};

/**
 * Get device profile by ID
 */
export function getDeviceProfile(profileId: string): DeviceProfile | null {
  return DEVICE_PROFILES[profileId] || null;
}

/**
 * Get all available device profiles
 */
export function getAllDeviceProfiles(): DeviceProfile[] {
  return Object.values(DEVICE_PROFILES);
}

/**
 * Create device from profile
 */
export function createDeviceFromProfile(
  profileId: string,
  customName?: string,
  address?: string
): Partial<GpsDevice> {
  const profile = getDeviceProfile(profileId);
  if (!profile) {
    throw new Error(`Profile ${profileId} not found`);
  }

  return {
    name: customName || profile.name,
    device_type: profile.device_type,
    connection_type: profile.connection_type,
    address: address || '',
    manufacturer: profile.manufacturer,
    model: profile.model,
    config: { ...profile.config },
    profile: profileId as any,
    auto_reconnect: true,
    reconnect_delay_ms: 5000,
    max_reconnect_attempts: 5,
    use_for_tracking: true,
    use_for_samples: true,
    priority: 1,
    created_at: new Date().toISOString(),
  };
}

/**
 * Validate device configuration
 */
export function validateDeviceConfig(device: Partial<GpsDevice>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check required fields
  if (!device.name?.trim()) {
    errors.push('Device name is required');
  }

  if (!device.address?.trim()) {
    errors.push('Device address is required');
  }

  // Validate connection settings
  if (device.connection_type === 'tcp' || device.connection_type === 'wifi') {
    if (!device.config?.tcp_port || device.config.tcp_port < 1 || device.config.tcp_port > 65535) {
      errors.push('Valid TCP port (1-65535) is required');
    }
  }

  if (device.connection_type === 'serial') {
    const validBaudrates = [4800, 9600, 19200, 38400, 57600, 115200];
    if (device.config?.baudrate && !validBaudrates.includes(device.config.baudrate)) {
      errors.push('Invalid baud rate. Use: 4800, 9600, 19200, 38400, 57600, or 115200');
    }
  }

  // Validate NTRIP settings if enabled
  if (device.config?.ntrip_enabled) {
    if (!device.config.ntrip_server?.trim()) {
      errors.push('NTRIP server is required when NTRIP is enabled');
    }
    if (!device.config.ntrip_port || device.config.ntrip_port < 1) {
      errors.push('Valid NTRIP port is required');
    }
    if (!device.config.ntrip_mountpoint?.trim()) {
      errors.push('NTRIP mountpoint is required');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get recommended NTRIP casters for Germany
 */
export function getGermanNtripCasters() {
  return [
    {
      name: 'SAPOS (Germany)',
      server: 'sapos.de',
      port: 2101,
      description: 'Official German geodetic reference service',
      coverage: 'Germany nationwide',
      requires_subscription: true,
    },
    {
      name: 'GREF (Rhineland-Palatinate)',
      server: 'ntrip.gref.lvermgeo.rlp.de',
      port: 2101,
      description: 'Free NTRIP service for Rhineland-Palatinate',
      coverage: 'Rhineland-Palatinate',
      requires_subscription: false,
    },
    {
      name: 'RTK2go (Free)',
      server: 'rtk2go.com',
      port: 2101,
      description: 'Free community NTRIP caster (variable quality)',
      coverage: 'Global (user-contributed)',
      requires_subscription: false,
    },
  ];
}

/**
 * Format device connection info for display
 */
export function formatDeviceConnectionInfo(device: GpsDevice): string {
  const parts: string[] = [];

  if (device.manufacturer && device.model) {
    parts.push(`${device.manufacturer} ${device.model}`);
  }

  if (device.connection_type === 'bluetooth') {
    parts.push(`Bluetooth: ${device.address}`);
  } else if (device.connection_type === 'wifi' || device.connection_type === 'tcp') {
    parts.push(`${device.address}:${device.config?.tcp_port || 'N/A'}`);
  }

  if (device.config?.positioning_mode) {
    parts.push(device.config.positioning_mode.toUpperCase());
  }

  if (device.config?.ntrip_enabled) {
    parts.push('RTK (NTRIP)');
  }

  return parts.join(' • ');
}
