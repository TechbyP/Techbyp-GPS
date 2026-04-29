import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { auth } from '../firebase';
import { hybridDB } from '../services/hybridDatabase';
import { firebaseGPS } from '../services/firebaseSync';
import { debugAuthPersistence } from '../utils/authDebug';
import { secureStorage } from '../utils/secureStorage';
import { clearStartupRecoveryMarker, triggerAutomaticStartupRecovery } from '../utils/startupRecovery';

// Simple translation helper for AuthContext (since we can't use hooks in contexts)
const getAuthErrorMessage = (key: string, fallback: string): string => {
  try {
    // Try to get current language from localStorage
    const lang = localStorage.getItem('i18nextLng') || 'en';
    
    // Basic translations for auth errors
    const translations = {
      'en': {
        'error.auth.signupFailed': 'Signup failed',
        'error.auth.loginFailed': 'Login failed',
        'error.auth.logoutFailed': 'Logout failed',
        'error.auth.contextError': 'useAuth must be used within an AuthProvider',
        'error.auth.offlineLogin': 'Cannot login offline: No cached session found for this email. Connect to internet to login first.'
      },
      'de': {
        'error.auth.signupFailed': 'Anmeldung fehlgeschlagen',
        'error.auth.loginFailed': 'Anmeldung fehlgeschlagen',
        'error.auth.logoutFailed': 'Abmeldung fehlgeschlagen',
        'error.auth.contextError': 'useAuth muss innerhalb eines AuthProvider verwendet werden',
        'error.auth.offlineLogin': 'Offline-Anmeldung nicht möglich: Keine zwischengespeicherte Sitzung für diese E-Mail gefunden. Verbinden Sie sich zuerst mit dem Internet.'
      }
    };
    
    return translations[lang as keyof typeof translations]?.[key] || fallback;
  } catch {
    return fallback;
  }
};

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthReady: boolean;
  signup: (email: string, password: string) => Promise<{user: User}>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authInitialized, setAuthInitialized] = useState(false); // Prevent double initialization

  // Listen to auth state changes
  useEffect(() => {
    // Prevent double initialization
    if (authInitialized) {
      console.log('🔐 Auth already initialized, skipping');
      return;
    }
    
    setAuthInitialized(true);
    
    let mounted = true;
    let authTimeout: ReturnType<typeof setTimeout> | null = null;
    let authResolved = false; // ✅ PRIORITY 4 FIX: Prevent duplicate setUserId calls
    
    // Listen for offline auth events
    const handleOfflineAuth = async (event: CustomEvent) => {
      if (mounted && !authResolved) {
        console.log('🔐 Offline auth triggered');
        authResolved = true;
        const guestUser = event.detail;
        setUser(guestUser);
        await hybridDB.setUserId(guestUser.uid);
        setLoading(false);
      }
    };
    
    window.addEventListener('offline-auth', handleOfflineAuth as EventListener);
    
    // Test internet connectivity using Firebase ping to avoid cross-domain/firewall issues
    const testConnectivity = async (): Promise<boolean> => {
      try {
        const result = await firebaseGPS.ping();
        return !!result.success;
      } catch {
        return false;
      }
    };

    // ✅ PRIORITY 4 FIX: Single auth initialization path
    const initializeAuth = async () => {
      // Never block auth listener setup on storage migration to avoid startup hangs.
      void secureStorage.migrateFromLocalStorage().catch((error) => {
        console.warn('⚠️ Secure storage migration failed (non-blocking):', error);
      });

      // Set up Firebase auth listener first
      const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
        if (authTimeout) {
          clearTimeout(authTimeout);
          authTimeout = null;
        }
        if (!mounted || authResolved) return;
        
        authResolved = true; // Mark as resolved to prevent cached auth from running
        
        // User authentication state updated
        if (import.meta.env.DEV && currentUser) {
          const debugKey = `auth-debug-${currentUser.uid}`;
          if (!sessionStorage.getItem(debugKey)) {
            debugAuthPersistence();
            sessionStorage.setItem(debugKey, 'true');
          }
        }
        
        setUser(currentUser);
        
        // Update hybrid database service with user ID
        if (currentUser?.uid) {
          // Non-blocking: Let database initialization happen in background
          void hybridDB.setUserId(currentUser.uid).catch(err => {
            console.error('⚠️ Failed to set user ID in HybridDB:', err);
          });

          // Ensure user document exists and update last active
          firebaseGPS.ensureUserDocument(currentUser.uid, currentUser.email || undefined)
            .then(() => firebaseGPS.updateUserLastActive(currentUser.uid))
            .catch(err => console.error('⚠️ Failed to sync user data:', err));
          
          setIsAuthReady(true);
        } else {
          setIsAuthReady(true);
          
          // Allow offline cache access only with a verified secure token
          secureStorage.getOfflineAuth()
            .then(token => {
              if (!navigator.onLine && token) {
                void hybridDB.setUserId(token.uid);
                console.log('ℹ️  Offline mode using secure token UID:', token.uid);
              } else {
                void hybridDB.setUserId('');
                console.log('⚠️  HybridDB: User not authenticated');
              }
            })
            .catch(() => {
              void hybridDB.setUserId('');
              console.log('⚠️  HybridDB: User not authenticated');
            });
        }
        
        setLoading(false);
        clearStartupRecoveryMarker();
      });

      // Safety timeout: ensure UI never stays on loading forever if auth callback stalls.
      authTimeout = setTimeout(() => {
        if (!mounted || authResolved) return;
        console.warn('🔐 Auth initialization timeout - attempting automatic startup recovery');

        void triggerAutomaticStartupRecovery('auth-init-timeout')
          .then((recoveryStarted) => {
            if (!mounted || authResolved) return;

            if (recoveryStarted) {
              authResolved = true;
              return;
            }

            console.warn('🔐 Automatic recovery not available - continuing without resolved Firebase auth state');
            authResolved = true;
            setIsAuthReady(true);
            setLoading(false);
          })
          .catch((error) => {
            if (!mounted || authResolved) return;

            console.warn('🔐 Automatic recovery failed - continuing without resolved Firebase auth state', error);
            authResolved = true;
            setIsAuthReady(true);
            setLoading(false);
          });
      }, 10000);
      
      // Check for cached auth only if Firebase hasn't resolved yet
      setTimeout(async () => {
        if (!mounted || authResolved) return;
        
        console.log('🔐 Firebase auth slow, checking cached credentials...');
        const offlineAuth = await secureStorage.getOfflineAuth();
        
        if (offlineAuth && !authResolved) {
          console.log('🔐 Auto-login with secure offline token');
          authResolved = true;
          
          const offlineUser = {
            uid: offlineAuth.uid,
            email: offlineAuth.email,
            emailVerified: true,
            isAnonymous: false,
            displayName: null,
            photoURL: null,
            phoneNumber: null,
            providerId: 'firebase',
            providerData: []
          } as User;
          
          setUser(offlineUser);
          void hybridDB.setUserId(offlineAuth.uid);
          setIsAuthReady(true);
          setLoading(false);
        }
      }, 500); // Wait 500ms before using cached auth (optimized for faster loading)
      
      return unsubscribe;
    };
    
    // Initialize auth immediately
    let unsubscribe: (() => void) | undefined;
    initializeAuth()
      .then(unsub => {
        unsubscribe = unsub;
      })
      .catch(async error => {
        console.error('🔐 Auth initialization failed:', error);

        try {
          const recoveryStarted = await triggerAutomaticStartupRecovery('auth-init-timeout');
          if (recoveryStarted) {
            authResolved = true;
            return;
          }
        } catch (recoveryError) {
          console.warn('🔐 Startup recovery failed after auth initialization error:', recoveryError);
        }

        if (!mounted || authResolved) return;
        authResolved = true;
        setUser(null);
        setIsAuthReady(true);
        setLoading(false);
      });

    return () => {
      mounted = false;
      if (authTimeout) {
        clearTimeout(authTimeout);
      }
      window.removeEventListener('offline-auth', handleOfflineAuth as EventListener);
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const signup = async (email: string, password: string) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      setUser(userCredential.user);
      await hybridDB.setUserId(userCredential.user.uid);
      
      // Store secure offline token (NO PASSWORD)
      await secureStorage.storeOfflineAuth(userCredential.user.uid, email);
      
      // Create user document in Firestore
      try {
        await firebaseGPS.createUserDocument(userCredential.user.uid, email);
        console.log('✅ User document created in Firestore');
      } catch (firestoreError) {
        console.error('⚠️ Failed to create user document:', firestoreError);
        // Don't throw - auth succeeded, document creation is secondary
      }
      
      console.log('✅ Signup successful:', userCredential.user.email);
      return { user: userCredential.user };
    } catch (error: any) {
      console.error('❌ Signup failed:', error.message);
      throw new Error(error.message || getAuthErrorMessage('error.auth.signupFailed', 'Signup failed'));
    }
  };

  const login = async (email: string, password: string) => {
    console.log('🔐 [AUTH] Login started for:', email);
    
    // Test connectivity before attempting Firebase login
    const testConnectivity = async (): Promise<boolean> => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        await fetch('https://www.google.com/favicon.ico', {
          method: 'HEAD',
          mode: 'no-cors',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        console.log('🔐 [AUTH] Internet connectivity: ✅ ONLINE');
        return true;
      } catch {
        console.log('🔐 [AUTH] Internet connectivity: ❌ OFFLINE');
        return false;
      }
    };

    const hasInternet = await testConnectivity();
    
    // If offline or no internet, try cached credentials with secure token
    if (!hasInternet) {
      console.log('🔄 No internet detected - checking secure offline token');
      const offlineAuth = await secureStorage.getOfflineAuth();
      
      if (offlineAuth && offlineAuth.email === email) {
        console.log('🔄 Offline login using secure token');
        const offlineUser = {
          uid: offlineAuth.uid,
          email: offlineAuth.email,
          emailVerified: true,
          isAnonymous: false,
          displayName: null,
          photoURL: null,
          phoneNumber: null,
          providerId: 'firebase',
          providerData: []
        } as User;
        
        setUser(offlineUser);
        await hybridDB.setUserId(offlineAuth.uid);
        console.log('✅ Offline login successful');
        return;
      } else {
        throw new Error(getAuthErrorMessage('error.auth.offlineLogin', 'Cannot login offline: No cached session found for this email. Connect to internet to login first.'));
      }
    }

    try {
      console.log('🔐 [AUTH] Attempting Firebase authentication...');
      console.log('🔐 [AUTH] Firebase auth config:', {
        authDomain: auth.app.options.authDomain,
        projectId: auth.app.options.projectId,
        apiKey: auth.app.options.apiKey ? '✅ Present' : '❌ Missing'
      });
      
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      console.log('🔐 [AUTH] ✅ Firebase authentication successful!');
      console.log('🔐 [AUTH] User UID:', userCredential.user.uid);
      console.log('🔐 [AUTH] User email:', userCredential.user.email);
      
      // Force refresh token to get latest custom claims (admin role, etc.)
      try {
        console.log('🔐 [AUTH] Refreshing token to get latest claims...');
        await userCredential.user.getIdToken(true); // Force refresh
        const tokenResult = await userCredential.user.getIdTokenResult();
        console.log('🔐 [AUTH] Token refreshed. Custom claims:', tokenResult.claims);
        console.log('🔐 [AUTH] Admin claim:', tokenResult.claims.admin ? '✅ Yes' : '❌ No');
      } catch (tokenError) {
        console.warn('🔐 [AUTH] Token refresh failed (non-fatal):', tokenError);
      }
      
      setUser(userCredential.user);
      
      console.log('🔐 [AUTH] Setting user ID in HybridDB...');
      await hybridDB.setUserId(userCredential.user.uid);
      console.log('🔐 [AUTH] ✅ HybridDB user ID set successfully');
      
      // Store secure offline token (NO PASSWORD)
      console.log('🔐 [AUTH] Storing offline authentication token...');
      await secureStorage.storeOfflineAuth(userCredential.user.uid, email);
      console.log('🔐 [AUTH] ✅ Offline token stored');
      
      // Update user last active time
      try {
        console.log('🔐 [AUTH] Updating user last active timestamp...');
        await firebaseGPS.updateUserLastActive(userCredential.user.uid);
        console.log('🔐 [AUTH] ✅ Last active timestamp updated');
      } catch (error) {
        console.error('🔐 [AUTH] ⚠️ Failed to update user last active:', error);
        // Don't throw - login succeeded, this is just tracking
      }
      
      console.log('🔐 [AUTH] ✅✅✅ LOGIN COMPLETE - User authenticated successfully!');
      console.log('🔐 [AUTH] Database should now load projects for UID:', userCredential.user.uid);
      
      // Trigger aggressive sync to load projects immediately
      console.log('🔐 [AUTH] Triggering post-login project sync...');
      setTimeout(async () => {
        try {
          await hybridDB.syncProjectsInBackground();
          console.log('🔐 [AUTH] ✅ Post-login project sync completed');
        } catch (err) {
          console.warn('🔐 [AUTH] Post-login sync had issues (non-fatal):', err);
        }
      }, 500);
      
      // Check if persistence is working
      setTimeout(() => {
        console.log('🔍 Auth state after login:', auth.currentUser?.email || 'Not persisted');
        if (import.meta.env.DEV) {
          debugAuthPersistence();
        }
      }, 1000);
      
    } catch (error: any) {
      console.error('❌ Login failed:', error.message);
      console.error('❌ Error code:', error.code);
      
      // If Firebase login fails but we have cached credentials, fall back to offline mode
      if (error.code === 'auth/network-request-failed') {
        console.log('🔄 Firebase login failed due to network, trying secure token...');
        const offlineAuth = await secureStorage.getOfflineAuth();
        
        if (offlineAuth && offlineAuth.email === email) {
          console.log('🔄 Fallback to offline login');
          const offlineUser = {
            uid: offlineAuth.uid,
            email: offlineAuth.email,
            emailVerified: true,
            isAnonymous: false,
            displayName: null,
            photoURL: null,
            phoneNumber: null,
            providerId: 'firebase',
            providerData: []
          } as User;
          
          setUser(offlineUser);
          await hybridDB.setUserId(offlineAuth.uid);
          console.log('✅ Offline login successful (fallback)');
          return;
        }
      }
      
      throw new Error(error.message || getAuthErrorMessage('error.auth.loginFailed', 'Login failed'));
    }
  };

  const logout = async () => {
    try {
      if (navigator.onLine) {
        await signOut(auth);
      }
      
      // Clear secure storage
      await secureStorage.clearAll();
      
      setUser(null);
      await hybridDB.setUserId('');
      console.log('✅ Logout successful - secure data cleared');
    } catch (error: any) {
      console.error('❌ Logout failed:', error.message);
      throw new Error(error.message || getAuthErrorMessage('error.auth.logoutFailed', 'Logout failed'));
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthReady,
        signup,
        login,
        logout,
        // Permit cached/offline access when we have a remembered UID but no live session
        isAuthenticated: !!user || (!navigator.onLine && !!localStorage.getItem('lastKnownUid')),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    // During HMR in dev mode, context might temporarily be unavailable
    if (import.meta.env.DEV) {
      console.warn('⚠️ useAuth called before AuthProvider mounted (likely HMR)');
      // Return a safe loading state instead of throwing
      return {
        user: null,
        loading: true,
        isAuthReady: false,
        isAuthenticated: false,
        signup: async () => {},
        login: async () => {},
        logout: async () => {},
      };
    }
    throw new Error(getAuthErrorMessage('error.auth.contextError', 'useAuth must be used within an AuthProvider'));
  }
  return context;
}

export { auth };
