/**
 * Offline Maps Downloader UI Component
 * Allows users to download map tiles from your server for offline use
 */

import { useState, useEffect } from 'react';
import { Download, Trash2, CheckCircle, AlertCircle, HardDrive } from 'lucide-react';
import { tileDownloader, DownloadProgress } from '../../services/offlineTileDownloader';
import { useDarkMode } from '../../hooks/useDarkMode';
import Button from '../ui/Button';
import { Capacitor } from '@capacitor/core';

export default function OfflineMapsDownloader() {
  const [isDarkMode] = useDarkMode();
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [tilesExist, setTilesExist] = useState(false);
  const [tileInfo, setTileInfo] = useState<{ size: number; ctime: number } | null>(null);
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    setIsNative(Capacitor.isNativePlatform());
    if (Capacitor.isNativePlatform()) {
      checkTiles();
    }
  }, []);

  const checkTiles = async () => {
    const exists = await tileDownloader.checkTilesExist();
    setTilesExist(exists);

    if (exists) {
      const info = await tileDownloader.getTileInfo();
      setTileInfo(info);
    }
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    setProgress(0);
    setStatusMessage('Starting download...');

    const success = await tileDownloader.downloadTilePackage((prog: DownloadProgress) => {
      setProgress(prog.percentage);
      setStatusMessage(prog.message || '');

      if (prog.status === 'complete') {
        setTilesExist(true);
        checkTiles();
      }
    });

    setIsDownloading(false);

    if (success) {
      setTimeout(() => {
        setStatusMessage('');
        setProgress(0);
      }, 3000);
    }
  };

  const handleDelete = async () => {
    const confirmed = window.confirm(
      'Delete offline maps? You will need internet connection to view maps after deletion.'
    );

    if (!confirmed) return;

    try {
      await tileDownloader.deleteTiles();
      setTilesExist(false);
      setTileInfo(null);
      setStatusMessage('Offline maps deleted');
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (error) {
      console.error('Failed to delete tiles:', error);
      setStatusMessage('Failed to delete tiles');
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString();
  };

  // Web browser message
  if (!isNative) {
    return (
      <div className={`p-4 rounded-lg border ${
        isDarkMode 
          ? 'bg-gray-800/50 border-gray-700 text-gray-400' 
          : 'bg-gray-50 border-gray-200 text-gray-600'
      }`}>
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium mb-1">Offline maps are only available on mobile app</p>
            <p className="text-sm">
              On web browser, maps are automatically cached as you browse. Install the mobile app to download full offline maps.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-lg border ${
      isDarkMode 
        ? 'bg-gray-800 border-gray-700 text-white' 
        : 'bg-white border-gray-200 text-gray-900'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <Download className="w-5 h-5 text-blue-500" />
        <h3 className="text-lg font-bold">Offline Maps</h3>
      </div>

      <p className={`text-sm mb-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
        Download map tiles for offline use. Internet required for initial download.
      </p>

      {/* Tile Storage Info */}
      <div className={`mb-4 p-3 rounded-lg ${
        isDarkMode ? 'bg-gray-900/50' : 'bg-gray-50'
      }`}>
        <div className="flex items-center gap-2 text-sm">
          <HardDrive className="w-4 h-4" />
          <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
            Storage required: ~2GB
          </span>
        </div>
      </div>

      {tilesExist ? (
        /* Tiles Installed */
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-green-500 mb-3">
            <CheckCircle className="w-5 h-5" />
            <span className="font-medium">Offline maps installed</span>
          </div>

          {tileInfo && (
            <div className={`text-sm space-y-1 mb-3 ${
              isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>
              <p>Size: {formatFileSize(tileInfo.size)}</p>
              <p>Downloaded: {formatDate(tileInfo.ctime)}</p>
            </div>
          )}

          <Button
            onClick={handleDelete}
            variant="danger"
            className="w-full"
            disabled={isDownloading}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Offline Maps
          </Button>
        </div>
      ) : (
        /* Download UI */
        <div className="space-y-3">
          <div className={`p-3 rounded-lg border ${
            isDarkMode 
              ? 'bg-orange-900/20 border-orange-900/50 text-orange-200'
              : 'bg-orange-50 border-orange-200 text-orange-900'
          }`}>
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <p className="text-xs">
                Make sure you have stable WiFi connection and at least 2GB free storage before downloading.
              </p>
            </div>
          </div>

          <Button
            onClick={handleDownload}
            disabled={isDownloading}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            <Download className="w-4 h-4 mr-2" />
            {isDownloading ? 'Downloading...' : 'Download Offline Maps'}
          </Button>

          {/* Progress Bar */}
          {isDownloading && (
            <div className="space-y-2">
              <div className={`w-full rounded-full h-2 ${
                isDarkMode ? 'bg-gray-700' : 'bg-gray-200'
              }`}>
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-center">{statusMessage}</p>
              <p className="text-xs text-center font-medium">
                {Math.round(progress)}%
              </p>
            </div>
          )}

          {/* Status Message */}
          {statusMessage && !isDownloading && (
            <p className={`text-sm text-center p-2 rounded ${
              statusMessage.includes('✓') || statusMessage.includes('complete')
                ? 'text-green-500'
                : statusMessage.includes('❌') || statusMessage.includes('failed')
                ? 'text-red-500'
                : isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>
              {statusMessage}
            </p>
          )}
        </div>
      )}

      {/* Help Text */}
      <div className={`mt-4 pt-4 border-t text-xs ${
        isDarkMode ? 'border-gray-700 text-gray-500' : 'border-gray-200 text-gray-500'
      }`}>
        <p>
          💡 Tip: Offline maps work without internet. Previously viewed areas are also cached automatically.
        </p>
      </div>
    </div>
  );
}
