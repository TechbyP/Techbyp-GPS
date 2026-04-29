// Debug utilities for authentication persistence
import { auth } from '../firebase';

export const logAuthState = () => {
  const currentUser = auth.currentUser;
  console.group('🔍 Auth Debug Info');
  console.log('Current User:', currentUser?.email || 'Not logged in');
  console.log('User ID:', currentUser?.uid || 'No UID');
  console.log('Auth Ready:', !!auth);
  console.log('Persistence Type:', 'browserLocalPersistence');
  console.log('Domain:', window.location.hostname);
  console.log('Protocol:', window.location.protocol);
  console.log('Is HTTPS:', window.location.protocol === 'https:');
  console.log('Is localhost:', window.location.hostname === 'localhost');
  console.log('User Agent:', navigator.userAgent.substring(0, 50) + '...');
  console.log('Cookies enabled:', navigator.cookieEnabled);
  console.log('Local storage available:', typeof(Storage) !== 'undefined');
  console.log('Timestamp:', new Date().toISOString());
  console.groupEnd();
};

export const checkLocalStorage = () => {
  console.group('🔍 Local Storage Auth Data');
  
  // Check all storage keys
  const allKeys = Object.keys(localStorage);
  const authKeys = allKeys.filter(key => 
    key.includes('firebase') || 
    key.includes('auth') ||
    key.startsWith('firebase:') ||
    key.includes('user') ||
    key.includes('token')
  );
  
  console.log('All localStorage keys:', allKeys.length, allKeys);
  console.log('Auth-related keys found:', authKeys.length);
  
  authKeys.forEach(key => {
    const value = localStorage.getItem(key);
    console.log(`${key}:`, value ? value.substring(0, 100) + '...' : 'null');
  });
  
  if (authKeys.length === 0) {
    console.log('❌ No auth-related data found in localStorage');
  }
  
  // Check sessionStorage too
  const sessionKeys = Object.keys(sessionStorage).filter(key => 
    key.includes('firebase') || key.includes('auth')
  );
  
  if (sessionKeys.length > 0) {
    console.log('Auth data in sessionStorage:', sessionKeys);
  }
  
  console.groupEnd();
};

export const debugAuthPersistence = () => {
  logAuthState();
  checkLocalStorage();
};