// ==========================================
// App initialization

// Translation fallbacks for global error handler
const getErrorText = (key: string, fallback: string) => {
  try {
    // Try to get from localStorage if i18n was initialized
    // For simplicity, we'll use English fallbacks as global errors happen before i18n loads
    const translations = {
      'error.global.initializationTitle': '⚠️ App Initialization Error',
      'error.global.promiseRejectionTitle': '⚠️ Promise Rejection Error',
      'error.global.errorLabel': 'Error:',
      'error.global.stackLabel': 'Stack:',
      'error.global.unknownError': 'Unknown error',
      'error.global.noStackTrace': 'No stack trace',
      'error.global.reload': 'Reload'
    };
    return translations[key as keyof typeof translations] || fallback;
  } catch {
    return fallback;
  }
};

// Global error handler - catches all unhandled errors
window.addEventListener('error', (event) => {
  console.error('🚨 GLOBAL ERROR:', event.error);
  document.body.innerHTML = `
    <div style="background: #1a1a1a; color: white; padding: 20px; font-family: monospace; overflow: auto; min-height: 100vh;">
      <h1 style="color: #ff6b6b;">${getErrorText('error.global.initializationTitle', '⚠️ App Initialization Error')}</h1>
      <div style="background: #2a2a2a; padding: 15px; margin: 10px 0; border-radius: 5px;">
        <strong>${getErrorText('error.global.errorLabel', 'Error:')}</strong> ${event.error?.message || getErrorText('error.global.unknownError', 'Unknown error')}
      </div>
      <div style="background: #2a2a2a; padding: 15px; margin: 10px 0; border-radius: 5px;">
        <strong>${getErrorText('error.global.stackLabel', 'Stack:')}</strong><br><pre style="white-space: pre-wrap; word-break: break-all;">${event.error?.stack || getErrorText('error.global.noStackTrace', 'No stack trace')}</pre>
      </div>
      <button onclick="location.reload()" style="background: #4CAF50; color: white; padding: 10px 20px; border: none; border-radius: 5px; font-size: 16px; cursor: pointer;">${getErrorText('error.global.reload', 'Reload')}</button>
    </div>
  `;
  event.preventDefault();
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('🚨 UNHANDLED PROMISE REJECTION:', event.reason);
  document.body.innerHTML = `
    <div style="background: #1a1a1a; color: white; padding: 20px; font-family: monospace; overflow: auto; min-height: 100vh;">
      <h1 style="color: #ff6b6b;">${getErrorText('error.global.promiseRejectionTitle', '⚠️ Promise Rejection Error')}</h1>
      <div style="background: #2a2a2a; padding: 15px; margin: 10px 0; border-radius: 5px;">
        <strong>${getErrorText('error.global.errorLabel', 'Error:')}</strong> ${event.reason?.message || String(event.reason) || getErrorText('error.global.unknownError', 'Unknown error')}
      </div>
      <div style="background: #2a2a2a; padding: 15px; margin: 10px 0; border-radius: 5px;">
        <strong>${getErrorText('error.global.stackLabel', 'Stack:')}</strong><br><pre style="white-space: pre-wrap; word-break: break-all;">${event.reason?.stack || getErrorText('error.global.noStackTrace', 'No stack trace')}</pre>
      </div>
      <button onclick="location.reload()" style="background: #4CAF50; color: white; padding: 10px 20px; border: none; border-radius: 5px; font-size: 16px; cursor: pointer;">${getErrorText('error.global.reload', 'Reload')}</button>
    </div>
  `;
  event.preventDefault();
});

const swDevEnabled = ((import.meta.env.VITE_ENABLE_SW_DEV as string | undefined) || '').toLowerCase() === 'true';

// In dev, unregister any existing service workers unless explicitly enabled
if (import.meta.env.DEV && !swDevEnabled && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister().catch(() => undefined));
  }).catch(() => undefined);
}

import ReactDOM from 'react-dom/client';
import App from './App';
import './i18n/index';
import './index.css';
import { environmentConfig } from './config/environment';
import { getDeviceInfo } from './utils/deviceDetection';

// Log device capabilities
getDeviceInfo();

// Debug utilities - available in dev mode
if (import.meta.env.DEV) {
  import('./utils/firestoreDebug').then(({ debugUserFirestoreData, logAllUsers }) => {
    (window as any).debugUserData = debugUserFirestoreData;
    (window as any).logAllUsers = logAllUsers;
  });
  
  // Show current environment info
  (window as any).getEnvironment = () => {
    const envConfig = environmentConfig.getConfig();
    return {
      platform: envConfig.platform,
      environment: envConfig.environment,
      isNative: envConfig.isNative,
    };
  };
  
  // Add GPS diagnostics in development
  import('./utils/gpsConnectionDiagnostic').then(({ setupGPSDiagnostics }) => {
    setupGPSDiagnostics();
  });
}

// Hide splash screen once React app loads
const hideSplashScreen = () => {
  const loader = document.getElementById('app-loader');
  document.documentElement.style.overflow = 'auto';
  document.body.style.overflow = 'auto';
  const root = document.getElementById('root');
  if (root) {
    root.style.overflow = 'visible';
  }
  if (loader) {
    loader.style.opacity = '0';
    loader.style.transition = 'opacity 0.3s ease-out';
    setTimeout(() => {
      loader.remove();
    }, 300);
  }
};

// Temporarily disable StrictMode to test authentication persistence
// StrictMode intentionally double-invokes effects which can interfere with Firebase Auth
ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
);

// Hide splash screen after app renders
setTimeout(hideSplashScreen, 100);
