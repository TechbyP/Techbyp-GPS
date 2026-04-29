import { WifiOff, AlertTriangle, Satellite, MapPin } from 'lucide-react';
import { useDarkMode } from '../../../hooks/useDarkMode';
import { useLanguage } from '../../../hooks/useLanguage';

interface OfflineIndicatorProps {
  isOnline: boolean;
  hasGPSSignal?: boolean;
  cachedRoutesCount?: number;
}

export default function OfflineIndicator({ 
  isOnline, 
  hasGPSSignal = true,
  cachedRoutesCount = 0 
}: OfflineIndicatorProps) {
  const [isDarkMode] = useDarkMode();
  const { t } = useLanguage();

  // Don't show anything if everything is working
  if (isOnline && hasGPSSignal) {
    return null;
  }

  return (
    <div className="absolute top-0 left-0 right-0 z-[1000] p-2 md:p-3">
      <div className={`flex items-start gap-2 md:gap-3 px-3 md:px-4 py-2 md:py-3 rounded-lg shadow-lg border ${
        isDarkMode 
          ? 'bg-amber-900/80 border-amber-700/50 text-amber-100' 
          : 'bg-amber-50/80 border-amber-200/50 text-amber-800'
      }`}>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isOnline && <WifiOff className="w-4 h-4 md:w-5 md:h-5" />}
          {!hasGPSSignal && <Satellite className="w-4 h-4 md:w-5 md:h-5" />}
        </div>
        
        <div className="flex-1 min-w-0">
          {!isOnline && (
            <>
              <p className="text-xs md:text-sm font-medium">
                {t('navigation.noInternet') || 'No Internet Connection'}
              </p>
              <p className="text-xs opacity-90 mt-0.5">
                {cachedRoutesCount > 0 
                  ? t('navigation.cachedRoutesAvailable', { count: cachedRoutesCount })
                  : t('navigation.routingUnavailable') || 'Route calculation unavailable. GPS tracking continues.'
                }
              </p>
            </>
          )}
          
          {!hasGPSSignal && (
            <>
              <p className="text-xs md:text-sm font-medium">
                {t('navigation.noGPS') || 'No GPS Signal'}
              </p>
              <p className="text-xs opacity-90 mt-0.5">
                {t('navigation.gpsUnavailable') || 'Searching for GPS satellites...'}
              </p>
            </>
          )}
          
          {/* Offline capabilities */}
          {!isOnline && (
            <div className="flex items-center gap-3 mt-2 pt-2 border-t border-current/20">
              <div className="flex items-center gap-1 text-xs">
                <MapPin className="w-3 h-3" />
                <span>{t('navigation.offlineMapsAvailable')}</span>
              </div>
              {cachedRoutesCount > 0 && (
                <div className="flex items-center gap-1 text-xs">
                  <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                  <span>{t('navigation.cachedRoutesCount', { count: cachedRoutesCount })}</span>
                </div>
              )}
            </div>
          )}
        </div>
        
        <AlertTriangle className="w-4 h-4 md:w-5 md:h-5 flex-shrink-0" />
      </div>
    </div>
  );
}