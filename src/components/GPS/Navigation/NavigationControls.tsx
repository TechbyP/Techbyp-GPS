import { Target, Navigation, TrendingUp } from 'lucide-react';
import Button from '../../ui/Button';
import { useLanguage } from '../../../hooks/useLanguage';
import { useDarkMode } from '../../../hooks/useDarkMode';
import { RouteOption } from './RouteSelector';

interface NavigationControlsProps {
  selectedRoute: RouteOption | null;
  onRecenter: () => void;
  onEndNavigation: () => void;
  distanceToNext?: number;
  etaSeconds?: number;
  nextInstruction?: string | null;
  currentSpeed?: number; // km/h
  progressPercent?: number; // 0-100
}

export default function NavigationControls({
  selectedRoute,
  onRecenter,
  onEndNavigation,
  distanceToNext,
  etaSeconds,
  nextInstruction,
  currentSpeed,
  progressPercent
}: NavigationControlsProps) {
  const { t } = useLanguage();
  const [isDarkMode] = useDarkMode();

  // Format distance
  const formatDistance = (meters: number): string => {
    if (meters < 1000) {
      return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(1)} km`;
  };

  // Format duration
  const formatDuration = (seconds: number): string => {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return `${minutes} ${t('gps.minutes') || 'min'}`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}min`;
  };

  const formatEta = (seconds?: number): string => {
    if (!seconds || Number.isNaN(seconds)) return '--';
    const now = new Date();
    const arrival = new Date(now.getTime() + seconds * 1000);
    return arrival.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  if (!selectedRoute) return null;

  const remainingDistance = selectedRoute.distance * ((100 - (progressPercent || 0)) / 100);

  return (
    <>
      {/* Compact next turn banner at top */}
      {nextInstruction && (
        <div className="absolute top-0 left-0 right-0 z-[999] p-2 md:p-2.5">
          <div className="bg-gradient-to-r from-blue-600 to-blue-500 dark:from-blue-700 dark:to-blue-600 rounded-xl shadow-2xl border-2 border-blue-400/50">
            <div className="p-2 md:p-2.5">
              <div className="flex items-center gap-3">
                {/* Distance to next - compact */}
                {typeof distanceToNext === 'number' && (
                  <div className="text-center min-w-[80px]">
                    <div className="text-3xl md:text-4xl font-black text-white leading-none">
                      {distanceToNext < 1000 
                        ? Math.round(distanceToNext)
                        : (distanceToNext / 1000).toFixed(1)
                      }
                    </div>
                    <div className="text-sm md:text-base font-bold text-blue-100">
                      {distanceToNext < 1000 ? 'meters' : 'km'}
                    </div>
                  </div>
                )}
                
                {/* Navigation arrow/icon - compact */}
                <div className="flex-shrink-0">
                  <div className="bg-white/20 rounded-full p-2">
                    <Navigation className="w-6 h-6 md:w-8 md:h-8 text-white" style={{ transform: 'rotate(45deg)' }} />
                  </div>
                </div>

                {/* Instruction text - compact */}
                <div className="flex-1 min-w-0">
                  <div className="text-base md:text-lg font-bold text-white leading-tight">
                    {nextInstruction}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Progress bar */}
            {typeof progressPercent === 'number' && (
              <div className="h-1.5 bg-blue-800/50">
                <div 
                  className="h-full bg-gradient-to-r from-green-400 to-green-300 transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Enhanced route info and controls at bottom */}
      <div className="absolute bottom-0 left-0 right-0 z-[999] p-3 md:p-4">
        <div className="bg-white/80 dark:bg-gray-900/80 rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50">
          {/* Current Speed Display */}
          {typeof currentSpeed === 'number' && currentSpeed > 0 && (
            <div className="px-4 pt-3 pb-2 border-b border-gray-200/50 dark:border-gray-700/50">
              <div className="flex items-center justify-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-500" />
                <span className="text-3xl font-black text-gray-900 dark:text-white">
                  {Math.round(currentSpeed)}
                </span>
                <span className="text-lg font-semibold text-gray-600 dark:text-gray-400">
                  km/h
                </span>
              </div>
            </div>
          )}

          {/* Main info row */}
          <div className="flex items-center gap-3 p-3">
            {/* Time, Distance, ETA */}
            <div className="flex-1 min-w-0">
              {/* Primary: ETA */}
              <div className="flex items-center gap-2 mb-1">
                <p className="text-2xl md:text-3xl font-black text-gray-900 dark:text-white">
                  {formatEta(etaSeconds ?? selectedRoute.duration)}
                </p>
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  arrival
                </span>
              </div>
              
              {/* Secondary info */}
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold text-blue-600 dark:text-blue-400">
                  {formatDuration(etaSeconds ?? selectedRoute.duration)}
                </span>
                <span className="text-gray-400">•</span>
                <span className="font-semibold text-gray-700 dark:text-gray-300">
                  {formatDistance(remainingDistance)} {t('gps.remaining') || 'left'}
                </span>
              </div>
            </div>
            
            {/* Compact controls */}
            <div className="flex flex-col gap-2">
              <button
                onClick={onRecenter}
                className="p-3 rounded-xl bg-blue-500 hover:bg-blue-600 transition-colors shadow-lg"
                title={t('gps.recenter') || 'Recenter'}
              >
                <Target className="w-5 h-5 text-white" />
              </button>
              
              <Button
                variant="secondary"
                size="sm"
                onClick={onEndNavigation}
                className="text-xs px-4 py-2 font-semibold"
              >
                {t('gps.endNavigation') || 'End'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}