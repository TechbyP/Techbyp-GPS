import { useRegisterSW } from 'virtual:pwa-register/react'
import { useEffect } from 'react'
import { useLanguage } from '../hooks/useLanguage'
import toast from 'react-hot-toast'
import { isCapacitorApp } from '../utils/platform'

const swDevEnabled = !import.meta.env.DEV || import.meta.env.VITE_ENABLE_SW_DEV === 'true'
const swCleanupSessionKey = 'gps-app-sw-cleanup-v3'
const workboxCacheNames = ['osm-tiles', 'esri-tiles', 'local-tiles']
const webPwaEnabled = ((import.meta.env.VITE_ENABLE_WEB_PWA as string | undefined) || '').toLowerCase() === 'true'
const shouldEnableSwRuntime = isCapacitorApp() || webPwaEnabled

function DisableWebServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }

    let cancelled = false

    const disableServiceWorker = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)))

        const cacheNames = typeof caches !== 'undefined' ? await caches.keys() : []
        const staleCacheNames = cacheNames.filter((cacheName) => (
          cacheName.startsWith('workbox-') || workboxCacheNames.includes(cacheName)
        ))
        await Promise.all(staleCacheNames.map((cacheName) => caches.delete(cacheName).catch(() => false)))
      } catch (error) {
        if (!cancelled) {
          console.warn('[sw-disable] Failed to disable service worker on web runtime:', error)
        }
      }
    }

    void disableServiceWorker()

    return () => {
      cancelled = true
    }
  }, [])

  return null
}

function DevServiceWorkerCleanup() {
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return
    }

    if (typeof window === 'undefined' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }

    if (window.sessionStorage.getItem(swCleanupSessionKey) === 'done') {
      return
    }

    let cancelled = false

    const cleanupStaleServiceWorkers = async () => {
      const registrations = await navigator.serviceWorker.getRegistrations()
      const staleRegistrations = registrations.filter((registration) => {
        const scriptUrl = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || ''
        return scriptUrl.endsWith('/sw.js')
      })

      const unregisterResults = await Promise.all(staleRegistrations.map((registration) => registration.unregister()))
      const cacheNames = typeof caches !== 'undefined' ? await caches.keys() : []
      const staleCacheNames = cacheNames.filter((cacheName) => (
        cacheName.startsWith('workbox-') || workboxCacheNames.includes(cacheName)
      ))
      await Promise.all(staleCacheNames.map((cacheName) => caches.delete(cacheName)))

      const changed = unregisterResults.some(Boolean) || staleCacheNames.length > 0
      window.sessionStorage.setItem(swCleanupSessionKey, 'done')

      if (!cancelled && changed) {
        window.location.reload()
      }
    }

    void cleanupStaleServiceWorkers()

    return () => {
      cancelled = true
    }
  }, [])

  return null
}

function ActiveReloadPrompt() {
  const { t } = useLanguage()
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r: any) {
      console.log('SW Registered: ' + r)
    },
    onRegisterError(error: any) {
      console.log('SW registration error', error)
    },
  })

  useEffect(() => {
    if (offlineReady) {
      setOfflineReady(false)
    }
  }, [offlineReady, setOfflineReady])

  useEffect(() => {
    if (needRefresh) {
      toast((toastRef) => (
        <div className="flex flex-col gap-2">
          <span>{t('common.newContentAvailable')}</span>
          <div className="flex gap-2">
            <button
              className="bg-blue-500 text-white px-3 py-1 rounded text-sm"
              onClick={() => updateServiceWorker(true)}
            >
              {t('common.reload')}
            </button>
            <button
              className="bg-gray-500 text-white px-3 py-1 rounded text-sm"
              onClick={() => {
                setNeedRefresh(false)
                toast.dismiss(toastRef.id)
              }}
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      ), {
        duration: Infinity,
        position: 'bottom-right',
      })
    }
  }, [needRefresh, setNeedRefresh, updateServiceWorker, t])

  return null
}

export function ReloadPrompt() {
  if (!shouldEnableSwRuntime) {
    return <DisableWebServiceWorker />
  }

  if (!swDevEnabled) {
    return <DevServiceWorkerCleanup />
  }

  return <ActiveReloadPrompt />
}
