/**
 * Secure Storage Utility
 * 
 * - Android/iOS: Uses Capacitor Preferences (encrypted storage)
 * - Web/PC: Uses IndexedDB (better than localStorage)
 * 
 * NEVER stores plaintext passwords - only secure offline tokens
 */

import { Preferences } from '@capacitor/preferences';
import { isCapacitorApp } from './platform';
import { indexedDBService } from '../services/indexedDBService';

interface OfflineAuthToken {
  uid: string;
  email: string;
  token: string; // Signed JWT-like token
  expiresAt: number; // Timestamp
  installId: string; // Unique per-install identifier
}

class SecureStorageService {
  private installId: string | null = null;
  private readonly TOKEN_EXPIRY_DAYS = 30; // Offline token valid for 30 days

  constructor() {
    this.initInstallId();
  }

  /**
   * Generate or retrieve unique per-install ID
   * Used to sign offline tokens
   */
  private async initInstallId() {
    try {
      if (isCapacitorApp()) {
        const result = await Preferences.get({ key: 'install_id' });
        if (result.value) {
          this.installId = result.value;
        } else {
          this.installId = this.generateInstallId();
          await Preferences.set({ key: 'install_id', value: this.installId });
        }
      } else {
        // Web: use IndexedDB
        let installId = await indexedDBService.get('secure_install_id');
        if (!installId) {
          installId = this.generateInstallId();
          await indexedDBService.set('secure_install_id', installId);
        }
        this.installId = installId;
      }
    } catch (error) {
      console.error('⚠️ Failed to init install ID:', error);
      // Fallback to session-based ID
      this.installId = this.generateInstallId();
    }
  }

  private generateInstallId(): string {
    return `install_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Create a signed offline auth token (NOT storing password)
   * Token = base64(uid:email:timestamp:signature)
   */
  private async createOfflineToken(uid: string, email: string): Promise<string> {
    const expiresAt = Date.now() + (this.TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const installId = this.installId || this.generateInstallId();
    
    // Simple signature: hash of combined values with install secret
    const payload = `${uid}:${email}:${expiresAt}:${installId}`;
    const signature = await this.simpleHash(payload);
    
    const token = btoa(payload + ':' + signature);
    return token;
  }

  /**
   * Verify offline token
   */
  private async verifyOfflineToken(token: string, uid: string, email: string): Promise<boolean> {
    try {
      const decoded = atob(token);
      const parts = decoded.split(':');
      
      if (parts.length !== 5) return false;
      
      const [tokenUid, tokenEmail, expiresAtStr, tokenInstallId, signature] = parts;
      
      // Check expiry
      const expiresAt = parseInt(expiresAtStr);
      if (Date.now() > expiresAt) {
        console.log('🔐 Offline token expired');
        return false;
      }
      
      // Check uid and email match
      if (tokenUid !== uid || tokenEmail !== email) {
        console.log('🔐 Token credentials mismatch');
        return false;
      }
      
      // Check install ID matches
      if (tokenInstallId !== this.installId) {
        console.log('🔐 Token install ID mismatch (different device or reinstall)');
        return false;
      }
      
      // Verify signature
      const payload = `${tokenUid}:${tokenEmail}:${expiresAtStr}:${tokenInstallId}`;
      const expectedSignature = await this.simpleHash(payload);
      
      if (signature !== expectedSignature) {
        console.log('🔐 Token signature invalid');
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('🔐 Token verification error:', error);
      return false;
    }
  }

  /**
   * Simple hash function for token signing
   * Uses Web Crypto API for better security
   */
  private async simpleHash(message: string): Promise<string> {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(message);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (error) {
      // Fallback for environments without crypto.subtle
      let hash = 0;
      for (let i = 0; i < message.length; i++) {
        const char = message.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return Math.abs(hash).toString(36);
    }
  }

  /**
   * Store offline auth credentials (NO PASSWORD)
   * Only stores uid, email, and signed token
   */
  async storeOfflineAuth(uid: string, email: string): Promise<void> {
    try {
      const token = await this.createOfflineToken(uid, email);
      const authData: OfflineAuthToken = {
        uid,
        email,
        token,
        expiresAt: Date.now() + (this.TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
        installId: this.installId || ''
      };

      if (isCapacitorApp()) {
        await Preferences.set({
          key: 'offline_auth',
          value: JSON.stringify(authData)
        });
      } else {
        await indexedDBService.set('secure_offline_auth', authData);
      }

      console.log('🔐 Offline auth token stored (valid for', this.TOKEN_EXPIRY_DAYS, 'days)');
    } catch (error) {
      console.error('⚠️ Failed to store offline auth:', error);
    }
  }

  /**
   * Get offline auth credentials
   */
  async getOfflineAuth(): Promise<OfflineAuthToken | null> {
    try {
      let authData: OfflineAuthToken | null = null;

      if (isCapacitorApp()) {
        const result = await Preferences.get({ key: 'offline_auth' });
        if (result.value) {
          authData = JSON.parse(result.value);
        }
      } else {
        authData = await indexedDBService.get('secure_offline_auth');
      }

      if (!authData) {
        console.log('🔐 No offline auth found');
        return null;
      }

      // Verify token is still valid
      const isValid = await this.verifyOfflineToken(
        authData.token,
        authData.uid,
        authData.email
      );

      if (!isValid) {
        console.log('🔐 Offline token invalid, removing');
        await this.removeOfflineAuth();
        return null;
      }

      console.log('🔐 Valid offline auth found for:', authData.email);
      return authData;
    } catch (error) {
      console.error('⚠️ Failed to get offline auth:', error);
      return null;
    }
  }

  /**
   * Remove offline auth credentials
   */
  async removeOfflineAuth(): Promise<void> {
    try {
      if (isCapacitorApp()) {
        await Preferences.remove({ key: 'offline_auth' });
      } else {
        await indexedDBService.delete('secure_offline_auth');
      }
      console.log('🔐 Offline auth removed');
    } catch (error) {
      console.error('⚠️ Failed to remove offline auth:', error);
    }
  }

  /**
   * Clear all secure storage (on logout)
   */
  async clearAll(): Promise<void> {
    try {
      await this.removeOfflineAuth();
      // Don't remove install_id - it persists across logins
      console.log('🔐 Secure storage cleared');
    } catch (error) {
      console.error('⚠️ Failed to clear secure storage:', error);
    }
  }

  /**
   * MIGRATION: Remove old insecure localStorage items
   */
  async migrateFromLocalStorage(): Promise<void> {
    try {
      const lastUid = localStorage.getItem('lastKnownUid');
      const lastEmail = localStorage.getItem('lastKnownEmail');
      
      if (lastUid && lastEmail) {
        // Create new secure token (without password!)
        await this.storeOfflineAuth(lastUid, lastEmail);
      }
      
      // CRITICAL: Remove plaintext password (security vulnerability)
      localStorage.removeItem('lastKnownPassword');
      
      // Keep uid/email for now (they're not sensitive)
      // Will be phased out as users login with new system
    } catch (error) {
      console.error('⚠️ Migration failed:', error);
    }
  }
}

export const secureStorage = new SecureStorageService();
