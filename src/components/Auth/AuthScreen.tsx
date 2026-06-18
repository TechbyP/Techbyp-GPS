import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useDarkMode } from '../../hooks/useDarkMode';
import { useLanguage } from '../../hooks/useLanguage';
import { Mail, Lock, Globe, Loader, Smartphone } from 'lucide-react';
import { AnimatedLoader } from '../ui/AnimatedLoader';
import { RegistrationForm } from './RegistrationForm';
import toast from 'react-hot-toast';
import { isCapacitorApp } from '../../utils/platform';

export function AuthScreen() {
  const [isDark] = useDarkMode();
  const { t, language, changeLanguage } = useLanguage();
  const { login } = useAuth();
  const apkDownloadFilename = 'TECHBYP-GPS Pro.apk';
  const apkDownloadPath = `/${encodeURIComponent(apkDownloadFilename)}`;

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const secondaryActionCardClass = `w-full rounded-xl border p-3 text-left transition-colors ${
    isDark
      ? 'border-gray-700 bg-gray-900/50 hover:bg-gray-900/70'
      : 'border-gray-200 bg-gray-50 hover:bg-white'
  }`;
  const secondaryActionTitleClass = `text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`;
  const secondaryActionBodyClass = `mt-1 text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`;
  const androidAppCardClass = `w-full rounded-2xl border p-3 transition-colors ${
    isDark
      ? 'border-gray-700 bg-gray-900/50 hover:bg-gray-900/70'
      : 'border-gray-200 bg-gray-50 hover:bg-white'
  }`;
  const androidIconTileClass = 'relative flex h-14 w-14 items-center justify-center rounded-[1.1rem] bg-gradient-to-br from-green-500 to-emerald-600 shadow-lg';
  const androidIconBadgeClass = `absolute -right-1 -top-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${
    isDark ? 'bg-gray-900 text-green-300 border border-green-500/30' : 'bg-white text-green-700 border border-green-200'
  }`;
  const androidMetaClass = `text-[11px] font-medium uppercase tracking-[0.16em] ${isDark ? 'text-green-300' : 'text-green-700'}`;
  const isInstalledApp = isCapacitorApp();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    console.log('🔄 Auth submission started:', { isSignUp, email });

    try {
      await login(email, password);
      toast.success(t('auth.loginSuccess') || 'Logged in successfully!');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  // Show loading screen during auth
  if (loading) {
    const loadingMessage = t('common.signingIn') || 'Signing in';
    return <AnimatedLoader message={loadingMessage} />;
  }

  // Show registration form
  if (isSignUp) {
    return (
      <div className={`min-h-screen flex items-center justify-center p-3 sm:p-4 ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
        <div
          className={`w-full max-w-sm sm:max-w-lg rounded-xl sm:rounded-2xl shadow-2xl p-4 sm:p-6 ${
            isDark
              ? 'bg-gray-800/90 border border-gray-700/50'
              : 'bg-white border border-gray-200'
          } backdrop-blur-xl`}
        >
          <div className="mb-4 text-center">
            <h1 className={`text-lg sm:text-xl font-bold mb-1.5 ${
              isDark ? 'text-gray-100' : 'text-gray-900'
            }`}>
              {t('app.name') || 'TECHBYP - GPS Pro'}
            </h1>
            <p className={`text-xs sm:text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              {t('auth.signupTitle') || 'Create your account'}
            </p>
          </div>
          
          <RegistrationForm onCancel={() => setIsSignUp(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen flex items-center justify-center p-3 sm:p-4 ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div
        className={`w-full max-w-sm sm:max-w-md rounded-xl sm:rounded-2xl shadow-2xl p-3 sm:p-4 md:p-6 ${
          isDark
            ? 'bg-gray-800/90 border border-gray-700/50'
            : 'bg-white border border-gray-200'
        } backdrop-blur-xl`}
      >
        {/* Header */}
        <div className="mb-4 sm:mb-6 text-center">
          <h1 className={`text-lg sm:text-xl font-bold mb-1.5 ${
            isDark ? 'text-gray-100' : 'text-gray-900'
          }`}>
            {t('app.name') || 'TECHBYP - GPS Pro'}
          </h1>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-2.5 sm:space-y-3">
          {/* Email */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('auth.email') || 'Email'}
              </label>
              {/* Small Language Selector */}
              <div className="relative">
                <select
                  value={language}
                  onChange={(e) => changeLanguage(e.target.value)}
                  className={`appearance-none pl-5 pr-4 py-0.5 rounded text-xs cursor-pointer transition-colors border focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                    isDark
                      ? 'bg-gray-700/50 border-gray-600 text-gray-300 hover:bg-gray-700'
                      : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <option value="en">EN</option>
                  <option value="de">DE</option>
                </select>
                <Globe className={`absolute left-1 top-0.5 w-3 h-3 pointer-events-none ${
                  isDark ? 'text-gray-500' : 'text-gray-400'
                }`} />
              </div>
            </div>
            <div className="relative">
              <Mail className={`absolute left-2.5 top-2 w-3.5 h-3.5 sm:w-4 sm:h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder') || 'you@example.com'}
                required
                className={`w-full pl-8 sm:pl-9 pr-2.5 sm:pr-3 py-1.5 sm:py-2 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isDark
                    ? 'bg-gray-700/50 border-gray-600 text-gray-100 placeholder-gray-500'
                    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
                }`}
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              {t('auth.password') || 'Password'}
            </label>
            <div className="relative">
              <Lock className={`absolute left-2.5 top-2 w-3.5 h-3.5 sm:w-4 sm:h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.passwordPlaceholder') || '••••••••'}
                required
                className={`w-full pl-8 sm:pl-9 pr-2.5 sm:pr-3 py-1.5 sm:py-2 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isDark
                    ? 'bg-gray-700/50 border-gray-600 text-gray-100 placeholder-gray-500'
                    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
                }`}
              />
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className={`w-full py-1.5 sm:py-2 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-colors text-xs ${
              loading
                ? 'opacity-50 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {loading && <Loader className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" />}
            {t('auth.login') || 'Login'}
          </button>
        </form>

        {(!navigator.onLine || !isInstalledApp) && (
          <div className={`mt-4 pt-4 border-t ${isDark ? 'border-gray-700/50' : 'border-gray-200'} space-y-2.5`}>
            {!navigator.onLine && (
              <button
                type="button"
                onClick={() => {
                  const guestUser = {
                    uid: 'offline_guest',
                    email: 'offline@guest.local',
                    emailVerified: false,
                    isAnonymous: true,
                    displayName: t('auth.offlineUser') || 'Offline User',
                    photoURL: null,
                    phoneNumber: null,
                    providerId: 'offline',
                    providerData: []
                  } as any;
                  
                  window.dispatchEvent(new CustomEvent('offline-auth', { detail: guestUser }));
                  toast.success(t('auth.offlineMode') || 'Using offline mode');
                }}
                className={secondaryActionCardClass}
              >
                <div className="flex items-start gap-3">
                  <div className="text-lg">📱</div>
                  <div>
                    <div className={secondaryActionTitleClass}>{t('auth.useOffline') || 'Use Offline Mode'}</div>
                    <div className={secondaryActionBodyClass}>{t('auth.offlineNote') || 'Local data only, no cloud sync'}</div>
                  </div>
                </div>
              </button>
            )}

            {!isInstalledApp && (
              <button
              onClick={() => {
                try {
                  console.log('📦 Starting APK download from:', apkDownloadPath);
                  
                  // Try fetch first to check if file exists
                  fetch(apkDownloadPath, { method: 'HEAD' })
                    .then(response => {
                      if (!response.ok) {
                        console.error('❌ APK not found or not accessible. Status:', response.status);
                        toast.error(t('auth.apkNotFound') || 'APK file not found on server');
                        return;
                      }
                      
                      console.log('✅ APK found, starting download...');
                      // Create download link
                      const link = document.createElement('a');
                      link.href = apkDownloadPath;
                      link.download = apkDownloadFilename;
                      link.style.display = 'none';
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      toast.success(t('auth.apkDownloadStarted') || 'APK download started');
                    })
                    .catch(error => {
                      console.error('❌ Error checking APK:', error);
                      // Try download anyway
                      const link = document.createElement('a');
                      link.href = apkDownloadPath;
                      link.download = apkDownloadFilename;
                      link.style.display = 'none';
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    });
                } catch (error) {
                  console.error('❌ Download error:', error);
                  toast.error(t('auth.apkDownloadFailed') || 'Failed to download APK');
                }
              }}
                className={androidAppCardClass}
                aria-label={t('auth.downloadApk') || 'Download Android APK'}
              >
                <div className="flex items-center gap-3">
                  <div className={androidIconTileClass}>
                    <Smartphone className="w-7 h-7 text-white" />
                    <span className={androidIconBadgeClass}>APK</span>
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <div className={androidMetaClass}>{t('auth.androidApp') || 'Android App'}</div>
                    <div className={secondaryActionBodyClass}>{t('auth.installOnTablet') || 'Install on your Android tablet'}</div>
                  </div>
                </div>
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

export default AuthScreen;
