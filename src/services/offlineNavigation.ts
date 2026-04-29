/**
 * Offline Navigation Service
 * Provides basic turn-by-turn navigation without internet using:
 * - Haversine distance calculations
 * - Bearing/direction calculations
 * - Simple straight-line routing
 * - Voice instructions based on position
 */

export interface NavigationStep {
  id: string;
  coordinates: [number, number]; // [lat, lon]
  distance: number; // meters from previous step
  bearing: number; // degrees from north
  instruction: string;
}

export interface OfflineRoute {
  waypoints: [number, number][]; // [lat, lon]
  steps: NavigationStep[];
  totalDistance: number;
  estimatedDuration: number; // seconds, based on average speed
}

export interface NavigationProgress {
  currentStepIndex: number;
  distanceToNextStep: number;
  distanceRemaining: number;
  bearingToNext: number;
  offCourseDistance: number;
  instruction: string;
  shouldReroute: boolean;
}

class OfflineNavigationService {
  private averageSpeed: number = 8.33; // m/s (~30 km/h for agricultural work)
  private offCourseThreshold: number = 50; // meters
  private approachThreshold: number = 20; // meters before step completion

  /**
   * Calculate distance between two points using Haversine formula
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371000; // Earth radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Calculate bearing from point 1 to point 2 (0-360 degrees from north)
   */
  private calculateBearing(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x =
      Math.cos(φ1) * Math.sin(φ2) -
      Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    const θ = Math.atan2(y, x);
    const bearing = ((θ * 180) / Math.PI + 360) % 360;

    return bearing;
  }

  /**
   * Convert bearing to cardinal direction
   */
  private bearingToDirection(bearing: number): string {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(bearing / 45) % 8;
    return directions[index];
  }

  /**
   * Generate instruction based on bearing change
   */
  private generateInstruction(
    previousBearing: number | null,
    currentBearing: number,
    distance: number
  ): string {
    const direction = this.bearingToDirection(currentBearing);

    // First waypoint
    if (previousBearing === null) {
      return `Head ${direction} for ${Math.round(distance)}m`;
    }

    // Calculate turn angle
    let turnAngle = currentBearing - previousBearing;
    if (turnAngle > 180) turnAngle -= 360;
    if (turnAngle < -180) turnAngle += 360;

    // Determine turn type
    if (Math.abs(turnAngle) < 20) {
      return `Continue ${direction} for ${Math.round(distance)}m`;
    } else if (turnAngle > 0) {
      if (turnAngle < 45) return `Bear right and head ${direction} for ${Math.round(distance)}m`;
      if (turnAngle < 135) return `Turn right to ${direction} and continue for ${Math.round(distance)}m`;
      return `Make a sharp right to ${direction} for ${Math.round(distance)}m`;
    } else {
      if (turnAngle > -45) return `Bear left and head ${direction} for ${Math.round(distance)}m`;
      if (turnAngle > -135) return `Turn left to ${direction} and continue for ${Math.round(distance)}m`;
      return `Make a sharp left to ${direction} for ${Math.round(distance)}m`;
    }
  }

  /**
   * Create offline route from waypoints
   */
  createRoute(waypoints: [number, number][]): OfflineRoute {
    if (waypoints.length < 2) {
      throw new Error('At least 2 waypoints required');
    }

    const steps: NavigationStep[] = [];
    let totalDistance = 0;
    let previousBearing: number | null = null;

    for (let i = 1; i < waypoints.length; i++) {
      const [lat1, lon1] = waypoints[i - 1];
      const [lat2, lon2] = waypoints[i];

      const distance = this.calculateDistance(lat1, lon1, lat2, lon2);
      const bearing = this.calculateBearing(lat1, lon1, lat2, lon2);
      const instruction = this.generateInstruction(previousBearing, bearing, distance);

      steps.push({
        id: `step-${i}`,
        coordinates: [lat2, lon2],
        distance,
        bearing,
        instruction,
      });

      totalDistance += distance;
      previousBearing = bearing;
    }

    return {
      waypoints,
      steps,
      totalDistance,
      estimatedDuration: totalDistance / this.averageSpeed,
    };
  }

