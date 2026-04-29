import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { hybridDB } from '../../services/hybridDatabase';
import toast from 'react-hot-toast';

export const SyncStatus: React.FC = () => {
  const { t } = useTranslation();
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const refreshDiagnostics = () => {
    try {
      const diag = hybridDB.getSyncDiagnostics();
      const stat = hybridDB.getStatus();
      setDiagnostics(diag);
      setStatus(stat);
    } catch (error) {
      console.error('Failed to get diagnostics:', error);
    }
  };

  useEffect(() => {
    refreshDiagnostics();

    if (autoRefresh) {
      const interval = setInterval(refreshDiagnostics, 2000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const handleForceSync = async () => {
    if (syncing) {
      console.log('[SyncStatus] Sync already in progress, ignoring');
      return;
    }
    
    setSyncing(true);
    try {
      const result = await hybridDB.forceSyncNow();
      if (result.success) {
        toast.success(`✅ ${result.message}`);
      } else {
        toast.error(`❌ ${result.message}`);
      }
      refreshDiagnostics();
    } catch (error: any) {
      toast.error(`❌ Sync failed: ${error.message}`);
    } finally {
      // Always reset syncing state
      setSyncing(false);
      console.log('[SyncStatus] Sync completed, resetting state');
    }
  };

  if (!diagnostics || !status) {
    return <div className="p-4 text-gray-400">{t('common.loading') || 'Loading...'}</div>;
  }

  const getStatusColor = () => {
    if (!diagnostics.network.navigatorOnline) return 'text-red-500';
    if (!diagnostics.network.backendOnline) return 'text-yellow-500';
    if (diagnostics.queue.length > 0) return 'text-blue-500';
    return 'text-green-500';
  };

  const getStatusIcon = () => {
    if (!diagnostics.network.navigatorOnline) return '📴';
    if (!diagnostics.network.backendOnline) return '⚠️';
    if (diagnostics.queue.isSyncing) return '🔄';
    if (diagnostics.queue.length > 0) return '⏳';
    return '✅';
  };

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg p-4 max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <span className={`text-2xl ${getStatusColor()}`}>{getStatusIcon()}</span>
          {t('databaseSyncStatus.title')}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1 rounded text-sm ${
              autoRefresh ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'
            }`}
          >
            {autoRefresh ? t('databaseSyncStatus.pauseAuto') : t('databaseSyncStatus.auto')}
          </button>
          <button
            onClick={refreshDiagnostics}
            className="px-3 py-1 bg-gray-700 text-white rounded text-sm hover:bg-gray-600"
          >
            {t('databaseSyncStatus.refresh')}
          </button>
        </div>
      </div>

      {/* Network Status */}
      <div className="mb-4 p-3 bg-gray-700 rounded">
        <h4 className="font-semibold text-white mb-2">{t('databaseSyncStatus.network')}</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="text-gray-300">
            {t('databaseSyncStatus.device')}: <span className={diagnostics.network.navigatorOnline ? 'text-green-400' : 'text-red-400'}>
              {diagnostics.network.navigatorOnline ? t('databaseSyncStatus.online') : t('databaseSyncStatus.offline')}
            </span>
          </div>
          <div className="text-gray-300">
            {t('databaseSyncStatus.firebase')}: <span className={diagnostics.network.backendOnline ? 'text-green-400' : 'text-red-400'}>
              {diagnostics.network.backendOnline ? t('databaseSyncStatus.connected') : t('databaseSyncStatus.disconnected')}
            </span>
          </div>
          <div className="text-gray-300">
            {t('databaseSyncStatus.lastCheck')}: <span className="text-yellow-400">{diagnostics.network.lastCheck}</span>
          </div>
          <div className="text-gray-300">
            {t('databaseSyncStatus.backoff')}: <span className="text-yellow-400">{diagnostics.network.backoffMs}ms</span>
          </div>
        </div>
      </div>

      {/* Sync Queue */}
      <div className="mb-4 p-3 bg-gray-700 rounded">
        <h4 className="font-semibold text-white mb-2">{t('databaseSyncStatus.syncQueue')}</h4>
        <div className="grid grid-cols-2 gap-2 text-sm mb-2">
          <div className="text-gray-300">
            {t('databaseSyncStatus.items')}: <span className="text-blue-400 font-bold">{diagnostics.queue.length}</span>
          </div>
          <div className="text-gray-300">
            {t('databaseSyncStatus.status')}: <span className={diagnostics.queue.isSyncing ? 'text-yellow-400' : 'text-gray-400'}>
              {diagnostics.queue.isSyncing ? t('databaseSyncStatus.syncing') : t('databaseSyncStatus.idle')}
            </span>
          </div>
        </div>

        {diagnostics.queue.length > 0 && (
          <div className="mt-2">
            <button
              onClick={handleForceSync}
              disabled={syncing || diagnostics.queue.isSyncing || !diagnostics.network.navigatorOnline}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
              {syncing || diagnostics.queue.isSyncing ? t('databaseSyncStatus.syncing') : t('databaseSyncStatus.forceSyncNow')}
            </button>

            <div className="mt-2 max-h-40 overflow-y-auto">
              <table className="w-full text-xs text-gray-300">
                <thead className="bg-gray-800">
                  <tr>
                    <th className="px-2 py-1 text-left">{t('databaseSyncStatus.type')}</th>
                    <th className="px-2 py-1 text-left">{t('databaseSyncStatus.action')}</th>
                    <th className="px-2 py-1 text-right">{t('databaseSyncStatus.age')}</th>
                    <th className="px-2 py-1 text-right">{t('databaseSyncStatus.tries')}</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.queue.items.map((item: any, idx: number) => (
                    <tr key={idx} className="border-t border-gray-600">
                      <td className="px-2 py-1">{item.type}</td>
                      <td className="px-2 py-1">{item.action}</td>
                      <td className="px-2 py-1 text-right text-yellow-400">{item.age}</td>
                      <td className="px-2 py-1 text-right">{item.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {diagnostics.queue.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-2">
            {t('databaseSyncStatus.allDataSynced')}
          </div>
        )}
      </div>

      {/* Auth Status */}
      <div className="mb-4 p-3 bg-gray-700 rounded">
        <h4 className="font-semibold text-white mb-2">{t('databaseSyncStatus.authentication')}</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="text-gray-300">
            UID: <span className={diagnostics.auth.uid === 'SET' ? 'text-green-400' : 'text-red-400'}>
              {diagnostics.auth.uid}
            </span>
          </div>
          <div className="text-gray-300">
            {t('databaseSyncStatus.firebase')}: <span className={diagnostics.auth.firebaseUser !== 'NO_AUTH' ? 'text-green-400' : 'text-red-400'}>
              {diagnostics.auth.firebaseUser !== 'NO_AUTH' ? t('databaseSyncStatus.authenticated') : t('databaseSyncStatus.notAuthenticated')}
            </span>
          </div>
        </div>
      </div>

      {/* Platform Info */}
      <div className="p-3 bg-gray-700 rounded">
        <h4 className="font-semibold text-white mb-2">{t('databaseSyncStatus.platform')}</h4>
        <div className="text-sm text-gray-300">
          {t('databaseSyncStatus.storage')}: <span className="text-blue-400">{diagnostics.platform.type}</span>
        </div>
      </div>
    </div>
  );
};
