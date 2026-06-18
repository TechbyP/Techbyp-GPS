/**
 * Battery Optimization Utility
 * Manages power consumption for long field sessions on Android tablets
 */

import { Capacitor } from '@capacitor/core';

interface BatteryInfo {
  level: number; // 0-100
  isCharging: boolean;
  isLowPower: boolean;
}

interface OptimizationSettings {
  gpsPollInterval: number; // milliseconds
  mapUpdateInterval: number; // milliseconds
  syncInterval: number; // milliseconds
  enableBackgroundTracking: boolean;
  reduceMapQuality: boolean;
  dimScreen: boolean;
}

interface BrowserBatteryManager {
  level: number;
  charging: boolean;
  addEventListener: (event: 'levelchange' | 'chargingchange', listener: () => void) => void;
}

class BatteryOptimizationService {
  private isNative = Capacitor.isNativePlatform();
  private currentSettings: OptimizationSettings = this.getDefaultSettings();
  private batteryCheckInterval: NodeJS.Timeout | null = null;
  private callbacks: Set<(info: BatteryInfo) => void> = new Set();

  /**
   * Get default optimization settings
   */
  private getDefaultSettings(): OptimizationSettings {
    return {
      gpsPollInterval: 1000, // 1 second - high accuracy
      mapUpdateInterval: 1000,
      syncInterval: 30000, // 30 seconds
      enableBackgroundTracking: true,
      reduceMapQuality: false,
      dimScreen: false,
    };
  }

  /**
   * Get battery-saving settings
   */
  private getBatterySavingSettings(): OptimizationSettings {
    return {
      gpsPollInterval: 5000, // 5 seconds - save battery
      mapUpdateInterval: 3000,
      syncInterval: 120000, // 2 minutes
      enableBackgroundTracking: false,
      reduceMapQuality: true,
      dimScreen: true,
    };
  }

  /**
   * Initialize battery monitoring
   */
  async initialize(): Promise<void> {
    if (!this.isNative) {
      // Web Battery API
      this.initializeBrowserBattery();
    } else {
      // Capacitor battery monitoring
      this.startBatteryMonitoring();
    }

    // Apply saved settings
    const savedMode = localStorage.getItem('battery_mode');
    if (savedMode === 'saving') {
      this.enableBatterySaving();
    }
  }

  private async getBrowserBattery(): Promise<BrowserBatteryManager | null> {
    const batteryNavigator = navigator as Navigator & {
      getBattery?: () => Promise<BrowserBatteryManager>;
    };

    return (await batteryNavigator.getBattery?.()) ?? null;
  }

  /**
   * Initialize browser battery API
   */
  private async initializeBrowserBattery(): Promise<void> {
    try {
      const battery = await this.getBrowserBattery();
      if (!battery) return;

      const updateBatteryInfo = () => {
        const info: BatteryInfo = {
          level: battery.level * 100,
          isCharging: battery.charging,
          isLowPower: battery.level < 0.2 && !battery.charging,
        };
        this.notifyBatteryChange(info);
      };

      battery.addEventListener('levelchange', updateBatteryInfo);
      battery.addEventListener('chargingchange', updateBatteryInfo);

      // Initial check
      updateBatteryInfo();
    } catch (error) {
      console.warn('[Battery] Browser battery API not available:', error);
    }
  }

  /**
   * Start battery monitoring (Capacitor)
   */
  private async startBatteryMonitoring(): Promise<void> {
    // Check battery every 30 seconds
    this.batteryCheckInterval = setInterval(async () => {
      const info = await this.getBatteryInfo();
      if (info) {
        this.notifyBatteryChange(info);
        
        // Auto-enable battery saving at 20%
        if (info.level <= 20 && !info.isCharging) {
          const current = localStorage.getItem('battery_mode');
          if (current !== 'saving') {
            console.log('[Battery] Auto-enabling battery saver at 20%');
            this.enableBatterySaving();
          }
        }
      }
    }, 30000);

    // Initial check
    const info = await this.getBatteryInfo();
    if (info) {
      this.notifyBatteryChange(info);
    }
  }

