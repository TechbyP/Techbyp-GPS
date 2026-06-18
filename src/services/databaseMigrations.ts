/**
 * Database Migration System
 * Handles schema upgrades for local SQLite database
 * 
 * Improvements:
 * - Migration history tracking with metadata
 * - Rollback support for failed migrations
 * - Migration validation
 * - Better error handling
 */

import { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { logger } from './logger';

export const CURRENT_SCHEMA_VERSION = 4;

interface Migration {
  version: number;
  description: string;
  up: (db: SQLiteDBConnection) => Promise<void>;
  down?: (db: SQLiteDBConnection) => Promise<void>; // Rollback support
}

interface MigrationRecord {
  version: number;
  description: string;
  applied_at: string;
  duration_ms: number;
  success: boolean;
  error_message?: string;
}

const migrations: Migration[] = [
  {
    version: 4,
    description: 'Convert numeric timestamps to ISO strings for consistency',
    up: async (db: SQLiteDBConnection) => {
      console.log('[Migration v4] Converting timestamps to ISO strings...');
      
      // Helper to check if column exists before querying
      const columnExists = async (table: string, column: string): Promise<boolean> => {
        try {
          const result = await db.query(`PRAGMA table_info(${table});`);
          if (result.values) {
            return result.values.some((col: any) => col.name === column);
          }
          return false;
        } catch {
          return false;
        }
      };
      
      // Helper to update a table's timestamp columns
      const updateTableTimestamps = async (table: string, columns: string[]) => {
        try {
          // Check if table exists first
          const tableCheck = await db.query(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}';`
          );
          if (!tableCheck.values || tableCheck.values.length === 0) {
            console.log(`[Migration v4] Table ${table} does not exist, skipping`);
            return;
          }
          
          // Filter columns to only those that exist
          const existingColumns: string[] = [];
          for (const col of columns) {
            if (await columnExists(table, col)) {
              existingColumns.push(col);
            }
          }
          
          if (existingColumns.length === 0) {
            console.log(`[Migration v4] No timestamp columns found in ${table}, skipping`);
            return;
          }
          
          const result = await db.query(`SELECT id, ${existingColumns.join(', ')} FROM ${table}`);
          if (!result.values || result.values.length === 0) return;

          for (const row of result.values) {
            const updates: string[] = [];
            const params: any[] = [];
            let needsUpdate = false;

            for (const col of existingColumns) {
              const val = row[col];
              // Check if value is a number (milliseconds)
              if (typeof val === 'number' && val > 1000000000) {
                updates.push(`${col} = ?`);
                params.push(new Date(val).toISOString());
                needsUpdate = true;
              }
            }

            if (needsUpdate) {
              params.push(row.id);
              await db.run(
                `UPDATE ${table} SET ${updates.join(', ')} WHERE id = ?`,
                params
              );
            }
          }
        } catch (e) {
          console.warn(`[Migration v4] Failed to update ${table}:`, e);
        }
      };

      await updateTableTimestamps('projects', ['created_at', 'updated_at']);
      await updateTableTimestamps('tracks', ['started_at', 'stopped_at', 'created_at']);
      await updateTableTimestamps('gps_points', ['timestamp', 'synced_at']);
      await updateTableTimestamps('samples', ['timestamp', 'created_at', 'lab_exported_at']);
      await updateTableTimestamps('field_boundaries', ['created_at']);
      await updateTableTimestamps('devices', ['last_connected', 'created_at', 'updated_at']);
      
      console.log('[Migration v4] Timestamp conversion complete');
    }
  },
  {
    version: 2,
    description: 'Add missing fields to tracks, samples, gps_points, and devices tables',
    up: async (db: SQLiteDBConnection) => {
      console.log('[Migration v2] Starting migration...');
      
      try {
        // Helper to check if column exists
        const columnExists = async (table: string, column: string): Promise<boolean> => {
          try {
            const result = await db.query(`PRAGMA table_info(${table});`);
            if (result.values) {
              return result.values.some((col: any) => col.name === column);
            }
            return false;
          } catch {
            return false;
          }
        };
        
        // Add field_boundary_id to tracks if not exists
        if (!(await columnExists('tracks', 'field_boundary_id'))) {
          await db.execute(`ALTER TABLE tracks ADD COLUMN field_boundary_id TEXT;`);
          console.log('[Migration v2] Added field_boundary_id to tracks');
        }
        
        // Add is_active to tracks if not exists
        if (!(await columnExists('tracks', 'is_active'))) {
          await db.execute(`ALTER TABLE tracks ADD COLUMN is_active INTEGER DEFAULT 0;`);
          console.log('[Migration v2] Added is_active to tracks');
        }
        
        // Add name to samples if not exists
        if (!(await columnExists('samples', 'name'))) {
          await db.execute(`ALTER TABLE samples ADD COLUMN name TEXT;`);
          console.log('[Migration v2] Added name to samples');
        }
        
        // Add synced_at to gps_points if not exists
        if (!(await columnExists('gps_points', 'synced_at'))) {
          await db.execute(`ALTER TABLE gps_points ADD COLUMN synced_at DATETIME;`);
          console.log('[Migration v2] Added synced_at to gps_points');
        }
        
        // For devices table, check if migration is needed
        console.log('[Migration v2] Checking devices table...');
        
        // Check if devices table exists and what columns it has
        const devicesTableInfo = await db.query(`PRAGMA table_info(devices);`).catch(() => ({ values: [] }));
        const hasDeviceType = devicesTableInfo.values?.some((col: any) => col.name === 'device_type');
        const hasOldType = devicesTableInfo.values?.some((col: any) => col.name === 'type');
        
        // Only migrate if table exists and has old 'type' column
        if (hasOldType && !hasDeviceType) {
          console.log('[Migration v2] Migrating devices table from old schema...');
          
          // Create new devices table
          await db.execute(`
            CREATE TABLE IF NOT EXISTS devices_new (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              device_type TEXT NOT NULL,
              connection_type TEXT,
              address TEXT,
              manufacturer TEXT,
              model TEXT,
              capabilities TEXT,
              last_connected DATETIME,
              config TEXT,
              is_active INTEGER DEFAULT 0,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
          `);
          
          // Copy data from old table to new table
          await db.execute(`
            INSERT OR IGNORE INTO devices_new (id, name, device_type, connection_type, address, is_active, created_at)
            SELECT id, name, type, 'bluetooth', COALESCE(address, ''), COALESCE(is_active, 0), COALESCE(created_at, CURRENT_TIMESTAMP) 
            FROM devices;
          `);
          
          // Drop old table and rename new one
          await db.execute('DROP TABLE devices;');
          await db.execute('ALTER TABLE devices_new RENAME TO devices;');
          console.log('[Migration v2] Devices table migrated successfully');
        } else {
          console.log('[Migration v2] Devices table already has correct schema');
        }
        
        console.log('[Migration v2] Migration completed successfully');
      } catch (error) {
        console.error('[Migration v2] Migration failed:', error);
        throw error;
      }
    }
  },
  {
    version: 3,
    description: 'Add compliance metadata columns to samples (depth, horizon, coords, device accuracy, operator)',
    up: async (db: SQLiteDBConnection) => {
      console.log('[Migration v3] Adding compliance columns to samples...');
      
      // Helper to check if column exists
      const columnExists = async (table: string, column: string): Promise<boolean> => {
        try {
          const result = await db.query(`PRAGMA table_info(${table});`);
          if (result.values) {
            return result.values.some((col: any) => col.name === column);
          }
          return false;
        } catch {
          return false;
        }
      };
      
      const columnsToAdd = [
        { name: "depth_cm", type: "REAL" },
        { name: "horizon", type: "TEXT" },
        { name: "soil_type", type: "TEXT" },
        { name: "sampling_method", type: "TEXT" },
        { name: "coordinate_system", type: "TEXT" },
        { name: "device_accuracy_m", type: "REAL" },
        { name: "operator", type: "TEXT" },
        { name: "field_id", type: "TEXT" },
        { name: "parcel_id", type: "TEXT" },
        { name: "legal_ref", type: "TEXT" },
        { name: "lab_export_status", type: "TEXT" },
        { name: "lab_exported_at", type: "DATETIME" }
      ];
      
      for (const col of columnsToAdd) {
        const exists = await columnExists('samples', col.name);
        if (!exists) {
          console.log(`[Migration v3] Adding column: ${col.name}`);
          await db.execute(`ALTER TABLE samples ADD COLUMN ${col.name} ${col.type};`);
        } else {
          console.log(`[Migration v3] Column ${col.name} already exists, skipping`);
        }
      }
      
      console.log('[Migration v3] Samples table updated');
    }
  },
  
  // Migration v4: Add German compliance fields
  {
    version: 4,
    description: 'Add German regulatory compliance fields to samples table',
    async up(db: SQLiteDBConnection) {
      console.log('[Migration v4] Adding German compliance fields...');
      
      const columnExists = async (table: string, column: string): Promise<boolean> => {
        try {
          const result = await db.query(`PRAGMA table_info(${table});`);
          if (result.values) {
            return result.values.some((col: any) => col.name === column);
          }
          return false;
        } catch {
          return false;
        }
      };
      
      const newColumns = [
        // Depth ranges
        { name: "depth_from_cm", type: "REAL" },
        { name: "depth_to_cm", type: "REAL" },
        { name: "horizon_description", type: "TEXT" },
        
        // Location & Cadastral
        { name: "field_name", type: "TEXT" },
        { name: "cadastral_district", type: "TEXT" },
        { name: "land_use", type: "TEXT" },
        
        // Crop Information
        { name: "current_crop", type: "TEXT" },
        { name: "previous_crop", type: "TEXT" },
        { name: "crop_rotation", type: "TEXT" },
        { name: "crop_stage", type: "TEXT" },
        { name: "last_harvest_date", type: "TEXT" },
        { name: "days_since_harvest", type: "INTEGER" },
        { name: "fertilization_history", type: "TEXT" },
        
        // Laboratory Assignment
        { name: "laboratory_id", type: "TEXT" },
        { name: "laboratory_name", type: "TEXT" },
        { name: "laboratory_customer_id", type: "TEXT" },
        { name: "analysis_parameters", type: "TEXT" }, // JSON array stored as text
        { name: "analysis_package", type: "TEXT" },
        { name: "analysis_methods", type: "TEXT" }, // JSON array stored as text
        
        // Container & Chain of Custody
        { name: "container_id", type: "TEXT" },
        { name: "container_type", type: "TEXT" },
        { name: "sample_weight_g", type: "REAL" },
        { name: "preservation_method", type: "TEXT" },
        { name: "sampled_by_signature", type: "TEXT" },
        { name: "reviewed_by", type: "TEXT" },
        { name: "transport_date", type: "TEXT" },
        { name: "transport_method", type: "TEXT" },
        
        // Quality Assurance
        { name: "sample_type", type: "TEXT" },
        { name: "qc_group_id", type: "TEXT" },
        { name: "sample_valid", type: "INTEGER" }, // Boolean as INTEGER (0/1)
        { name: "rejection_reason", type: "TEXT" },
        
        // Regulatory
        { name: "bundesland", type: "TEXT" },
        { name: "sampling_date", type: "TEXT" },
        { name: "regulatory_notes", type: "TEXT" },
        { name: "updated_at", type: "DATETIME" }
      ];
      
      for (const col of newColumns) {
        const exists = await columnExists('samples', col.name);
        if (!exists) {
          console.log(`[Migration v4] Adding column: ${col.name}`);
          await db.execute(`ALTER TABLE samples ADD COLUMN ${col.name} ${col.type};`);
        } else {
          console.log(`[Migration v4] Column ${col.name} already exists, skipping`);
        }
      }
      
      console.log('[Migration v4] German compliance fields added');
    }
  }
];

