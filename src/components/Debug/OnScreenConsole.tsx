import { useState, useEffect, useRef } from 'react';
import { X, Terminal, Trash2, Copy } from 'lucide-react';
import Button from '../ui/Button';
import { useLanguage } from '../../hooks/useLanguage';

interface LogEntry {
  id: number;
  timestamp: string;
  level: 'log' | 'warn' | 'error' | 'info';
  message: string;
  args: any[];
}

interface OnScreenConsoleProps {
  isVisible: boolean;
  onClose: () => void;
}

// Global log buffer that persists even when console is closed
const globalLogBuffer: LogEntry[] = [];
let globalLogId = 0;
let consoleIntercepted = false;
const originalConsoleMethods = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info
};

// Export the buffer so other components can see log count
export { globalLogBuffer };

// Intercept console IMMEDIATELY on module load (before any React renders)
if (!consoleIntercepted) {
  consoleIntercepted = true;
  
  const addToGlobalBuffer = (level: 'log' | 'warn' | 'error' | 'info', args: any[]) => {
    // Filter out noisy SQLite connection errors that are handled internally
    const messageStr = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    
    const isSQLiteConnectionNoise = 
      messageStr.includes('CloseConnection: No available connection') ||
      messageStr.includes('CreateConnection: Connection') && messageStr.includes('already exists');
    
    if (isSQLiteConnectionNoise && level === 'error') {
      // Still log to native console for debugging, but don't show in UI
      originalConsoleMethods[level](...args);
      return;
    }
    
    const logEntry: LogEntry = {
      id: globalLogId++,
      timestamp: new Date().toLocaleTimeString(),
      level,
      message: args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' '),
      args
    };
    
    globalLogBuffer.push(logEntry);
    // Keep only last 200 logs to prevent memory issues
    if (globalLogBuffer.length > 200) {
      globalLogBuffer.shift();
    }
    
    // Call original method
    originalConsoleMethods[level](...args);
  };

  console.log = (...args) => addToGlobalBuffer('log', args);
  console.warn = (...args) => addToGlobalBuffer('warn', args);
  console.error = (...args) => addToGlobalBuffer('error', args);
  console.info = (...args) => addToGlobalBuffer('info', args);

  // Wire global error handlers so runtime errors surface in the console
  window.addEventListener('error', (event) => {
    const msg = event?.error?.stack || event?.message || 'Unknown error';
    addToGlobalBuffer('error', [msg]);
  });
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason: any = event.reason;
    const msg = typeof reason === 'object' ? (reason?.stack || JSON.stringify(reason)) : String(reason);
    addToGlobalBuffer('error', ['Unhandled promise rejection:', msg]);
  });
}

