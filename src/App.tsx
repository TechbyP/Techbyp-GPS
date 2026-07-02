import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useEffect, useState, lazy, Suspense } from 'react';
import AuthScreen from './components/Auth/AuthScreen';
import LandingPage from './components/Web/LandingPage';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useDarkMode } from './hooks/useDarkMode';
import NotificationContainer from './components/ui/NotificationContainer';
import { ConfirmationProvider } from './components/ui/ConfirmationProvider';
import { AnimatedLoader } from './components/ui/AnimatedLoader';
import ErrorBoundary from './components/ErrorBoundary';
import { ReloadPrompt } from './components/ReloadPrompt';
import { secureStorage } from './utils/secureStorage';
import './index.css';

const OrdersMainPage = lazy(() => import('./components/Web/Orders/OrdersMainPage'));
const AdminPage = lazy(() => import('./components/Web/Admin/AdminPage'));

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

function AuthLoadingScreen({ onForceAuthFallback }: { onForceAuthFallback: () => void }) {
  const [isDarkMode] = useDarkMode();
  const { t } = useTranslation();

  return (
    <div className={isDarkMode ? 'dark' : ''}>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center px-4">
        <AnimatedLoader message={t('common.loadingAuth') || 'Loading'} />
        <button
          type="button"
          onClick={onForceAuthFallback}
          className="mt-4 px-4 py-2 rounded-lg border text-sm font-medium transition-colors bg-white text-gray-700 border-gray-300 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700"
        >
          {t('common.continueToLogin') || 'Continue to login'}
        </button>
      </div>
    </div>
  );
}

function RouteChunkLoadingScreen() {
  const [isDarkMode] = useDarkMode();
  const { t } = useTranslation();

  return (
    <div className={isDarkMode ? 'dark' : ''}>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
        <AnimatedLoader message={t('common.loading') || 'Loading'} />
      </div>
    </div>
  );
}

// Protected route wrapper
function ProtectedRoute({
  element,
  allowAuthFallback,
  onForceAuthFallback,
}: {
  element: React.ReactNode;
  allowAuthFallback: boolean;
  onForceAuthFallback: () => void;
}) {
  const auth = useAuth();
  
  // Handle HMR race condition where context might not be ready
  if (!auth) {
    return null; // Context not ready, render nothing
  }

  // If we already have an authenticated user, do not block on loading forever.
  if (auth.loading && auth.isAuthenticated) {
    return element;
  }
  
  if (auth.loading && !allowAuthFallback) {
    return <AuthLoadingScreen onForceAuthFallback={onForceAuthFallback} />;
  }
  
  if (!auth.isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return element;
}

function LoginRoute() {
  const auth = useAuth();

  if (auth.isAuthenticated) {
    return <Navigate to="/app" replace />;
  }

  return <AuthScreen />;
}

// Main app content
function AppContent() {
  const [isDarkMode] = useDarkMode();
  const auth = useAuth();
  const location = useLocation();
  const [allowAuthFallback, setAllowAuthFallback] = useState(false);

  const handleForceAuthFallback = () => {
    setAllowAuthFallback(true);
  };

  useEffect(() => {
    let cancelled = false;
    let quickFallbackTriggered = false;

    if (!auth.loading || auth.isAuthenticated) {
      setAllowAuthFallback(false);
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
      setAllowAuthFallback(true);
    }, 12000);

    return () => {
      cancelled = true;
      clearTimeout(quickFallbackTimer);
      clearTimeout(recoveryTimer);
    };
  }, [auth.isAuthenticated, auth.loading]);

  useEffect(() => {
    const root = document.getElementById('root');
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousHtmlOverflowY = document.documentElement.style.overflowY;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverflowY = document.body.style.overflowY;
    const previousRootOverflow = root?.style.overflow ?? '';
    const previousRootOverflowY = root?.style.overflowY ?? '';

    const publicRoute = location.pathname === '/' || location.pathname === '/login';

    document.documentElement.style.overflow = publicRoute ? 'auto' : 'hidden';
    document.documentElement.style.overflowY = publicRoute ? 'auto' : 'hidden';
    document.body.style.overflow = publicRoute ? 'auto' : 'hidden';
    document.body.style.overflowY = publicRoute ? 'auto' : 'hidden';
    if (root) {
      root.style.overflow = publicRoute ? 'auto' : 'hidden';
      root.style.overflowY = publicRoute ? 'auto' : 'hidden';
    }

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.overflowY = previousHtmlOverflowY;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overflowY = previousBodyOverflowY;
      if (root) {
        root.style.overflow = previousRootOverflow;
        root.style.overflowY = previousRootOverflowY;
      }
    };
  }, [location.pathname]);

  return (
    <NotificationContainer>
      <ReloadPrompt />
      <div className={isDarkMode ? 'dark' : ''}>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
          <Routes>
            <Route
              path="/"
              element={<LandingPage />}
            />
            <Route
              path="/login"
              element={<LoginRoute />}
            />
            <Route
              path="/app"
              element={(
                <Suspense fallback={<RouteChunkLoadingScreen />}>
                  <ProtectedRoute
                    element={<OrdersMainPage />}
                    allowAuthFallback={allowAuthFallback}
                    onForceAuthFallback={handleForceAuthFallback}
                  />
                </Suspense>
              )}
            />
            <Route
              path="/admin"
              element={(
                <Suspense fallback={<RouteChunkLoadingScreen />}>
                  <ProtectedRoute
                    element={<AdminPage />}
                    allowAuthFallback={allowAuthFallback}
                    onForceAuthFallback={handleForceAuthFallback}
                  />
                </Suspense>
              )}
            />
            <Route
              path="*"
              element={<Navigate to="/" replace />}
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
