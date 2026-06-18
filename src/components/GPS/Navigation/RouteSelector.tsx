import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import Button from '../../ui/Button';
import { useLanguage } from '../../../hooks/useLanguage';

interface RouteStep {
  distance: number; // meters
  duration: number; // seconds
  instruction: string;
  name: string;
  maneuver?: {
    type?: string;
    modifier?: string;
    location?: [number, number];
  };
}

interface RouteOption {
  id: string;
  coordinates: [number, number][];
  distance: number;
  duration: number;
  name: string;
  steps?: RouteStep[];
}

interface RouteSelectorProps {
  routes: RouteOption[];
  selectedRoute: RouteOption | null;
  onRouteSelect: (route: RouteOption) => void;
  onStartNavigation: () => void;
  isLoading?: boolean;
  compact?: boolean;
}

export default function RouteSelector({
  routes,
  selectedRoute,
  onRouteSelect,
  onStartNavigation,
  isLoading = false,
  compact = false,
}: RouteSelectorProps) {
  const { t } = useLanguage();
  const [showRouteOptions, setShowRouteOptions] = useState(false);

  const wrapperClass = compact ? 'space-y-1.5' : 'space-y-2 md:space-y-3';
  const durationClass = compact ? 'text-lg font-bold text-gray-900 dark:text-white' : 'text-xl md:text-2xl font-bold text-gray-900 dark:text-white';
  const distanceClass = compact ? 'text-[11px] font-medium text-gray-600 dark:text-gray-400' : 'text-xs md:text-sm font-medium text-gray-600 dark:text-gray-400';
  const routeNameClass = compact ? 'text-[11px] mt-0.5 text-gray-600 dark:text-gray-400' : 'text-xs mt-0.5 text-gray-600 dark:text-gray-400';
  const mobileToggleClass = compact
    ? 'md:hidden w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors bg-gray-100/50 dark:bg-gray-800/50 hover:bg-gray-100/80 dark:hover:bg-gray-800/70 text-gray-700 dark:text-gray-300'
    : 'md:hidden w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors bg-gray-100/50 dark:bg-gray-800/50 hover:bg-gray-100/80 dark:hover:bg-gray-800/70 text-gray-700 dark:text-gray-300';
  const routeButtonClass = compact
    ? 'w-full px-2.5 py-2 rounded-lg text-left transition-colors'
    : 'w-full px-3 md:px-4 py-2.5 md:py-3.5 rounded-xl text-left transition-colors';
  const routeOptionDurationClass = compact ? 'text-[13px] font-semibold text-gray-900 dark:text-white' : 'text-sm md:text-base font-semibold text-gray-900 dark:text-white';
  const routeOptionMetaClass = compact ? 'text-[11px] text-gray-600 dark:text-gray-400' : 'text-xs md:text-sm text-gray-600 dark:text-gray-400';
  const sectionLabelClass = compact ? 'text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400' : 'text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400';
  const selectedCardClass = compact
    ? 'rounded-xl border border-blue-200/70 dark:border-blue-800/50 bg-blue-50/80 dark:bg-blue-950/20 p-2.5'
    : 'rounded-2xl border border-blue-200/70 dark:border-blue-800/50 bg-blue-50/80 dark:bg-blue-950/20 p-3';
  const selectedBadgeClass = `${compact ? 'text-[9px]' : 'text-[10px]'} inline-flex items-center rounded-full border px-1.5 py-0.5 font-semibold bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800/50`;
  const instructionPreviewClass = compact ? 'mt-2 text-[11px] leading-snug text-gray-700 dark:text-gray-200' : 'mt-2 text-xs leading-snug text-gray-700 dark:text-gray-200';
  const alternativeLabelClass = compact ? 'text-[11px] font-semibold text-gray-600 dark:text-gray-400' : 'text-xs font-medium text-gray-600 dark:text-gray-400';
  const previewInstruction = selectedRoute.steps?.find((step) => step.instruction?.trim())?.instruction;

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

  if (!selectedRoute) return null;

  return (
    <div className={wrapperClass}>
      <div className={selectedCardClass}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className={sectionLabelClass}>{t('gps.selectedRoute') || 'Selected route'}</p>
          <div className="flex items-baseline gap-1.5 md:gap-2">
            <p className={durationClass}>
              {formatDuration(selectedRoute.duration)}
            </p>
            <p className={distanceClass}>
              ({formatDistance(selectedRoute.distance)})
            </p>
          </div>
          <p className={routeNameClass}>
            {selectedRoute.name}
          </p>
            {previewInstruction && (
              <p className={instructionPreviewClass}>
                {previewInstruction}
              </p>
            )}
          </div>
          <span className={selectedBadgeClass}>{t('gps.ready') || 'Ready'}</span>
        </div>
      </div>
      
      {/* Alternative Routes - Dropdown on mobile, expanded on desktop */}
      {routes.length > 1 && (
        <div className="space-y-1.5">
          {/* Mobile: Dropdown button */}
          <button
            onClick={() => setShowRouteOptions(!showRouteOptions)}
            className={mobileToggleClass}
          >
            <span>Alternative routes ({routes.length - 1})</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showRouteOptions ? 'rotate-180' : ''}`} />
          </button>

          {/* Desktop: Label */}
          <p className={`hidden md:block ${alternativeLabelClass}`}>
            Alternative routes
          </p>
          
          {/* Routes list - conditionally shown on mobile, always on desktop */}
          <div className={`space-y-2 ${showRouteOptions ? 'block' : 'hidden'} md:block`}>
            {routes.map((route) => (
              <button
                key={route.id}
                onClick={() => {
                  onRouteSelect(route);
                  setShowRouteOptions(false);
                }}
                className={`${routeButtonClass} ${
                  selectedRoute?.id === route.id
                    ? 'bg-blue-500/20 border-2 border-blue-500'
                    : 'bg-gray-100/50 dark:bg-gray-800/50 hover:bg-gray-100/80 dark:hover:bg-gray-800/70 border-2 border-transparent active:bg-gray-100 dark:active:bg-gray-800/90'
                }`}
              >
                <div className="flex items-baseline gap-1.5 md:gap-2">
                  <span className={routeOptionDurationClass}>
                    {formatDuration(route.duration)}
                  </span>
                </div>
                <div className={`${routeOptionMetaClass} mt-0.5`}>
                  {formatDistance(route.distance)} • {route.name}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      
      {/* Start Button */}
      <Button
        variant="primary"
        size={compact ? 'sm' : 'lg'}
        onClick={onStartNavigation}
        loading={isLoading}
        className={compact ? 'w-full mt-1.5 text-xs' : 'w-full mt-2 text-sm md:text-base'}
      >
        {t('gps.startDriving') || 'Start'}
      </Button>
    </div>
  );
}

export type { RouteOption };