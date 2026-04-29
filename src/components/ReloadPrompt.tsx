import { useRegisterSW } from 'virtual:pwa-register/react'
import { useEffect } from 'react'
import { useLanguage } from '../hooks/useLanguage'
import toast from 'react-hot-toast'

export function ReloadPrompt() {
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
      // Provide a default English fallback in case the key is missing for the current locale
      toast.success(t('common.appReadyOffline', 'App ready to work offline'))
      setOfflineReady(false)
    }
  }, [offlineReady, setOfflineReady, t])

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
  }, [needRefresh, setNeedRefresh, updateServiceWorker])

  return null
}
