import { X, Navigation2 } from 'lucide-react';
import { useLanguage } from '../../../hooks/useLanguage';
import { useDarkMode } from '../../../hooks/useDarkMode';

interface NavigationHeaderProps {
  projectName?: string;
  onClose: () => void;
}

export default function NavigationHeader({ projectName, onClose }: NavigationHeaderProps) {
  const [isDarkMode] = useDarkMode();
  const { t } = useLanguage();

  return (
    <div className={`flex-shrink-0 flex items-center gap-1 lg:gap-3 px-2 py-1 lg:p-4 border-b ${
      isDarkMode ? 'glass-panel-dark border-gray-700/50' : 'glass-panel-light border-gray-200/50'
    }`}>
      <Navigation2 className="w-3.5 h-3.5 lg:w-6 lg:h-6 text-blue-500 dark:text-blue-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        {/* Show only project name on mobile/tablet, full info on desktop */}
        <h2 className="hidden lg:block text-base lg:text-lg font-semibold truncate text-gray-900 dark:text-white">
          {t('gps.navigation') || 'Navigation'}
        </h2>
        {projectName && (
          <p className="text-[10px] lg:text-sm truncate text-gray-600 dark:text-gray-400 lg:mt-0">
            {projectName}
          </p>
        )}
      </div>
      <button
        onClick={onClose}
        className="p-0.5 lg:p-2 rounded-lg transition-colors flex-shrink-0 text-gray-700 dark:text-gray-200 hover:bg-gray-100/50 dark:hover:bg-gray-700/50 active:bg-gray-100 dark:active:bg-gray-700"
        title={t('common.close') || 'Close'}
      >
        <X className="w-3.5 h-3.5 lg:w-5 lg:h-5" />
      </button>
    </div>
  );
}