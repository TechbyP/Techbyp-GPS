import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import toast from 'react-hot-toast';
import { auth } from '../firebase';
import { userProfileService } from '../services/userProfileService';
import { firebaseGPS } from '../services/firebaseSync';
import { hybridDB } from '../services/hybridDatabase';
import { secureStorage } from '../utils/secureStorage';
import { debugAuthPersistence } from '../utils/authDebug';
import {
  getUserAccessSnapshot,
  getUserAccessState,
  type UserAccessShape,
  type UserAccessState,
} from '../utils/userAccess';

// Simple translation helper for AuthContext (since we can't use hooks in contexts)
const getAuthErrorMessage = (key: string, fallback: string): string => {
  try {
    // Try to get current language from localStorage
    const lang = localStorage.getItem('language') || localStorage.getItem('i18nextLng') || 'de';
    
    // Basic translations for auth errors
    const translations = {
      'en': {
        'error.auth.signupFailed': 'Signup failed',
        'error.auth.loginFailed': 'Login failed',
        'error.auth.logoutFailed': 'Logout failed',
        'error.auth.contextError': 'useAuth must be used within an AuthProvider',
        'error.auth.offlineLogin': 'Cannot login offline: No cached session found for this email. Connect to internet to login first.',
        'error.auth.accountDisabled': 'This account has been disabled. Contact your administrator.',
        'error.auth.accountExpired': 'This account access has expired. Contact your administrator.'
      },
      'de': {
        'error.auth.signupFailed': 'Anmeldung fehlgeschlagen',
        'error.auth.loginFailed': 'Anmeldung fehlgeschlagen',
        'error.auth.logoutFailed': 'Abmeldung fehlgeschlagen',
        'error.auth.contextError': 'useAuth muss innerhalb eines AuthProvider verwendet werden',
        'error.auth.offlineLogin': 'Offline-Anmeldung nicht möglich: Keine zwischengespeicherte Sitzung für diese E-Mail gefunden. Verbinden Sie sich zuerst mit dem Internet.',
        'error.auth.accountDisabled': 'Dieses Konto wurde deaktiviert. Bitte wenden Sie sich an Ihren Administrator.',
        'error.auth.accountExpired': 'Der Zugriff für dieses Konto ist abgelaufen. Bitte wenden Sie sich an Ihren Administrator.'
      }
    };
    
    return translations[lang as keyof typeof translations]?.[key] || fallback;
  } catch {
    return fallback;
  }
};

const buildOfflineUser = (uid: string, email: string): User => ({
  uid,
  email,
  emailVerified: true,
  isAnonymous: false,
  displayName: null,
  photoURL: null,
  phoneNumber: null,
  providerId: 'firebase',
  providerData: []
} as User);

