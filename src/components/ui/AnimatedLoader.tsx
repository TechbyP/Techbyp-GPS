import React from 'react';
import { useDarkMode } from '../../hooks/useDarkMode';
import { useTranslation } from 'react-i18next';

interface AnimatedLoaderProps {
  message?: string;
  fullScreen?: boolean;
}

export const AnimatedLoader: React.FC<AnimatedLoaderProps> = ({ 
  message,
  fullScreen = true 
}) => {
  const [isDark] = useDarkMode();
  const { t } = useTranslation();

  // Use provided message or default to translated "Loading"
  const displayMessage = message || t('common.loadingApp') || 'Loading';

  // Ensure we detect dark mode preference from system if not set
  const effectiveDark = isDark || (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <div style={{
      position: fullScreen ? 'fixed' : 'relative',
      inset: fullScreen ? '0' : 'auto',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      background: effectiveDark 
        ? 'linear-gradient(135deg,rgba(59,130,246,0.1) 0%,rgba(16,185,129,0.1) 100%)'
        : 'linear-gradient(135deg,rgba(59,130,246,0.08) 0%,rgba(16,185,129,0.08) 100%)',
      backgroundColor: effectiveDark ? '#0f172a' : '#f9fafb',
      fontFamily: "ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
      minHeight: fullScreen ? '100vh' : '200px',
      zIndex: 50,
    }}>
      {/* Animated background particles */}
      {fullScreen && (
        <div style={{
          position: 'absolute',
          inset: '0',
          overflow: 'hidden',
          pointerEvents: 'none'
        }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                width: '4px',
                height: '4px',
                background: effectiveDark 
                  ? (i % 2 === 0 ? 'rgba(59,130,246,0.4)' : 'rgba(16,185,129,0.4)')
                  : (i % 2 === 0 ? 'rgba(59,130,246,0.3)' : 'rgba(16,185,129,0.3)'),
                borderRadius: '50%',
                left: `${(i + 1) * 10}%`,
                top: '100vh',
                animation: `floatParticle ${12 + i * 2}s infinite linear ${i * 2}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* Loading content */}
      <div style={{
        textAlign: 'center',
        position: 'relative',
        zIndex: 10,
        animation: 'scaleInSplash 0.6s cubic-bezier(0.34,1.56,0.64,1)',
      }}>
        {/* Logo with spinning rings */}
        <div style={{
          position: 'relative',
          width: '120px',
          height: '120px',
          margin: '0 auto 32px',
        }}>
          {/* App Logo */}
          <img
            src="/app-logo.png"
            alt={t('gps.gpsTracker')}
            style={{
              position: 'absolute',
              inset: '0',
              margin: 'auto',
              width: '64px',
              height: '64px',
              borderRadius: '16px',
              boxShadow: effectiveDark 
                ? '0 8px 16px rgba(0,0,0,0.5)'
                : '0 8px 16px rgba(0,0,0,0.15)',
              animation: 'pulseLogo 2s ease-in-out infinite',
            }}
          />
          {/* Rotating rings */}
          <div
            style={{
              position: 'absolute',
              inset: '0',
              borderRadius: '50%',
              border: '3px solid ' + (effectiveDark ? 'rgba(59,130,246,0.3)' : 'rgba(59,130,246,0.2)'),
              borderTopColor: '#3b82f6',
              animation: 'spinOuter 2s linear infinite',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: '10px',
              borderRadius: '50%',
              border: '3px solid ' + (effectiveDark ? 'rgba(16,185,129,0.3)' : 'rgba(16,185,129,0.2)'),
              borderRightColor: '#10b981',
              animation: 'spinMiddle 3s linear infinite',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: '20px',
              borderRadius: '50%',
              border: '3px solid ' + (effectiveDark ? 'rgba(59,130,246,0.25)' : 'rgba(59,130,246,0.15)'),
              borderBottomColor: '#60a5fa',
              animation: 'spinInner 4s linear infinite',
            }}
          />
        </div>

        {/* App name with gradient */}
        <h1
          style={{
            fontSize: '2rem',
            fontWeight: '700',
            marginBottom: '12px',
            background: 'linear-gradient(to right,' + (effectiveDark ? '#60a5fa' : '#3b82f6') + ',' + (effectiveDark ? '#34d399' : '#10b981') + ')',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            letterSpacing: '-0.02em',
            animation: 'slideUpSplash 0.8s cubic-bezier(0.34,1.56,0.64,1) 0.2s both',
          }}
        >
          {t('gps.gpsTracker')}
        </h1>

        {/* Loading text with animated dots */}
        <p
          style={{
            color: effectiveDark ? '#94a3b8' : '#64748b',
            fontSize: '0.875rem',
            fontWeight: '500',
            animation: 'slideUpSplash 0.8s cubic-bezier(0.34,1.56,0.64,1) 0.4s both',
          }}
        >
          {displayMessage}
          <span style={{
            display: 'inline-block',
            width: '4px',
            margin: '0 2px',
            animation: 'blinkDot 1.5s infinite 0s',
          }}>.</span>
          <span style={{
            display: 'inline-block',
            width: '4px',
            margin: '0 2px',
            animation: 'blinkDot 1.5s infinite 0.2s',
          }}>.</span>
          <span style={{
            display: 'inline-block',
            width: '4px',
            margin: '0 2px',
            animation: 'blinkDot 1.5s infinite 0.4s',
          }}>.</span>
        </p>

        {/* Progress bar */}
        <div
          style={{
            marginTop: '32px',
            width: '200px',
            height: '3px',
            background: effectiveDark ? 'rgba(148,163,184,0.2)' : 'rgba(203,213,225,0.4)',
            borderRadius: '9999px',
            marginLeft: 'auto',
            marginRight: 'auto',
            overflow: 'hidden',
            animation: 'slideUpSplash 0.8s cubic-bezier(0.34,1.56,0.64,1) 0.6s both',
          }}
        >
          <div
            style={{
              height: '100%',
              width: '50%',
              background: effectiveDark 
                ? 'linear-gradient(to right,#60a5fa,#34d399)'
                : 'linear-gradient(to right,#3b82f6,#10b981)',
              animation: 'progressBarSplash 1.5s ease-in-out infinite',
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes scaleInSplash { from { transform: scale(0.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes spinOuter { to { transform: rotate(360deg); } }
        @keyframes spinMiddle { to { transform: rotate(-360deg); } }
        @keyframes spinInner { to { transform: rotate(360deg); } }
        @keyframes pulseLogo { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.05); opacity: 0.9; } }
        @keyframes slideUpSplash { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes blinkDot { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
        @keyframes progressBarSplash { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
        @keyframes floatParticle { to { transform: translateY(-110vh) translateX(50px); opacity: 0; } }
      `}</style>
    </div>
  );
};

export default AnimatedLoader;
