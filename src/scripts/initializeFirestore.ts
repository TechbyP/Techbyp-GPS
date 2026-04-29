// src/scripts/initializeFirestore.ts
// Script to initialize Firestore collections with sample data
// Run with: npm run init-firestore

import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  Timestamp,
  getDocs
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDj9vu25kuV15qCKdl7MlZ8MXJ7dqVv4II",
  authDomain: "gps-app-f7d1e.firebaseapp.com",
  projectId: "gps-app-f7d1e",
  storageBucket: "gps-app-f7d1e.firebasestorage.app",
  messagingSenderId: "221494312696",
  appId: "1:221494312696:web:29f9baea8214f03d84050d",
  measurementId: "G-H9HVCQB08W"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function initializeCollections() {
  console.log('🔥 Initializing Firestore collections...\n');

  try {
    // 1. Create a sample project
    console.log('📁 Creating sample project...');
    const projectRef = await addDoc(collection(db, 'gps_projects'), {
      name: 'Sample GPS Project',
      description: 'Initial test project for GPS tracking',
      created_at: Timestamp.now(),
      updated_at: Timestamp.now(),
      created_by: 'system',
      is_active: true
    });
    console.log('✅ Project created with ID:', projectRef.id);

    // 2. Create a sample track
    console.log('\n🛤️  Creating sample track...');
    const trackRef = await addDoc(collection(db, 'gps_tracks'), {
      project_id: projectRef.id,
      name: 'Test Track 1',
      description: 'Sample GPS tracking route',
      start_time: Timestamp.now(),
      end_time: null,
      total_distance: 0,
      total_points: 0,
      is_active: true,
      created_at: Timestamp.now()
    });
    console.log('✅ Track created with ID:', trackRef.id);

    // 3. Create sample GPS points
    console.log('\n📍 Creating sample GPS points...');
    const samplePoints = [
      { lat: 40.7128, lng: -74.0060, altitude: 10.5 }, // New York
      { lat: 40.7138, lng: -74.0050, altitude: 11.2 },
      { lat: 40.7148, lng: -74.0040, altitude: 12.0 }
    ];

    for (const point of samplePoints) {
      await addDoc(collection(db, 'gps_points'), {
        track_id: trackRef.id,
        latitude: point.lat,
        longitude: point.lng,
        altitude: point.altitude,
        accuracy: 5.0,
        speed: 0,
        heading: 0,
        timestamp: Timestamp.now(),
        created_at: Timestamp.now()
      });
    }
    console.log(`✅ Created ${samplePoints.length} GPS points`);

    // 4. Create a sample waypoint/marker
    console.log('\n📌 Creating sample waypoint...');
    const sampleRef = await addDoc(collection(db, 'gps_samples'), {
      project_id: projectRef.id,
      track_id: trackRef.id,
      name: 'Waypoint 1',
      description: 'Sample waypoint marker',
      latitude: 40.7128,
      longitude: -74.0060,
      altitude: 10.5,
      sample_type: 'waypoint',
      timestamp: Timestamp.now(),
      created_at: Timestamp.now()
    });
    console.log('✅ Sample created with ID:', sampleRef.id);

    // 5. Create a sample field boundary
    console.log('\n🗺️  Creating sample field boundary...');
    const boundaryRef = await addDoc(collection(db, 'gps_field_boundaries'), {
      project_id: projectRef.id,
      name: 'Field Boundary 1',
      description: 'Sample field boundary polygon',
      geometry_type: 'Polygon',
      // Store as string to avoid nested array limitation
      coordinates_json: JSON.stringify([[
        [-74.0060, 40.7128],
        [-74.0050, 40.7128],
        [-74.0050, 40.7138],
        [-74.0060, 40.7138],
        [-74.0060, 40.7128]
      ]]),
      area: 1000.5,
      perimeter: 150.2,
      created_at: Timestamp.now(),
      updated_at: Timestamp.now()
    });
    console.log('✅ Boundary created with ID:', boundaryRef.id);

    // 6. Verify all collections
    console.log('\n🔍 Verifying collections...');
    const collections = [
      'gps_projects',
      'gps_tracks',
      'gps_points',
      'gps_samples',
      'gps_field_boundaries'
    ];

    for (const collectionName of collections) {
      const snapshot = await getDocs(collection(db, collectionName));
      console.log(`✅ ${collectionName}: ${snapshot.size} documents`);
    }

    console.log('\n✨ Firestore initialization complete!');
    console.log('\n📊 Summary:');
    console.log('   - All 5 GPS collections created');
    console.log('   - Sample data populated');
    console.log('   - Ready for GPS tracking');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error initializing Firestore:', error);
    process.exit(1);
  }
}

// Run the initialization
initializeCollections();