const getAccessBlockedMessage = (accessState: UserAccessState): string => {
  if (accessState.status === 'disabled') {
    return getAuthErrorMessage('error.auth.accountDisabled', 'This account has been disabled. Contact your administrator.');
  }

  return getAuthErrorMessage('error.auth.accountExpired', 'This account access has expired. Contact your administrator.');
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

  const resolveUserAccess = async (uid: string, email?: string | null) => {
    const profile = await userProfileService.getProfile(uid);
    if (profile) {
      return {
        accessSnapshot: getUserAccessSnapshot(profile),
        accessState: getUserAccessState(profile)
      };
    }

    const offlineAuth = await secureStorage.getOfflineAuth();
    if (offlineAuth && offlineAuth.uid === uid && (!email || offlineAuth.email === email)) {
      return {
        accessSnapshot: getUserAccessSnapshot(offlineAuth),
        accessState: getUserAccessState(offlineAuth)
      };
    }

    const accessSnapshot: UserAccessShape = getUserAccessSnapshot(null);
    return {
      accessSnapshot,
      accessState: getUserAccessState(accessSnapshot)
    };
  };

  const blockAccess = async (accessState: UserAccessState, shouldNotify: boolean = true) => {
    const message = getAccessBlockedMessage(accessState);

    await secureStorage.removeOfflineAuth();
    setUser(null);
    setIsAuthReady(true);
    setLoading(false);
    void hybridDB.setUserId('');

    if (shouldNotify) {
      toast.error(message);
    }

    return message;
  };

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
        
        // Update hybrid database service with user ID
        if (currentUser?.uid) {
          const { accessSnapshot, accessState } = await resolveUserAccess(currentUser.uid, currentUser.email);

          if (accessState.blocked) {
            await blockAccess(accessState);
            try {
              await signOut(auth);
            } catch (error) {
              console.warn('🔐 Failed to sign out blocked user:', error);
            }
            return;
          }

          setUser(currentUser);

          // Non-blocking: Let database initialization happen in background
          void hybridDB.setUserId(currentUser.uid).catch(err => {
            console.error('⚠️ Failed to set user ID in HybridDB:', err);
          });

          void secureStorage.storeOfflineAuth(currentUser.uid, currentUser.email || '', accessSnapshot).catch(err => {
            console.error('⚠️ Failed to store offline auth snapshot:', err);
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
              const accessState = token ? getUserAccessState(token) : null;

              if (!navigator.onLine && token && accessState && !accessState.blocked) {
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
      });

      // Safety timeout: ensure UI never stays on loading forever if auth callback stalls.
      authTimeout = setTimeout(() => {
        if (!mounted || authResolved) return;
        console.warn('🔐 Auth initialization timeout - continuing without resolved Firebase auth state');
        authResolved = true;
        setIsAuthReady(true);
        setLoading(false);
      }, 10000);
      
      // Check for cached auth only if Firebase hasn't resolved yet
      setTimeout(async () => {
        if (!mounted || authResolved) return;
        
        console.log('🔐 Firebase auth slow, checking cached credentials...');
        const offlineAuth = await secureStorage.getOfflineAuth();
        
        if (offlineAuth && !authResolved) {
          const accessState = getUserAccessState(offlineAuth);
          if (accessState.blocked) {
            authResolved = true;
            await blockAccess(accessState);
            return;
          }

          console.log('🔐 Auto-login with secure offline token');
          authResolved = true;

          const offlineUser = buildOfflineUser(offlineAuth.uid, offlineAuth.email);

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
  }, [authInitialized]);

  const signup = async (email: string, password: string) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      setUser(userCredential.user);
      await hybridDB.setUserId(userCredential.user.uid);
      
      // Store secure offline token (NO PASSWORD)
      await secureStorage.storeOfflineAuth(userCredential.user.uid, email, getUserAccessSnapshot(null));
      
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
    const hasInternet = navigator.onLine;
    console.log(`🔐 [AUTH] Browser connectivity hint: ${hasInternet ? '✅ ONLINE' : '❌ OFFLINE'}`);
    
    // If offline or no internet, try cached credentials with secure token
    if (!hasInternet) {
      console.log('🔄 No internet detected - checking secure offline token');
      const offlineAuth = await secureStorage.getOfflineAuth();
      
      if (offlineAuth && offlineAuth.email === email) {
        const accessState = getUserAccessState(offlineAuth);
        if (accessState.blocked) {
          throw new Error(await blockAccess(accessState, false));
        }

        console.log('🔄 Offline login using secure token');
        const offlineUser = buildOfflineUser(offlineAuth.uid, offlineAuth.email);
        
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

      const { accessSnapshot, accessState } = await resolveUserAccess(userCredential.user.uid, userCredential.user.email);
      if (accessState.blocked) {
        const message = await blockAccess(accessState, false);
        await signOut(auth);
        throw new Error(message);
      }
      
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
      await secureStorage.storeOfflineAuth(userCredential.user.uid, email, accessSnapshot);
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
          const accessState = getUserAccessState(offlineAuth);
          if (accessState.blocked) {
            throw new Error(await blockAccess(accessState, false));
          }

          console.log('🔄 Fallback to offline login');
          const offlineUser = buildOfflineUser(offlineAuth.uid, offlineAuth.email);
          
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
        isAuthenticated: !!user,
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
