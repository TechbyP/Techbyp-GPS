/**
 * Device Detection Utilities
 * Detects Windows tablets, mobile devices, and platform capabilities
 */

/**
 * Detect if the device is a Windows tablet
 * Windows tablets typically have:
 * - Touch support
 * - Windows OS
 * - Potentially smaller screen sizes or specific user agents
 */
export function isWindowsTablet(): boolean {
  if (typeof window === 'undefined') return false;

  const userAgent = navigator.userAgent.toLowerCase();
  const platform = navigator.platform?.toLowerCase() || '';
  
  // Check for Windows OS
  const isWindows = platform.includes('win') || userAgent.includes('windows');
  
  // Check for touch support (primary indicator of tablet/touch device)
  const hasTouch = 'ontouchstart' in window || 
                   navigator.maxTouchPoints > 0 || 
                   (navigator as any).msMaxTouchPoints > 0;
  
  // Check for tablet-specific indicators
  const isTablet = userAgent.includes('tablet') || 
                   userAgent.includes('ipad') ||
                   // Surface devices
                   userAgent.includes('surface') ||
                   // Some Windows tablets identify as 'touch'
                   userAgent.includes('touch');
  
  // Windows tablet = Windows OS + Touch support
  // OR explicitly marked as tablet/surface
  return (isWindows && hasTouch) || (isWindows && isTablet);
}

/**
 * Detect if device is mobile (phone or tablet)
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;

  const userAgent = navigator.userAgent.toLowerCase();
  
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|tablet/i.test(userAgent) ||
         (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);
}

/**
 * Detect compact landscape screens, primarily phones used in landscape.
 * This intentionally excludes tablets and larger touch devices.
 */
export function isCompactLandscapeScreen(): boolean {
  if (typeof window === 'undefined') return false;

  const width = window.innerWidth;
  const height = window.innerHeight;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= height) {
    return false;
  }

  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const userAgent = navigator.userAgent.toLowerCase();
  const hasTouch = 'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    (navigator as any).msMaxTouchPoints > 0;
  const looksLikeTablet = userAgent.includes('ipad') || userAgent.includes('tablet') || userAgent.includes('surface');

  if (!hasTouch || looksLikeTablet) {
    return false;
  }

  return isMobileDevice() && shortSide <= 600 && longSide <= 960;
}

/**
 * Detect if device has GPS capabilities
 */
export function hasGPSCapability(): boolean {
  return 'geolocation' in navigator;
}

/**
 * Detect if device supports Web Serial API (for USB GPS)
 */
export function supportsSerialAPI(): boolean {
  return 'serial' in navigator;
}

/**
 * Get comprehensive device info
 */
export function getDeviceInfo() {
  return {
    isWindowsTablet: isWindowsTablet(),
    isMobile: isMobileDevice(),
    isCompactLandscape: isCompactLandscapeScreen(),
    hasGPS: hasGPSCapability(),
    hasSerialAPI: supportsSerialAPI(),
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    touchPoints: navigator.maxTouchPoints,
    screenSize: {
      width: window.innerWidth,
      height: window.innerHeight
    }
  };
}

/**
 * Check if device can track GPS
 * - Native apps always can
 * - Windows tablets can
 * - Mobile devices can
 * - Desktop browsers without special detection cannot
 */
export function canTrackGPS(isNativeApp: boolean): boolean {
  // Native apps always support tracking
  if (isNativeApp) return true;
  
  // Windows tablets can track
  if (isWindowsTablet()) return true;
  
  // Mobile devices can track
  if (isMobileDevice()) return true;
  
  // Desktop browsers can track if they have geolocation
  // (allow for debugging and development)
  return hasGPSCapability();
}
