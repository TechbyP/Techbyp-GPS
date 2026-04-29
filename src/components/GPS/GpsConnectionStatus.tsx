import React, { useState, useEffect } from 'react';
import { diagnoseGpsConnection, GpsConnectionDiagnostics } from '../../utils/gpsConnectionFix';

interface GpsConnectionStatusProps {
  className?: string;
}

const GpsConnectionStatus: React.FC<GpsConnectionStatusProps> = ({ className = '' }) => {
  const [diagnostics, setDiagnostics] = useState<GpsConnectionDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const runDiagnostics = async () => {
      try {
        const result = await diagnoseGpsConnection();
        setDiagnostics(result);
      } catch (error) {
        console.error('Failed to run GPS diagnostics:', error);
        setDiagnostics({
          isNative: false,
          hasGpsManager: false,
          capacitorVersion: 'unknown',
          platform: 'unknown',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      } finally {
        setLoading(false);
      }
    };

    runDiagnostics();
  }, []);

  if (loading) {
    return (
      <div className={`p-3 bg-gray-100 rounded-lg ${className}`}>
        <div className="text-sm text-gray-600">Checking GPS capabilities...</div>
      </div>
    );
  }

  if (!diagnostics) {
    return null;
  }

  const getStatusIcon = () => {
    if (!diagnostics.isNative) return '🌐';
    if (diagnostics.hasGpsManager) return '✅';
    return '❌';
  };

  const getStatusColor = () => {
    if (!diagnostics.isNative) return 'bg-blue-100 border-blue-200';
    if (diagnostics.hasGpsManager) return 'bg-green-100 border-green-200';
    return 'bg-red-100 border-red-200';
  };

  const getStatusMessage = () => {
    if (!diagnostics.isNative) {
      return 'Running in web browser - GPS device connections not available';
    }
    if (diagnostics.hasGpsManager) {
      return 'GPS Manager ready - GPS device connections available';
    }
    return `GPS Manager unavailable: ${diagnostics.error || 'Unknown issue'}`;
  };

  const getSuggestions = () => {
    if (!diagnostics.isNative) {
      return [
        'Use internal device GPS for location tracking',
        'Download the native Android app for GPS device support'
      ];
    }
    if (!diagnostics.hasGpsManager) {
      return [
        'Restart the application',
        'Check if the app was properly installed',
        'Use internal GPS as fallback'
      ];
    }
    return ['GPS device connections are fully supported'];
  };

  return (
    <div className={`border rounded-lg p-4 ${getStatusColor()} ${className}`}>
      <div className="flex items-center mb-2">
        <span className="text-lg mr-2">{getStatusIcon()}</span>
        <h3 className="font-semibold text-sm">GPS System Status</h3>
      </div>
      
      <div className="text-sm mb-3">
        <div className="mb-1">{getStatusMessage()}</div>
        <div className="text-xs opacity-75">
          Platform: {diagnostics.platform} | Native: {diagnostics.isNative ? 'Yes' : 'No'}
        </div>
      </div>
      
      <div className="text-xs">
        <div className="font-medium mb-1">Available options:</div>
        <ul className="list-disc list-inside space-y-1">
          {getSuggestions().map((suggestion, index) => (
            <li key={index}>{suggestion}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default GpsConnectionStatus;