/**
 * GPS Device Persistence Service
 * Manages GPS device configurations in Firestore with automatic sync
 */

import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  query,
  where,
  orderBy,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { GpsDevice, GpsPosition } from '../types';

// Local storage key for cached devices
const LOCAL_STORAGE_KEY = 'gps_devices_cache';

class GpsDevicePersistenceService {
  /**
   * Load devices from local storage cache
   */
  private loadFromLocalStorage(userId: string): GpsDevice[] {
    try {
      const cached = localStorage.getItem(`${LOCAL_STORAGE_KEY}_${userId}`);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn('[GPSDevicePersistence] Error loading from local storage:', error);
    }
    return [];
  }

  /**
   * Save devices to local storage cache
   */
  private saveToLocalStorage(userId: string, devices: GpsDevice[]): void {
    try {
      localStorage.setItem(`${LOCAL_STORAGE_KEY}_${userId}`, JSON.stringify(devices));
    } catch (error) {
      console.warn('[GPSDevicePersistence] Error saving to local storage:', error);
    }
  }

  /**
   * Get all GPS devices for a user
   */
  async getUserDevices(userId: string): Promise<GpsDevice[]> {
    try {
      const devicesRef = collection(db, `users/${userId}/gps_devices`);
      const q = query(devicesRef, orderBy('created_at', 'desc'));
      const snapshot = await getDocs(q);
      
      const devices = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as GpsDevice[];

      // Cache to local storage
      this.saveToLocalStorage(userId, devices);
      
      return devices;
    } catch (error) {
      console.error('[GPSDevicePersistence] Error loading devices from Firestore, using local cache:', error);
      // Fallback to local storage
      return this.loadFromLocalStorage(userId);
    }
  }

  /**
   * Get a specific device by ID
   */
  async getDevice(userId: string, deviceId: string): Promise<GpsDevice | null> {
    try {
      const deviceRef = doc(db, `users/${userId}/gps_devices/${deviceId}`);
      const deviceSnap = await getDoc(deviceRef);
      
      if (!deviceSnap.exists()) {
        return null;
      }
      
      return {
        id: deviceSnap.id,
        ...deviceSnap.data(),
      } as GpsDevice;
    } catch (error) {
      console.error('[GPSDevicePersistence] Error loading device:', error);
      return null;
    }
  }

  /**
   * Save a new GPS device
   */
  async saveDevice(userId: string, device: Partial<GpsDevice>): Promise<string> {
    const deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const deviceData: GpsDevice = {
      ...device,
      id: deviceId,
      user_id: userId,
      created_at: device.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      connection_state: device.connection_state || 'disconnected',
      connection_attempts: 0,
      total_connections: 0,
      total_uptime_seconds: 0,
    } as GpsDevice;

    try {
      const devicesRef = collection(db, `users/${userId}/gps_devices`);
      const docRef = await addDoc(devicesRef, deviceData);
      console.log('[GPSDevicePersistence] Device saved to Firestore:', docRef.id);
      
      // Update device with Firestore ID
      deviceData.id = docRef.id;
      
      // Save to local cache
      const cached = this.loadFromLocalStorage(userId);
      cached.unshift(deviceData);
      this.saveToLocalStorage(userId, cached);
      
      return docRef.id;
    } catch (error) {
      console.error('[GPSDevicePersistence] Error saving to Firestore, saving locally:', error);
      
      // Save to local storage as fallback
      const cached = this.loadFromLocalStorage(userId);
      cached.unshift(deviceData);
      this.saveToLocalStorage(userId, cached);
      
      return deviceId;
    }
  }

  /**
   * Update an existing GPS device
   */
  async updateDevice(userId: string, deviceId: string, updates: Partial<GpsDevice>): Promise<void> {
    try {
      const deviceRef = doc(db, `users/${userId}/gps_devices/${deviceId}`);
      
      const updateData = {
        ...updates,
        updated_at: new Date().toISOString(),
      };

      await updateDoc(deviceRef, updateData);
      console.log('[GPSDevicePersistence] Device updated:', deviceId);
    } catch (error) {
      console.error('[GPSDevicePersistence] Error updating device:', error);
      throw error;
    }
  }

  /**
   * Delete a GPS device
   */
  async deleteDevice(userId: string, deviceId: string): Promise<void> {
    try {
      const deviceRef = doc(db, `users/${userId}/gps_devices/${deviceId}`);
      await deleteDoc(deviceRef);
      console.log('[GPSDevicePersistence] Device deleted:', deviceId);
    } catch (error) {
      console.error('[GPSDevicePersistence] Error deleting device:', error);
      throw error;
    }
  }

