import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import fs from "fs";
import { compression } from "vite-plugin-compression2";
import { VitePWA } from "vite-plugin-pwa";

// Check for SSL certificates
const certPath = path.resolve(__dirname, "certs/cert.pem");
const keyPath = path.resolve(__dirname, "certs/key.pem");
// HTTPS disabled by default to allow WebSocket connections to GPS devices
// Set VITE_USE_HTTPS=true environment variable to enable HTTPS
const useHttps = process.env.VITE_USE_HTTPS === "true" && fs.existsSync(certPath) && fs.existsSync(keyPath);

console.log(useHttps ? "🔐 HTTPS enabled with SSL certificates" : "🔓 Running in HTTP mode (required for GPS device WebSocket connections)");

// Disable compression to avoid duplicate resource errors in Android builds
// Compressed files (.gz, .br) are served by web servers, not needed in APK
const enableCompression = false;

// Allow overriding via env var for debugging
const enableSourceMaps = process.env.VITE_ENABLE_SOURCEMAPS === "true";

const offlineTilePath = path.resolve(__dirname, "src/assets/tiles/offline.mbtiles");
const offlineTileUrl = fs.existsSync(offlineTilePath) ? "/assets/tiles/offline.mbtiles" : "";

// Check for Germany offline tiles (legacy raster) + PMTiles
const germanyTilesPath = path.resolve(__dirname, "public/tiles/germany");
const germanyTilesSourceAvailable = fs.existsSync(germanyTilesPath) && fs.existsSync(path.join(germanyTilesPath, "metadata.json"));
const germanyPmtilesPath = path.resolve(__dirname, "public/tiles/germany.pmtiles");
const germanyPmtilesSourceAvailable = fs.existsSync(germanyPmtilesPath);
const apacheHtaccessPath = path.resolve(__dirname, "public/.htaccess");

console.log(germanyPmtilesSourceAvailable ? "🇩🇪 Germany PMTiles available" : "🌐 Germany PMTiles not found");
console.log(germanyTilesSourceAvailable ? "🇩🇪 Germany raster tiles available" : "🌐 Germany raster tiles not found (will use online tiles)");

const isRecoverableDistCleanupError = (error: unknown): error is NodeJS.ErrnoException => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? String((error as NodeJS.ErrnoException).code || "") : "";
  return code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY";
};

