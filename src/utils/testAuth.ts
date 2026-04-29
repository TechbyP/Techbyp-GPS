// Test Firebase Auth Persistence
// This file can be used to manually test auth persistence

import { auth } from '../firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from 'firebase/auth';

export const testAuthPersistence = () => {
  // Test Firebase Auth Persistence functionality
  
  // Check current auth state
  if (auth.currentUser) {
    // Listen for auth state changes
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      // Auth state updated
    });
    
    return unsubscribe;
  }
  
  return () => {};
};

// Function to create a test user for debugging
export const createTestUser = async () => {
  try {
    const testEmail = 'test@gpsapp.dev';
    const testPassword = 'testpass123';
    
    try {
      await createUserWithEmailAndPassword(auth, testEmail, testPassword);
    } catch (error: any) {
      if (error.code === 'auth/email-already-in-use') {
        await signInWithEmailAndPassword(auth, 'test@gpsapp.dev', 'testpass123');
      } else {
        console.error('Test user creation failed:', error.message);
        throw error;
      }
    }
  } catch (error: any) {
    console.error('Test user error:', error.message);
  }
};

// Expose test functions globally in development
if (import.meta.env.DEV) {
  (window as any).createTestUser = createTestUser;
  (window as any).testAuthPersistence = testAuthPersistence;
}

// Function to check Firebase project configuration
export const checkFirebaseConfig = () => {
  // Firebase configuration validation available (enable via console if needed)
};

// Auto-test persistence on page load in development
if (import.meta.env.DEV) {
  setTimeout(() => {
    checkFirebaseConfig();
    testAuthPersistence();
  }, 2000);
}