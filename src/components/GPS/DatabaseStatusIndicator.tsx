import { useState, useEffect, useRef } from 'react';
import { Wifi, WifiOff, Cloud, CheckCircle, AlertCircle, RefreshCw, LogIn } from 'lucide-react';
import { hybridDB } from '../../services/hybridDatabase';
import { useTranslation } from 'react-i18next';
import { isCapacitorApp } from '../../utils/platform';
import { useAuth } from '../../context/AuthContext';
import { useDarkMode } from '../../hooks/useDarkMode';

// Detect if running in Capacitor
const isCapacitor = isCapacitorApp();

export const DatabaseStatusIndicator = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { isDark } = useDarkMode();
  const [navPanelOpen, setNavPanelOpen] = useState(false);
  const [status, setStatus] = useState(hybridDB.getStatus());
  const [syncing, setSyncing] = useState(false);
  const [expandedOnline, setExpandedOnline] = useState(false);
  const [expandedSync, setExpandedSync] = useState(false);
  const [expandedComplete, setExpandedComplete] = useState(false);
  const [expandedOffline, setExpandedOffline] = useState(false);
  const prevOnlineRef = useRef(status.online);
  const prevPendingSyncRef = useRef(status.pendingSync);
  const onlineTimeoutRef = useRef<NodeJS.Timeout>();
  const syncTimeoutRef = useRef<NodeJS.Timeout>();
  const completeTimeoutRef = useRef<NodeJS.Timeout>();
  const [pendingItems, setPendingItems] = useState<ReturnType<typeof hybridDB.getSyncQueueSnapshot>>([]);
  const needsLogin = !user;
  const offline = !status.online;
  const [refreshingConnectivity, setRefreshingConnectivity] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setStatus(hybridDB.getStatus());
      // Sync local state with actual isSyncing status from hybridDatabase
      const diagnostics = hybridDB.getSyncDiagnostics();
      if (!diagnostics.queue.isSyncing && syncing) {
        console.log('[DatabaseStatusIndicator] Detected sync completed, resetting syncing state');
        setSyncing(false);
      }
    }, 2000);

    // Monitor if navigation panel is visible
    const navCheckInterval = setInterval(() => {
      const navPanel = document.querySelector('[data-nav-panel]');
      setNavPanelOpen(!!navPanel && navPanel.getAttribute('data-nav-panel') === 'true');
    }, 100);

    return () => {
      clearInterval(interval);
      clearInterval(navCheckInterval);
      if (onlineTimeoutRef.current) clearTimeout(onlineTimeoutRef.current);
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      if (completeTimeoutRef.current) clearTimeout(completeTimeoutRef.current);
    };
  }, [syncing]);

  // Auto-expand when online status changes
  useEffect(() => {
    if (prevOnlineRef.current !== status.online) {
      setExpandedOnline(true);
      if (onlineTimeoutRef.current) clearTimeout(onlineTimeoutRef.current);
      onlineTimeoutRef.current = setTimeout(() => {
        setExpandedOnline(false);
      }, 3000);
      prevOnlineRef.current = status.online;
    }
  }, [status.online]);

  // Auto-expand when pending sync changes
  useEffect(() => {
    if (prevPendingSyncRef.current !== status.pendingSync) {
      if (status.pendingSync > 0) {
        setExpandedSync(true);
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = setTimeout(() => {
          setExpandedSync(false);
        }, 3000);
      }
      prevPendingSyncRef.current = status.pendingSync;
    }
  }, [status.pendingSync]);

  // Auto-expand when sync completes
  useEffect(() => {
    if (status.online && status.pendingSync === 0 && prevPendingSyncRef.current > 0) {
      setExpandedComplete(true);
      if (completeTimeoutRef.current) clearTimeout(completeTimeoutRef.current);
      completeTimeoutRef.current = setTimeout(() => {
        setExpandedComplete(false);
      }, 3000);
    }
  }, [status.online, status.pendingSync]);

  // Collapse offline panel when back online
  useEffect(() => {
    if (!offline) {
      setExpandedOffline(false);
    }
  }, [offline]);

  const handleManualSync = async () => {
    if (syncing) {
      console.log('[DatabaseStatusIndicator] Sync already in progress, ignoring');
      return;
    }
    
    setSyncing(true);
    setExpandedSync(true);
    try {
      // Always attempt connectivity refresh first
      await hybridDB.refreshConnectivity(true);
      // Unified force sync (uploads + downstream pull)
      const result = await hybridDB.forceSync();
      console.log('[DatabaseStatusIndicator] Force sync result:', result);
      
      // Poll for sync completion (forceSync is non-blocking)
      let pollCount = 0;
      const maxPolls = 15; // 15 seconds max
      const pollInterval = setInterval(() => {
        const diagnostics = hybridDB.getSyncDiagnostics();
        pollCount++;
        
        if (!diagnostics.queue.isSyncing || pollCount >= maxPolls) {
          clearInterval(pollInterval);
          setSyncing(false);
          setStatus(hybridDB.getStatus());
          console.log('[DatabaseStatusIndicator] Sync completed or timed out');
        }
      }, 1000);
    } catch (error) {
      console.error('Manual sync failed:', error);
      setSyncing(false);
    }
  };

  const toggleOnlineExpand = () => {
    setExpandedOnline(!expandedOnline);
    if (!expandedOnline) {
      if (onlineTimeoutRef.current) clearTimeout(onlineTimeoutRef.current);
      onlineTimeoutRef.current = setTimeout(() => {
        setExpandedOnline(false);
      }, 3000);
    }
  };

  const handleConnectivityRefresh = async () => {
    setRefreshingConnectivity(true);
    try {
      await hybridDB.refreshConnectivity(true);
      setStatus(hybridDB.getStatus());
    } catch (err) {
      console.warn('Connectivity refresh failed', err);
    } finally {
      setRefreshingConnectivity(false);
    }
  };

  const toggleSyncExpand = () => {
    const next = !expandedSync;
    setExpandedSync(next);
    if (next) {
      setPendingItems(hybridDB.getSyncQueueSnapshot());
    }
    if (!expandedSync) {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(() => {
        setExpandedSync(false);
      }, 3000);
    }
  };

  const toggleCompleteExpand = () => {
    setExpandedComplete(!expandedComplete);
    if (!expandedComplete) {
      if (completeTimeoutRef.current) clearTimeout(completeTimeoutRef.current);
      completeTimeoutRef.current = setTimeout(() => {
        setExpandedComplete(false);
      }, 3000);
    }
  };
  
  return (
    <div className={`fixed top-16 z-[1000] flex flex-col items-end gap-2 pointer-events-none transition-all duration-500 ease-in-out ${
      navPanelOpen ? 'right-[448px] lg:right-[520px]' : 'right-4'
    }`}>
      {/* Small circular login button when login is required */}
      {needsLogin && (
        <button
          onClick={() => {
            // Navigate to login or show login modal
            window.location.reload(); // Simple way to show login screen
          }}
          className="pointer-events-auto w-8 h-8 rounded-full bg-amber-500/90 hover:bg-amber-600/90 text-white shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out flex items-center justify-center"
          title={t('db.loginRequired')}
        >
          <LogIn className="w-4 h-4" />
        </button>
      )}

      {/* Offline notification as expandable control above the status badge */}
      {offline && !needsLogin && (
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <button
            onClick={() => setExpandedOffline(!expandedOffline)}
            className={`flex items-center rounded-full font-medium shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out bg-amber-500/90 text-white hover:bg-amber-600/90 ${
              expandedOffline ? 'w-auto gap-2 px-2 py-1.5' : 'w-8 h-8 justify-center'
            }`}
            title={t('db.offline')}
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span
              className={`text-xs whitespace-nowrap transition-all duration-300 overflow-hidden ${
                expandedOffline ? 'opacity-100 max-w-xs' : 'opacity-0 max-w-0'
              }`}
            >
              {t('db.offline')}
            </span>
          </button>

          {expandedOffline && (
            <div className={`w-64 rounded-lg shadow-2xl backdrop-blur-xl p-3 glass-panel ${
              isDark ? 'glass-panel-dark' : 'glass-panel-light'
            }`}>
              <div className={`text-sm font-medium mb-2 ${
                isDark ? 'text-amber-300' : 'text-amber-700'
              }`}>{t('db.offlineMessage')}</div>
              <div className="flex gap-2">
                <button
                  onClick={handleConnectivityRefresh}
                  disabled={refreshingConnectivity}
                  className={`flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs font-semibold transition-colors ${
                    isDark
                      ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                      : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                  } ${refreshingConnectivity ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                  <RefreshCw className={`w-3 h-3 ${refreshingConnectivity ? 'animate-spin' : ''}`} />
                  {refreshingConnectivity ? t('db.checking') : t('db.retryConnection')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Online/Offline Status */}
      <button
        onClick={toggleOnlineExpand}
        className={`flex items-center rounded-full font-medium shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out pointer-events-auto cursor-pointer ${
          status.online
            ? 'bg-green-500/90 text-white hover:bg-green-600/90'
            : status.internetOnline 
            ? 'bg-orange-500/90 text-white hover:bg-orange-600/90'
            : 'bg-red-500/90 text-white hover:bg-red-600/90'
        } ${
          expandedOnline ? 'w-auto gap-1 px-1.5 py-1' : 'w-5 h-5 justify-center'
        }`}
        title={
          status.online 
            ? (isCapacitor ? 'Firebase Connected' : t('db.online'))
            : status.internetOnline 
            ? 'Connecting to Firebase...'
            : t('db.offline')
        }
      >
        {status.online ? (
          <Wifi className="w-2 h-2 flex-shrink-0" />
        ) : (
          <WifiOff className="w-2 h-2 flex-shrink-0" />
        )}
        <span className={`text-xs whitespace-nowrap transition-all duration-300 overflow-hidden ${
          expandedOnline ? 'opacity-100 max-w-xs' : 'opacity-0 max-w-0'
        }`}>
          {status.online 
            ? (isCapacitor ? 'Firebase' : t('db.online'))
            : status.backendOnline === false && !isCapacitor
            ? 'Backend Offline'
            : t('db.offline')
          }
        </span>
      </button>

      {/* Pending Sync Badge */}
      {status.pendingSync > 0 && (
        <button
          onClick={() => {
            if (status.online && !syncing) {
              handleManualSync();
            }
            toggleSyncExpand();
          }}
          disabled={syncing}
          className={`flex items-center rounded-full font-medium shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out pointer-events-auto ${
            syncing
              ? 'bg-blue-500/90 text-white cursor-wait w-auto gap-1 px-1.5 py-1'
              : status.online
              ? 'bg-yellow-500/90 text-white hover:bg-yellow-600/90 cursor-pointer'
              : 'bg-gray-500/90 text-white cursor-not-allowed'
          } ${
            expandedSync || syncing ? 'w-auto gap-1 px-1.5 py-1' : 'w-5 h-5 justify-center'
          }`}
          title={status.online ? t('db.syncing') : t('db.offline')}
        >
          {syncing ? (
            <>
              <Cloud className="w-2 h-2 flex-shrink-0 animate-pulse" />
              <span className="text-xs whitespace-nowrap">{t('db.syncing')}</span>
            </>
          ) : (
            <>
              <AlertCircle className="w-2 h-2 flex-shrink-0" />
              <span className={`text-xs whitespace-nowrap transition-all duration-300 overflow-hidden ${
                expandedSync ? 'opacity-100 max-w-xs' : 'opacity-0 max-w-0'
              }`}>
                {status.pendingSync} {t('db.pendingSync')}
              </span>
            </>
          )}
        </button>
      )}

      {/* Pending list + force sync panel */}
      {expandedSync && status.pendingSync > 0 && (
        <div className={`pointer-events-auto w-72 rounded-lg shadow-2xl backdrop-blur-xl p-3 flex flex-col gap-2 glass-panel ${
          isDark ? 'glass-panel-dark' : 'glass-panel-light'
        }`}>
          <div className={`flex items-center justify-between text-sm font-semibold ${
            isDark ? 'text-blue-300' : 'text-blue-700'
          }`}>
            <span>{status.pendingSync} {t('db.pendingSync')}</span>
            <button
              onClick={handleManualSync}
              disabled={syncing}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold transition-colors ${
                status.online && !syncing
                  ? isDark
                    ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
                    : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                  : isDark
                    ? 'bg-gray-700/50 text-gray-400 cursor-not-allowed'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
              }`}
            >
              <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? t('db.syncing') : t('db.forceSync')}
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1 text-xs">
            {pendingItems.length === 0 ? (
              <div className={isDark ? 'text-gray-400' : 'text-gray-600'}>{t('db.noDetails')}</div>
            ) : (
              pendingItems.map((item, idx) => (
                <div key={`${item.id}-${idx}`} className={`flex items-center justify-between rounded px-2 py-1 ${
                  isDark ? 'bg-gray-700/30' : 'bg-gray-100/50'
                }`}>
                  <div className="flex flex-col">
                    <span className={`font-semibold ${
                      isDark ? 'text-gray-200' : 'text-gray-800'
                    }`}>{item.type} · {item.action}</span>
                    <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>{t('db.itemId')}: {String(item.id).slice(-8)}</span>
                  </div>
                  <div className={`text-right ${
                    isDark ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    <div>{t('db.attempts')}: {item.attempts ?? 0}</div>
                    {item.nextAttemptAt ? <div className="text-[11px]">{t('db.nextAttempt')}: {new Date(item.nextAttemptAt).toLocaleTimeString()}</div> : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Sync Complete */}
      {status.online && status.pendingSync === 0 && (
        <button
          onClick={() => {
            // Trigger a resync even when queue is empty
            if (!syncing) {
              handleManualSync();
            }
            toggleCompleteExpand();
          }}
          className={`flex items-center rounded-full font-medium bg-emerald-500/90 text-white shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out pointer-events-auto cursor-pointer hover:bg-emerald-600/90 ${
            expandedComplete ? 'w-auto gap-1 px-1.5 py-1' : 'w-5 h-5 justify-center'
          }`}
        >
          <CheckCircle className="w-2 h-2 flex-shrink-0" />
          <span className={`text-xs whitespace-nowrap transition-all duration-300 overflow-hidden ${
            expandedComplete ? 'opacity-100 max-w-xs' : 'opacity-0 max-w-0'
          }`}>
            {t('db.syncComplete')}
          </span>
        </button>
      )}
    </div>
  );
};