const clearDirectoryContents = (directoryPath: string) => {
  if (!fs.existsSync(directoryPath)) {
    return;
  }

  for (const entry of fs.readdirSync(directoryPath)) {
    const entryPath = path.join(directoryPath, entry);
    try {
      fs.rmSync(entryPath, {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 150,
      });
    } catch (error) {
      if (isRecoverableDistCleanupError(error)) {
        console.warn(`⚠️ Skipping locked build artifact: ${entryPath}`);
        continue;
      }

      throw error;
    }
  }
};

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const modeAppTarget = mode === "tablet" ? "tablet" : mode === "web" ? "web" : null;
  const envAppTarget = env.VITE_APP_TARGET === "tablet" ? "tablet" : env.VITE_APP_TARGET === "web" ? "web" : null;
  const appTarget = modeAppTarget || envAppTarget || "web";
  const htmlInput = appTarget === "tablet" ? "index.tablet.html" : "index.html";
  const isDev = mode === "development";
  const bundleOfflineTiles = command !== "build" || env.VITE_BUNDLE_OFFLINE_TILES === "true";
  const germanyTilesAvailable = bundleOfflineTiles && germanyTilesSourceAvailable;
  const germanyPmtilesAvailable = bundleOfflineTiles && germanyPmtilesSourceAvailable;
  const outDir = path.resolve(__dirname, "dist");

  if (modeAppTarget && envAppTarget && envAppTarget !== modeAppTarget) {
    console.log(`ℹ️ Ignoring inherited VITE_APP_TARGET=${envAppTarget} for mode ${mode}`);
  }

  console.log(`🧭 App target: ${appTarget}`);
  if (command === "build" && !bundleOfflineTiles) {
    console.log("📦 Bundled offline tiles excluded from dist");
  }

  return {
    plugins: [
    wasm(),
    topLevelAwait(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: env.VITE_ENABLE_SW_DEV === "true",
      },
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "masked-icon.svg"],
      manifest: {
        name: "TECHBYP - GPS Pro",
        short_name: "TECHBYP - GPS Pro",
        description: "Professional GPS Tracking & Field Mapping",
        theme_color: "#1e293b",
        background_color: "#1e293b",
        display: "standalone",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        disableDevLogs: true,
        globPatterns: isDev ? [] : ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // Include Germany offline tiles in service worker cache
        globDirectory: "dist",
        globIgnores: [],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB to include large tile sets
        runtimeCaching: [
          // Cache OpenStreetMap tiles aggressively (30 days)
          {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "osm-tiles",
              expiration: {
                maxEntries: 1000,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          // Cache ESRI satellite tiles aggressively
          {
            urlPattern: /^https:\/\/server\.arcgisonline\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "esri-tiles",
              expiration: {
                maxEntries: 2000,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
                purgeOnQuotaError: true,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          ...(germanyTilesAvailable
            ? [
                {
                  // Use a match callback here because same-origin tile regexes can be dropped from the generated SW.
                  urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) => (
                    sameOrigin && /^\/tiles\/.*\.png$/i.test(url.pathname)
                  ),
                  handler: "CacheFirst" as const,
                  options: {
                    cacheName: "local-tiles",
                    expiration: {
                      maxEntries: 5000,
                      maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
                    },
                    cacheableResponse: {
                      statuses: [0, 200],
                    },
                  },
                },
              ]
            : []),
        ],
      },
    }),
    // Custom plugin to serve APK files with correct content type and tiles with cache headers
    {
      name: "configure-apk-response",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // APK content type
          if (req.url?.endsWith(".apk")) {
            res.setHeader("Content-Type", "application/vnd.android.package-archive");
            res.setHeader("Content-Disposition", "attachment; filename=\"gps-tracker.apk\"");
          }
          
          // PMTiles files need special handling for Range requests
          if (req.url?.endsWith(".pmtiles")) {
            res.setHeader("Accept-Ranges", "bytes");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Range");
            res.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length, Content-Type");
            // Disable caching for PMTiles to avoid ERR_CACHE_OPERATION_NOT_SUPPORTED
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
            res.setHeader("Pragma", "no-cache");
          }
          
          // Cache headers for tile images (30 days)
          if (req.url?.match(/\/tiles\/.*\.png$/i) || req.url?.match(/\.(png|jpg|jpeg)$/i)) {
            res.setHeader("Cache-Control", "public, max-age=2592000, immutable"); // 30 days
            res.setHeader("Expires", new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString());
          }
          
          next();
        });
      },
    },
    {
      name: "prepare-build-output",
      buildStart() {
        if (command !== "build") {
          return;
        }

        fs.mkdirSync(outDir, { recursive: true });
        clearDirectoryContents(outDir);
      },
    },
    {
      name: "copy-apache-htaccess",
      closeBundle() {
        if (command !== "build" || !fs.existsSync(apacheHtaccessPath)) {
          return;
        }

        const distHtaccessPath = path.join(outDir, ".htaccess");
        fs.copyFileSync(apacheHtaccessPath, distHtaccessPath);
        console.log("🔒 Copied .htaccess to dist");
      },
    },
    {
      name: "exclude-bundled-offline-tiles",
      closeBundle() {
        if (command !== "build" || bundleOfflineTiles) {
          return;
        }

        const distTilesPath = path.join(outDir, "tiles");
        if (fs.existsSync(distTilesPath)) {
          fs.rmSync(distTilesPath, { recursive: true, force: true });
          console.log("🧹 Removed offline tiles from dist");
        }
      },
    },
    enableCompression
      ? compression({
          algorithm: "brotliCompress",
        })
      : null,
  ].filter(Boolean),
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    __VITE_OFFLINE_TILE_URL__: JSON.stringify(offlineTileUrl),
    __GERMANY_TILES_AVAILABLE__: JSON.stringify(germanyTilesAvailable),
    __GERMANY_PMTILES_AVAILABLE__: JSON.stringify(germanyPmtilesAvailable),
    __APP_TARGET__: JSON.stringify(appTarget),
  },
  build: {
    emptyOutDir: false,
    // Enable code splitting and chunking
    rollupOptions: {
      input: path.resolve(__dirname, htmlInput),
      output: {
        manualChunks: {
          // Vendor chunks for better caching
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "ui-vendor": ["framer-motion", "lucide-react", "react-hot-toast"],
          "i18n-vendor": ["i18next", "react-i18next", "i18next-browser-languagedetector"],
          leaflet: ["leaflet", "react-leaflet"],
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore"],
        },
        // Better chunk naming for caching
        chunkFileNames: (_chunkInfo) => {
          return `assets/js/[name]-[hash].js`;
        },
        entryFileNames: "assets/js/[name]-[hash].js",
        assetFileNames: "assets/[ext]/[name]-[hash].[ext]",
      },
    },
    // Increase chunk size warning limit for better splitting
    chunkSizeWarningLimit: 1000,
    // Optimize asset inlining
    assetsInlineLimit: 4096, // 4KB
    // Enable minification
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: !enableSourceMaps, // Remove console.logs in production unless debugging
        drop_debugger: !enableSourceMaps,
        pure_funcs: enableSourceMaps ? [] : ["console.log", "console.info", "console.debug"],
      },
      format: {
        comments: false, // Remove comments
      },
    },
    // Source maps for debugging (can disable for smaller builds)
    sourcemap: enableSourceMaps,
    // CSS code splitting
    cssCodeSplit: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    https: useHttps
      ? {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath),
        }
      : undefined,
    proxy: {
      // Proxy removed for serverless architecture
    },
  },
  optimizeDeps: {
    exclude: ["lucide-react", "opencascade.js"],
  },
  resolve: {
    alias: [
      {
        find: /^leaflet-draw$/,
        replacement: path.resolve(__dirname, './src/shims/leafletDrawCompat.ts'),
      },
      {
        find: '@',
        replacement: path.resolve(__dirname, './src'),
      },
    ],
  },
  worker: {
    format: "es",
    plugins: () => [wasm(), topLevelAwait()],
  },
  };
});
