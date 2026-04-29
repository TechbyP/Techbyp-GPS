/**
 * SQLite Connection Pool
 * Manages a pool of SQLite connections to prevent conflicts and crashes
 */

import { SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';

interface PooledConnection {
  connection: SQLiteDBConnection;
  inUse: boolean;
  lastUsed: number;
}

export class SQLiteConnectionPool {
  private connections: Map<string, PooledConnection> = new Map();
  private waitQueue: Array<{
    resolve: (conn: SQLiteDBConnection) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = [];
  private creatingConnection = false;
  
  private maxConnections = 3; // Conservative limit for mobile
  private connectionTimeout = 10000; // 10 seconds
  private idleTimeout = 30000; // 30 seconds before closing idle connection
  
  constructor(
    private sqlite: SQLiteConnection,
    private dbName: string,
    private encrypted = false,
    private mode = 'no-encryption',
    private version = 1
  ) {}

  /**
   * Acquire a connection from the pool
   */
  async acquire(): Promise<SQLiteDBConnection> {
    // Try to find an available connection
    for (const [id, pooled] of this.connections.entries()) {
      if (!pooled.inUse) {
        pooled.inUse = true;
        pooled.lastUsed = Date.now();
        console.log(`♻️ Reusing connection ${id}`);
        return pooled.connection;
      }
    }

    // Create new connection if under limit and no other creation is in-flight
    if (this.connections.size < this.maxConnections && !this.creatingConnection) {
      try {
        this.creatingConnection = true;
        const conn = await this.createConnection();
        const id = this.generateConnectionId();
        
        this.connections.set(id, {
          connection: conn,
          inUse: true,
          lastUsed: Date.now()
        });
        
        console.log(`✅ Created new connection ${id} (${this.connections.size}/${this.maxConnections})`);
        return conn;
      } catch (error) {
        console.error('❌ Failed to create connection:', error);
        throw error;
      } finally {
        this.creatingConnection = false;
      }
    }

    // Pool is full or a connection is already being created, wait for availability
    console.log('⏳ Connection pool busy, waiting for an available connection...');
    return this.waitForConnection();
  }

  /**
   * Release a connection back to the pool
   */
  release(connection: SQLiteDBConnection): void {
    for (const [id, pooled] of this.connections.entries()) {
      if (pooled.connection === connection) {
        pooled.inUse = false;
        pooled.lastUsed = Date.now();
        console.log(`✅ Released connection ${id}`);
        
        // If someone is waiting, give them this connection
        if (this.waitQueue.length > 0) {
          const waiter = this.waitQueue.shift();
          if (waiter) {
            clearTimeout(waiter.timeout);
            pooled.inUse = true;
            waiter.resolve(connection);
            console.log(`🔄 Handed connection to waiting request`);
          }
        }
        return;
      }
    }
    
    console.warn('⚠️ Attempted to release unknown connection');
  }

  /**
   * Execute a query with automatic connection management
   * Handles connection acquisition and release automatically
   */
  async execute<T>(operation: (conn: SQLiteDBConnection) => Promise<T>): Promise<T> {
    const conn = await this.acquire();
    try {
      return await operation(conn);
    } finally {
      this.release(conn);
    }
  }

  /**
   * Close all connections and clean up
   */
  async closeAll(): Promise<void> {
    console.log(`🔒 Closing all ${this.connections.size} connections...`);
    
    // Cancel all waiting requests
    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error('Connection pool is closing'));
    }
    this.waitQueue = [];

    // Close all connections
    const closePromises: Promise<void>[] = [];
    for (const [id, pooled] of this.connections.entries()) {
      closePromises.push(
        pooled.connection.close()
          .then(() => console.log(`✅ Closed connection ${id}`))
          .catch(err => console.error(`❌ Failed to close connection ${id}:`, err))
      );
    }
    
    await Promise.allSettled(closePromises);
    this.connections.clear();
    console.log('✅ All connections closed');
  }

  /**
   * Clean up idle connections
   */
  async cleanupIdleConnections(): Promise<void> {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, pooled] of this.connections.entries()) {
      if (!pooled.inUse && (now - pooled.lastUsed) > this.idleTimeout) {
        toRemove.push(id);
      }
    }

    if (toRemove.length > 0) {
      console.log(`🧹 Cleaning up ${toRemove.length} idle connections`);
      
      for (const id of toRemove) {
        const pooled = this.connections.get(id);
        if (pooled) {
          try {
            await pooled.connection.close();
            this.connections.delete(id);
            console.log(`✅ Closed idle connection ${id}`);
          } catch (error) {
            console.error(`❌ Failed to close idle connection ${id}:`, error);
          }
        }
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    total: number;
    inUse: number;
    available: number;
    waiting: number;
  } {
    let inUse = 0;
    for (const pooled of this.connections.values()) {
      if (pooled.inUse) inUse++;
    }

    return {
      total: this.connections.size,
      inUse,
      available: this.connections.size - inUse,
      waiting: this.waitQueue.length
    };
  }

  // Private methods

  private async createConnection(): Promise<SQLiteDBConnection> {
    try {
      console.log('[Pool] Creating/retrieving connection for:', this.dbName);
      
      // First, check if a connection already exists and try to retrieve it
      const existing = await this.sqlite.isConnection(this.dbName, false);
      if (existing.result) {
        console.log('[Pool] Connection already exists, retrieving it');
        try {
          const conn = await this.sqlite.retrieveConnection(this.dbName, false);
          // Make sure it's open and wait for stability (increased to 2s)
          await conn.open();
          console.log('[Pool] Waiting 2 seconds for retrieved connection to stabilize...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          console.log('[Pool] ✅ Retrieved connection ready');
          return conn;
        } catch (retrieveError: any) {
          console.warn('[Pool] Failed to retrieve existing connection:', retrieveError?.message);
          // If retrieve fails, try to close and create fresh
          try {
            await this.sqlite.closeConnection(this.dbName, true);
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (closeErr) {
            console.warn('[Pool] Close failed (continuing anyway):', closeErr);
          }
        }
      }
      
      // Create new connection
      console.log('[Pool] Creating new connection...');
      const conn = await this.sqlite.createConnection(
        this.dbName,
        this.encrypted,
        this.mode,
        this.version,
        false // readonly = false
      );
      
      // Open the connection
      await conn.open();
      console.log('[Pool] Connection opened, waiting for stability...');
      
      // CRITICAL FIX: Wait for connection to fully stabilize on Android
      // Android SQLite needs significant time before transactions work
      // Increased from 1s to 3s to ensure readiness
      console.log('[Pool] Waiting 3 seconds for Android SQLite to stabilize...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      console.log('[Pool] ✅ Connection ready');
      
      return conn;
    } catch (createError: any) {
      console.error('[Pool] ❌ Failed to create/open connection:', createError?.message || createError);
      throw new Error(`Failed to create database connection: ${createError?.message || createError}`);
    }
  }

  private waitForConnection(): Promise<SQLiteDBConnection> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Remove from queue
        const index = this.waitQueue.findIndex(w => w.timeout === timeout);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
        }
        reject(new Error(`Connection pool timeout after ${this.connectionTimeout}ms`));
      }, this.connectionTimeout);

      this.waitQueue.push({ resolve, reject, timeout });
    });
  }

  private generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