/**
 * Get current schema version from database
 */
async function getCurrentVersion(db: SQLiteDBConnection): Promise<number> {
  try {
    // Check if schema_version table exists
    const result = await db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version';"
    );
    
    if (!result.values || result.values.length === 0) {
      // Create enhanced schema_version table with migration history
      // Use id as PRIMARY KEY to allow multiple attempts of same version
      await db.execute(`
        CREATE TABLE IF NOT EXISTS schema_version (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          version INTEGER NOT NULL,
          description TEXT,
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          duration_ms INTEGER,
          success INTEGER DEFAULT 1,
          error_message TEXT
        );
      `);
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_schema_version_success 
        ON schema_version(version, success);
      `);
      await db.execute(`
        INSERT INTO schema_version (version, description, success) 
        VALUES (1, 'Initial schema', 1);
      `);
      logger.info('Migration', 'Created schema_version table');
      return 1;
    }
    
    // Get current version (only successful migrations)
    const versionResult = await db.query(
      'SELECT MAX(version) as version FROM schema_version WHERE success = 1;'
    );
    if (versionResult.values && versionResult.values.length > 0) {
      return versionResult.values[0].version || 1;
    }
    
    return 1;
  } catch (error) {
    logger.error('Migration', 'Error getting current version', error);
    return 1;
  }
}

/**
 * Get migration history
 */
export async function getMigrationHistory(db: SQLiteDBConnection): Promise<MigrationRecord[]> {
  try {
    const result = await db.query(`
      SELECT version, description, applied_at, duration_ms, success, error_message 
      FROM schema_version 
      ORDER BY version DESC;
    `);
    
    if (!result.values || result.values.length === 0) {
      return [];
    }
    
    return result.values.map(row => ({
      version: row.version,
      description: row.description || '',
      applied_at: row.applied_at,
      duration_ms: row.duration_ms || 0,
      success: row.success === 1,
      error_message: row.error_message
    }));
  } catch (error) {
    logger.error('Migration', 'Error getting migration history', error);
    return [];
  }
}

/**
 * Record migration attempt
 */
async function recordMigration(
  db: SQLiteDBConnection,
  migration: Migration,
  success: boolean,
  durationMs: number,
  errorMessage?: string
): Promise<void> {
  try {
    // Execute directly without transaction wrapper to avoid nested transaction issues
    // This should be called either within an existing transaction or independently
    await db.run(
      `INSERT OR IGNORE INTO schema_version (version, description, applied_at, duration_ms, success, error_message) 
       VALUES (?, ?, ?, ?, ?, ?);`,
      [
        migration.version,
        migration.description,
        new Date().toISOString(),
        durationMs,
        success ? 1 : 0,
        errorMessage || null
      ]
    );
  } catch (error) {
    // Silently ignore duplicate insertion errors
    if (error instanceof Error && !error.message.includes('UNIQUE constraint')) {
      logger.error('Migration', 'Failed to record migration', error);
    }
  }
}

/**
 * Apply pending migrations
 */
export async function applyMigrations(db: SQLiteDBConnection): Promise<void> {
  logger.info('Migration', 'Checking for pending migrations...');
  
  const currentVersion = await getCurrentVersion(db);
  logger.info('Migration', `Current schema version: ${currentVersion}`);
  
  const pendingMigrations = migrations.filter(m => m.version > currentVersion);
  
  if (pendingMigrations.length === 0) {
    logger.info('Migration', 'Database is up to date');
    return;
  }
  
  logger.info('Migration', `Found ${pendingMigrations.length} pending migration(s)`);
  
  // Apply migrations in order
  for (const migration of pendingMigrations.sort((a, b) => a.version - b.version)) {
    logger.info('Migration', `Applying migration v${migration.version}: ${migration.description}`);
    
    const startTime = Date.now();
    let errorMessage: string | undefined;
    
    try {
      // Check if this migration was already successfully applied
      const checkResult = await db.query(
        'SELECT version FROM schema_version WHERE version = ? AND success = 1 LIMIT 1;',
        [migration.version]
      );
      
      if (checkResult.values && checkResult.values.length > 0) {
        logger.info('Migration', `Migration v${migration.version} already applied, skipping`);
        continue;
      }
      
      // Begin transaction for atomic migration (use run() for Android compatibility)
      await db.run('BEGIN IMMEDIATE TRANSACTION');
      
      let transactionActive = true;
      
      try {
        // Apply migration
        await migration.up(db);

        const duration = Date.now() - startTime;
        
        // Record successful migration INSIDE transaction before committing
        await recordMigration(db, migration, true, duration);
        
        // Commit transaction (includes migration record)
        await db.run('COMMIT');
        transactionActive = false;
        
        logger.info('Migration', `Successfully applied v${migration.version} in ${duration}ms`);
      } catch (migrationError) {
        // Rollback on error (only if transaction is still active)
        if (transactionActive) {
          try {
            await db.run('ROLLBACK');
            logger.warn('Migration', 'Transaction rolled back');
          } catch {
            // Rollback might fail if transaction wasn't started - this is okay
            logger.warn('Migration', 'Rollback unnecessary or failed (may be normal)');
          }
        }
        
        throw migrationError; // Re-throw to outer catch
      }
    } catch (error) {
      
      errorMessage = error instanceof Error ? error.message : String(error);
      const duration = Date.now() - startTime;
      
      // Record failed migration in its own transaction (after rollback)
      try {
        await db.run('BEGIN IMMEDIATE TRANSACTION');
        await recordMigration(db, migration, false, duration, errorMessage);
        await db.run('COMMIT');
      } catch (recordError) {
        // If recording fails, just log it and continue
        logger.warn('Migration', 'Failed to record migration failure', recordError);
        try {
          await db.run('ROLLBACK');
        } catch {
          // Ignore rollback errors
        }
      }
      
      logger.error('Migration', `Failed to apply v${migration.version}`, error, {
        duration,
        errorMessage
      });
      
      throw new Error(`Migration v${migration.version} failed: ${errorMessage}`);
    }
  }
  
  logger.info('Migration', 'All migrations applied successfully');
}

/**
 * Validate database schema integrity
 */
export async function validateSchema(db: SQLiteDBConnection): Promise<{
  valid: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  
  try {
    // Check required tables exist
    const requiredTables = [
      'projects', 'tracks', 'gps_points', 'samples', 
      'field_boundaries', 'devices', 'schema_version'
    ];
    
    const result = await db.query(
      "SELECT name FROM sqlite_master WHERE type='table';"
    );
    
    const existingTables = result.values?.map(row => row.name) || [];
    
    for (const table of requiredTables) {
      if (!existingTables.includes(table)) {
        errors.push(`Missing required table: ${table}`);
      }
    }
    
    // Validate current version
    const currentVersion = await getCurrentVersion(db);
    if (currentVersion < CURRENT_SCHEMA_VERSION) {
      errors.push(`Schema version ${currentVersion} is outdated (expected ${CURRENT_SCHEMA_VERSION})`);
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  } catch (error) {
    logger.error('Migration', 'Schema validation failed', error);
    return {
      valid: false,
      errors: [`Validation error: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
}

/**
 * Check if migrations are needed
 */
export async function needsMigration(db: SQLiteDBConnection): Promise<boolean> {
  const currentVersion = await getCurrentVersion(db);
  return currentVersion < CURRENT_SCHEMA_VERSION;
}
