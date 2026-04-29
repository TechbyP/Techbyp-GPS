import { useState } from 'react';
import { useDarkMode } from '../../hooks/useDarkMode';
import { useLanguage } from '../../hooks/useLanguage';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { Settings, Satellite, Radio, Wifi } from 'lucide-react';
import { GpsDevice, GpsDeviceConfig } from '../../types';

interface ReachRS3ConfigProps {
  device: GpsDevice;
  onSave: (config: GpsDeviceConfig) => void;
  onCancel: () => void;
}

export default function ReachRS3Config({ device, onSave, onCancel }: ReachRS3ConfigProps) {
  const [isDark] = useDarkMode();
  const { t } = useLanguage();

  const existingConfig = device.config || {};
  
  const [correctionInput, setCorrectionInput] = useState(existingConfig.correction_input || 'ntrip');
  const [ntripServer, setNtripServer] = useState(existingConfig.ntrip_server || '');
  const [ntripPort, setNtripPort] = useState(existingConfig.ntrip_port || 2101);
  const [ntripMountpoint, setNtripMountpoint] = useState(existingConfig.ntrip_mountpoint || '');
  const [ntripUsername, setNtripUsername] = useState(existingConfig.ntrip_username || '');
  const [ntripPassword, setNtripPassword] = useState(existingConfig.ntrip_password || '');
  const [positioningMode, setPositioningMode] = useState(existingConfig.positioning_mode || 'kinematic');
  const [elevationMask, setElevationMask] = useState(existingConfig.elevation_mask || 15);
  const [outputFormat, setOutputFormat] = useState(existingConfig.output_format || 'nmea');

  const handleSave = () => {
    const config: GpsDeviceConfig = {
      correction_input: correctionInput as 'ntrip' | 'lora' | 'bluetooth',
      positioning_mode: positioningMode as 'kinematic' | 'static' | 'single',
      elevation_mask: elevationMask,
      output_format: outputFormat as 'nmea' | 'lla' | 'xyz',
    };

    if (correctionInput === 'ntrip') {
      config.ntrip_server = ntripServer;
      config.ntrip_port = ntripPort;
      config.ntrip_mountpoint = ntripMountpoint;
      config.ntrip_username = ntripUsername;
      config.ntrip_password = ntripPassword;
    }

    onSave(config);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-lg" style={{ backgroundColor: isDark ? '#374151' : '#f3f4f6' }}>
          <Satellite className="w-6 h-6" style={{ color: '#10b981' }} />
        </div>
        <div>
          <h2 className="text-2xl font-bold" style={{ color: isDark ? '#fff' : '#333' }}>
            {t('gps.devices.reachConfig') || 'Emlid Reach RS3 Configuration'}
          </h2>
          <p className="text-sm mt-1" style={{ color: isDark ? '#9ca3af' : '#666' }}>
            {device.name}
          </p>
        </div>
      </div>

      {/* Positioning Mode */}
      <Card>
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: isDark ? '#fff' : '#333' }}>
          <Settings className="w-5 h-5" />
          {t('gps.devices.positioningMode') || 'Positioning Mode'}
        </h3>
        
        <div className="space-y-3">
          {[
            { value: 'kinematic', label: 'Kinematic', desc: 'For moving applications (vehicles, drones)' },
            { value: 'static', label: 'Static', desc: 'For stationary measurements (surveying points)' },
            { value: 'single', label: 'Single', desc: 'Standard GPS without RTK corrections' }
          ].map((mode) => (
            <label
              key={mode.value}
              className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors"
              style={{
                backgroundColor: positioningMode === mode.value
                  ? isDark ? '#065f46' : '#d1fae5'
                  : isDark ? '#374151' : '#f9fafb',
                border: `1px solid ${positioningMode === mode.value ? '#10b981' : isDark ? '#4b5563' : '#e5e7eb'}`
              }}
            >
              <input
                type="radio"
                name="positioning"
                value={mode.value}
                checked={positioningMode === mode.value}
                onChange={(e) => setPositioningMode(e.target.value as 'kinematic' | 'static' | 'single')}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium" style={{ color: isDark ? '#fff' : '#333' }}>
                  {mode.label}
                </div>
                <div className="text-sm" style={{ color: isDark ? '#9ca3af' : '#666' }}>
                  {mode.desc}
                </div>
              </div>
            </label>
          ))}
        </div>
      </Card>

      {/* Correction Input */}
      <Card>
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: isDark ? '#fff' : '#333' }}>
          <Radio className="w-5 h-5" />
          {t('gps.devices.correctionInput') || 'RTK Correction Input'}
        </h3>
        
        <div className="space-y-3 mb-4">
          {[
            { value: 'ntrip', label: 'NTRIP', icon: <Wifi className="w-4 h-4" />, desc: 'Internet-based corrections' },
            { value: 'lora', label: 'LoRa Radio', icon: <Radio className="w-4 h-4" />, desc: 'Radio link corrections' },
            { value: 'bluetooth', label: 'Bluetooth', icon: <Radio className="w-4 h-4" />, desc: 'From another device' }
          ].map((input) => (
            <label
              key={input.value}
              className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors"
              style={{
                backgroundColor: correctionInput === input.value
                  ? isDark ? '#065f46' : '#d1fae5'
                  : isDark ? '#374151' : '#f9fafb',
                border: `1px solid ${correctionInput === input.value ? '#10b981' : isDark ? '#4b5563' : '#e5e7eb'}`
              }}
            >
              <input
                type="radio"
                name="correction"
                value={input.value}
                checked={correctionInput === input.value}
                onChange={(e) => setCorrectionInput(e.target.value as 'ntrip' | 'lora' | 'bluetooth')}
              />
              <div className="flex items-center gap-2 flex-1">
                {input.icon}
                <div>
                  <div className="font-medium" style={{ color: isDark ? '#fff' : '#333' }}>
                    {input.label}
                  </div>
                  <div className="text-xs" style={{ color: isDark ? '#9ca3af' : '#666' }}>
                    {input.desc}
                  </div>
                </div>
              </div>
            </label>
          ))}
        </div>

        {/* NTRIP Settings */}
        {correctionInput === 'ntrip' && (
          <div className="space-y-3 p-4 rounded-lg" style={{ backgroundColor: isDark ? '#1f2937' : '#f3f4f6' }}>
            <h4 className="font-medium text-sm" style={{ color: isDark ? '#9ca3af' : '#666' }}>
              {t('gps.devices.ntripSettings') || 'NTRIP Server Settings'}
            </h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: isDark ? '#9ca3af' : '#666' }}>
                  {t('gps.devices.server') || 'Server'}
                </label>
                <input
                  type="text"
                  value={ntripServer}
                  onChange={(e) => setNtripServer(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{
                    backgroundColor: isDark ? '#374151' : '#fff',
                    color: isDark ? '#fff' : '#333',
                    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`
                  }}
                  placeholder="rtk.example.com"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: isDark ? '#9ca3af' : '#666' }}>
                  {t('gps.devices.port') || 'Port'}
                </label>
                <input
                  type="number"
                  value={ntripPort}
                  onChange={(e) => setNtripPort(parseInt(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{
                    backgroundColor: isDark ? '#374151' : '#fff',
                    color: isDark ? '#fff' : '#333',
                    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`
                  }}
                  placeholder="2101"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: isDark ? '#9ca3af' : '#666' }}>
                  {t('gps.devices.mountpoint') || 'Mountpoint'}
                </label>
                <input
                  type="text"
                  value={ntripMountpoint}
                  onChange={(e) => setNtripMountpoint(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{
                    backgroundColor: isDark ? '#374151' : '#fff',
                    color: isDark ? '#fff' : '#333',
                    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`
                  }}
                  placeholder="MOUNT1"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: isDark ? '#9ca3af' : '#666' }}>
                  {t('gps.devices.username') || 'Username'}
                </label>
                <input
                  type="text"
                  value={ntripUsername}
                  onChange={(e) => setNtripUsername(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{
                    backgroundColor: isDark ? '#374151' : '#fff',
                    color: isDark ? '#fff' : '#333',
                    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`
                  }}
                  placeholder="username"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium mb-1" style={{ color: isDark ? '#9ca3af' : '#666' }}>
                  {t('gps.devices.password') || 'Password'}
                </label>
                <input
                  type="password"
                  value={ntripPassword}
                  onChange={(e) => setNtripPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{
                    backgroundColor: isDark ? '#374151' : '#fff',
                    color: isDark ? '#fff' : '#333',
                    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`
                  }}
                  placeholder="••••••••"
                />
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Advanced Settings */}
      <Card>
        <h3 className="text-lg font-semibold mb-4" style={{ color: isDark ? '#fff' : '#333' }}>
          {t('gps.devices.advancedSettings') || 'Advanced Settings'}
        </h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: isDark ? '#9ca3af' : '#666' }}>
              {t('gps.devices.elevationMask') || 'Elevation Mask'}: {elevationMask}°
            </label>
            <input
              type="range"
              min="5"
              max="40"
              value={elevationMask}
              onChange={(e) => setElevationMask(parseInt(e.target.value))}
              className="w-full"
            />
            <p className="text-xs mt-1" style={{ color: isDark ? '#6b7280' : '#9ca3af' }}>
              Minimum satellite elevation angle (lower = more satellites, but potentially less accurate)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: isDark ? '#9ca3af' : '#666' }}>
              {t('gps.devices.outputFormat') || 'Output Format'}
            </label>
            <select
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value as 'nmea' | 'lla' | 'xyz')}
              className="w-full px-3 py-2 rounded-lg"
              style={{
                backgroundColor: isDark ? '#374151' : '#fff',
                color: isDark ? '#fff' : '#333',
                border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`
              }}
            >
              <option value="nmea">{t('gps.reachConfig.outputNmea')}</option>
              <option value="lla">{t('gps.reachConfig.outputLla')}</option>
              <option value="xyz">{t('gps.reachConfig.outputXyz')}</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Info Box */}
      <div className="p-4 rounded-lg" style={{ backgroundColor: isDark ? '#1e3a8a' : '#dbeafe' }}>
        <p className="text-sm" style={{ color: isDark ? '#93c5fd' : '#1e40af' }}>
          <strong>{t('gps.reachConfig.rtkInfoTitle')}</strong> {t('gps.reachConfig.rtkInfoDescription')}
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button onClick={handleSave} className="flex-1">
          {t('common.save') || 'Save Configuration'}
        </Button>
        <Button variant="secondary" onClick={onCancel} className="flex-1">
          {t('common.cancel') || 'Cancel'}
        </Button>
      </div>
    </div>
  );
}
