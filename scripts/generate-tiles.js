#!/usr/bin/env node

/**
 * Quick Tile Generator using Planetiler
 * Downloads OSM data and generates PMTiles for Germany
 * 
 * Requirements:
 * - Node.js 18+
 * - Java 17+
 * - ~10GB free disk space
 * - Good internet connection
 * 
 * Usage: node generate-tiles.js
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import https from 'https';
import path from 'path';

const execAsync = promisify(exec);

const PLANETILER_VERSION = '0.7.0';
const PLANETILER_JAR = `planetiler-dist-${PLANETILER_VERSION}.jar`;
const PLANETILER_URL = `https://github.com/onthegomap/planetiler/releases/download/v${PLANETILER_VERSION}/${PLANETILER_JAR}`;

const OSM_DATA_URL = 'https://download.geofabrik.de/europe/germany-latest.osm.pbf';
const OSM_DATA_FILE = 'germany-latest.osm.pbf';

const OUTPUT_FILE = 'germany.pmtiles';
const OUTPUT_DIR = './tiles-output';

// Colors for terminal
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    
    https.get(url, (response) => {
      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;
      
      response.pipe(file);
      
      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const percentage = ((downloadedSize / totalSize) * 100).toFixed(1);
        process.stdout.write(`\r${colors.yellow}Downloading: ${percentage}%${colors.reset}`);
      });
      
      file.on('finish', () => {
        file.close();
        console.log(''); // New line
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function checkJava() {
  try {
    const { stdout } = await execAsync('java -version 2>&1');
    log('✓ Java detected', colors.green);
    return true;
  } catch {
    log('❌ Java not found. Please install Java 17 or higher', colors.red);
    log('Download from: https://adoptium.net/', colors.yellow);
    return false;
  }
}

async function downloadPlanetiler() {
  if (fs.existsSync(PLANETILER_JAR)) {
    log('✓ Planetiler already downloaded', colors.green);
    return;
  }

  log('📥 Downloading Planetiler...', colors.cyan);
  await downloadFile(PLANETILER_URL, PLANETILER_JAR);
  log('✓ Planetiler downloaded', colors.green);
}

async function downloadOsmData() {
  if (fs.existsSync(OSM_DATA_FILE)) {
    log('✓ OSM data already downloaded', colors.green);
    return;
  }

  log('📥 Downloading Germany OSM data (~3.5GB)...', colors.cyan);
  log('⏱️  This may take 10-30 minutes depending on your connection', colors.yellow);
  await downloadFile(OSM_DATA_URL, OSM_DATA_FILE);
  log('✓ OSM data downloaded', colors.green);
}

async function generateTiles() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILE);

  if (fs.existsSync(outputPath)) {
    log('✓ Tiles already generated', colors.green);
    log(`📍 Location: ${outputPath}`, colors.cyan);
    return;
  }

  log('🔨 Generating tiles...', colors.cyan);
  log('⏱️  This will take 30-90 minutes', colors.yellow);
  log('💾 Peak memory usage: ~4-6GB RAM', colors.yellow);
  
  const command = `java -Xmx6g -jar ${PLANETILER_JAR} ` +
    `--download ` +
    `--area=germany ` +
    `--output=${outputPath} ` +
    `--maxzoom=15 ` +
    `--min_feature_size=0.25 ` +
    `--min_feature_size_at_max_zoom=0.01 ` +
    `--simplify_tolerance=0.05 ` +
    `--simplify_tolerance_at_max_zoom=0.02 ` +
    `--schema=protomaps ` +
    `--force`;

  try {
    const { stdout, stderr } = await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });
    
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    
    log('✓ Tiles generated successfully!', colors.green);
    log(`📍 Output: ${outputPath}`, colors.cyan);
    
    const stats = fs.statSync(outputPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    log(`📊 File size: ${sizeMB} MB`, colors.cyan);
    
  } catch (error) {
    log('❌ Tile generation failed', colors.red);
    console.error(error);
    process.exit(1);
  }
}

async function main() {
  log('═══════════════════════════════════════', colors.cyan);
  log('   GPS Tracker - Tile Generator', colors.cyan);
  log('═══════════════════════════════════════', colors.cyan);
  log('');

  // Check Java
  const hasJava = await checkJava();
  if (!hasJava) {
    process.exit(1);
  }

  log('');
  log('📋 Process:', colors.cyan);
  log('  1. Download Planetiler (~40MB)', colors.reset);
  log('  2. Download Germany OSM data (~3.5GB)', colors.reset);
  log('  3. Generate PMTiles (~2-4GB output)', colors.reset);
  log('');
  log('⏱️  Total time: 30 minutes - 2 hours', colors.yellow);
  log('💾 Disk space needed: ~10GB', colors.yellow);
  log('');

  // Confirm
  log('Press Ctrl+C to cancel, or wait 5 seconds to start...', colors.yellow);
  await new Promise(resolve => setTimeout(resolve, 5000));

  try {
    // Step 1: Download Planetiler
    log('');
    log('━━━ Step 1/3: Download Planetiler ━━━', colors.cyan);
    await downloadPlanetiler();

    // Step 2: Download OSM data
    log('');
    log('━━━ Step 2/3: Download OSM Data ━━━', colors.cyan);
    await downloadOsmData();

    // Step 3: Generate tiles
    log('');
    log('━━━ Step 3/3: Generate Tiles ━━━', colors.cyan);
    await generateTiles();

    // Success
    log('');
    log('═══════════════════════════════════════', colors.green);
    log('   ✓ TILE GENERATION COMPLETE!', colors.green);
    log('═══════════════════════════════════════', colors.green);
    log('');
    log('📍 Output location:', colors.cyan);
    log(`   ${path.resolve(OUTPUT_DIR, OUTPUT_FILE)}`, colors.reset);
    log('');
    log('📤 Next steps:', colors.cyan);
    log('  1. Upload to your server:', colors.reset);
    log(`     scp ${OUTPUT_DIR}/${OUTPUT_FILE} user@yourserver.com:/var/www/html/tiles/`, colors.yellow);
    log('  2. Update app tile server URL:', colors.reset);
    log('     src/services/offlineTileDownloader.ts', colors.yellow);
    log('  3. Configure CORS on your server', colors.reset);
    log('  4. Test download in app!', colors.reset);
    log('');

  } catch (error) {
    log('');
    log('❌ Process failed', colors.red);
    console.error(error);
    process.exit(1);
  }
}

main();