export default function OnScreenConsole({ isVisible, onClose }: OnScreenConsoleProps) {
  const { t } = useLanguage();
  const [logs, setLogs] = useState<LogEntry[]>([...globalLogBuffer]);
  const [isMinimized, setIsMinimized] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync with global buffer when opened
  useEffect(() => {
    if (isVisible) {
      setLogs([...globalLogBuffer]);
      console.log('🐛 Debug Console Opened - Showing all captured logs');
    }
  }, [isVisible]);

  // Keep updating from global buffer while visible
  useEffect(() => {
    if (!isVisible) return;

    const interval = setInterval(() => {
      setLogs([...globalLogBuffer]);
    }, 500); // Update every 500ms

    return () => clearInterval(interval);
  }, [isVisible]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (containerRef.current && !isMinimized) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, isMinimized]);

  const clearLogs = () => {
    globalLogBuffer.length = 0; // Clear the global buffer
    setLogs([]);
    console.log('🧹 Debug console cleared');
  };

  // Simple code runner: executes code asynchronously and logs start/success/error
  const [codeInput, setCodeInput] = useState('');
  const safeToString = (value: any) => {
    try {
      if (value === undefined) return 'undefined';
      if (value === null) return 'null';
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      if (value instanceof Error) return value.stack || value.message || String(value);
      return JSON.stringify(value, null, 2);
    } catch {
      try { return String(value); } catch { return '[unprintable value]'; }
    }
  };

  const runCode = async (snippet?: string, label?: string) => {
    const code = (snippet ?? codeInput).trim();
    if (!code) {
      console.warn('⚠️ Nothing to run: code input is empty');
      return;
    }

    const title = label ? `preset: ${label}` : 'custom';
    console.info(`▶️ Running ${title}...`);
    console.info('🧩 Command:', code);

    try {
      // Always run inside an async IIFE so top-level await works
      const fn = new Function(
        'console',
        'window',
        'globalThis',
        `return (async () => {\n${code}\n})()`
      );
      const result = await fn(console, window, globalThis);
      console.info('✅ Completed');
      console.info('📦 Result:', safeToString(result));
      // Clear input on successful execution
      setCodeInput('');
    } catch (err: any) {
      const msg = err?.stack || err?.message || String(err);
      console.error('❌ Failed', msg);
    }
  };
  
  // Prefilled diagnostic snippets
  const presetSnippets: Record<string, string> = {
    'Force Sync': 'await db.forceSync()',
    'Force Sync (Immediate Upload)': 'await db.forceSyncImmediate()',
    'Force DB Reset': 'await localDB.forceReset()',
    'Check DB Status': 'localDB.isReady()',
    'Get Pool Stats': 'localDB.getPoolStats()',
    'Retry Now': 'await FirebaseSyncDebugger.retryNow()',
    'Sync Status': 'await FirebaseSyncDebugger.checkSyncStatus()',
    'Inspect Queue': 'FirebaseSyncDebugger.inspectQueue()',
    'Clear Broken Items (10+ attempts)': 'await FirebaseSyncDebugger.clearBrokenItems(10)',
    'Clear Queue (all)': 'await FirebaseSyncDebugger.clearQueue()',
    'Clear Queue (tracks only)': "await FirebaseSyncDebugger.clearQueue({ type: 'track' })",
    'Compare Local vs Firebase': 'await FirebaseSyncDebugger.compareLocalVsFirebase()',
    'Clear Cache & Resync': 'await FirebaseSyncDebugger.clearCacheAndResync()'
  };
  const presetDescriptions: Record<string, string> = {
    'Force Sync': 'Initiates upload + download (non-blocking). Good to hydrate fresh installs and general sync.',
    'Force Sync (Immediate Upload)': 'Uploads pending queue now (blocking upstream). Use when you need a guaranteed push.',
    'Force DB Reset': 'Force reset and re-initialize the database. Use if database is stuck.',
    'Check DB Status': 'Check if database is initialized and ready.',
    'Get Pool Stats': 'Get SQLite connection pool statistics.',
    'Retry Now': 'Refresh connectivity and re-run sync for failed items. Non-destructive.',
    'Sync Status': 'Shows network/auth state and queue summary. Read-only, no data changes.',
    'Inspect Queue': 'Prints queued operations with IDs and attempts. Read-only.',
    'Clear Broken Items (10+ attempts)': 'Removes items with 10+ failed attempts from queue. Useful to clear stuck items.',
    'Clear Queue (all)': 'Clears all queued operations. Irreversible — follow with Force Sync.',
    'Clear Queue (tracks only)': 'Clears only track-related queued items. Irreversible.',
    'Compare Local vs Firebase': 'Shows differences between local cache and Firestore. Read-only.',
    'Clear Cache & Resync': 'Purges local caches and fetches fresh data. Use to fix stale data.'
  };
  const [selectedPreset, setSelectedPreset] = useState<string>('Force Sync');
  const insertPreset = () => {
    setCodeInput(presetSnippets[selectedPreset] || '');
  };
  const runSelectedPreset = () => runCode(presetSnippets[selectedPreset] || '', selectedPreset);

  const copyLogs = () => {
    const logText = logs.map(log => 
      `[${log.timestamp}] ${log.level.toUpperCase()}: ${log.message}`
    ).join('\n');
    
    navigator.clipboard.writeText(logText).then(() => {
      console.log('📋 Logs copied to clipboard');
    }).catch(() => {
      console.warn('❌ Failed to copy logs to clipboard');
    });
  };

  const getLogColor = (level: string) => {
    switch (level) {
      case 'error': return 'text-red-400';
      case 'warn': return 'text-yellow-400';
      case 'info': return 'text-blue-400';
      default: return 'text-gray-300';
    }
  };

  const getLogIcon = (level: string) => {
    switch (level) {
      case 'error': return '❌';
      case 'warn': return '⚠️';
      case 'info': return 'ℹ️';
      default: return '📝';
    }
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/50 backdrop-blur-sm pt-20">
      <div 
        className={`bg-gray-900 border border-gray-700 rounded-lg shadow-2xl transition-all duration-300 ${
          isMinimized ? 'w-80 h-16' : 'w-11/12 max-w-4xl h-5/6 max-h-[calc(100vh-160px)]'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-gray-700 bg-gray-800 rounded-t-lg">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-green-400" />
            <span className="text-white font-medium">{t('debugConsole.title')}</span>
            <span className="text-gray-400 text-sm">({t('debugConsole.logsCount', { count: logs.length })})</span>
          </div>
          
          <div className="flex items-center gap-2">
            {!isMinimized && (
              <>
                <Button
                  onClick={copyLogs}
                  variant="secondary"
                  className="p-2 text-xs"
                  title={t('debugConsole.copyAllLogs')}
                >
                  <Copy className="w-4 h-4" />
                </Button>
                <Button
                  onClick={clearLogs}
                  variant="secondary"
                  className="p-2 text-xs"
                  title={t('debugConsole.clearLogs')}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </>
            )}
            <Button
              onClick={() => setIsMinimized(!isMinimized)}
              variant="secondary"
              className="p-2 text-xs"
              title={isMinimized ? t('debugConsole.maximize') : t('debugConsole.minimize')}
            >
              {isMinimized ? '⬆️' : '⬇️'}
            </Button>
            <Button
              onClick={onClose}
              variant="danger"
              className="p-2 text-xs"
              title={t('debugConsole.close')}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Console Content */}
        {!isMinimized && (
          <div 
            ref={containerRef}
            className="p-3 h-full overflow-y-auto bg-black text-sm font-mono"
            style={{ maxHeight: 'calc(100% - 160px)' }}
          >
            {logs.length === 0 ? (
              <div className="text-gray-500 text-center py-8">
                {t('debugConsole.noLogsYet')}
              </div>
            ) : (
              <div className="space-y-1">
                {logs.map((log) => (
                  <div key={log.id} className="flex gap-2 leading-relaxed">
                    <span className="text-gray-500 text-xs min-w-[80px] flex-shrink-0">
                      {log.timestamp}
                    </span>
                    <span className="text-xs min-w-[16px] flex-shrink-0">
                      {getLogIcon(log.level)}
                    </span>
                    <span className={`${getLogColor(log.level)} break-all`}>
                      {log.message}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Inline code runner panel */}
        {!isMinimized && (
          <div className="border-t border-gray-700 bg-gray-800 p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="text-xs text-gray-300 flex-1">{t('debugConsole.runCodeHint')}</div>
              <select
                value={selectedPreset}
                onChange={(e) => setSelectedPreset(e.target.value)}
                className="text-xs bg-gray-900 text-white border border-gray-700 rounded px-2 py-1"
                title={t('debugConsole.commonCommands')}
              >
                {Object.keys(presetSnippets).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <Button onClick={insertPreset} variant="secondary" className="px-2 py-1 text-xs">{t('debugConsole.insert')}</Button>
              <Button onClick={runSelectedPreset} variant="primary" className="px-2 py-1 text-xs">{t('debugConsole.run')}</Button>
            </div>
            <div className="text-[11px] text-gray-400 -mt-1 mb-1">{presetDescriptions[selectedPreset]}</div>
            <div className="flex gap-2">
              <textarea
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                onKeyDown={(e) => {
                  // Ctrl+Enter or Cmd+Enter to execute
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    runCode();
                  }
                }}
                className="flex-1 h-24 rounded bg-black text-white p-2 text-sm font-mono border border-gray-700"
                placeholder={t('debugConsole.codePlaceholder')}
              />
              <div className="flex flex-col gap-2">
                <Button 
                  onClick={() => runCode()} 
                  variant="primary" 
                  className="px-3 py-1 text-xs whitespace-nowrap"
                  title={t('debugConsole.executeCode')}
                >
                  {t('debugConsole.run')}
                </Button>
                <Button 
                  onClick={() => runCode()} 
                  variant="primary" 
                  className="px-2 py-1 text-xs"
                  title={t('debugConsole.executeCodeAlt')}
                >
                  ⏎
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}