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
  compact?: boolean;
  layout?: 'overlay' | 'side';
}

export default function NavigationControls({
  selectedRoute,
  onRecenter,
  onEndNavigation,
  distanceToNext,
  etaSeconds,
  nextInstruction,
  currentSpeed,
  progressPercent,
  compact = false,
  layout = 'overlay',
}: NavigationControlsProps) {
  const { t } = useLanguage();
  const [isDarkMode] = useDarkMode();

  const topPaddingClass = compact ? 'p-1.5' : 'p-2 md:p-2.5';
  const topCardClass = compact ? 'rounded-lg' : 'rounded-xl';
  const distanceBlockClass = compact ? 'text-center min-w-[64px]' : 'text-center min-w-[80px]';
  const distanceValueClass = compact ? 'text-2xl font-black text-white leading-none' : 'text-3xl md:text-4xl font-black text-white leading-none';
  const distanceUnitClass = compact ? 'text-[11px] font-bold text-blue-100' : 'text-sm md:text-base font-bold text-blue-100';
  const navIconWrapClass = compact ? 'bg-white/20 rounded-full p-1.5' : 'bg-white/20 rounded-full p-2';
  const navIconClass = compact ? 'w-5 h-5 text-white' : 'w-6 h-6 md:w-8 md:h-8 text-white';
  const instructionClass = compact ? 'text-sm font-bold text-white leading-tight' : 'text-base md:text-lg font-bold text-white leading-tight';
  const bottomPaddingClass = compact ? 'p-2' : 'p-3 md:p-4';
  const speedSectionClass = compact ? 'px-3 pt-2.5 pb-1.5 border-b border-gray-200/50 dark:border-gray-700/50' : 'px-4 pt-3 pb-2 border-b border-gray-200/50 dark:border-gray-700/50';
  const speedValueClass = compact ? 'text-2xl font-black text-gray-900 dark:text-white' : 'text-3xl font-black text-gray-900 dark:text-white';
  const speedUnitClass = compact ? 'text-base font-semibold text-gray-600 dark:text-gray-400' : 'text-lg font-semibold text-gray-600 dark:text-gray-400';
  const etaValueClass = compact ? 'text-xl font-black text-gray-900 dark:text-white' : 'text-2xl md:text-3xl font-black text-gray-900 dark:text-white';
  const etaLabelClass = compact ? 'text-[11px] font-medium text-gray-500 dark:text-gray-400' : 'text-sm font-medium text-gray-500 dark:text-gray-400';
  const secondaryMetaClass = compact ? 'flex items-center gap-1.5 text-[11px]' : 'flex items-center gap-2 text-sm';
  const recenterButtonClass = compact ? 'p-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 transition-colors shadow-lg' : 'p-3 rounded-xl bg-blue-500 hover:bg-blue-600 transition-colors shadow-lg';
  const recenterIconClass = compact ? 'w-4 h-4 text-white' : 'w-5 h-5 text-white';
  const endButtonClass = compact ? 'text-[11px] px-3 py-1.5 font-semibold' : 'text-xs px-4 py-2 font-semibold';
  const sideContainerClass = compact ? 'flex h-full flex-col gap-2 p-2' : 'flex h-full flex-col gap-3 p-3';
  const sideSummaryCardClass = `flex-1 flex flex-col justify-end bg-white/80 dark:bg-gray-900/80 ${compact ? 'rounded-xl' : 'rounded-2xl'} shadow-xl border border-gray-200/50 dark:border-gray-700/50`;
  const sideSummaryBodyClass = compact ? 'flex flex-1 flex-col gap-3 p-3' : 'flex flex-1 flex-col gap-4 p-4';
  const sideSecondaryMetaClass = compact ? 'space-y-1 text-[11px]' : 'space-y-1.5 text-sm';
  const sideActionStackClass = compact ? 'mt-auto flex flex-col gap-2' : 'mt-auto flex flex-col gap-2.5';
  const sideRecenterButtonClass = compact
    ? 'w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 transition-colors shadow-lg text-white text-[11px] font-semibold'
    : 'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 transition-colors shadow-lg text-white text-sm font-semibold';
  const sideMetricGridClass = compact ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-2 gap-3';
  const sideMetricCardClass = `${isDarkMode ? 'bg-gray-800/50 border-gray-700/60' : 'bg-white/70 border-gray-200/80'} rounded-xl border ${compact ? 'p-2.5' : 'p-3'}`;
  const sideMetricLabelClass = compact ? 'text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400' : 'text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400';
  const sideMetricValueClass = compact ? 'mt-1 text-sm font-semibold text-gray-900 dark:text-white' : 'mt-1 text-base font-semibold text-gray-900 dark:text-white';
  const sideRouteNameClass = compact ? 'text-[11px] font-semibold text-gray-900 dark:text-white truncate' : 'text-sm font-semibold text-gray-900 dark:text-white truncate';
  const sideRouteMetaClass = compact ? 'text-[11px] text-gray-600 dark:text-gray-400' : 'text-sm text-gray-600 dark:text-gray-400';

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

  if (layout === 'side') {
    return (
      <div className={sideContainerClass}>
        {nextInstruction && (
          <div className={`bg-gradient-to-r from-blue-600 to-blue-500 dark:from-blue-700 dark:to-blue-600 ${topCardClass} shadow-2xl border-2 border-blue-400/50 overflow-hidden`}>
            <div className={topPaddingClass}>
              <div className="flex items-start gap-2.5">
                {typeof distanceToNext === 'number' && (
                  <div className={distanceBlockClass}>
                    <div className={distanceValueClass}>
                      {distanceToNext < 1000
                        ? Math.round(distanceToNext)
                        : (distanceToNext / 1000).toFixed(1)
                      }
                    </div>
                    <div className={distanceUnitClass}>
                      {distanceToNext < 1000 ? (compact ? 'm' : 'meters') : 'km'}
                    </div>
                  </div>
                )}
                <div className={navIconWrapClass}>
                  <Navigation className={navIconClass} style={{ transform: 'rotate(45deg)' }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className={instructionClass}>
                    {nextInstruction}
                  </div>
                </div>
              </div>
            </div>
            {typeof progressPercent === 'number' && (
              <div className="h-1.5 bg-blue-800/50">
                <div
                  className="h-full bg-gradient-to-r from-green-400 to-green-300 transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            )}
          </div>
        )}

        <div className={sideSummaryCardClass}>
          {typeof currentSpeed === 'number' && currentSpeed > 0 && (
            <div className={speedSectionClass}>
              <div className="flex items-center justify-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-500" />
                <span className={speedValueClass}>{Math.round(currentSpeed)}</span>
                <span className={speedUnitClass}>km/h</span>
              </div>
            </div>
          )}

          <div className={sideSummaryBodyClass}>
            <div className={sideMetricGridClass}>
              <div className={sideMetricCardClass}>
                <div className={sideMetricLabelClass}>{t('gps.arrival') || 'Arrival'}</div>
                <div className="mt-1">
                  <p className={etaValueClass}>{formatEta(etaSeconds ?? selectedRoute.duration)}</p>
                </div>
              </div>
              <div className={sideMetricCardClass}>
                <div className={sideMetricLabelClass}>{t('gps.remaining') || 'Remaining'}</div>
                <div className={sideMetricValueClass}>{formatDistance(remainingDistance)}</div>
              </div>
            </div>

            <div className={sideMetricCardClass}>
              <div className={sideMetricLabelClass}>{t('gps.route') || 'Route'}</div>
              <div className="mt-1 space-y-1">
                <div className={sideRouteNameClass}>{selectedRoute.name}</div>
                <div className={sideSecondaryMetaClass}>
                  <div className="font-semibold text-blue-600 dark:text-blue-400">
                    {formatDuration(etaSeconds ?? selectedRoute.duration)}
                  </div>
                  <div className={sideRouteMetaClass}>
                    {formatDistance(remainingDistance)} {t('gps.left') || 'left'}
                  </div>
                </div>
              </div>
            </div>

            <div className={sideActionStackClass}>
              <button
                onClick={onRecenter}
                className={sideRecenterButtonClass}
                title={t('gps.recenter') || 'Recenter'}
              >
                <Target className={recenterIconClass} />
                <span>{t('gps.recenter') || 'Recenter'}</span>
              </button>

              <Button
                variant="secondary"
                size="sm"
                onClick={onEndNavigation}
                className={`w-full ${endButtonClass}`}
              >
                {t('gps.endNavigation') || 'End'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Compact next turn banner at top */}
      {nextInstruction && (
        <div className={`absolute top-0 left-0 right-0 z-[999] ${topPaddingClass}`}>
          <div className={`bg-gradient-to-r from-blue-600 to-blue-500 dark:from-blue-700 dark:to-blue-600 ${topCardClass} shadow-2xl border-2 border-blue-400/50`}>
            <div className={topPaddingClass}>
              <div className="flex items-center gap-3">
                {/* Distance to next - compact */}
                {typeof distanceToNext === 'number' && (
                  <div className={distanceBlockClass}>
                    <div className={distanceValueClass}>
                      {distanceToNext < 1000 
                        ? Math.round(distanceToNext)
                        : (distanceToNext / 1000).toFixed(1)
                      }
                    </div>
                    <div className={distanceUnitClass}>
                      {distanceToNext < 1000 ? (compact ? 'm' : 'meters') : 'km'}
                    </div>
                  </div>
                )}
                
                {/* Navigation arrow/icon - compact */}
                <div className="flex-shrink-0">
                  <div className={navIconWrapClass}>
                    <Navigation className={navIconClass} style={{ transform: 'rotate(45deg)' }} />
                  </div>
                </div>

                {/* Instruction text - compact */}
                <div className="flex-1 min-w-0">
                  <div className={instructionClass}>
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
      <div className={`absolute bottom-0 left-0 right-0 z-[999] ${bottomPaddingClass}`}>
        <div className="bg-white/80 dark:bg-gray-900/80 rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50">
          {/* Current Speed Display */}
          {typeof currentSpeed === 'number' && currentSpeed > 0 && (
            <div className={speedSectionClass}>
              <div className="flex items-center justify-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-500" />
                <span className={speedValueClass}>
                  {Math.round(currentSpeed)}
                </span>
                <span className={speedUnitClass}>
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
                <p className={etaValueClass}>
                  {formatEta(etaSeconds ?? selectedRoute.duration)}
                </p>
                <span className={etaLabelClass}>
                  arrival
                </span>
              </div>
              
              {/* Secondary info */}
              <div className={secondaryMetaClass}>
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
                className={recenterButtonClass}
                title={t('gps.recenter') || 'Recenter'}
              >
                <Target className={recenterIconClass} />
              </button>
              
              <Button
                variant="secondary"
                size="sm"
                onClick={onEndNavigation}
                className={endButtonClass}
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