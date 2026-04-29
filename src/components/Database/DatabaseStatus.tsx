import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  checkDatabaseHealth, 
  recoverDatabase, 
  getDatabaseErrorMessage,
  DatabaseHealthCheck 
} from '../../services/databaseRecovery';

interface DatabaseStatusProps {
  className?: string;
  showDetails?: boolean;
}

const DatabaseStatus: React.FC<DatabaseStatusProps> = ({ 
  className = '', 
  showDetails = false 
}) => {
  const { t } = useTranslation();
  const [health, setHealth] = useState<DatabaseHealthCheck | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  const performHealthCheck = async () => {
    try {
      setLoading(true);
      const healthResult = await checkDatabaseHealth();
      setHealth(healthResult);
      setLastCheck(new Date());
    } catch (error) {
      setHealth({
        isHealthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        suggestion: 'Try restarting the app'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRecover = async () => {
    setIsRecovering(true);
    try {
      const result = await recoverDatabase();
      if (result.success) {
        // Re-check health after recovery
        await performHealthCheck();
      } else {
        setHealth({
          isHealthy: false,
          error: result.message,
          suggestion: 'Manual restart may be required'
        });
      }
    } catch (error) {
      setHealth({
        isHealthy: false,
        error: error instanceof Error ? error.message : 'Recovery failed',
        suggestion: 'Try restarting the app'
      });
    } finally {
      setIsRecovering(false);
    }
  };

  useEffect(() => {
    performHealthCheck();
    
    // Check health every 2 minutes
    const interval = setInterval(performHealthCheck, 2 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, []);

  if (loading && !health) {
    return (
      <div className={`p-3 bg-gray-100 rounded-lg ${className}`}>
        <div className="text-sm text-gray-600">{t('database.checking') || 'Checking database status...'}</div>
      </div>
    );
  }

  if (!health) return null;

  const getStatusIcon = () => {
    if (isRecovering) return '🔄';
    return health.isHealthy ? '✅' : '❌';
  };

  const getStatusColor = () => {
    if (isRecovering) return 'bg-yellow-100 border-yellow-200';
    return health.isHealthy ? 'bg-green-100 border-green-200' : 'bg-red-100 border-red-200';
  };

  const getStatusMessage = () => {
    if (isRecovering) return t('database.recoveringConnection') || 'Recovering database connection...';
    return health.isHealthy ? (t('database.connectionHealthy') || 'Database connection healthy') : health.error;
  };

  const errorInfo = health.error ? getDatabaseErrorMessage(health.error) : null;

  return (
    <div className={`border rounded-lg p-4 ${getStatusColor()} ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center">
          <span className="text-lg mr-2">{getStatusIcon()}</span>
          <h3 className="font-semibold text-sm">
            {isRecovering ? (t('database.recovery') || 'Database Recovery') : (t('database.local') || 'Local Database')}
          </h3>
        </div>
        
        {!health.isHealthy && !isRecovering && errorInfo?.canRecover && (
          <button
            onClick={handleRecover}
            className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600"
            disabled={isRecovering}
          >
            {t('database.fixNow') || 'Fix Now'}
          </button>
        )}
      </div>
      
      <div className="text-sm mb-2">
        <div className="mb-1">{getStatusMessage()}</div>
        {!health.isHealthy && health.suggestion && (
          <div className="text-xs opacity-75 italic">
            {t('database.suggestion') || 'Suggestion'}: {health.suggestion}
          </div>
        )}
      </div>
      
      {showDetails && (
        <div className="text-xs space-y-1">
          <div className="border-t pt-2 mt-2 opacity-75">
            <div>{t('database.lastChecked') || 'Last checked'}: {lastCheck?.toLocaleTimeString() || (t('database.never') || 'Never')}</div>
            {!health.isHealthy && errorInfo && (
              <>
                <div className="font-medium mt-1">{errorInfo.title}</div>
                <div>{errorInfo.message}</div>
              </>
            )}
          </div>
        </div>
      )}
      
      {isRecovering && (
        <div className="mt-2 text-xs">
          <div className="w-full bg-gray-200 rounded-full h-1">
            <div className="bg-blue-500 h-1 rounded-full animate-pulse" style={{ width: '60%' }}></div>
          </div>
          <div className="text-center mt-1">{t('common.initializing') || 'Initializing'}...</div>
        </div>
      )}
    </div>
  );
};

export default DatabaseStatus;