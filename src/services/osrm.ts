import axios from 'axios';

/**
 * OSRM Service for route calculation
 * Uses Open Source Routing Machine for navigation
 */

// OSRM server endpoints (prioritized list)
const OSRM_SERVERS = [
  'https://router.project-osrm.org',  // Official OSRM demo server
  'https://routing.openstreetmap.de', // OSM Germany routing
];

interface OSRMRoute {
  distance: number; // meters
  duration: number; // seconds
  geometry: {
    type: 'LineString';
    coordinates: number[][]; // [lon, lat] format
  };
  steps: OSRMStep[];
}

interface OSRMStep {
  distance: number;
  duration: number;
  instruction: string;
  name: string;
  maneuver?: {
    type: string;
    modifier?: string;
    location: [number, number];
  };
}

interface OSRMResponse {
  code: string;
  routes: OSRMRoute[];
  waypoints?: any[];
}

interface RouteOptions {
  alternatives?: boolean;
  profile?: 'driving' | 'walking' | 'cycling';
}

class OSRMService {
  private baseUrl: string = OSRM_SERVERS[0];

  /**
   * Calculate route between two points
   * @param start - Starting coordinate as [lat, lon]
   * @param end - Ending coordinate as [lat, lon]
   * @param options - Route calculation options
   */
  async calculateRoute(
    start: [number, number],
    end: [number, number],
    options: RouteOptions = {}
  ): Promise<OSRMResponse> {
    const { alternatives = true, profile = 'driving' } = options;
    
    try {
      // OSRM uses lon,lat format (not lat,lon), so we need to swap
      const coordinates = `${start[1]},${start[0]};${end[1]},${end[0]}`;
      const alternativesParam = alternatives ? '&alternatives=true' : '';
      const url = `${this.baseUrl}/route/v1/${profile}/${coordinates}?overview=full&steps=true&geometries=geojson${alternativesParam}`;

      console.log('🌐 OSRM Request:', {
        server: this.baseUrl,
        profile,
        from: `${start[0]},${start[1]}`,
        to: `${end[0]},${end[1]}`,
        url
      });

      const response = await axios.get(url, { timeout: 10000 });

      console.log('📡 OSRM Response:', {
        code: response.data.code,
        numRoutes: response.data.routes?.length,
        waypoints: response.data.waypoints?.length
      });

      if (response.data.code !== 'Ok' || !response.data.routes?.[0]) {
        throw new Error(`OSRM returned: ${response.data.code || 'No route found'}`);
      }

      // Return the routes with geometry in GeoJSON format
      return {
        code: response.data.code,
        routes: response.data.routes.map((route: any) => ({
          distance: route.distance,
          duration: route.duration,
          geometry: route.geometry, // Already in GeoJSON format
          steps: route.legs[0]?.steps.map((step: any) => ({
            distance: step.distance,
            duration: step.duration,
            instruction: this.getManeuverInstruction(step.maneuver),
            name: step.name || 'Unnamed road',
            maneuver: step.maneuver ? {
              type: step.maneuver.type,
              modifier: step.maneuver.modifier,
              location: step.maneuver.location
            } : undefined
          })) || []
        })),
        waypoints: response.data.waypoints
      };
    } catch (error) {
      console.error('❌ OSRM routing error:', error);
      if (axios.isAxiosError(error)) {
        console.error('Response data:', error.response?.data);
        console.error('Response status:', error.response?.status);
      }
      throw new Error(`Failed to calculate route: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate human-readable instruction from maneuver
   */
  private getManeuverInstruction(maneuver: any): string {
    if (!maneuver) return 'Continue';
    
    const type = maneuver.type;
    const modifier = maneuver.modifier;
    
    const instructions: Record<string, string> = {
      'turn': modifier ? `Turn ${modifier}` : 'Turn',
      'new name': 'Continue',
      'depart': 'Depart',
      'arrive': 'Arrive at destination',
      'merge': modifier ? `Merge ${modifier}` : 'Merge',
      'on ramp': 'Take the ramp',
      'off ramp': 'Take the exit',
      'fork': modifier ? `Keep ${modifier} at the fork` : 'Keep at the fork',
      'end of road': modifier ? `Turn ${modifier} at the end of the road` : 'Turn at the end of the road',
      'continue': 'Continue straight',
      'roundabout': 'Enter the roundabout',
      'rotary': 'Enter the rotary',
      'roundabout turn': modifier ? `At the roundabout, take the ${modifier} exit` : 'Exit the roundabout',
    };
    
    return instructions[type] || 'Continue';
  }

  /**
   * Try alternative OSRM server if primary fails
   */
  async tryAlternativeServer(): Promise<void> {
    const currentIndex = OSRM_SERVERS.indexOf(this.baseUrl);
    const nextIndex = (currentIndex + 1) % OSRM_SERVERS.length;
    this.baseUrl = OSRM_SERVERS[nextIndex];
    console.log(`Switched to alternative OSRM server: ${this.baseUrl}`);
  }
}

export const osrmService = new OSRMService();
