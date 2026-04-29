// ==========================================
// App initialization

// Translation fallbacks for global error handler
const getErrorText = (key: string, fallback: string) => {
  try {
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

// In dev, unregister any existing service workers unless explicitly enabled
if (import.meta.env.DEV && !import.meta.env.VITE_ENABLE_SW_DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister().catch(() => undefined));
  }).catch(() => undefined);
}

import ReactDOM from 'react-dom/client';
import AppTablet from './AppTablet';
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

  (window as any).getEnvironment = () => {
    const envConfig = environmentConfig.getConfig();
    return {
      platform: envConfig.platform,
      environment: envConfig.environment,
      isNative: envConfig.isNative,
    };
  };

  import('./utils/gpsConnectionDiagnostic').then(({ setupGPSDiagnostics }) => {
    setupGPSDiagnostics();
  });
}

const hideSplashScreen = () => {
  const loader = document.getElementById('app-loader');
  if (loader) {
    loader.style.opacity = '0';
    loader.style.transition = 'opacity 0.3s ease-out';
    setTimeout(() => {
      loader.remove();
    }, 300);
  }
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppTablet />
);

setTimeout(hideSplashScreen, 100);
