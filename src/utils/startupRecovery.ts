import { isCapacitorApp } from './platform';

const RECOVERY_ATTEMPT_KEY = 'gps_app_startup_recovery_attempted';
const RECOVERY_PARAM = 'startupRecovery';

export type StartupRecoveryReason = 'auth-init-timeout';

const canRecoverOnThisPlatform = (): boolean => {
  if (typeof window === 'undefined') return false;
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

  const targetUrl = new URL(window.location.href);
  targetUrl.searchParams.set(RECOVERY_PARAM, Date.now().toString());
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

    currentUrl.searchParams.delete(RECOVERY_PARAM);
    window.history.replaceState({}, document.title, currentUrl.toString());
  } catch {
    // ignore
  }
}