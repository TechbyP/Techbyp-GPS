// Firebase Configuration for GPS Tracker
// ========================================
// Uses existing Firebase project with separate Firestore database

import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
import { environmentConfig } from './config/environment';

// Detect if running in Capacitor (native mobile app)
// Import from the unified platform detection module
import { isCapacitorApp } from './utils/platform';
const isCapacitor = isCapacitorApp();

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
let app;
try {
  app = initializeApp(firebaseConfig);
} catch (error) {
  console.error('❌ FATAL: Firebase initialization failed:', error);
  throw new Error(`Firebase init failed: ${error instanceof Error ? error.message : String(error)}`);
}

// Only enable Analytics on web (not Capacitor) and when explicitly allowed
let analytics: ReturnType<typeof getAnalytics> | null = null;
const analyticsEnabled = !isCapacitor
  && firebaseConfig.measurementId
  && window.location.protocol.startsWith('http')
  && import.meta.env.VITE_ENABLE_ANALYTICS === 'true'
  && !import.meta.env.DEV;

if (analyticsEnabled) {
  analytics = getAnalytics(app);
} else {
  // Analytics disabled for this platform or environment
}

// Initialize Firestore with persistent cache for reliable offline support
// Uses persistent local cache + multiple tab manager for web
// Native platforms get Firestore's built-in persistence automatically
let db: ReturnType<typeof getFirestore>;
try {
  if (isCapacitor) {
    db = getFirestore(app);
  } else {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      })
    });
  }
  
} catch (initError: any) {
  console.error('❌ Critical: Failed to initialize Firestore:', initError);
  
  // Fallback to default initialization if persistent cache fails
  if (initError.message?.includes('persistence') || initError.message?.includes('cache')) {
    console.log('🔄 Falling back to default Firestore cache...');
    try {
      db = getFirestore(app);
      console.log('✅ Firestore initialized with fallback cache');
    } catch (retryError) {
      console.error('❌ Fatal: Cannot initialize Firestore:', retryError);
      throw retryError;
    }
  } else {
    throw initError;
  }
}

// Initialize Auth with local persistence
const auth = getAuth(app);

// Enable Auth persistence (keeps user logged in across page reloads)
// This should be set before any auth operations
const initializeAuthPersistence = async () => {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (error: any) {
    console.error('❌ Auth persistence error:', error);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    
    // On mobile, auth persistence errors are sometimes expected
    if (isCapacitor) {
      console.log('ℹ️  Running in Capacitor - some persistence features may be limited');
    }
  }
};

// Initialize persistence immediately
initializeAuthPersistence().catch(err => console.error('Failed to initialize auth persistence:', err));

// Test Firebase connectivity
const testFirebaseConnection = async () => {
  const startTime = Date.now();
  try {
    console.log('🔍 Testing Firebase connection...');
    console.log('📡 Network status:', navigator.onLine ? 'ONLINE' : 'OFFLINE');
    
    // Try to access Firestore to verify connection
    const { collection, getDocs, limit, query } = await import('firebase/firestore');
    const testQuery = query(collection(db, 'users'), limit(1));
    
    console.log('⏳ Executing Firestore test query...');
    await Promise.race([
      getDocs(testQuery),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection test timeout')), 10000))
    ]);
    
    const duration = Date.now() - startTime;
    console.log(`✅ Firebase connection successful (${duration}ms)`);
    
    if (duration > 5000) {
      console.warn('⚠️  Firebase connection is slow (>5s). This may cause timeout issues.');
      console.log('💡 Consider checking your internet speed or Firebase region configuration.');
    }
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`❌ Firebase connection test failed (${duration}ms):`, error);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    
    if (error.code === 'unavailable') {
      console.error('💡 Firebase is unreachable. Check internet connection.');
    } else if (error.code === 'permission-denied') {
      console.error('💡 Firebase permission denied. You may need to log in first.');
    } else if (error.message?.includes('timeout')) {
      console.error('💡 Firebase connection timeout. Network may be slow or Firebase may be under heavy load.');
    } else {
      console.error('💡 Unexpected Firebase error. Check Firebase console for issues.');
    }
  }
};

// Initialize persistence and test connection
if (environmentConfig.shouldRunFirebaseConnectionTests()) {
  if (isCapacitor) {
    // For mobile apps, test connection after a short delay to allow network to be ready
    setTimeout(() => testFirebaseConnection(), 1000);
  } else {
    testFirebaseConnection();
  }
} else {
  // Firebase connection test skipped in development mode
}

export { app, analytics, db, auth, isCapacitor };

