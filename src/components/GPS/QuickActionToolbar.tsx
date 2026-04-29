/**
 * Quick Action Toolbar Component
 * Floating action buttons for quick access to common GPS tracking functions
 * Optimized for tablet use with glove-friendly touch targets
 */

import { useState } from 'react';
import { MapPin, Target, Navigation, Settings, Zap, Battery } from 'lucide-react';
import { haptics } from '../../utils/haptics';
import { batteryOptimization } from '../../utils/batteryOptimization';
import { useLanguage } from '../../hooks/useLanguage';
import '../../styles/tablet-optimizations.css';

interface QuickActionToolbarProps {
  isTracking: boolean;
  onAddSample?: () => void;
  onCenterMap?: () => void;
  onStartNavigation?: () => void;
  onToggleSettings?: () => void;
  onToggleBatterySaver?: () => void;
  className?: string;
  position?: 'bottom-right' | 'bottom-left' | 'bottom-center';
}

export default function QuickActionToolbar({
  isTracking,
  onAddSample,
  onCenterMap,
  onStartNavigation,
  onToggleSettings,
  onToggleBatterySaver,
  className = '',
  position = 'bottom-right',
}: QuickActionToolbarProps) {
  const { t } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isBatterySaver, setIsBatterySaver] = useState(batteryOptimization.isBatterySavingEnabled());

  const positionClasses = {
    'bottom-right': 'bottom-6 right-6',
    'bottom-left': 'bottom-6 left-6',
    'bottom-center': 'bottom-6 left-1/2 transform -translate-x-1/2',
  };

  const handleButtonClick = async (action: () => void, hapticType: 'light' | 'medium' = 'light') => {
    await haptics.trigger({ type: hapticType });
    action();
  };

  const toggleBatterySaver = async () => {
    await haptics.trigger({ type: 'medium' });
    const newState = !isBatterySaver;
    setIsBatterySaver(newState);
    
    if (newState) {
      batteryOptimization.enableBatterySaving();
    } else {
      batteryOptimization.disableBatterySaving();
    }
    
    onToggleBatterySaver?.();
  };

  return (
    <div 
      className={`quick-actions-toolbar fixed ${positionClasses[position]} z-[1000] flex flex-col gap-3 ${className}`}
      style={{ pointerEvents: 'none' }}
    >
      {/* Expanded Actions */}
      {isExpanded && (
        <div 
          className="flex flex-col gap-3 transition-all duration-300 ease-out"
          style={{ 
            pointerEvents: 'all',
            transform: isExpanded ? 'translateY(0)' : 'translateY(20px)',
            opacity: isExpanded ? 1 : 0,
          }}
        >
          {/* Battery Saver Toggle */}
          <button
            onClick={toggleBatterySaver}
            className={`fab touch-target-lg ${isBatterySaver ? 'fab-success' : 'fab-primary'} hover:scale-105 transition-transform`}
            title={t('gps.quickActions.batterySaver')}
            aria-label={t('gps.quickActions.toggleBatterySaver')}
          >
            {isBatterySaver ? (
              <Battery className="w-7 h-7" />
            ) : (
              <Zap className="w-7 h-7" />
            )}
          </button>

          {/* Settings */}
          {onToggleSettings && (
            <button
              onClick={() => handleButtonClick(onToggleSettings)}
              className="fab fab-primary hover:scale-105 transition-transform touch-target-lg"
              title={t('gps.quickActions.settings')}
              aria-label={t('gps.quickActions.settingsAria')}
            >
              <Settings className="w-7 h-7" />
            </button>
          )}

          {/* Start Navigation */}
          {onStartNavigation && (
            <button
              onClick={() => handleButtonClick(onStartNavigation, 'medium')}
              className="fab fab-primary hover:scale-105 transition-transform touch-target-lg"
              title={t('gps.quickActions.navigation')}
              aria-label={t('gps.quickActions.startNavigation')}
            >
              <Navigation className="w-7 h-7" />
            </button>
          )}

          {/* Center Map on Current Location */}
          {onCenterMap && (
            <button
              onClick={() => handleButtonClick(onCenterMap)}
              className="fab fab-primary hover:scale-105 transition-transform touch-target-lg"
              title={t('gps.quickActions.centerMap')}
              aria-label={t('gps.quickActions.centerMapAria')}
            >
              <Target className="w-7 h-7" />
            </button>
          )}
        </div>
      )}

      {/* Main Action Button (Add Sample / Toggle Menu) */}
      <div className="relative" style={{ pointerEvents: 'all' }}>
        {isTracking && onAddSample ? (
          // When tracking: Main button records sample
          <>
            <button
              onClick={() => handleButtonClick(onAddSample, 'medium')}
              onContextMenu={(e) => {
                e.preventDefault();
                setIsExpanded(!isExpanded);
                haptics.trigger({ type: 'light' });
              }}
              className="sample-record-button fab fab-success hover:scale-105 transition-transform shadow-xl"
              title={t('gps.quickActions.addSampleLongPress')}
              aria-label={t('gps.quickActions.addSample')}
            >
              <MapPin className="w-9 h-9" />
            </button>

            {/* Menu toggle indicator (small dot) */}
            <button
              onClick={() => {
                setIsExpanded(!isExpanded);
                haptics.trigger({ type: 'light' });
              }}
              className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-blue-500 hover:bg-blue-600 flex items-center justify-center shadow-lg transition-colors"
              aria-label={t('gps.quickActions.toggleMenu')}
            >
              <span className="text-white text-xs font-bold">···</span>
            </button>
          </>
        ) : (
          // When not tracking: Main button toggles menu
          <button
            onClick={() => {
              setIsExpanded(!isExpanded);
              haptics.trigger({ type: 'light' });
            }}
            className={`fab ${isExpanded ? 'fab-danger' : 'fab-primary'} hover:scale-105 transition-all touch-target-lg shadow-xl`}
            title={isExpanded ? t('gps.quickActions.closeMenu') : t('gps.quickActions.quickActions')}
            aria-label={isExpanded ? t('gps.quickActions.closeQuickActionsMenu') : t('gps.quickActions.openQuickActionsMenu')}
          >
            {isExpanded ? (
              <span className="text-3xl">×</span>
            ) : (
              <span className="text-2xl">⚡</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