  /**
   * Get current battery info
   */
  async getBatteryInfo(): Promise<BatteryInfo | null> {
    try {
      if (!this.isNative) {
        const battery = await this.getBrowserBattery();
        if (battery) {
          return {
            level: battery.level * 100,
            isCharging: battery.charging,
            isLowPower: battery.level < 0.2 && !battery.charging,
          };
        }
        return null;
      }

      // Capacitor - use Device plugin
      // Note: Requires @capacitor/device package
      // For now, return mock data as fallback
      return {
        level: 100,
        isCharging: false,
        isLowPower: false,
      };
    } catch (error) {
      console.warn('[Battery] Failed to get battery info:', error);
      return null;
    }
  }

  /**
   * Subscribe to battery changes
   */
  onBatteryChange(callback: (info: BatteryInfo) => void): () => void {
    this.callbacks.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.callbacks.delete(callback);
    };
  }

  /**
   * Notify all subscribers of battery change
   */
  private notifyBatteryChange(info: BatteryInfo): void {
    this.callbacks.forEach(callback => {
      try {
        callback(info);
      } catch (error) {
        console.error('[Battery] Callback error:', error);
      }
    });
  }

  /**
   * Enable battery saving mode
   */
  enableBatterySaving(): void {
    console.log('[Battery] Enabling battery saving mode');
    this.currentSettings = this.getBatterySavingSettings();
    localStorage.setItem('battery_mode', 'saving');
    this.notifySettingsChange();
  }

  /**
   * Disable battery saving mode
   */
  disableBatterySaving(): void {
    console.log('[Battery] Disabling battery saving mode');
    this.currentSettings = this.getDefaultSettings();
    localStorage.setItem('battery_mode', 'normal');
    this.notifySettingsChange();
  }

  /**
   * Check if battery saving is enabled
   */
  isBatterySavingEnabled(): boolean {
    return localStorage.getItem('battery_mode') === 'saving';
  }

  /**
   * Get current optimization settings
   */
  getSettings(): OptimizationSettings {
    return { ...this.currentSettings };
  }

  /**
   * Update specific settings
   */
  updateSettings(updates: Partial<OptimizationSettings>): void {
    this.currentSettings = { ...this.currentSettings, ...updates };
    this.notifySettingsChange();
  }

  /**
   * Notify settings change (could be used to update GPS intervals, etc.)
   */
  private notifySettingsChange(): void {
    window.dispatchEvent(new CustomEvent('battery-settings-changed', {
      detail: this.currentSettings
    }));
  }

  /**
   * Get recommendations based on battery level
   */
  async getRecommendations(): Promise<string[]> {
    const info = await this.getBatteryInfo();
    if (!info) return [];

    const recommendations: string[] = [];

    if (info.level < 20 && !info.isCharging) {
      recommendations.push('Battery critically low - enable battery saver mode');
      recommendations.push('Reduce GPS polling frequency');
      recommendations.push('Disable real-time sync (queue for later)');
    } else if (info.level < 40 && !info.isCharging) {
      recommendations.push('Battery running low - consider battery saver mode');
      recommendations.push('Reduce map updates');
    }

    if (!info.isCharging && this.currentSettings.enableBackgroundTracking) {
      recommendations.push('Disable background tracking to save battery');
    }

    return recommendations;
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    if (this.batteryCheckInterval) {
      clearInterval(this.batteryCheckInterval);
      this.batteryCheckInterval = null;
    }
    this.callbacks.clear();
  }
}

export const batteryOptimization = new BatteryOptimizationService();

// Auto-initialize
if (typeof window !== 'undefined') {
  batteryOptimization.initialize().catch(error => {
    console.warn('[Battery] Initialization failed:', error);
  });
}
