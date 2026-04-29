import { WebPlugin } from '@capacitor/core';
import type { GpsDeviceManagerPlugin, GpsDevice, GpsPosition } from './index';

/**
 * Web implementation - fallback for web browsers
 * Uses existing Web Bluetooth API and fetch for basic functionality
 */
export class GpsDeviceManagerWeb extends WebPlugin implements GpsDeviceManagerPlugin {
  async scanDevices(): Promise<{ devices: GpsDevice[] }> {
    console.log('GPS Device scanning is limited on web - using Web Bluetooth API');
    // Fallback to existing Web Bluetooth implementation
    return { devices: [] };
  }

  async getPairedBluetoothDevices(): Promise<{ devices: GpsDevice[] }> {
    console.log('Paired Bluetooth devices are only available on Android');
    return { devices: [] };
  }

  async connectDevice(): Promise<{ device: GpsDevice }> {
    throw new Error('GPS Device connection requires native Android app - use web fallback methods');
  }

  async disconnectDevice(): Promise<void> {
    console.log('GPS Device disconnect is not available on web');
  }

  async getCurrentPosition(): Promise<{ position: GpsPosition | null }> {
    return { position: null };
  }

  async startPositionStream(): Promise<void> {
    console.log('GPS Position streaming requires native Android app');
  }

  async stopPositionStream(): Promise<void> {
    console.log('GPS Position streaming requires native Android app');
  }

  async getStatus(): Promise<{ isConnected: boolean; connectedDevice?: GpsDevice; isStreaming: boolean }> {
    return { isConnected: false, isStreaming: false };
  }
}