  /**
   * Calculate navigation progress based on current position
   */
  calculateProgress(
    route: OfflineRoute,
    currentPosition: [number, number],
    currentStepIndex: number
  ): NavigationProgress {
    const [currentLat, currentLon] = currentPosition;
    const currentStep = route.steps[currentStepIndex];
    
    if (!currentStep) {
      return {
        currentStepIndex,
        distanceToNextStep: 0,
        distanceRemaining: 0,
        bearingToNext: 0,
        offCourseDistance: 0,
        instruction: 'Route completed',
        shouldReroute: false,
      };
    }

    const [targetLat, targetLon] = currentStep.coordinates;
    const distanceToNext = this.calculateDistance(
      currentLat,
      currentLon,
      targetLat,
      targetLon
    );
    const bearingToNext = this.calculateBearing(
      currentLat,
      currentLon,
      targetLat,
      targetLon
    );

    // Calculate distance to ideal path (perpendicular distance)
    const offCourseDistance = this.calculateOffCourseDistance(
      currentPosition,
      currentStepIndex > 0 ? route.waypoints[currentStepIndex - 1] : currentPosition,
      currentStep.coordinates
    );

    // Calculate remaining distance
    let distanceRemaining = distanceToNext;
    for (let i = currentStepIndex + 1; i < route.steps.length; i++) {
      distanceRemaining += route.steps[i].distance;
    }

    // Check if we should move to next step
    const shouldAdvance = distanceToNext < this.approachThreshold;
    const shouldReroute = offCourseDistance > this.offCourseThreshold;

    return {
      currentStepIndex: shouldAdvance ? currentStepIndex + 1 : currentStepIndex,
      distanceToNextStep: distanceToNext,
      distanceRemaining,
      bearingToNext,
      offCourseDistance,
      instruction: currentStep.instruction,
      shouldReroute,
    };
  }

  /**
   * Calculate perpendicular distance from point to line segment
   */
  private calculateOffCourseDistance(
    point: [number, number],
    lineStart: [number, number],
    lineEnd: [number, number]
  ): number {
    const [pLat, pLon] = point;
    const [aLat, aLon] = lineStart;
    const [bLat, bLon] = lineEnd;

    // If start and end are the same, return distance to that point
    if (aLat === bLat && aLon === bLon) {
      return this.calculateDistance(pLat, pLon, aLat, aLon);
    }

    // Project point onto line segment
    const atob = {
      x: bLon - aLon,
      y: bLat - aLat,
    };
    const atop = {
      x: pLon - aLon,
      y: pLat - aLat,
    };

    const len = atob.x * atob.x + atob.y * atob.y;
    const dot = atop.x * atob.x + atop.y * atob.y;
    const t = Math.min(1, Math.max(0, dot / len));

    const projectedLat = aLat + atob.y * t;
    const projectedLon = aLon + atob.x * t;

    return this.calculateDistance(pLat, pLon, projectedLat, projectedLon);
  }

  /**
   * Generate route through multiple field boundaries
   */
  createFieldRoute(
    startPosition: [number, number],
    fieldBoundaries: Array<{ coordinates: number[][][] }>
  ): OfflineRoute {
    const waypoints: [number, number][] = [startPosition];

    // Add centroid of each field as a waypoint
    for (const field of fieldBoundaries) {
      const centroid = this.calculateCentroid(field.coordinates);
      if (centroid) {
        waypoints.push(centroid);
      }
    }

    return this.createRoute(waypoints);
  }

  /**
   * Calculate centroid of a polygon
   */
  private calculateCentroid(coordinates: number[][][]): [number, number] | null {
    try {
      if (!coordinates || coordinates.length === 0) return null;
      const ring = coordinates[0]; // Use exterior ring
      if (!ring || ring.length === 0) return null;

      let sumLat = 0;
      let sumLon = 0;

      for (const [lon, lat] of ring) {
        sumLon += lon;
        sumLat += lat;
      }

      return [sumLat / ring.length, sumLon / ring.length];
    } catch (error) {
      console.error('Error calculating centroid:', error);
      return null;
    }
  }

  /**
   * Set average speed for duration estimation (m/s)
   */
  setAverageSpeed(speedMs: number): void {
    this.averageSpeed = speedMs;
  }

  /**
   * Set off-course threshold (meters)
   */
  setOffCourseThreshold(meters: number): void {
    this.offCourseThreshold = meters;
  }
}

export const offlineNavigationService = new OfflineNavigationService();
