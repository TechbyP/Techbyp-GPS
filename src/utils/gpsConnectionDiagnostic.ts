/**
 * GPS Connection Diagnostic Tool
 * Tests various connection methods to help troubleshoot GPS device connectivity
 */

export interface ConnectionTest {
  method: string;
  url: string;
  result: 'success' | 'failed' | 'timeout' | 'cors-blocked';
  error?: string;
  data?: string;
  duration: number;
}

export class GPSConnectionDiagnostic {
  private results: ConnectionTest[] = [];

  async testConnection(deviceIP: string, port: number = 9001): Promise<ConnectionTest[]> {
    this.results = [];
    console.log(`🔍 Starting GPS connection diagnostics for ${deviceIP}:${port}`);

    // Test 1: WebSocket connection (what most GPS devices use for streaming)
    await this.testWebSocket(deviceIP, port);

    // Test 2: WebSocket on port 80 (some devices)
    if (port !== 80) {
      await this.testWebSocket(deviceIP, 80);
    }

    // Test 3: HTTP endpoints (polling fallback)
    await this.testHTTPEndpoints(deviceIP, port);
    
    // Test 4: Basic ping/connectivity test
    await this.testBasicConnectivity(deviceIP);

    // Test 5: NMEA data format test
    await this.testNMEAEndpoints(deviceIP);

    this.printDiagnosticReport();
    return this.results;
  }