  /**
   * Update device connection state
   */
  async updateConnectionState(
    userId: string, 
    deviceId: string, 
    state: GpsDevice['connection_state'],
    errorMessage?: string
  ): Promise<void> {
    try {
      const updates: Partial<GpsDevice> = {
        connection_state: state,
        updated_at: new Date().toISOString(),
      };

      if (state === 'connected') {
        updates.last_connected = new Date().toISOString();
        updates.connection_attempts = 0;
        updates.total_connections = ((await this.getDevice(userId, deviceId))?.total_connections || 0) + 1;
      } else if (state === 'error') {
        updates.last_error = errorMessage;
        updates.connection_attempts = ((await this.getDevice(userId, deviceId))?.connection_attempts || 0) + 1;
      }

      await this.updateDevice(userId, deviceId, updates);
    } catch (error) {
      console.error('[GPSDevicePersistence] Error updating connection state:', error);
    }
  }

  /**
   * Update device position (for statistics)
   */
  async updateDevicePosition(userId: string, deviceId: string, position: GpsPosition): Promise<void> {
    try {
      const updates: Partial<GpsDevice> = {
        last_position: position,
        updated_at: new Date().toISOString(),
      };

      // Update average accuracy (rolling average)
      const device = await this.getDevice(userId, deviceId);
      if (device) {
        const currentAvg = device.average_accuracy_m || 0;
        const newAvg = currentAvg === 0 
          ? position.accuracy 
          : (currentAvg * 0.9 + position.accuracy * 0.1); // Exponential moving average
        updates.average_accuracy_m = newAvg;
      }

      await this.updateDevice(userId, deviceId, updates);
    } catch (error) {
      // Silently fail position updates to avoid spamming logs
      console.debug('[GPSDevicePersistence] Position update skipped:', error);
    }
  }

  /**
   * Mark device as favorite
   */
  async setFavorite(userId: string, deviceId: string, isFavorite: boolean): Promise<void> {
    try {
      await this.updateDevice(userId, deviceId, { is_favorite: isFavorite });
    } catch (error) {
      console.error('[GPSDevicePersistence] Error setting favorite:', error);
      throw error;
    }
  }

  /**
   * Get favorite devices
   */
  async getFavoriteDevices(userId: string): Promise<GpsDevice[]> {
    try {
      const devicesRef = collection(db, `users/${userId}/gps_devices`);
      const q = query(
        devicesRef, 
        where('is_favorite', '==', true),
        orderBy('priority', 'asc')
      );
      const snapshot = await getDocs(q);
      
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as GpsDevice[];
    } catch (error) {
      console.error('[GPSDevicePersistence] Error loading favorites:', error);
      return [];
    }
  }

  /**
   * Get devices for tracking (use_for_tracking = true)
   */
  async getTrackingDevices(userId: string): Promise<GpsDevice[]> {
    try {
      const devicesRef = collection(db, `users/${userId}/gps_devices`);
      const q = query(
        devicesRef, 
        where('use_for_tracking', '==', true),
        orderBy('priority', 'asc')
      );
      const snapshot = await getDocs(q);
      
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as GpsDevice[];
    } catch (error) {
      console.error('[GPSDevicePersistence] Error loading tracking devices:', error);
      return [];
    }
  }

  /**
   * Increment device uptime
   */
  async incrementUptime(userId: string, deviceId: string, seconds: number): Promise<void> {
    try {
      const device = await this.getDevice(userId, deviceId);
      if (device) {
        const newUptime = (device.total_uptime_seconds || 0) + seconds;
        await this.updateDevice(userId, deviceId, { 
          total_uptime_seconds: newUptime 
        });
      }
    } catch (error) {
      console.debug('[GPSDevicePersistence] Uptime update skipped:', error);
    }
  }

  /**
   * Bulk delete devices
   */
  async bulkDeleteDevices(userId: string, deviceIds: string[]): Promise<void> {
    try {
      const batch = writeBatch(db);
      
      deviceIds.forEach(deviceId => {
        const deviceRef = doc(db, `users/${userId}/gps_devices/${deviceId}`);
        batch.delete(deviceRef);
      });

      await batch.commit();
      console.log('[GPSDevicePersistence] Bulk deleted devices:', deviceIds.length);
    } catch (error) {
      console.error('[GPSDevicePersistence] Error bulk deleting devices:', error);
      throw error;
    }
  }

  /**
   * Clone a device configuration
   */
  async cloneDevice(userId: string, deviceId: string, newName: string): Promise<string> {
    try {
      const device = await this.getDevice(userId, deviceId);
      if (!device) {
        throw new Error('Device not found');
      }

      const clonedDevice: Partial<GpsDevice> = {
        ...device,
        id: undefined,
        name: newName,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        connection_state: 'disconnected',
        last_connected: undefined,
        last_error: undefined,
        connection_attempts: 0,
        total_connections: 0,
        total_uptime_seconds: 0,
      };

      return await this.saveDevice(userId, clonedDevice);
    } catch (error) {
      console.error('[GPSDevicePersistence] Error cloning device:', error);
      throw error;
    }
  }
}

export const gpsDevicePersistence = new GpsDevicePersistenceService();
