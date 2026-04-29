import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useDarkMode } from '../../hooks/useDarkMode';
import { useLanguage } from '../../hooks/useLanguage';
import { Mail, Lock, Globe, Download, Loader } from 'lucide-react';
import { AnimatedLoader } from '../ui/AnimatedLoader';
import { RegistrationForm } from './RegistrationForm';
import toast from 'react-hot-toast';
import { isCapacitorApp, getPlatformInfo } from '../../utils/platform';

export function AuthScreen() {
  const [isDark] = useDarkMode();
  const { t, language, changeLanguage } = useLanguage();
  const { login } = useAuth();

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

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

  // Check if running as installed app
  const isInstalledApp = isCapacitorApp();

  // Debug logging disabled to reduce console spam
  // Platform info available via getPlatformInfo() if needed for debugging

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
              {t('app.name') || 'TECHBYP GPS'}
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
            {t('app.name') || 'TECHBYP GPS'}
          </h1>
          <p className={`text-xs sm:text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            {isSignUp
              ? t('auth.signupTitle') || 'Create your account'
              : t('auth.loginTitle') || 'Welcome back'}
          </p>
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

        {/* Toggle */}
        <div className="mt-3 sm:mt-4 text-center">
          <p className={`text-[10px] sm:text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            {t('auth.noAccount') || "Don't have an account?"}
            {' '}
            <button
              type="button"
              onClick={() => {
                setIsSignUp(true);
              }}
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              {t('auth.signupInstead') || 'Sign up'}
            </button>
          </p>
        </div>

        {/* Offline Mode */}
        {!navigator.onLine && (
          <div className="mt-3 sm:mt-4">
            <button
              type="button"
              onClick={() => {
                // Set guest mode
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
                
                // Manually trigger auth state (bypass Firebase)
                window.dispatchEvent(new CustomEvent('offline-auth', { detail: guestUser }));
                toast.success(t('auth.offlineMode') || 'Using offline mode');
              }}
              className={`w-full py-1.5 sm:py-2 rounded-lg font-medium text-xs transition-colors border-2 border-dashed ${
                isDark 
                  ? 'border-gray-600 text-gray-300 hover:border-gray-500 hover:bg-gray-800/50' 
                  : 'border-gray-400 text-gray-600 hover:border-gray-500 hover:bg-gray-50'
              }`}
            >
              📱 {t('auth.useOffline') || 'Use Offline Mode'}
            </button>
            <p className={`text-[9px] sm:text-[10px] mt-1 text-center ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
              {t('auth.offlineNote') || 'Local data only, no cloud sync'}
            </p>
          </div>
        )}

        {/* APK Download Link - Only show in browser, not in installed app */}
        {!isInstalledApp && (
          <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-gray-700/50">
            <button
              onClick={() => {
                try {
                  console.log('📦 Starting APK download from:', '/gps-tracker.apk');
                  
                  // Try fetch first to check if file exists
                  fetch('/gps-tracker.apk', { method: 'HEAD' })
                    .then(response => {
                      if (!response.ok) {
                        console.error('❌ APK not found or not accessible. Status:', response.status);
                        toast.error(t('auth.apkNotFound') || 'APK file not found on server');
                        return;
                      }
                      
                      console.log('✅ APK found, starting download...');
                      // Create download link
                      const link = document.createElement('a');
                      link.href = '/gps-tracker.apk';
                      link.download = 'gps-tracker.apk';
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
                      link.href = '/gps-tracker.apk';
                      link.download = 'gps-tracker.apk';
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
              className={`flex items-center justify-center gap-1.5 sm:gap-2 w-full py-2 sm:py-2.5 rounded-lg font-medium text-xs sm:text-sm transition-colors ${
                isDark
                  ? 'bg-green-600/10 hover:bg-green-600/20 text-green-400 border border-green-600/30'
                  : 'bg-green-50 hover:bg-green-100 text-green-700 border border-green-200'
              }`}
            >
              <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              {t('auth.downloadApk') || 'Download Android APK'}
            </button>
            <p className={`text-[10px] sm:text-xs text-center mt-1.5 sm:mt-2 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
              {t('auth.installOnTablet') || 'Install on your Android tablet'}
            </p>
          </div>
        )}

      </div>
    </div>
  );
}

export default AuthScreen;
