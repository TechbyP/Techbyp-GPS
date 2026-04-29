/**
 * GPS Connection Validation Utilities
 * Ensures real device connections and prevents false positives
 */

import { GpsPositionUpdate } from '../types';

export interface ConnectionValidation {
  isValid: boolean;
  reason: string;
  dataQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'invalid';
  confidence: number; // 0-100
}

/**
 * Validate a GPS connection by analyzing the data stream
 */
export class GpsConnectionValidator {
  private dataPoints: GpsPositionUpdate[] = [];
  private startTime: number = Date.now();
  private validSentences = new Set<string>();
  private totalSentences = 0;
  
  /**
   * Add a GPS position update for validation
   */
  addDataPoint(position: GpsPositionUpdate, rawSentence?: string): void {
    this.dataPoints.push(position);
    this.totalSentences++;
    
    // Track valid NMEA sentence types
    if (rawSentence) {
      const sentenceType = rawSentence.substring(0, 6); // e.g., $GPGGA, $GPRMC
      if (this.isValidNmeaSentence(sentenceType)) {
        this.validSentences.add(sentenceType);
      }
    }
    
    // Keep only recent data (last 30 seconds)
    const thirtySecondsAgo = Date.now() - 30000;
    this.dataPoints = this.dataPoints.filter(p => p.timestamp > thirtySecondsAgo);
  }
  
  /**
   * Validate the current connection
   */
  validateConnection(): ConnectionValidation {
    const now = Date.now();
    const connectionAge = now - this.startTime;
    
    // Check minimum connection time (5 seconds)
    if (connectionAge < 5000) {
      return {
        isValid: false,
        reason: 'Connection too recent - waiting for data',
        dataQuality: 'invalid',
        confidence: 0
      };
    }
    
    // Check if we have data points
    if (this.dataPoints.length === 0) {
      return {
        isValid: false,
        reason: 'No GPS data received',
        dataQuality: 'invalid',
        confidence: 0
      };
    }
    
    // Check data frequency (should receive updates regularly)
    const dataRate = this.dataPoints.length / (connectionAge / 1000);
    if (dataRate < 0.1) { // Less than 1 point per 10 seconds
      return {
        isValid: false,
        reason: 'GPS data rate too low',
        dataQuality: 'poor',
        confidence: 20
      };
    }
    
    // Check position validity
    const validPositions = this.dataPoints.filter(p => 
      this.isValidCoordinate(p.latitude, p.longitude)
    );
    
    if (validPositions.length === 0) {
      return {
        isValid: false,
        reason: 'No valid GPS coordinates received',
        dataQuality: 'invalid',
        confidence: 0
      };
    }
    
    // Check coordinate consistency (shouldn't jump around randomly)
    if (validPositions.length > 1) {
      const maxDistance = this.calculateMaxDistance(validPositions);
      if (maxDistance > 10000) { // More than 10km variation
        return {
          isValid: false,
          reason: 'GPS coordinates inconsistent - possible fake data',
          dataQuality: 'poor',
          confidence: 10
        };
      }
    }
    
    // Check accuracy values
    const avgAccuracy = validPositions.reduce((sum, p) => sum + (p.accuracy || 999), 0) / validPositions.length;
    
    // Determine data quality
    let dataQuality: ConnectionValidation['dataQuality'] = 'fair';
    let confidence = 60;
    
    if (avgAccuracy <= 3 && this.validSentences.size >= 2) {
      dataQuality = 'excellent';
      confidence = 95;
    } else if (avgAccuracy <= 10 && this.validSentences.size >= 1) {
      dataQuality = 'good';
      confidence = 80;
    } else if (avgAccuracy <= 20) {
      dataQuality = 'fair';
      confidence = 60;
    } else {
      dataQuality = 'poor';
      confidence = 40;
    }
    
    // Additional checks for confidence
    if (dataRate > 0.5) confidence += 10; // Good data rate
    if (this.validSentences.size > 2) confidence += 10; // Multiple NMEA types
    
    confidence = Math.min(100, confidence);
    
    return {
      isValid: confidence >= 50,
      reason: confidence >= 50 ? 
        `Valid GPS connection (${dataQuality}, ${confidence}% confidence)` :
        `Low confidence GPS data (${confidence}%)`,
      dataQuality,
      confidence
    };
  }
  
  /**
   * Get connection statistics
   */
  getStats() {
    const validation = this.validateConnection();
    const avgAccuracy = this.dataPoints.length > 0 ? 
      this.dataPoints.reduce((sum, p) => sum + (p.accuracy || 999), 0) / this.dataPoints.length :
      999;
    
    return {
      connectionAge: Date.now() - this.startTime,
      dataPoints: this.dataPoints.length,
      validSentenceTypes: Array.from(this.validSentences),
      averageAccuracy: avgAccuracy,
      dataRate: this.dataPoints.length / ((Date.now() - this.startTime) / 1000),
      validation
    };
  }
  
  /**
   * Reset validator for new connection
   */
  reset(): void {
    this.dataPoints = [];
    this.startTime = Date.now();
    this.validSentences.clear();
    this.totalSentences = 0;
  }
  
  private isValidNmeaSentence(sentenceType: string): boolean {
    const validTypes = [
      '$GPGGA', '$GPRMC', '$GPGLL', '$GPVTG', '$GPGSA', '$GPGSV',
      '$GLGGA', '$GLRMC', '$GLGLL', '$GLVTG', '$GLGSA', '$GLGSV',
      '$GAGGA', '$GARMC', '$GAGLL', '$GAVTG', '$GAGSA', '$GAGSV',
      '$GNGGA', '$GNRMC', '$GNGLL', '$GNVTG', '$GNGSA', '$GNGSV'
    ];
    return validTypes.includes(sentenceType);
  }
  
  private isValidCoordinate(lat: number, lng: number): boolean {
    return lat !== 0 && lng !== 0 && 
           lat >= -90 && lat <= 90 && 
           lng >= -180 && lng <= 180;
  }
  
  private calculateMaxDistance(positions: GpsPositionUpdate[]): number {
    if (positions.length < 2) return 0;
    
    let maxDistance = 0;
    for (let i = 0; i < positions.length - 1; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dist = this.haversineDistance(
          positions[i].latitude, positions[i].longitude,
          positions[j].latitude, positions[j].longitude
        );
        maxDistance = Math.max(maxDistance, dist);
      }
    }
    return maxDistance;
  }
  
  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }
}

/**
 * Create a debounced notification handler to prevent spam
 */
export class NotificationDebouncer {
  private timeouts = new Map<string, NodeJS.Timeout>();
  
  /**
   * Schedule a debounced notification
   */
  notify(key: string, callback: () => void, delay: number = 1000): void {
    // Clear existing timeout for this key
    const existing = this.timeouts.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    
    // Set new timeout
    const timeout = setTimeout(() => {
      callback();
      this.timeouts.delete(key);
    }, delay);
    
    this.timeouts.set(key, timeout);
  }
  
  /**
   * Cancel all pending notifications
   */
  cancelAll(): void {
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();
  }
  
  /**
   * Cancel specific notification
   */
  cancel(key: string): void {
    const timeout = this.timeouts.get(key);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(key);
    }
  }
}