/**
 * Test script to validate SQLite connection fixes
 * Tests connection cleanup and recovery mechanisms
 */

import { CapacitorSQLite } from '@capacitor-community/sqlite';

async function testSQLiteConnectionFixes() {
  console.log('🧪 Testing SQLite Connection Fixes...');
  
  try {
    // Test 1: Check if connection already exists (should be cleaned up)
    console.log('Test 1: Checking existing connections...');
    const connectionNames = ['gps+tracker', 'gps-tracker', 'gps_tracker', 'gps_tracker.db'];
    
    for (const name of connectionNames) {
      try {
        const exists = await CapacitorSQLite.isConnection({ database: name });
        if (exists.result) {
          console.log(`⚠️  Connection '${name}' exists - would be cleaned up`);
          
          // Test cleanup
          try {
            await CapacitorSQLite.closeConnection({ database: name });
            console.log(`✅ Closed connection '${name}'`);
          } catch (error) {
            console.log(`ℹ️  Connection '${name}' already closed`);
          }
        } else {
          console.log(`✅ No existing connection '${name}'`);
        }
      } catch (error) {
        console.log(`✅ Connection '${name}' not found (good)`);
      }
    }
    
    // Test 2: Create new connection with proper name
    console.log('\nTest 2: Creating new connection...');
    const dbName = 'gps_tracker.db';
    
    try {
      // Create connection
      const result = await CapacitorSQLite.createConnection({
        database: dbName,
        version: 1,
        encrypted: false,
        mode: 'full'
      });
      
      if (result) {
        console.log(`✅ Successfully created connection '${dbName}'`);
        
        // Test opening
        await CapacitorSQLite.open({ database: dbName });
        console.log(`✅ Successfully opened connection '${dbName}'`);
        
        // Test cleanup
        await CapacitorSQLite.closeConnection({ database: dbName });
        console.log(`✅ Successfully closed connection '${dbName}'`);
        
      } else {
        console.log('❌ Failed to create connection');
      }
    } catch (error) {
      console.log(`❌ Connection test failed:`, error.message);
    }
    
    console.log('\n🎉 SQLite connection tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// For browser environment testing
if (typeof window !== 'undefined') {
  window.testSQLiteConnectionFixes = testSQLiteConnectionFixes;
  console.log('💡 Run testSQLiteConnectionFixes() in browser console to test');
}

export { testSQLiteConnectionFixes };