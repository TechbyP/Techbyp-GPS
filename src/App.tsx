import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import OrdersMainPage from './components/Web/Orders/OrdersMainPage';
import AdminPage from './components/Web/Admin/AdminPage';
import AuthScreen from './components/Auth/AuthScreen';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useDarkMode } from './hooks/useDarkMode';
import NotificationContainer from './components/ui/NotificationContainer';
import { ConfirmationProvider } from './components/ui/ConfirmationProvider';
import { AnimatedLoader } from './components/ui/AnimatedLoader';
import ErrorBoundary from './components/ErrorBoundary';
import { ReloadPrompt } from './components/ReloadPrompt';
import { clearStartupRecoveryMarker, triggerAutomaticStartupRecovery } from './utils/startupRecovery';
import { secureStorage } from './utils/secureStorage';
import './index.css';

// Import auth persistence test in development
if (import.meta.env.DEV) {
  import('./utils/testAuth');
  // Make Firebase sync debugger available globally in dev mode
  import('./utils/firebaseSyncDebugger');
  // Import auth token utilities for debugging
  import('./utils/authTokenUtils');
  // Import admin status checker
  import('./utils/checkAdminStatus');
}

// Protected route wrapper
function ProtectedRoute({ element }: { element: React.ReactNode }) {
  const auth = useAuth();
  
  // Handle HMR race condition where context might not be ready
  if (!auth) {
    return null; // Context not ready, render nothing
  }

  // If we already have an authenticated user, do not block on loading forever.
  if (auth.loading && auth.isAuthenticated) {
    return element;
  }
  
  // Still loading auth state - don't show AuthScreen yet
  if (auth.loading) {
    return null; // Let the main auth provider handle loading state
  }
  
  // Show login if not authenticated
  if (!auth.isAuthenticated) {
    return <AuthScreen />;
  }

  return element;
}

// Main app content
function AppContent() {
  const [isDarkMode] = useDarkMode();
  const auth = useAuth();
  const { t } = useTranslation();
  const [allowAuthFallback, setAllowAuthFallback] = useState(false);

  const handleForceAuthFallback = () => {
    setAllowAuthFallback(true);
    void triggerAutomaticStartupRecovery('auth-init-timeout').catch(error => {
      console.warn('Manual startup recovery failed from app shell:', error);
    });
  };

  useEffect(() => {
    let cancelled = false;
    let quickFallbackTriggered = false;

    if (!auth.loading) {
      setAllowAuthFallback(false);
      clearStartupRecoveryMarker();
      return () => {
        cancelled = true;
      };
    }

    const quickFallbackTimer = setTimeout(() => {
      if (cancelled || !auth.loading || auth.isAuthenticated || quickFallbackTriggered) return;

      void secureStorage.getOfflineAuth()
        .then((offlineAuth) => {
          if (cancelled || !auth.loading || auth.isAuthenticated || quickFallbackTriggered) return;
          if (!offlineAuth) {
            quickFallbackTriggered = true;
            setAllowAuthFallback(true);
          }
        })
        .catch(() => {
          if (cancelled || !auth.loading || auth.isAuthenticated || quickFallbackTriggered) return;
          quickFallbackTriggered = true;
          setAllowAuthFallback(true);
        });
    }, 800);

    const recoveryTimer = setTimeout(() => {
      if (cancelled || !auth.loading) return;

      void triggerAutomaticStartupRecovery('auth-init-timeout')
        .catch(error => {
          console.warn('Auto startup recovery failed from app shell:', error);
        })
        .finally(() => {
          if (!cancelled) {
            setAllowAuthFallback(true);
          }
        });
    }, 12000);

    return () => {
      cancelled = true;
      clearTimeout(quickFallbackTimer);
      clearTimeout(recoveryTimer);
    };
  }, [auth.isAuthenticated, auth.loading]);

  // Show loading screen while auth is being resolved
  if (auth.loading && !allowAuthFallback && !auth.isAuthenticated) {
    return (
      <div className={isDarkMode ? 'dark' : ''}>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center px-4">
          <AnimatedLoader message={t('common.loadingAuth') || 'Loading'} />
          <button
            type="button"
            onClick={handleForceAuthFallback}
            className="mt-4 px-4 py-2 rounded-lg border text-sm font-medium transition-colors bg-white text-gray-700 border-gray-300 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700"
          >
            {t('common.continueToLogin') || 'Continue to login'}
          </button>
        </div>
      </div>
    );
  }

  if (allowAuthFallback && !auth.isAuthenticated) {
    return <AuthScreen />;
  }

  return (
    <NotificationContainer>
      <ReloadPrompt />
      <div className={isDarkMode ? 'dark' : ''}>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
          <Routes>
            <Route
              path="/"
              element={<ProtectedRoute element={<OrdersMainPage />} />}
            />
            <Route
              path="/admin"
              element={<ProtectedRoute element={<AdminPage />} />}
            />
            <Route
              path="*"
              element={<ProtectedRoute element={<OrdersMainPage />} />}
            />
          </Routes>

        <Toaster
          position="bottom-center"
          toastOptions={{
            duration: 3000,
            style: {
              background: isDarkMode ? '#1f2937' : '#ffffff',
              color: isDarkMode ? '#f3f4f6' : '#111827',
              cursor: 'pointer',
            },
            onClick: (event, toast) => {
              // Dismiss the toast when clicked
              if (toast && toast.id) {
                import('react-hot-toast').then(module => module.default.dismiss(toast.id));
              }
            },
          }}
        />
        </div>
      </div>
    </NotificationContainer>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ConfirmationProvider>
          <Router>
            <AppContent />
          </Router>
        </ConfirmationProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
