/**
 * Download Satellite Tiles for Offline Use
 * 
 * Downloads ESRI World Imagery (satellite) tiles for a specific region
 * to enable offline satellite view in the app
 * 
 * Usage: node download-satellite-tiles.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  // Region bounds (Germany as example)
  region: {
    name: 'Germany',
    bounds: {
      north: 55.1,
      south: 47.3,
      east: 15.0,
      west: 5.9
    }
  },
  
  // Zoom levels to download (satellite tiles are larger than street maps)
  // WARNING: Zoom 14 for entire Germany = ~2-5GB of data!
  // Recommended: Start with 0-10 for testing (~200-500MB)
  zoomLevels: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  
  // Output directory
  outputDir: path.join(__dirname, '..', 'public', 'tiles', 'germany-satellite'),
  
  // ESRI satellite tile URL
  // Note: Check ESRI terms of service before bulk downloading
  tileUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  
  // Download options
  maxConcurrent: 3, // Concurrent downloads (be nice to servers)
  retryAttempts: 3,
  retryDelay: 1000, // ms
  timeout: 30000, // 30 seconds
};

// Statistics
const stats = {
  totalTiles: 0,
  downloadedTiles: 0,
  cachedTiles: 0,
  failedTiles: 0,
  startTime: Date.now()
};

/**
 * Calculate tiles needed for a bounding box at a specific zoom level
 */
function getTilesForBounds(bounds, zoom) {
  const n = Math.pow(2, zoom);
  
  // Convert lat/lon to tile coordinates
  const minX = Math.floor((bounds.west + 180) / 360 * n);
  const maxX = Math.floor((bounds.east + 180) / 360 * n);
  
  const minY = Math.floor((1 - Math.log(Math.tan(bounds.north * Math.PI / 180) + 1 / Math.cos(bounds.north * Math.PI / 180)) / Math.PI) / 2 * n);
  const maxY = Math.floor((1 - Math.log(Math.tan(bounds.south * Math.PI / 180) + 1 / Math.cos(bounds.south * Math.PI / 180)) / Math.PI) / 2 * n);
  
  const tiles = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      tiles.push({ z: zoom, x, y });
    }
  }
  
  return tiles;
}

/**
 * Download a single tile
 */
function downloadTile(tile) {
  return new Promise((resolve, reject) => {
    const { z, x, y } = tile;
    const url = CONFIG.tileUrl
      .replace('{z}', z)
      .replace('{x}', x)
      .replace('{y}', y);
    
    const outputPath = path.join(CONFIG.outputDir, z.toString(), x.toString());
    const outputFile = path.join(outputPath, `${y}.jpg`); // ESRI uses JPG
    
    // Check if file already exists
    if (fs.existsSync(outputFile)) {
      stats.cachedTiles++;
      resolve({ cached: true });
      return;
    }
    
    // Create directory
    fs.mkdirSync(outputPath, { recursive: true });
    
    // Download tile
    const file = fs.createWriteStream(outputFile);
    
    const request = https.get(url, { timeout: CONFIG.timeout }, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          stats.downloadedTiles++;
          resolve({ downloaded: true });
        });
      } else if (response.statusCode === 404) {
        // Tile doesn't exist (out of bounds or no imagery)
        file.close();
        fs.unlinkSync(outputFile);
        stats.failedTiles++;
        resolve({ notFound: true });
      } else {
        file.close();
        fs.unlinkSync(outputFile);
        reject(new Error(`HTTP ${response.statusCode}`));
      }
    });
    
    request.on('error', (err) => {
      if (fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
      }
      reject(err);
    });
    
    request.on('timeout', () => {
      request.destroy();
      if (fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
      }
      reject(new Error('Timeout'));
    });
  });
}

/**
 * Download tiles with retry logic
 */
async function downloadTileWithRetry(tile, attempt = 1) {
  try {
    return await downloadTile(tile);
  } catch (error) {
    if (attempt < CONFIG.retryAttempts) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay * attempt));
      return downloadTileWithRetry(tile, attempt + 1);
    } else {
      stats.failedTiles++;
      console.error(`Failed to download tile ${tile.z}/${tile.x}/${tile.y}:`, error.message);
      return { failed: true };
    }
  }
}

