import { isCapacitorApp } from './platform';

const RECOVERY_ATTEMPT_KEY = 'gps_app_startup_recovery_attempted';
const RECOVERY_PARAM = 'startupRecovery';
const RECOVERY_RETURN_PARAM = 'startupRecoveryReturn';
const startupRecoveryEnabled = ((import.meta.env.VITE_ENABLE_STARTUP_RECOVERY as string | undefined) || '').toLowerCase() === 'true';

export type StartupRecoveryReason = 'auth-init-timeout';

const canRecoverOnThisPlatform = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (!startupRecoveryEnabled) return false;
  if (import.meta.env.DEV) return false;
  if (isCapacitorApp()) return false;
  return true;
};

export async function triggerAutomaticStartupRecovery(reason: StartupRecoveryReason): Promise<boolean> {
  if (!canRecoverOnThisPlatform()) {
    return false;
  }

  try {
    const attempted = window.sessionStorage.getItem(RECOVERY_ATTEMPT_KEY);
    if (attempted) {
      return false;
    }
    window.sessionStorage.setItem(RECOVERY_ATTEMPT_KEY, reason);
  } catch {
    return false;
  }

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(reg => reg.unregister().catch(() => false)));
    }

    if ('caches' in window) {
      const cacheNames = await window.caches.keys();
      await Promise.all(cacheNames.map(cacheName => window.caches.delete(cacheName).catch(() => false)));
    }
  } catch (error) {
    console.warn('[StartupRecovery] Failed to clear service worker/cache state:', error);
  }

  const currentUrl = new URL(window.location.href);
  const targetUrl = new URL(import.meta.env.BASE_URL || '/', window.location.origin);
  targetUrl.searchParams.set(RECOVERY_PARAM, Date.now().toString());

  const returnUrl = new URL(currentUrl.toString());
  returnUrl.searchParams.delete(RECOVERY_PARAM);
  returnUrl.searchParams.delete(RECOVERY_RETURN_PARAM);
  const returnPath = `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`;
  if (returnPath && returnPath !== '/') {
    targetUrl.searchParams.set(RECOVERY_RETURN_PARAM, returnPath);
  }

  window.location.replace(targetUrl.toString());

  return true;
}

export function clearStartupRecoveryMarker(): void {
  if (!canRecoverOnThisPlatform()) {
    return;
  }

  try {
    window.sessionStorage.removeItem(RECOVERY_ATTEMPT_KEY);
  } catch {
    // ignore
  }

  try {
    const currentUrl = new URL(window.location.href);
    if (!currentUrl.searchParams.has(RECOVERY_PARAM)) {
      return;
    }

    const recoveryReturnPath = currentUrl.searchParams.get(RECOVERY_RETURN_PARAM);
    currentUrl.searchParams.delete(RECOVERY_PARAM);
    currentUrl.searchParams.delete(RECOVERY_RETURN_PARAM);

    if (recoveryReturnPath) {
      const recoveryReturnUrl = new URL(recoveryReturnPath, window.location.origin);
      if (recoveryReturnUrl.origin === window.location.origin) {
        currentUrl.pathname = recoveryReturnUrl.pathname;
        currentUrl.search = recoveryReturnUrl.search;
        currentUrl.hash = recoveryReturnUrl.hash;
      }
    }

    window.history.replaceState({}, document.title, currentUrl.toString());
  } catch {
    // ignore
  }
}