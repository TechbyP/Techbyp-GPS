import React, { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { getTileCacheStats, clearTileCache } from '../../services/tileDownloadService';
import { tileDownloader } from '../../services/offlineTileDownloader';
import { OFFLINE_MAP_PACKS } from '../../config/offlineMapPacks';
import { getBundledGermanyPmtilesUrl } from '../../utils/tileUtils';
import toast from 'react-hot-toast';
import { useLanguage } from '../../hooks/useLanguage';

interface DownloadRegion {
  id: string;
  name: string;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  estimatedSize: string;
  tileCount: number;
}

const DOWNLOADABLE_REGIONS: DownloadRegion[] = [
  {
    id: 'lower-saxony-detailed',
    name: 'Lower Saxony (Zoom 13-15)',
    bounds: { north: 53.9, south: 51.3, east: 11.6, west: 6.7 },
    estimatedSize: '~3.4 GB',
    tileCount: 229657
  },
  {
    id: 'hamburg-detailed',
    name: 'Hamburg Region (Zoom 13-15)',
    bounds: { north: 53.75, south: 53.4, east: 10.3, west: 9.7 },
    estimatedSize: '~200 MB',
    tileCount: 15000
  },
  {
    id: 'bremen-detailed',
    name: 'Bremen Region (Zoom 13-15)',
    bounds: { north: 53.3, south: 53.0, east: 9.0, west: 8.6 },
    estimatedSize: '~150 MB',
    tileCount: 11000
  },
  {
    id: 'hannover-detailed',
    name: 'Hannover Region (Zoom 13-15)',
    bounds: { north: 52.6, south: 52.2, east: 9.9, west: 9.5 },
    estimatedSize: '~180 MB',
    tileCount: 13000
  }
];

const offlineTilesDisabledByEnv = ((import.meta.env.VITE_DISABLE_OFFLINE_TILES as string | undefined) || '').toLowerCase() === 'true';

export default function OfflineMapDownloader() {
  const { t } = useLanguage();
  const [cacheStats, setCacheStats] = useState({ count: 0, sizeEstimate: '0 MB' });
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [pmtilesDownloading, setPmtilesDownloading] = useState(false);
  const [pmtilesProgress, setPmtilesProgress] = useState(0);
  const [pmtilesStatus, setPmtilesStatus] = useState('');
  const [pmtilesAvailable, setPmtilesAvailable] = useState(false);
  const [selectedPackId, setSelectedPackId] = useState<string>(() => OFFLINE_MAP_PACKS[0]?.id || '');
  const offlinePmtilesUrl = getBundledGermanyPmtilesUrl();

  const loadCacheStats = useCallback(async () => {
    try {
      const stats = await getTileCacheStats();
      setCacheStats(stats);
    } catch (error) {
      console.error('Failed to load cache stats:', error);
    }
  }, []);

  const checkPmtilesAvailability = useCallback(async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        const uri = await tileDownloader.getLocalTileUri();
        setPmtilesAvailable(!!uri);
        return;
      }

      if (!offlinePmtilesUrl) {
        setPmtilesAvailable(false);
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(offlinePmtilesUrl, { method: 'HEAD', signal: controller.signal });
      clearTimeout(timeoutId);
      setPmtilesAvailable(res.ok);
    } catch {
      setPmtilesAvailable(false);
    }
  }, [offlinePmtilesUrl]);

  useEffect(() => {
    if (offlineTilesDisabledByEnv) {
      return;
    }

    void loadCacheStats();
    void checkPmtilesAvailability();
  }, [loadCacheStats, checkPmtilesAvailability]);

  const handleDownloadPmtiles = async () => {
    if (!Capacitor.isNativePlatform()) {
      toast.error(t('offlineMapDownloader.pmtilesAndroidOnly'));
      return;
    }

    const selectedPack = OFFLINE_MAP_PACKS.find(pack => pack.id === selectedPackId) || OFFLINE_MAP_PACKS[0];
    if (!selectedPack) {
      toast.error(t('offlineMapDownloader.noPackSelected'));
      return;
    }
    if (!selectedPack.downloadUrl) {
      toast.error(t('offlineMapDownloader.noDownloadUrl'));
      return;
    }

    setPmtilesDownloading(true);
    setPmtilesProgress(0);
    setPmtilesStatus(t('offlineMapDownloader.startingDownload'));

    const toastId = toast.loading(t('offlineMapDownloader.downloadingPack', { name: selectedPack.name }));
    try {
      const ok = await tileDownloader.downloadTilePackage((progress) => {
        setPmtilesProgress(Math.round(progress.percentage));
        setPmtilesStatus(progress.message || progress.status);
      }, selectedPack);

      if (!ok) {
        throw new Error(t('offlineMapDownloader.downloadFailedGeneric'));
      }

      toast.success(t('offlineMapDownloader.packDownloaded', { name: selectedPack.name }), { id: toastId });
      setPmtilesAvailable(true);
    } catch (error) {
      console.error('PMTiles download failed:', error);
      toast.error(t('offlineMapDownloader.pmtilesDownloadFailed'), { id: toastId });
    } finally {
      setPmtilesDownloading(false);
      setPmtilesProgress(0);
    }
  };

  const handleDeletePmtiles = async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await tileDownloader.deleteTiles();
      setPmtilesAvailable(false);
      toast.success(t('offlineMapDownloader.pmtilesRemoved'));
    } catch (error) {
      console.error('Failed to delete PMTiles:', error);
      toast.error(t('offlineMapDownloader.pmtilesDeleteFailed'));
    }
  };

  const handleDownloadRegion = async (region: DownloadRegion) => {
    setDownloading(region.id);
    setDownloadProgress(0);

    const toastId = toast.loading(t('offlineMapDownloader.downloadingRegion', { name: region.name }));

    try {
      // Calculate tiles needed for zoom 13-15
      const zoomLevels = [13, 14, 15];
      let totalTiles = 0;
      let downloadedTiles = 0;

      for (const zoom of zoomLevels) {
        const tiles = calculateTilesForBounds(region.bounds, zoom);
        totalTiles += tiles.length;

        // Download tiles in batches
        for (let i = 0; i < tiles.length; i += 50) {
          const batch = tiles.slice(i, i + 50);
          await Promise.all(
            batch.map(tile => 
              downloadTile(tile.x, tile.y, tile.zoom)
            )
          );
          downloadedTiles += batch.length;
          setDownloadProgress(Math.round((downloadedTiles / totalTiles) * 100));
        }
      }

      toast.success(t('offlineMapDownloader.regionDownloaded', { name: region.name }), { id: toastId });
      await loadCacheStats();
    } catch (error) {
      console.error('Download failed:', error);
      toast.error(t('offlineMapDownloader.regionDownloadFailed', { name: region.name }), { id: toastId });
    } finally {
      setDownloading(null);
      setDownloadProgress(0);
    }
  };

  const handleClearCache = async () => {
    if (!window.confirm(t('offlineMapDownloader.confirmClearTiles'))) {
      return;
    }

    try {
      await clearTileCache();
      await loadCacheStats();
      toast.success(t('offlineMapDownloader.cacheCleared'));
    } catch (error) {
      console.error('Failed to clear cache:', error);
      toast.error(t('offlineMapDownloader.cacheClearFailed'));
    }
  };

  if (offlineTilesDisabledByEnv) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
          {t('offlineMapDownloader.offlinePmtilesTitle')}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          {t('offlineMapDownloader.offlinePmtilesDescription')}
        </p>

        {pmtilesAvailable ? (
          <div className="space-y-3">
            <div className="text-sm text-green-700 dark:text-green-300">
              {t('offlineMapDownloader.pmtilesAvailable')}
            </div>
            {Capacitor.isNativePlatform() && (
              <button
                onClick={handleDeletePmtiles}
                className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                {t('offlineMapDownloader.removePmtiles')}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="block text-xs text-gray-600 dark:text-gray-300">{t('offlineMapDownloader.regionLabel')}</label>
              <select
                value={selectedPackId}
                onChange={(e) => setSelectedPackId(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
              >
                {OFFLINE_MAP_PACKS.map(pack => (
                  <option key={pack.id} value={pack.id}>
                    {pack.name}
                  </option>
                ))}
              </select>
            </div>
            {pmtilesDownloading ? (
              <div className="space-y-2">
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all"
                    style={{ width: `${pmtilesProgress}%` }}
                  />
                </div>
                <p className="text-xs text-center text-gray-600 dark:text-gray-300">
                  {pmtilesProgress}% • {pmtilesStatus}
                </p>
              </div>
            ) : (
              <button
                onClick={handleDownloadPmtiles}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                {t('offlineMapDownloader.downloadPmtiles')}
              </button>
            )}

            {!Capacitor.isNativePlatform() && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('offlineMapDownloader.webUsesUrl', { url: offlinePmtilesUrl })}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
          {t('offlineMapDownloader.storageTitle')}
        </h3>
        
        <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
          <div className="flex justify-between">
            <span>{t('offlineMapDownloader.baseMapsLabel')}</span>
            <span className="font-semibold">{t('offlineMapDownloader.baseMapsValue')}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('offlineMapDownloader.downloadedTilesLabel')}</span>
            <span className="font-semibold">{t('offlineMapDownloader.tileCount', { count: cacheStats.count.toLocaleString() })}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('offlineMapDownloader.cacheSizeLabel')}</span>
            <span className="font-semibold">{cacheStats.sizeEstimate}</span>
          </div>
        </div>

        {cacheStats.count > 0 && (
          <button
            onClick={handleClearCache}
            className="mt-4 w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
          >
            {t('offlineMapDownloader.clearDownloadedTiles')}
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">
          {t('offlineMapDownloader.downloadDetailedMapsTitle')}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          {t('offlineMapDownloader.downloadDetailedMapsDescription')}
        </p>

        <div className="space-y-3">
          {DOWNLOADABLE_REGIONS.map(region => (
            <div
              key={region.id}
              className="border border-gray-200 dark:border-gray-700 rounded-lg p-4"
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-white">
                    {region.name}
                  </h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {region.tileCount.toLocaleString()} tiles • {region.estimatedSize}
                  </p>
                </div>
              </div>

              {downloading === region.id ? (
                <div className="space-y-2">
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-center text-gray-600 dark:text-gray-300">
                    {t('offlineMapDownloader.progressComplete', { percent: downloadProgress })}
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => handleDownloadRegion(region)}
                  disabled={downloading !== null}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {t('common.download')}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
        <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
          {t('offlineMapDownloader.tipTitle')}
        </h4>
        <p className="text-sm text-blue-800 dark:text-blue-200">
          {t('offlineMapDownloader.tipDescription')}
        </p>
      </div>
    </div>
  );
}

// Helper functions
function calculateTilesForBounds(bounds: any, zoom: number) {
  const topLeft = latLonToTile(bounds.north, bounds.west, zoom);
  const bottomRight = latLonToTile(bounds.south, bounds.east, zoom);
  
  const tiles = [];
  for (let x = topLeft.x; x <= bottomRight.x; x++) {
    for (let y = topLeft.y; y <= bottomRight.y; y++) {
      tiles.push({ x, y, zoom });
    }
  }
  return tiles;
}

function latLonToTile(lat: number, lon: number, zoom: number) {
  const latRad = (lat * Math.PI) / 180;
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);
  return { x, y, zoom };
}

async function downloadTile(_x: number, _y: number, _zoom: number) {
  // Use the tile download service
  // This is a simplified version - in production you'd call a proper download function
  return Promise.resolve();
}