  private async testWebSocket(ip: string, port: number): Promise<void> {
    const wsUrl = `ws://${ip}:${port}`;
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      const timeout = setTimeout(() => {
        ws.close();
        if (!resolved) {
          this.results.push({
            method: 'WebSocket',
            url: wsUrl,
            result: 'timeout',
            error: 'Connection timeout (3 seconds)',
            duration: Date.now() - startTime
          });
          cleanup();
        }
      }, 3000);

      ws.onopen = () => {
        clearTimeout(timeout);
        this.results.push({
          method: 'WebSocket',
          url: wsUrl,
          result: 'success',
          data: 'Connection established',
          duration: Date.now() - startTime
        });
        ws.close();
        cleanup();
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        this.results.push({
          method: 'WebSocket',
          url: wsUrl,
          result: 'failed',
          error: 'WebSocket connection failed',
          duration: Date.now() - startTime
        });
        cleanup();
      };

      ws.onclose = (event) => {
        clearTimeout(timeout);
        if (event.code !== 1000 && !resolved) {
          this.results.push({
            method: 'WebSocket',
            url: wsUrl,
            result: 'failed',
            error: `WebSocket closed with code ${event.code}: ${event.reason}`,
            duration: Date.now() - startTime
          });
          cleanup();
        }
      };
    });
  }

  private async testHTTPEndpoints(ip: string, port: number): Promise<void> {
    const endpoints = [
      `http://${ip}:${port}/`,
      `http://${ip}:${port}/nmea`,
      `http://${ip}:${port}/gps`,
      `http://${ip}:${port}/position`,
      `http://${ip}/nmea`,
      `http://${ip}/gps`,
      `http://${ip}/position`
    ];

    for (const endpoint of endpoints) {
      await this.testHTTPEndpoint(endpoint);
    }
  }

  private async testHTTPEndpoint(url: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-cache',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      this.results.push({
        method: 'HTTP',
        url: url,
        result: 'success',
        data: `Status: ${response.status} (CORS mode)`,
        duration: Date.now() - startTime
      });
    } catch (error: any) {
      this.results.push({
        method: 'HTTP',
        url: url,
        result: error.name === 'AbortError' ? 'timeout' : 'failed',
        error: error.message,
        duration: Date.now() - startTime
      });
    }
  }

  private async testBasicConnectivity(ip: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Try to reach the device on port 80 (most basic test)
      await fetch(`http://${ip}/`, {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-cache',
        signal: AbortSignal.timeout(3000)
      });

      this.results.push({
        method: 'Ping',
        url: `http://${ip}/`,
        result: 'success',
        data: 'Device appears reachable',
        duration: Date.now() - startTime
      });
    } catch (error: any) {
      this.results.push({
        method: 'Ping',
        url: `http://${ip}/`,
        result: 'failed',
        error: `Device not reachable: ${error.message}`,
        duration: Date.now() - startTime
      });
    }
  }

  private async testNMEAEndpoints(ip: string): Promise<void> {
    // Test common NMEA streaming endpoints
    const nmeaEndpoints = [
      `http://${ip}:9001/`,
      `http://${ip}/api/nmea`,
      `http://${ip}/stream/nmea`,
      `http://${ip}/nmea.txt`,
      `http://${ip}/data/nmea`
    ];

    for (const endpoint of nmeaEndpoints) {
      await this.testNMEAEndpoint(endpoint);
    }
  }

  private async testNMEAEndpoint(url: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors', // Try CORS first for NMEA data
        cache: 'no-cache',
        signal: AbortSignal.timeout(3000)
      });

      const text = await response.text();
      const isNMEA = text.includes('$GP') || text.includes('$GN') || text.includes('$GL');

      this.results.push({
        method: 'NMEA',
        url: url,
        result: isNMEA ? 'success' : 'failed',
        data: isNMEA ? `NMEA data found: ${text.substring(0, 100)}...` : 'No NMEA data detected',
        duration: Date.now() - startTime
      });
    } catch (error: any) {
      if (error.message.includes('CORS')) {
        this.results.push({
          method: 'NMEA',
          url: url,
          result: 'cors-blocked',
          error: 'CORS policy blocks access',
          duration: Date.now() - startTime
        });
      } else {
        this.results.push({
          method: 'NMEA',
          url: url,
          result: 'failed',
          error: error.message,
          duration: Date.now() - startTime
        });
      }
    }
  }

  private printDiagnosticReport(): void {
    console.log('\n🔍 === GPS CONNECTION DIAGNOSTIC REPORT ===');
    
    const successful = this.results.filter(r => r.result === 'success');
    const failed = this.results.filter(r => r.result === 'failed');
    const blocked = this.results.filter(r => r.result === 'cors-blocked');
    const timeouts = this.results.filter(r => r.result === 'timeout');

    console.log(`✅ Successful connections: ${successful.length}`);
    console.log(`❌ Failed connections: ${failed.length}`);
    console.log(`🚫 CORS blocked: ${blocked.length}`);
    console.log(`⏱️ Timeouts: ${timeouts.length}`);

    if (successful.length > 0) {
      console.log('\n✅ WORKING CONNECTIONS:');
      successful.forEach(result => {
        console.log(`  ${result.method}: ${result.url} (${result.duration}ms)`);
        if (result.data) console.log(`    Data: ${result.data}`);
      });
    }

    if (blocked.length > 0) {
      console.log('\n🚫 CORS BLOCKED (but device may be reachable):');
      blocked.forEach(result => {
        console.log(`  ${result.method}: ${result.url}`);
      });
    }

    if (failed.length > 0 || timeouts.length > 0) {
      console.log('\n❌ FAILED/TIMEOUT CONNECTIONS:');
      [...failed, ...timeouts].forEach(result => {
        console.log(`  ${result.method}: ${result.url} - ${result.error}`);
      });
    }

    console.log('\n💡 RECOMMENDATIONS:');
    
    if (successful.filter(r => r.method === 'WebSocket').length > 0) {
      console.log('  ✓ WebSocket connection works - GPS should connect successfully');
    } else if (successful.filter(r => r.method === 'HTTP').length > 0) {
      console.log('  ✓ HTTP endpoints work - GPS will use polling mode');
    } else if (blocked.length > 0) {
      console.log('  ⚠️ Device is reachable but CORS blocks access');
      console.log('  💡 Solution: Configure GPS device to allow CORS or use mobile app');
    } else {
      console.log('  ❌ Device not reachable. Check:');
      console.log('    1. Device is powered on and WiFi hotspot is active');
      console.log('    2. You are connected to the device\'s WiFi network');
      console.log('    3. Device IP address is correct (usually 192.168.42.1)');
      console.log('    4. Device firewall allows connections');
    }
    
    console.log('===========================================\n');
  }
}

// Add to window for easy browser console access
declare global {
  interface Window {
    testGPSConnection: (ip: string, port?: number) => Promise<ConnectionTest[]>;
    GPSDiagnostic: typeof GPSConnectionDiagnostic;
  }
}

// Export for console access
export const setupGPSDiagnostics = () => {
  window.testGPSConnection = async (ip: string, port: number = 9001) => {
    const diagnostic = new GPSConnectionDiagnostic();
    return await diagnostic.testConnection(ip, port);
  };
  window.GPSDiagnostic = GPSConnectionDiagnostic;
};