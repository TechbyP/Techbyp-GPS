/**
 * Conflict Resolution Strategy for Hybrid Database
 * Handles conflicts between offline edits and server changes
 */

export type ConflictResolution = 'client-wins' | 'server-wins' | 'merge' | 'prompt-user';

export interface DataVersion {
  version: number;
  timestamp: number;
  checksum: string;
}

export interface ConflictData<T = any> {
  id: string;
  clientVersion: T & DataVersion;
  serverVersion: T & DataVersion;
  baseVersion?: T & DataVersion; // Last known common version
}

export interface ConflictResolutionResult<T = any> {
  resolved: T;
  strategy: ConflictResolution;
  metadata?: {
    mergedFields?: string[];
    conflicts?: string[];
  };
}

/**
 * Conflict resolver for hybrid database operations
 * Uses Last-Write-Wins (LWW) strategy with optional manual resolution
 */
export class ConflictResolver {
  private strategy: ConflictResolution;

  constructor(defaultStrategy: ConflictResolution = 'server-wins') {
    this.strategy = defaultStrategy;
  }

  /**
   * Resolve conflict between client and server versions
   */
  resolve<T extends Record<string, any>>(
    conflict: ConflictData<T>,
    customStrategy?: ConflictResolution
  ): ConflictResolutionResult<T> {
    const strategy = customStrategy || this.strategy;

    switch (strategy) {
      case 'client-wins':
        return this.resolveClientWins(conflict);
      
      case 'server-wins':
        return this.resolveServerWins(conflict);
      
      case 'merge':
        return this.resolveMerge(conflict);
      
      case 'prompt-user':
        // This should be handled by UI layer
        throw new Error('User prompt required - handle in UI');
      
      default:
        // Fallback to server-wins
        return this.resolveServerWins(conflict);
    }
  }

  /**
   * Client version takes precedence
   */
  private resolveClientWins<T>(conflict: ConflictData<T>): ConflictResolutionResult<T> {
    return {
      resolved: conflict.clientVersion,
      strategy: 'client-wins'
    };
  }

  /**
   * Server version takes precedence (safest default)
   */
  private resolveServerWins<T>(conflict: ConflictData<T>): ConflictResolutionResult<T> {
    return {
      resolved: conflict.serverVersion,
      strategy: 'server-wins'
    };
  }

  /**
   * Attempt to merge both versions
   * Uses Last-Write-Wins for each field
   */
  private resolveMerge<T extends Record<string, any>>(
    conflict: ConflictData<T>
  ): ConflictResolutionResult<T> {
    const { clientVersion, serverVersion, baseVersion } = conflict;
    const merged: any = { ...serverVersion }; // Start with server
    const mergedFields: string[] = [];
    const conflicts: string[] = [];

    // For each field in client version
    for (const key in clientVersion) {
      if (key === 'version' || key === 'timestamp' || key === 'checksum') {
        continue; // Skip metadata fields
      }

      const clientValue = clientVersion[key];
      const serverValue = serverVersion[key];
      const baseValue = baseVersion?.[key];

      // Client changed but server didn't - use client
      if (clientValue !== baseValue && serverValue === baseValue) {
        merged[key] = clientValue;
        mergedFields.push(key);
      }
      // Both changed differently - use timestamp to decide
      else if (clientValue !== serverValue && clientValue !== baseValue && serverValue !== baseValue) {
        // Last-Write-Wins: compare timestamps
        if (clientVersion.timestamp > serverVersion.timestamp) {
          merged[key] = clientValue;
          mergedFields.push(key);
        }
        conflicts.push(key);
      }
      // Server changed but client didn't - already in merged (server base)
    }

    // Update metadata
    merged.version = Math.max(clientVersion.version, serverVersion.version) + 1;
    merged.timestamp = Date.now();
    merged.checksum = this.calculateChecksum(merged);

    return {
      resolved: merged,
      strategy: 'merge',
      metadata: {
        mergedFields,
        conflicts
      }
    };
  }

  /**
   * Check if two versions conflict
   */
  hasConflict<T extends Record<string, any>>(
    clientVersion: T & DataVersion,
    serverVersion: T & DataVersion
  ): boolean {
    // No conflict if versions match
    if (clientVersion.version === serverVersion.version) {
      return false;
    }

    // No conflict if checksums match (same data)
    if (clientVersion.checksum === serverVersion.checksum) {
      return false;
    }

    // Check if any fields actually differ
    for (const key in clientVersion) {
      if (key === 'version' || key === 'timestamp' || key === 'checksum') {
        continue;
      }
      
      if (clientVersion[key] !== serverVersion[key]) {
        return true; // Found a difference
      }
    }

    return false;
  }

  /**
   * Calculate checksum for data consistency check
   */
  private calculateChecksum(data: any): string {
    const str = JSON.stringify(data, Object.keys(data).sort());
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Add version metadata to data
   */
  static addVersionMetadata<T extends Record<string, any>>(
    data: T,
    version: number = 1
  ): T & DataVersion {
    const resolver = new ConflictResolver();
    return {
      ...data,
      version,
      timestamp: Date.now(),
      checksum: resolver.calculateChecksum(data)
    };
  }

  /**
   * Check if data has version metadata
   */
  static hasVersionMetadata(data: any): data is any & DataVersion {
    return (
      typeof data === 'object' &&
      data !== null &&
      'version' in data &&
      'timestamp' in data &&
      'checksum' in data
    );
  }
}

/**
 * Default conflict resolver instance
 * Uses server-wins strategy as safest default
 */
export const conflictResolver = new ConflictResolver('server-wins');
