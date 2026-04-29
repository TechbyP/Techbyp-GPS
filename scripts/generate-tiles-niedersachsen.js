#!/usr/bin/env node

/**
 * Niedersachsen PMTiles Generator using Planetiler
 * Downloads OSM data and generates PMTiles for Niedersachsen (Lower Saxony)
 *
 * Requirements:
 * - Node.js 18+
 * - Java 17+
 * - ~6GB free disk space
 *
 * Usage: node scripts/generate-tiles-niedersachsen.js
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import https from 'https';
import path from 'path';

const execAsync = promisify(exec);

const PLANETILER_JAR = 'planetiler.jar';
const PLANETILER_URL = 'https://github.com/onthegomap/planetiler/releases/latest/download/planetiler.jar';

const OSM_DATA_URL = 'https://download.geofabrik.de/europe/germany/niedersachsen-latest.osm.pbf';
const OSM_DATA_FILE = 'niedersachsen-latest.osm.pbf';

const OUTPUT_FILE = 'germany.pmtiles';
const OUTPUT_DIR = './public/tiles';
const LOCAL_JAVA = path.join('tools', 'jre21', 'bin', 'java.exe');
const JAVA_BIN = fs.existsSync(LOCAL_JAVA) ? LOCAL_JAVA : 'java';

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

function downloadFile(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    https.get(url, (response) => {
      if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode)) {
        const next = response.headers.location;
        file.close();
        fs.unlink(dest, () => {});
        if (!next || redirectCount > 5) {
          reject(new Error('Too many redirects')); 
          return;
        }
        resolve(downloadFile(next, dest, redirectCount + 1));
        return;
      }

      if (response.statusCode && response.statusCode >= 400) {
        reject(new Error(`Download failed: ${response.statusCode}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedSize = 0;

      response.pipe(file);

      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        if (totalSize > 0) {
          const percentage = ((downloadedSize / totalSize) * 100).toFixed(1);
          process.stdout.write(`\r${colors.yellow}Downloading: ${percentage}%${colors.reset}`);
        }
      });

      file.on('finish', () => {
        file.close();
        console.log('');
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
    await execAsync(`${JAVA_BIN} -version 2>&1`);
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
    log('✓ Niedersachsen OSM data already downloaded', colors.green);
    return;
  }

  log('📥 Downloading Niedersachsen OSM data (~500MB-1GB)...', colors.cyan);
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

  log('🔨 Generating PMTiles for Niedersachsen...', colors.cyan);
  log('⏱️  This will take 20-60 minutes', colors.yellow);
  log('💾 Peak memory usage: ~4-6GB RAM', colors.yellow);

  const command = `${JAVA_BIN} -Xmx6g -jar ${PLANETILER_JAR} ` +
    `--download ` +
    `--area=niedersachsen ` +
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

    log('✓ PMTiles generated successfully!', colors.green);
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
  log('   GPS Tracker - Niedersachsen Tiles', colors.cyan);
  log('═══════════════════════════════════════', colors.cyan);
  log('');

  const hasJava = await checkJava();
  if (!hasJava) process.exit(1);

  log('');
  log('📋 Process:', colors.cyan);
  log('  1. Download Planetiler (~40MB)', colors.reset);
  log('  2. Download Niedersachsen OSM data', colors.reset);
  log('  3. Generate PMTiles (output to public/tiles/germany.pmtiles)', colors.reset);
  log('');

  log('Press Ctrl+C to cancel, or wait 5 seconds to start...', colors.yellow);
  await new Promise(resolve => setTimeout(resolve, 5000));

  await downloadPlanetiler();
  await downloadOsmData();
  await generateTiles();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
