import { registerPlugin } from '@capacitor/core';

export interface MockLocationDetectorPlugin {
  isMockLocation(): Promise<{
    isMock: boolean;
    provider?: string;
    accuracy?: number;
    latitude?: number;
    longitude?: number;
    time?: number;
    error?: string;
  }>;
}

const MockLocationDetector = registerPlugin<MockLocationDetectorPlugin>('MockLocationDetector');

export default MockLocationDetector;
