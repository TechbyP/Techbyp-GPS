/**
 * Schema Validator - Checks consistency across all database implementations
 */

import type { SQLiteDBConnection } from '@capacitor-community/sqlite';

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  tables: {
    [tableName: string]: {
      exists: boolean;
      columns: string[];
      missingColumns?: string[];
      extraColumns?: string[];
    };
  };
}

/**
 * Expected schema definition for all tables
 */
const EXPECTED_SCHEMA = {
  projects: [
    'id',
    'name',
    'description',
    'user_id',
    'created_at',
    'updated_at'
  ],
  tracks: [
    'id',
    'name',
    'project_id',
    'field_boundary_id',
    'color',
    'notes',
    'started_at',
    'stopped_at',
    'is_active',
    'created_at'
  ],
  gps_points: [
    'id',
    'track_id',
    'latitude',
    'longitude',
    'altitude',
    'accuracy',
    'timestamp',
    'synced_at'
  ],
  samples: [
    'id',
    'track_id',
    'latitude',
    'longitude',
    'name',
    'sample_number',
    'notes',
    'depth_cm',
    'horizon',
    'soil_type',
    'sampling_method',
    'coordinate_system',
    'device_accuracy_m',
    'operator',
    'field_id',
    'parcel_id',
    'legal_ref',
    'lab_export_status',
    'lab_exported_at',
    'timestamp',
    'created_at'
  ],
  field_boundaries: [
    'id',
    'project_id',
    'name',
    'geometry_type',
    'coordinates',
    'properties',
    'color',
    'created_at'
  ],
  devices: [
    'id',
    'name',
    'device_type',
    'connection_type',
    'address',
    'manufacturer',
    'model',
    'capabilities',
    'last_connected',
    'config',
    'is_active',
    'created_at',
    'updated_at'
  ],
  schema_version: [
    'version',
    'description',
    'applied_at',
    'duration_ms',
    'success',
    'error_message'
  ]
};

/**
 * Validate SQLite database schema
 */
export async function validateSQLiteSchema(db: SQLiteDBConnection): Promise<SchemaValidationResult> {
  const result: SchemaValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    tables: {}
  };

  try {
    // Get list of all tables
    const tablesQuery = await db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
    );
    
    const existingTables = new Set(
      tablesQuery.values?.map((row: any) => row.name) || []
    );

    // Check each expected table
    for (const [tableName, expectedColumns] of Object.entries(EXPECTED_SCHEMA)) {
      if (!existingTables.has(tableName)) {
        result.valid = false;
        result.errors.push(`Missing table: ${tableName}`);
        result.tables[tableName] = {
          exists: false,
          columns: []
        };
        continue;
      }

      // Get table columns
      const columnsQuery = await db.query(`PRAGMA table_info(${tableName});`);
      const actualColumns = columnsQuery.values?.map((col: any) => col.name) || [];
      
      const actualSet = new Set(actualColumns);
      const expectedSet = new Set(expectedColumns);

      const missingColumns = expectedColumns.filter(col => !actualSet.has(col));
      const extraColumns = actualColumns.filter(col => !expectedSet.has(col));

      result.tables[tableName] = {
        exists: true,
        columns: actualColumns,
        missingColumns,
        extraColumns
      };

      if (missingColumns.length > 0) {
        result.valid = false;
        result.errors.push(
          `Table '${tableName}' missing columns: ${missingColumns.join(', ')}`
        );
      }

      if (extraColumns.length > 0) {
        result.warnings.push(
          `Table '${tableName}' has extra columns: ${extraColumns.join(', ')}`
        );
      }
    }

    // Check for unexpected tables
    const expectedTableNames = new Set(Object.keys(EXPECTED_SCHEMA));
    for (const tableName of existingTables) {
      if (!expectedTableNames.has(tableName) && tableName !== 'kv_store') {
        result.warnings.push(`Unexpected table found: ${tableName}`);
      }
    }

  } catch (error) {
    result.valid = false;
    result.errors.push(`Schema validation failed: ${error}`);
  }

  return result;
}

/**
 * Get human-readable validation report
 */
export function formatValidationReport(result: SchemaValidationResult): string {
  const lines: string[] = [];
  
  lines.push('='.repeat(60));
  lines.push('DATABASE SCHEMA VALIDATION REPORT');
  lines.push('='.repeat(60));
  lines.push('');
  
  if (result.valid) {
    lines.push('✅ Schema validation PASSED');
  } else {
    lines.push('❌ Schema validation FAILED');
  }
  
  lines.push('');
  
  if (result.errors.length > 0) {
    lines.push('ERRORS:');
    result.errors.forEach(err => lines.push(`  ❌ ${err}`));
    lines.push('');
  }
  
  if (result.warnings.length > 0) {
    lines.push('WARNINGS:');
    result.warnings.forEach(warn => lines.push(`  ⚠️  ${warn}`));
    lines.push('');
  }
  
  lines.push('TABLE DETAILS:');
  lines.push('-'.repeat(60));
  
  for (const [tableName, info] of Object.entries(result.tables)) {
    if (!info.exists) {
      lines.push(`❌ ${tableName}: MISSING`);
      continue;
    }
    
    const status = (info.missingColumns?.length || 0) > 0 ? '❌' : '✅';
    lines.push(`${status} ${tableName}: ${info.columns.length} columns`);
    
    if (info.missingColumns && info.missingColumns.length > 0) {
      lines.push(`     Missing: ${info.missingColumns.join(', ')}`);
    }
    
    if (info.extraColumns && info.extraColumns.length > 0) {
      lines.push(`     Extra: ${info.extraColumns.join(', ')}`);
    }
  }
  
  lines.push('='.repeat(60));
  
  return lines.join('\n');
}

/**
 * Log validation results to console
 */
export function logValidationResults(result: SchemaValidationResult): void {
  console.log(formatValidationReport(result));
  
  // Also log structured data for debugging
  console.log('📊 Schema validation details:', {
    valid: result.valid,
    errorCount: result.errors.length,
    warningCount: result.warnings.length,
    tables: Object.keys(result.tables).length
  });
}
