import { useState, useEffect } from 'react';
import { gpsAPI } from '../services/api';

interface DatabaseStatus {
  online: boolean;
  firebaseOnline: boolean;
  backendOnline: boolean;
  internetOnline: boolean;
  pendingSync: number;
  queuedItems: any[];
}

export function useDatabaseStatus() {
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = async () => {
    try {
      const response = await gpsAPI.getDatabaseStatus();
      setStatus(response as DatabaseStatus);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to check database status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkStatus();
    
    // Check status every 30 seconds
    const interval = setInterval(checkStatus, 30000);
    
    return () => clearInterval(interval);
  }, []);

  const triggerSync = async () => {
    try {
      await gpsAPI.syncNow();
      await checkStatus(); // Refresh status
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  return { status, loading, error, checkStatus, triggerSync };
}
