/**
 * Track Export/Import Service
 * Handles GPX, KML, and GeoJSON export/import for GPS tracks
 * Works on both web and native platforms
 */

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import type { GpsTrackDetail, GpsPoint } from '../types';

export class TrackExportService {
  /**
   * Export track to GPX format
   */
  static async exportToGPX(track: GpsTrackDetail): Promise<string> {
    const points = track.gps_points || [];
    
    const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GPS Tracker App" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${this.escapeXml(track.name)}</name>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>${this.escapeXml(track.name)}</name>
    <trkseg>
${points.map(pt => `      <trkpt lat="${pt.latitude}" lon="${pt.longitude}">
        ${pt.altitude ? `<ele>${pt.altitude}</ele>` : ''}
        <time>${pt.timestamp || new Date().toISOString()}</time>
      </trkpt>`).join('\n')}
    </trkseg>
  </trk>
</gpx>`;

    return gpxContent;
  }

  /**
   * Export track to KML format
   */
  static async exportToKML(track: GpsTrackDetail): Promise<string> {
    const points = track.gps_points || [];
    
    const kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${this.escapeXml(track.name)}</name>
    <Style id="trackStyle">
      <LineStyle>
        <color>${this.colorToKml(track.color || '#3B82F6')}</color>
        <width>4</width>
      </LineStyle>
    </Style>
    <Placemark>
      <name>${this.escapeXml(track.name)}</name>
      <styleUrl>#trackStyle</styleUrl>
      <LineString>
        <coordinates>
${points.map(pt => `          ${pt.longitude},${pt.latitude}${pt.altitude ? ',' + pt.altitude : ''}`).join('\n')}
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;

    return kmlContent;
  }

  /**
   * Export track to GeoJSON format
   */
  static async exportToGeoJSON(track: GpsTrackDetail): Promise<string> {
    const points = track.gps_points || [];
    
    const geojson = {
      type: 'Feature',
      properties: {
        name: track.name,
        color: track.color || '#3B82F6',
        started_at: track.started_at,
        ended_at: track.ended_at,
      },
      geometry: {
        type: 'LineString',
        coordinates: points.map(pt => [
          pt.longitude,
          pt.latitude,
          pt.altitude || 0
        ])
      }
    };

    return JSON.stringify(geojson, null, 2);
  }

  /**
   * Download/save track file
   */
  static async downloadTrack(
    track: GpsTrackDetail,
    format: 'gpx' | 'kml' | 'geojson'
  ): Promise<void> {
    let content: string;
    let mimeType: string;
    let extension: string;

    // Generate content based on format
    switch (format) {
      case 'gpx':
        content = await this.exportToGPX(track);
        mimeType = 'application/gpx+xml';
        extension = 'gpx';
        break;
      case 'kml':
        content = await this.exportToKML(track);
        mimeType = 'application/vnd.google-earth.kml+xml';
        extension = 'kml';
        break;
      case 'geojson':
        content = await this.exportToGeoJSON(track);
        mimeType = 'application/geo+json';
        extension = 'geojson';
        break;
    }

    const filename = `${this.sanitizeFilename(track.name)}.${extension}`;

    // Native platform (Android/iOS)
    if (Capacitor.isNativePlatform()) {
      try {
        // Write file to Documents directory
        const result = await Filesystem.writeFile({
          path: filename,
          data: content,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });

        console.log('File saved to:', result.uri);

        // On Android, try to share the file if share plugin is available
        try {
          const { Share } = await import('@capacitor/share');
          await Share.share({
            title: `Export ${track.name}`,
            text: `GPS Track: ${track.name}`,
            url: result.uri,
            dialogTitle: 'Save or Share Track',
          });
        } catch (shareError) {
          // Share plugin not available, file is still saved
          console.log('Share not available, file saved to:', result.uri);
        }
      } catch (error) {
        console.error('Error saving file on native:', error);
        throw new Error('Failed to save track file');
      }
    } else {
      // Web platform - trigger download
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Import GPX file
   */
  static async importFromGPX(gpxContent: string): Promise<Partial<GpsTrackDetail>> {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxContent, 'text/xml');

    // Check for parsing errors
    if (xmlDoc.querySelector('parsererror')) {
      throw new Error('Invalid GPX file');
    }

    const track: Partial<GpsTrackDetail> = {
      gps_points: [],
    };

    // Get track name
    const trkName = xmlDoc.querySelector('trk > name')?.textContent;
    if (trkName) track.name = trkName;

    // Parse track points
    const trkpts = xmlDoc.querySelectorAll('trkpt');
    trkpts.forEach((trkpt) => {
      const lat = parseFloat(trkpt.getAttribute('lat') || '0');
      const lon = parseFloat(trkpt.getAttribute('lon') || '0');
      const ele = trkpt.querySelector('ele')?.textContent;
      const time = trkpt.querySelector('time')?.textContent;

      track.gps_points!.push({
        latitude: lat,
        longitude: lon,
        altitude: ele ? parseFloat(ele) : undefined,
        timestamp: time || new Date().toISOString(),
      } as GpsPoint);
    });

    return track;
  }

  /**
   * Import KML file
   */
  static async importFromKML(kmlContent: string): Promise<Partial<GpsTrackDetail>> {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(kmlContent, 'text/xml');

    // Check for parsing errors
    if (xmlDoc.querySelector('parsererror')) {
      throw new Error('Invalid KML file');
    }

    const track: Partial<GpsTrackDetail> = {
      gps_points: [],
    };

    // Get placemark name
    const placemarkName = xmlDoc.querySelector('Placemark > name')?.textContent;
    if (placemarkName) track.name = placemarkName;

    // Parse coordinates
    const coordinates = xmlDoc.querySelector('LineString > coordinates')?.textContent;
    if (coordinates) {
      const coords = coordinates.trim().split(/\s+/);
      coords.forEach((coord) => {
        const [lon, lat, alt] = coord.split(',').map(parseFloat);
        if (!isNaN(lat) && !isNaN(lon)) {
          track.gps_points!.push({
            latitude: lat,
            longitude: lon,
            altitude: alt,
            timestamp: new Date().toISOString(),
          } as GpsPoint);
        }
      });
    }

    return track;
  }

  /**
   * Import GeoJSON file
   */
  static async importFromGeoJSON(geojsonContent: string): Promise<Partial<GpsTrackDetail>> {
    const geojson = JSON.parse(geojsonContent);

    if (geojson.type !== 'Feature' || geojson.geometry?.type !== 'LineString') {
      throw new Error('Invalid GeoJSON: Must be a Feature with LineString geometry');
    }

    const track: Partial<GpsTrackDetail> = {
      name: geojson.properties?.name || 'Imported Track',
      color: geojson.properties?.color || '#3B82F6',
      gps_points: [],
      samples: [],
    };

    // Parse coordinates
    const coordinates = geojson.geometry.coordinates || [];
    coordinates.forEach((coord: number[]) => {
      const [lon, lat, alt] = coord;
      track.gps_points!.push({
        latitude: lat,
        longitude: lon,
        altitude: alt,
        timestamp: new Date().toISOString(),
      } as GpsPoint);
    });

    return track;
  }

  /**
   * Read file from device (for import)
   */
  static async readFile(filePath: string): Promise<string> {
    if (Capacitor.isNativePlatform()) {
      const result = await Filesystem.readFile({
        path: filePath,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });
      return result.data as string;
    } else {
      throw new Error('File reading not supported on web - use file input');
    }
  }

  // Helper methods
  private static escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private static colorToKml(hexColor: string): string {
    // KML uses AABBGGRR format (alpha, blue, green, red)
    const hex = hexColor.replace('#', '');
    const r = hex.substring(0, 2);
    const g = hex.substring(2, 4);
    const b = hex.substring(4, 6);
    return `ff${b}${g}${r}`; // Full opacity
  }

  private static sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}

export const trackExport = TrackExportService;
