/**
 * Tile URL utilities for offline/online map tiles
 * Centralizes platform-specific tile URL logic
 */

const BLANK_TILE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// Optional bridge to OnScreenConsole: if available, push tile warnings directly to its buffer
const pushOnScreenLog = (level: 'warn' | 'error' | 'log' | 'info', message: string) => {
  try {
    const buf = (window as any)?.globalLogBuffer;
    if (Array.isArray(buf)) {
      const entry = {
        id: buf.length ? (buf[buf.length - 1].id ?? 0) + 1 : 0,
        timestamp: new Date().toLocaleTimeString(),
        level,
        message,
        args: [message]
      };
      buf.push(entry);
      if (buf.length > 200) buf.shift();
    }
  } catch (_) {
    // Ignore logging bridge errors
  }
};

interface TileUrlOptions {
  isCapacitor: boolean;
  forceOffline: boolean;
  requiresOnline?: boolean;
}

/**
 * Get the appropriate tile URL for Germany offline tiles
 */
export const getGermanyTileUrl = (_isCapacitor: boolean): string => {
  // Use a relative URL so it works for both web (https://domain/tiles/...) and
  // Capacitor (capacitor://localhost/tiles/...). Avoid the http://localhost
  // rewrite that fails on Android because no HTTP server is running there.
  return '/tiles/germany/{z}/{x}/{y}.png';
};

export const getBundledGermanyPmtilesUrl = (): string | undefined => {
  const runtimeUrl = typeof window !== 'undefined' ? (window as any).__VITE_PMTILES_URL__ : undefined;
  const configuredUrl = runtimeUrl || (import.meta.env.VITE_PMTILES_URL as string | undefined);

  if (configuredUrl) {
    return configuredUrl;
  }

  return __GERMANY_PMTILES_AVAILABLE__ ? '/tiles/germany.pmtiles' : undefined;
};

/**
 * Get blank tile data URI for error/blocking scenarios
 */
export const getBlankTileUrl = (): string => {
  return BLANK_TILE;
};

/**
 * Create tile error handler that forces blank tiles
 */
export const createTileErrorHandler = (layerId: string = 'unknown') => (error: any) => {
  const msg = `[TileUtils] Tile error for ${layerId}: ${JSON.stringify(error?.coords || {})}`;
  console.warn(msg);
  pushOnScreenLog('warn', msg);
  if (error.tile) {
    error.tile.src = BLANK_TILE;
  }
};

/**
 * Create tile load start handler that blocks external requests for offline layers
 */
export const createTileLoadStartHandler = (
  requiresOnline: boolean,
  localTileUrl?: string
) => (event: any) => {
  if (!requiresOnline && event.tile && event.tile.src) {
    const src = event.tile.src;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const isSameOrigin = (() => {
      try {
        const url = new URL(src, origin);
        return origin && url.origin === origin;
      } catch {
        return false;
      }
    })();
    
    // Block external HTTP requests (except localhost)
    if (src.startsWith('http://') && !src.startsWith('http://localhost') && !isSameOrigin) {
      const msg = `[TileUtils] Blocking external HTTP tile request: ${src}`;
      console.warn(msg);
      pushOnScreenLog('warn', msg);
      event.tile.src = BLANK_TILE;
    } 
    // Block all HTTPS requests
    else if (src.startsWith('https://') && !isSameOrigin) {
      const msg = `[TileUtils] Blocking HTTPS tile request: ${src}`;
      console.warn(msg);
      pushOnScreenLog('warn', msg);
      event.tile.src = BLANK_TILE;
    }
    // Redirect to local tile if provided
    else if (localTileUrl && !src.startsWith('data:') && !src.startsWith('http://localhost')) {
      event.tile.src = localTileUrl
        .replace('{z}', event.coords.z)
        .replace('{x}', event.coords.x)
        .replace('{y}', event.coords.y);
    }
  }
};

/**
 * Get Germany bounds for tile restriction
 */
export const getGermanyBounds = (): [[number, number], [number, number]] => {
  return [[47.27, 5.87], [55.06, 15.04]];
};

/**
 * Niedersachsen bounds for offline PMTiles coverage
 */
export const getNiedersachsenBounds = (): [[number, number], [number, number]] => {
  return [[51.26, 6.35], [53.91, 11.65]];
};

/**
 * Resolve tile URL for a layer based on options
 */
export const resolveTileUrl = (
  baseUrl: string,
  options: TileUrlOptions
): string => {
  const { isCapacitor, forceOffline, requiresOnline } = options;
  
  // For offline layers in Capacitor, use localhost
  if (!requiresOnline && isCapacitor && baseUrl.includes('/tiles/germany/')) {
    return getGermanyTileUrl(isCapacitor);
  }
  
  return baseUrl;
};

/**
 * Common tile layer props for offline Germany tiles
 */
export const getOfflineGermanyTileProps = (isCapacitor: boolean) => ({
  url: getGermanyTileUrl(isCapacitor),
  minZoom: 0,
  maxZoom: 18,
  maxNativeZoom: 12,
  noWrap: true,
  bounds: getGermanyBounds(),
  errorTileUrl: BLANK_TILE,
  attribution: 'Offline Maps',
});
