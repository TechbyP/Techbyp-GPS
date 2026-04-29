/**
 * API Configuration Manager
 * Simplified for Serverless/Firebase-only architecture
 */

import axios, { AxiosInstance } from 'axios';

// Export a dummy apiConfig object to satisfy any remaining imports
export const apiConfig = {
  testConnection: async () => ({ success: true, duration: 0 }),
  getAxiosInstance: () => axios.create(),
  getBackendUrl: () => '',
};

export const getApi = (): AxiosInstance => axios.create();
