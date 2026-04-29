/**
 * Haptic Feedback Utility
 * Provides vibration feedback for user interactions (Android tablets)
 */

import { Capacitor } from '@capacitor/core';

type HapticType = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

interface HapticOptions {
  type?: HapticType;
  duration?: number; // milliseconds
}

class HapticService {
  private isNative = Capacitor.isNativePlatform();
  private isEnabled = true;

  /**
   * Check if haptics are supported
   */
  isSupported(): boolean {
    if (!this.isNative) {
      return 'vibrate' in navigator;
    }
    return true;
  }

  /**
   * Enable/disable haptic feedback
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    localStorage.setItem('haptic_enabled', String(enabled));
  }

  /**
   * Check if haptics are enabled
   */
  getEnabled(): boolean {
    const stored = localStorage.getItem('haptic_enabled');
    return stored !== null ? stored === 'true' : true;
  }

  /**
   * Trigger haptic feedback
   */
  async trigger(options: HapticOptions = {}): Promise<void> {
    if (!this.isEnabled || !this.getEnabled()) return;
    if (!this.isSupported()) return;

    const { type = 'light', duration } = options;

    try {
      if (this.isNative) {
        // Use Capacitor Haptics on native platforms
        const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
        
        switch (type) {
          case 'light':
            await Haptics.impact({ style: ImpactStyle.Light });
            break;
          case 'medium':
            await Haptics.impact({ style: ImpactStyle.Medium });
            break;
          case 'heavy':
            await Haptics.impact({ style: ImpactStyle.Heavy });
            break;
          case 'success':
            await Haptics.notification({ type: NotificationType.Success });
            break;
          case 'warning':
            await Haptics.notification({ type: NotificationType.Warning });
            break;
          case 'error':
            await Haptics.notification({ type: NotificationType.Error });
            break;
        }
      } else {
        // Fallback to Web Vibration API
        if ('vibrate' in navigator) {
          const pattern = this.getVibrationPattern(type, duration);
          navigator.vibrate(pattern);
        }
      }
    } catch (error) {
      console.warn('[Haptic] Failed to trigger feedback:', error);
    }
  }

  /**
   * Get vibration pattern for web
   */
  private getVibrationPattern(type: HapticType, customDuration?: number): number | number[] {
    if (customDuration) return customDuration;

    switch (type) {
      case 'light':
        return 10;
      case 'medium':
        return 20;
      case 'heavy':
        return 40;
      case 'success':
        return [20, 50, 20];
      case 'warning':
        return [30, 100, 30];
      case 'error':
        return [40, 50, 40, 50, 40];
      default:
        return 15;
    }
  }

  /**
   * Predefined haptic feedback for common actions
   */
  async buttonPress(): Promise<void> {
    await this.trigger({ type: 'light' });
  }

  async sampleRecorded(): Promise<void> {
    await this.trigger({ type: 'success' });
  }

  async trackStarted(): Promise<void> {
    await this.trigger({ type: 'medium' });
  }

  async trackStopped(): Promise<void> {
    await this.trigger({ type: 'heavy' });
  }

  async error(): Promise<void> {
    await this.trigger({ type: 'error' });
  }

  async warning(): Promise<void> {
    await this.trigger({ type: 'warning' });
  }

  async navigationTurn(): Promise<void> {
    await this.trigger({ type: 'medium' });
  }

  async boundaryEntered(): Promise<void> {
    await this.trigger({ type: 'success' });
  }

  async boundaryExited(): Promise<void> {
    await this.trigger({ type: 'warning' });
  }

  async deviceConnected(): Promise<void> {
    await this.trigger({ type: 'success' });
  }

  async deviceDisconnected(): Promise<void> {
    await this.trigger({ type: 'error' });
  }

  /**
   * Custom vibration pattern
   */
  async custom(pattern: number | number[]): Promise<void> {
    if (!this.isEnabled || !this.getEnabled()) return;
    
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate(pattern);
      }
    } catch (error) {
      console.warn('[Haptic] Custom vibration failed:', error);
    }
  }
}

export const haptics = new HapticService();
