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
}

export default function RouteSelector({
  routes,
  selectedRoute,
  onRouteSelect,
  onStartNavigation,
  isLoading = false
}: RouteSelectorProps) {
  const { t } = useLanguage();
  const [showRouteOptions, setShowRouteOptions] = useState(false);

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
    <div className="space-y-2 md:space-y-3">
      {/* Primary Route Info */}
      <div className="flex items-center gap-2 md:gap-3">
        <div className="flex-1">
          <div className="flex items-baseline gap-1.5 md:gap-2">
            <p className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
              {formatDuration(selectedRoute.duration)}
            </p>
            <p className="text-xs md:text-sm font-medium text-gray-600 dark:text-gray-400">
              ({formatDistance(selectedRoute.distance)})
            </p>
          </div>
          <p className="text-xs mt-0.5 text-gray-600 dark:text-gray-400">
            {selectedRoute.name}
          </p>
        </div>
      </div>
      
      {/* Alternative Routes - Dropdown on mobile, expanded on desktop */}
      {routes.length > 1 && (
        <div className="space-y-1.5">
          {/* Mobile: Dropdown button */}
          <button
            onClick={() => setShowRouteOptions(!showRouteOptions)}
            className="md:hidden w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors bg-gray-100/50 dark:bg-gray-800/50 hover:bg-gray-100/80 dark:hover:bg-gray-800/70 text-gray-700 dark:text-gray-300"
          >
            <span>Alternative routes ({routes.length - 1})</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showRouteOptions ? 'rotate-180' : ''}`} />
          </button>

          {/* Desktop: Label */}
          <p className="hidden md:block text-xs font-medium text-gray-600 dark:text-gray-400">
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
                className={`w-full px-3 md:px-4 py-2.5 md:py-3.5 rounded-xl text-left transition-colors ${
                  selectedRoute?.id === route.id
                    ? 'bg-blue-500/20 border-2 border-blue-500'
                    : 'bg-gray-100/50 dark:bg-gray-800/50 hover:bg-gray-100/80 dark:hover:bg-gray-800/70 border-2 border-transparent active:bg-gray-100 dark:active:bg-gray-800/90'
                }`}
              >
                <div className="flex items-baseline gap-1.5 md:gap-2">
                  <span className="text-sm md:text-base font-semibold text-gray-900 dark:text-white">
                    {formatDuration(route.duration)}
                  </span>
                  <span className="text-xs md:text-sm text-gray-600 dark:text-gray-400">
                    {formatDistance(route.distance)} • {route.name}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      
      {/* Start Button */}
      <Button
        variant="primary"
        size="lg"
        onClick={onStartNavigation}
        loading={isLoading}
        className="w-full mt-2 text-sm md:text-base"
      >
        {t('gps.startDriving') || 'Start'}
      </Button>
    </div>
  );
}

export type { RouteOption };