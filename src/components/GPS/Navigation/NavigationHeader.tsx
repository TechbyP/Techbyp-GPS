import { X, Navigation2 } from 'lucide-react';
import { useLanguage } from '../../../hooks/useLanguage';
import { useDarkMode } from '../../../hooks/useDarkMode';

interface NavigationHeaderProps {
  projectName?: string;
  onClose: () => void;
  compact?: boolean;
  showClose?: boolean;
}

export default function NavigationHeader({ projectName, onClose, compact = false, showClose = true }: NavigationHeaderProps) {
  const [isDarkMode] = useDarkMode();
  const { t } = useLanguage();

  const headerClass = compact
    ? 'flex-shrink-0 flex items-center gap-1.5 px-2 py-1.5 border-b'
    : 'flex-shrink-0 flex items-center gap-1 lg:gap-3 px-2 py-1 lg:p-4 border-b';
  const iconClass = compact ? 'w-3.5 h-3.5 text-blue-500 dark:text-blue-400 flex-shrink-0' : 'w-3.5 h-3.5 lg:w-6 lg:h-6 text-blue-500 dark:text-blue-400 flex-shrink-0';
  const projectNameClass = compact
    ? 'text-[10px] truncate text-gray-600 dark:text-gray-400'
    : 'text-[10px] lg:text-sm truncate text-gray-600 dark:text-gray-400 lg:mt-0';
  const closeButtonClass = compact
    ? 'px-2.5 py-1 rounded-lg transition-colors flex-shrink-0 text-gray-700 dark:text-gray-200 hover:bg-gray-100/50 dark:hover:bg-gray-700/50 active:bg-gray-100 dark:active:bg-gray-700 text-[11px] font-semibold'
    : 'p-0.5 lg:p-2 rounded-lg transition-colors flex-shrink-0 text-gray-700 dark:text-gray-200 hover:bg-gray-100/50 dark:hover:bg-gray-700/50 active:bg-gray-100 dark:active:bg-gray-700';
  const closeIconClass = compact ? 'w-4 h-4' : 'w-3.5 h-3.5 lg:w-5 lg:h-5';

  return (
    <div className={`${headerClass} ${
      isDarkMode ? 'glass-panel-dark border-gray-700/50' : 'glass-panel-light border-gray-200/50'
    }`}>
      <Navigation2 className={iconClass} />
      <div className="flex-1 min-w-0">
        {/* Show only project name on mobile/tablet, full info on desktop */}
        <h2 className={`hidden ${compact ? '' : 'lg:block'} text-base lg:text-lg font-semibold truncate text-gray-900 dark:text-white`}>
          {t('gps.navigation') || 'Navigation'}
        </h2>
        {projectName && (
          <p className={projectNameClass}>
            {projectName}
          </p>
        )}
      </div>
      {showClose && (
        <button
          onClick={onClose}
          className={closeButtonClass}
          title={t('common.close') || 'Close'}
        >
          {compact ? (
            <span>{t('common.close') || 'Close'}</span>
          ) : (
            <X className={closeIconClass} />
          )}
        </button>
      )}
    </div>
  );
}