import { useState } from 'react';
import { Settings, Sun, Moon, LogOut, Map } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import OfflineMapsDownloader from '../Maps/OfflineMapsDownloader';

interface SettingsMenuProps {
  language: string;
  onLanguageChange: (lng: string) => void;
  isDark: boolean;
  onToggleTheme: () => void;
}

const languages = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
];

export function SettingsMenu({ language, onLanguageChange, isDark, onToggleTheme }: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const [showOfflineMaps, setShowOfflineMaps] = useState(false);
  const { t } = useTranslation();
  const { logout, user } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      console.log('✅ Logged out successfully');
    } catch (error) {
      console.error('❌ Logout failed:', error);
    } finally {
      setIsLoggingOut(false);
      setOpen(false);
    }
  };

  return (
    <div className="absolute top-4 right-4 z-[2200]">
      <div className="relative">
        <button
          onClick={() => setOpen((p) => !p)}
          className={`flex items-center justify-center w-11 h-11 rounded-full shadow-lg transition-colors border ${
            isDark
              ? 'bg-gray-800/90 border-gray-700 text-gray-100 hover:bg-gray-700'
              : 'bg-white/90 border-gray-200 text-gray-800 hover:bg-gray-100'
          }`}
          title={t('settings.title')}
        >
          <Settings className="w-5 h-5" />
        </button>

        {open && (
          <div
            className={`mt-3 w-64 rounded-2xl shadow-xl border backdrop-blur-xl p-4 absolute right-0 transform -translate-x-1/4 ${
              isDark
                ? 'bg-gray-900/95 border-gray-700/50 text-gray-100'
                : 'bg-white/95 border-gray-200/50 text-gray-900'
            }`}
            style={{
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold">{t('settings.title')}</span>
              <button
                onClick={() => setOpen(false)}
                className="text-xs px-2 py-1 rounded hover:bg-gray-200/60 dark:hover:bg-gray-800/60"
              >
                {t('common.close')}
              </button>
            </div>

            <div className="space-y-3 text-sm">
              {/* Language Selector */}
              <div>
                <label className="block text-xs font-medium mb-1">{t('settings.language')}</label>
                <select
                  value={language}
                  onChange={(e) => onLanguageChange(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDark
                      ? 'bg-gray-800 border-gray-700 text-gray-100'
                      : 'bg-white border-gray-300 text-gray-900'
                  }`}
                >
                  {languages.map((lng) => (
                    <option key={lng.code} value={lng.code}>
                      {lng.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Theme Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium mb-1">{t('settings.theme')}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{t('settings.lightMode')} / {t('settings.darkMode')}</div>
                </div>
                <button
                  onClick={onToggleTheme}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    isDark
                      ? 'bg-gray-800 border-gray-700 text-gray-100 hover:bg-gray-700'
                      : 'bg-white border-gray-300 text-gray-800 hover:bg-gray-100'
                  }`}
                >
                  {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  {isDark ? t('settings.lightMode') : t('settings.darkMode')}
                </button>
              </div>

              {/* Offline Maps Section */}
              <div className="pt-2 border-t border-gray-300/30 dark:border-gray-600/30">
                <button
                  onClick={() => setShowOfflineMaps(!showOfflineMaps)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
                    isDark
                      ? 'hover:bg-gray-800/60'
                      : 'hover:bg-gray-100/60'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Map className="w-4 h-4" />
                    <span className="text-xs font-medium">Offline Maps</span>
                  </div>
                  <span className="text-xs">{showOfflineMaps ? '▼' : '▶'}</span>
                </button>
                
                {showOfflineMaps && (
                  <div className="mt-2">
                    <OfflineMapsDownloader />
                  </div>
                )}
              </div>

              {/* User Email Display */}
              {user && (
                <div className="pt-2 border-t border-gray-300/30 dark:border-gray-600/30">
                  <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                    {t('settings.loggedInAs')}
                  </p>
                  <p className="text-xs font-medium truncate text-blue-600 dark:text-blue-400">{user.email}</p>
                </div>
              )}

              {/* Logout Button */}
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                className={`w-full mt-3 flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  isLoggingOut
                    ? 'opacity-50 cursor-not-allowed'
                    : isDark
                      ? 'bg-red-900/30 text-red-300 hover:bg-red-900/50 border border-red-700/50'
                      : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                }`}
              >
                <LogOut className="w-4 h-4" />
                {isLoggingOut ? t('auth.loggingOut') : t('auth.logout')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SettingsMenu;
