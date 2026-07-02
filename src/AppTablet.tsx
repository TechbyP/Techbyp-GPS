import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import GPSTracker from './components/GPS/GPSTracker';
import AuthScreen from './components/Auth/AuthScreen';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useDarkMode } from './hooks/useDarkMode';
import NotificationContainer from './components/ui/NotificationContainer';
import { ConfirmationProvider } from './components/ui/ConfirmationProvider';
import { AnimatedLoader } from './components/ui/AnimatedLoader';
import ErrorBoundary from './components/ErrorBoundary';
import { ReloadPrompt } from './components/ReloadPrompt';
import './index.css';

// Import auth persistence test in development
if (import.meta.env.DEV) {
  import('./utils/testAuth');
  // Make Firebase sync debugger available globally in dev mode
  import('./utils/firebaseSyncDebugger');
}

// Protected route wrapper
function ProtectedRoute({ element }: { element: React.ReactNode }) {
  const auth = useAuth();

  if (!auth) {
    return null;
  }

  if (auth.loading && auth.isAuthenticated) {
    return element;
  }

  if (auth.loading) {
    return null;
  }

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

  useEffect(() => {
    let disposed = false;
    let wakeLock: any = null;

    const supportsWakeLock = typeof navigator !== 'undefined'
      && typeof document !== 'undefined'
      && 'wakeLock' in navigator
      && typeof (navigator as any).wakeLock?.request === 'function';

    const requestWakeLock = async () => {
      if (!supportsWakeLock || document.visibilityState !== 'visible') {
        return;
      }

      try {
        wakeLock = await (navigator as any).wakeLock.request('screen');

        wakeLock?.addEventListener?.('release', () => {
          wakeLock = null;
          if (!disposed && document.visibilityState === 'visible') {
            void requestWakeLock();
          }
        });
      } catch (error) {
        console.warn('Screen wake lock unavailable:', error);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void requestWakeLock();
      }
    };

    void requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLock && typeof wakeLock.release === 'function') {
        void wakeLock.release().catch(() => undefined);
      }
    };
  }, []);

  const handleForceAuthFallback = () => {
    setAllowAuthFallback(true);
  };

  useEffect(() => {
    let cancelled = false;

    if (!auth.loading || auth.isAuthenticated) {
      setAllowAuthFallback(false);
      return () => {
        cancelled = true;
      };
    }

    const timer = setTimeout(() => {
      if (cancelled || !auth.loading) return;
      setAllowAuthFallback(true);
    }, 12000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [auth.loading]);

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
              element={<ProtectedRoute element={<GPSTracker />} />}
            />
            <Route
              path="*"
              element={<ProtectedRoute element={<GPSTracker />} />}
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
              }
            }}
          />
        </div>
      </div>
    </NotificationContainer>
  );
}

function AppTablet() {
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

export default AppTablet;
