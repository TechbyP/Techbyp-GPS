import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Wifi, WifiOff, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { firebaseGPS } from '../../services/firebaseSync';
import { hybridDB } from '../../services/hybridDatabase';
import { auth } from '../../firebase';
import { useLanguage } from '../../hooks/useLanguage';
import toast from 'react-hot-toast';

interface SyncStatus {
  isOnline: boolean;
  isAuthenticated: boolean;
  firebaseConnected: boolean;
  projectCount: {
    local: number;
    firebase: number;
  };
  lastSync: string | null;
  syncInProgress: boolean;
  errors: string[];
}

export default function SyncStatusPanel() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<SyncStatus>({
    isOnline: navigator.onLine,
    isAuthenticated: false,
    firebaseConnected: false,
    projectCount: { local: 0, firebase: 0 },
    lastSync: null,
    syncInProgress: false,
    errors: []
  });

  const [expanded, setExpanded] = useState(false);

  const checkStatus = useCallback(async () => {
    const errors: string[] = [];
    
    try {
      const isAuth = !!auth.currentUser;
      const userId = auth.currentUser?.uid || '';

      // Check Firebase connectivity
      let firebaseConnected = false;
      try {
        const pingResult = await firebaseGPS.ping();
        firebaseConnected = pingResult.success;
        if (!pingResult.success) {
          errors.push(t('gps.syncStatus.firebaseError', { error: pingResult.error || t('common.unknownError') }));
        }
      } catch (e: any) {
        errors.push(t('gps.syncStatus.firebaseConnectionFailed', { error: e.message }));
      }

      // Count projects
      let localCount = 0;
      let firebaseCount = 0;

      try {
        const localProjects = await hybridDB.getProjects();
        localCount = localProjects.length;
      } catch (e: any) {
        errors.push(t('gps.syncStatus.localProjectsError', { error: e.message }));
      }

      if (isAuth && firebaseConnected) {
        try {
          const firebaseProjects = await firebaseGPS.getProjects(userId);
          firebaseCount = firebaseProjects.length;
        } catch (e: any) {
          errors.push(t('gps.syncStatus.firebaseProjectsError', { error: e.message }));
        }
      }

      setStatus({
        isOnline: navigator.onLine,
        isAuthenticated: isAuth,
        firebaseConnected,
        projectCount: { local: localCount, firebase: firebaseCount },
        lastSync: new Date().toLocaleTimeString(),
        syncInProgress: false,
        errors
      });

    } catch (e: any) {
      setStatus(prev => ({
        ...prev,
        errors: [...prev.errors, t('gps.syncStatus.statusCheckFailed', { error: e.message })]
      }));
    }
  }, [t]);

  const forcSync = async () => {
    setStatus(prev => ({ ...prev, syncInProgress: true, errors: [] }));
    toast.loading(t('common.forcingSync'), { id: 'force-sync' });

    try {
      // Call public forceSync method on hybridDB
      const result = await hybridDB.forceSync();
      
      if (result.success) {
        // Wait a moment and recheck status
        setTimeout(() => {
          checkStatus();
          toast.success(t('gps.syncStatus.syncInitiated'), { id: 'force-sync' });
        }, 2000);
      } else {
        toast.error(t('gps.syncStatus.syncFailed', { message: result.message }), { id: 'force-sync' });
        setStatus(prev => ({ ...prev, syncInProgress: false }));
      }
    } catch (e: any) {
      toast.error(t('gps.syncStatus.syncError', { message: e.message }), { id: 'force-sync' });
      setStatus(prev => ({ ...prev, syncInProgress: false }));
    }
  };

  const clearCacheAndSync = async () => {
    setStatus(prev => ({ ...prev, syncInProgress: true }));
    toast.loading(t('common.clearingCache'), { id: 'clear-cache' });

    try {
      const userId = auth.currentUser?.uid || '';
      if (userId) {
        // Clear localStorage cache
        const keys = Object.keys(localStorage);
        let clearedCount = 0;
        
        for (const key of keys) {
          if (key.includes(`gps_local_${userId}_`)) {
            localStorage.removeItem(key);
            clearedCount++;
          }
        }
        
        toast.success(t('gps.syncStatus.cacheCleared', { count: clearedCount }), { id: 'clear-cache' });
        
        // Force fresh fetch
        setTimeout(() => {
          checkStatus();
        }, 1000);
      }
    } catch (e: any) {
      toast.error(t('gps.syncStatus.clearCacheFailed', { message: e.message }), { id: 'clear-cache' });
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, [checkStatus]);

  const getStatusIcon = () => {
    if (status.syncInProgress) return <RefreshCw className="w-4 h-4 animate-spin" />;
    if (status.errors.length > 0) return <AlertCircle className="w-4 h-4 text-red-500" />;
    if (!status.isOnline) return <WifiOff className="w-4 h-4 text-red-500" />;
    if (!status.firebaseConnected) return <Wifi className="w-4 h-4 text-yellow-500" />;
    return <CheckCircle className="w-4 h-4 text-green-500" />;
  };

  const getStatusColor = () => {
    if (status.errors.length > 0) return 'bg-red-50 border-red-200';
    if (!status.isOnline || !status.firebaseConnected) return 'bg-yellow-50 border-yellow-200';
    return 'bg-green-50 border-green-200';
  };

  return (
    <div className={`rounded-lg border-2 p-4 mb-4 ${getStatusColor()}`}>
      <div 
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center space-x-2">
          {getStatusIcon()}
          <span className="font-medium">
            {t('gps.syncStatus.summary', {
              local: status.projectCount.local,
              firebase: status.projectCount.firebase
            })}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          {status.lastSync && (
            <span className="text-sm text-gray-600 flex items-center">
              <Clock className="w-3 h-3 mr-1" />
              {status.lastSync}
            </span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <strong>{t('gps.syncStatus.network')}:</strong> {status.isOnline ? `✅ ${t('gps.syncStatus.online')}` : `❌ ${t('gps.syncStatus.offline')}`}
            </div>
            <div>
              <strong>{t('gps.syncStatus.auth')}:</strong> {status.isAuthenticated ? `✅ ${t('gps.syncStatus.loggedIn')}` : `❌ ${t('gps.syncStatus.notLoggedIn')}`}
            </div>
            <div>
              <strong>{t('gps.syncStatus.firebase')}:</strong> {status.firebaseConnected ? `✅ ${t('gps.syncStatus.connected')}` : `❌ ${t('gps.syncStatus.disconnected')}`}
            </div>
            <div>
              <strong>{t('gps.syncStatus.user')}:</strong> {auth.currentUser?.email || t('gps.syncStatus.none')}
            </div>
          </div>

          {status.errors.length > 0 && (
            <div className="bg-red-100 border border-red-200 rounded p-3">
              <strong className="text-red-800">{t('gps.syncStatus.errors')}:</strong>
              <ul className="mt-1 list-disc list-inside text-sm text-red-700">
                {status.errors.map((error, idx) => (
                  <li key={idx}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex space-x-2">
            <button
              onClick={checkStatus}
              disabled={status.syncInProgress}
              className="px-3 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50"
            >
              {t('gps.syncStatus.refreshStatus')}
            </button>
            <button
              onClick={forcSync}
              disabled={status.syncInProgress}
              className="px-3 py-2 bg-green-500 text-white rounded text-sm hover:bg-green-600 disabled:opacity-50"
            >
              {t('gps.syncStatus.forceSync')}
            </button>
            <button
              onClick={clearCacheAndSync}
              disabled={status.syncInProgress}
              className="px-3 py-2 bg-orange-500 text-white rounded text-sm hover:bg-orange-600 disabled:opacity-50"
            >
              {t('gps.syncStatus.clearCache')}
            </button>
          </div>

          <div className="text-xs text-gray-600 bg-gray-100 p-2 rounded">
            <strong>{t('gps.syncStatus.help')}:</strong> {t('gps.syncStatus.helpText')}
          </div>
        </div>
      )}
    </div>
  );
}