/**
 * Download tiles in batches with concurrency limit
 */
async function downloadTilesInBatches(tiles) {
  const queue = [...tiles];
  const active = [];
  
  console.log(`Downloading ${tiles.length} tiles with max ${CONFIG.maxConcurrent} concurrent downloads...`);
  
  while (queue.length > 0 || active.length > 0) {
    // Start new downloads up to concurrency limit
    while (active.length < CONFIG.maxConcurrent && queue.length > 0) {
      const tile = queue.shift();
      const promise = downloadTileWithRetry(tile).then(result => {
        active.splice(active.indexOf(promise), 1);
        
        // Progress indicator
        const progress = stats.downloadedTiles + stats.cachedTiles + stats.failedTiles;
        if (progress % 50 === 0) {
          const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
          console.log(`Progress: ${progress}/${stats.totalTiles} (${((progress / stats.totalTiles) * 100).toFixed(1)}%) - ${elapsed}s`);
        }
        
        return result;
      });
      active.push(promise);
    }
    
    // Wait for at least one to complete
    if (active.length > 0) {
      await Promise.race(active);
    }
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🛰️  ESRI Satellite Tile Downloader');
  console.log('=====================================');
  console.log(`Region: ${CONFIG.region.name}`);
  console.log(`Bounds: ${CONFIG.region.bounds.north}N, ${CONFIG.region.bounds.south}S, ${CONFIG.region.bounds.east}E, ${CONFIG.region.bounds.west}W`);
  console.log(`Zoom levels: ${CONFIG.zoomLevels.join(', ')}`);
  console.log(`Output: ${CONFIG.outputDir}`);
  console.log('');
  
  // WARNING
  console.log('⚠️  WARNING: Satellite tiles are LARGE!');
  console.log('   - Zoom 0-10: ~200-500MB');
  console.log('   - Zoom 0-12: ~1-2GB');
  console.log('   - Zoom 0-14: ~5-10GB for Germany');
  console.log('');
  console.log('⚠️  Check ESRI Terms of Service before bulk downloading!');
  console.log('   https://www.esri.com/en-us/legal/terms/full-master-agreement');
  console.log('');
  
  // Calculate total tiles
  console.log('Calculating tiles...');
  let allTiles = [];
  for (const zoom of CONFIG.zoomLevels) {
    const tiles = getTilesForBounds(CONFIG.region.bounds, zoom);
    console.log(`  Zoom ${zoom}: ${tiles.length} tiles`);
    allTiles = allTiles.concat(tiles);
  }
  stats.totalTiles = allTiles.length;
  console.log(`Total: ${stats.totalTiles} tiles`);
  console.log('');
  
  // Create output directory
  fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  
  // Download tiles
  console.log('Starting download...');
  await downloadTilesInBatches(allTiles);
  
  // Save metadata
  const metadata = {
    region: CONFIG.region.name,
    bounds: CONFIG.region.bounds,
    zoomLevels: CONFIG.zoomLevels,
    generatedAt: new Date().toUTCString(),
    stats: {
      totalTiles: stats.totalTiles,
      downloadedTiles: stats.downloadedTiles,
      cachedTiles: stats.cachedTiles,
      failedTiles: stats.failedTiles,
      downloadTime: ((Date.now() - stats.startTime) / 1000).toFixed(1)
    },
    usage: {
      tileUrlPattern: '/tiles/germany-satellite/{z}/{x}/{y}.jpg',
      attribution: '© Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    }
  };
  
  fs.writeFileSync(
    path.join(CONFIG.outputDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2)
  );
  
  // Summary
  console.log('');
  console.log('✅ Download complete!');
  console.log(`   Downloaded: ${stats.downloadedTiles} tiles`);
  console.log(`   Cached: ${stats.cachedTiles} tiles`);
  console.log(`   Failed: ${stats.failedTiles} tiles`);
  console.log(`   Time: ${((Date.now() - stats.startTime) / 1000).toFixed(1)}s`);
  console.log('');
  console.log(`📁 Tiles saved to: ${CONFIG.outputDir}`);
  console.log('   Add to your app with:');
  console.log('   <TileLayer url="/tiles/germany-satellite/{z}/{x}/{y}.jpg" />');
}

// Run
main().catch(console.error);
