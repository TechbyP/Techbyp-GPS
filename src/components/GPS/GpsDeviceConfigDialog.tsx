/**
 * GPS Device Configuration Component
 * Full-featured device management with profiles, NTRIP settings, and testing
 */

import { useState, useEffect } from 'react';
import { X, Save, Trash2, Copy, Star, Wifi, Bluetooth, Settings, TestTube, CheckCircle, XCircle } from 'lucide-react';
import { GpsDevice } from '../../types';
import { getAllDeviceProfiles, createDeviceFromProfile, validateDeviceConfig, getGermanNtripCasters } from '../../services/gpsDeviceProfiles';
import { haptics } from '../../utils/haptics';
import { useLanguage } from '../../hooks/useLanguage';
import { useDarkMode } from '../../hooks/useDarkMode';
import toast from 'react-hot-toast';

interface GpsDeviceConfigProps {
  device?: GpsDevice | null;
  onSave: (device: Partial<GpsDevice>) => Promise<void>;
  onDelete?: (deviceId: string) => Promise<void>;
  onCancel: () => void;
  onTest?: (device: Partial<GpsDevice>) => Promise<boolean>;
}

export default function GpsDeviceConfig({
  device,
  onSave,
  onDelete,
  onCancel,
  onTest,
}: GpsDeviceConfigProps) {
  const [isDark] = useDarkMode();
  const { t } = useLanguage();
  const [formData, setFormData] = useState<Partial<GpsDevice>>(device || {});
  const [activeTab, setActiveTab] = useState<'basic' | 'connection' | 'rtk' | 'advanced'>('basic');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const profiles = getAllDeviceProfiles();
  const ntripCasters = getGermanNtripCasters();

  useEffect(() => {
    if (device) {
      setFormData(device);
    }
  }, [device]);

  const handleProfileSelect = (profileId: string) => {
    try {
      const deviceFromProfile = createDeviceFromProfile(profileId);
      setFormData({ ...formData, ...deviceFromProfile });
      toast.success(t('gps.configDialog.profileLoaded', { profile: profileId }));
      haptics.trigger({ type: 'light' });
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleChange = (field: string, value: any) => {
    if (field.startsWith('config.')) {
      const configField = field.split('.')[1];
      setFormData({
        ...formData,
        config: { ...formData.config, [configField]: value }
      });
    } else {
      setFormData({ ...formData, [field]: value });
    }
    haptics.trigger({ type: 'light' });
  };

  const handleTest = async () => {
    if (!onTest) return;
    
    setIsTesting(true);
    setTestResult(null);
    await haptics.trigger({ type: 'medium' });
    
    try {
      const success = await onTest(formData);
      setTestResult(success ? 'success' : 'error');
      toast[success ? 'success' : 'error'](
        success ? t('gps.configDialog.connectionTestSuccessful') : t('gps.configDialog.connectionTestFailed')
      );
      await haptics.trigger({ type: success ? 'success' : 'error' });
    } catch (error) {
      setTestResult('error');
      toast.error(t('gps.configDialog.connectionTestFailed'));
      await haptics.error();
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    const validation = validateDeviceConfig(formData);
    if (!validation.valid) {
      toast.error(validation.errors[0]);
      await haptics.error();
      return;
    }

    setIsSaving(true);
    await haptics.trigger({ type: 'medium' });
    
    try {
      await onSave(formData);
      toast.success(t('gps.configDialog.deviceSavedSuccessfully'));
      await haptics.trigger({ type: 'success' });
    } catch (error: any) {
      toast.error(error.message || t('gps.devices.saveFailed'));
      await haptics.error();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || !device?.id) return;
    
    if (!window.confirm(t('gps.configDialog.confirmDeleteDevice'))) return;
    
    await haptics.trigger({ type: 'heavy' });
    try {
      await onDelete(device.id as string);
      toast.success(t('gps.configDialog.deviceDeleted'));
      await haptics.trigger({ type: 'success' });
    } catch (error: any) {
      toast.error(error.message || t('gps.devices.deleteFailed'));
      await haptics.error();
    }
  };

  const bgClass = isDark ? 'bg-gray-800' : 'bg-white';
  const textClass = isDark ? 'text-gray-100' : 'text-gray-900';
  const borderClass = isDark ? 'border-gray-700' : 'border-gray-300';
  const inputClass = `form-input-touch ${isDark ? 'bg-gray-700 text-white border-gray-600' : 'bg-white text-gray-900 border-gray-300'}`;
  const selectClass = `form-select-touch ${isDark ? 'bg-gray-700 text-white border-gray-600' : 'bg-white text-gray-900 border-gray-300'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className={`${bgClass} ${textClass} rounded-lg shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col`}>
        {/* Header */}
        <div className={`flex items-center justify-between p-4 border-b ${borderClass}`}>
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-full ${isDark ? 'bg-blue-900' : 'bg-blue-100'} flex items-center justify-center`}>
              {formData.connection_type === 'bluetooth' ? (
                <Bluetooth className="w-6 h-6 text-blue-500" />
              ) : (
                <Wifi className="w-6 h-6 text-blue-500" />
              )}
            </div>
            <div>
              <h2 className="text-xl font-bold">
                {device ? t('gps.configDialog.editGpsDevice') : t('gps.configDialog.addGpsDevice')}
              </h2>
              {formData.name && (
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                  {formData.name}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={() => {
              haptics.trigger({ type: 'light' });
              onCancel();
            }}
            className="touch-target p-2 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className={`flex border-b ${borderClass} overflow-x-auto`}>
          {[
            { id: 'basic', label: t('gps.configDialog.tabBasic'), icon: Settings },
            { id: 'connection', label: t('gps.configDialog.tabConnection'), icon: Wifi },
            { id: 'rtk', label: t('gps.configDialog.tabRtk'), icon: Star },
            { id: 'advanced', label: t('gps.configDialog.tabAdvanced'), icon: TestTube },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => {
                setActiveTab(id as any);
                haptics.trigger({ type: 'light' });
              }}
              className={`flex-1 min-w-[120px] px-4 py-3 font-medium transition-colors touch-target flex items-center justify-center gap-2 ${
                activeTab === id
                  ? `border-b-2 border-blue-500 ${isDark ? 'text-blue-400' : 'text-blue-600'}`
                  : `${isDark ? 'text-gray-400' : 'text-gray-600'} hover:${isDark ? 'text-gray-200' : 'text-gray-800'}`
              }`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Basic Tab */}
          {activeTab === 'basic' && (
            <div className="space-y-6">
              {/* Profile Selection */}
              <div>
                <label className="block text-sm font-medium mb-2">{t('gps.configDialog.deviceProfile')}</label>
                <div className="grid grid-cols-2 gap-3">
                  {profiles.map(profile => (
                    <button
                      key={profile.id}
                      onClick={() => handleProfileSelect(profile.id)}
                      className={`p-4 border-2 rounded-lg text-left transition-all touch-target ${
                        formData.profile === profile.id
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : `${borderClass} hover:border-blue-300`
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-2xl">{profile.icon}</span>
                        <span className="font-semibold">{profile.name}</span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {profile.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Device Name */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t('gps.configDialog.deviceNameRequired')}
                </label>
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={e => handleChange('name', e.target.value)}
                  className={inputClass}
                  placeholder={t('gps.configDialog.deviceNamePlaceholder')}
                  required
                />
              </div>

              {/* Device Address */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  {formData.connection_type === 'bluetooth' ? t('gps.configDialog.bluetoothMacRequired') : t('gps.configDialog.ipAddressRequired')}
                </label>
                <input
                  type="text"
                  value={formData.address || ''}
                  onChange={e => handleChange('address', e.target.value)}
                  className={inputClass}
                  placeholder={formData.connection_type === 'bluetooth' ? '00:11:22:33:44:55' : '192.168.1.100'}
                  required
                />
              </div>

              {/* Favorite & Auto-reconnect */}
              <div className="flex gap-4">
                <label className="flex items-center gap-3 cursor-pointer touch-target">
                  <input
                    type="checkbox"
                    checked={formData.is_favorite || false}
                    onChange={e => handleChange('is_favorite', e.target.checked)}
                    className="form-checkbox-touch"
                  />
                  <span>{t('gps.configDialog.markAsFavorite')}</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer touch-target">
                  <input
                    type="checkbox"
                    checked={formData.auto_reconnect !== false}
                    onChange={e => handleChange('auto_reconnect', e.target.checked)}
                    className="form-checkbox-touch"
                  />
                  <span>{t('gps.configDialog.autoReconnect')}</span>
                </label>
              </div>
            </div>
          )}

          {/* Connection Tab */}
          {activeTab === 'connection' && (
            <div className="space-y-6">
              {/* Connection Type */}
              <div>
                <label className="block text-sm font-medium mb-2">{t('gps.configDialog.connectionType')}</label>
                <select
                  value={formData.connection_type || 'bluetooth'}
                  onChange={e => handleChange('connection_type', e.target.value)}
                  className={selectClass}
                >
                  <option value="bluetooth">{t('common.bluetooth') || 'Bluetooth'}</option>
                  <option value="wifi">{t('common.wifiTcp') || 'WiFi (TCP)'}</option>
                  <option value="tcp">{t('common.networkTcp') || 'Network (TCP)'}</option>
                  <option value="serial">{t('common.serialPort') || 'Serial Port'}</option>
                </select>
              </div>

              {/* TCP Settings */}
              {(formData.connection_type === 'wifi' || formData.connection_type === 'tcp') && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-2">{t('gps.configDialog.tcpPort')}</label>
                    <input
                      type="number"
                      value={formData.config?.tcp_port || 9001}
                      onChange={e => handleChange('config.tcp_port', parseInt(e.target.value))}
                      className={inputClass}
                      min="1"
                      max="65535"
                    />
                  </div>
                  <label className="flex items-center gap-3 cursor-pointer touch-target">
                    <input
                      type="checkbox"
                      checked={formData.config?.use_ssl || false}
                      onChange={e => handleChange('config.use_ssl', e.target.checked)}
                      className="form-checkbox-touch"
                    />
                    <span>{t('gps.configDialog.useSslTls')}</span>
                  </label>
                </>
              )}

              {/* Serial Settings */}
              {formData.connection_type === 'serial' && (
                <div>
                  <label className="block text-sm font-medium mb-2">{t('gps.configDialog.baudRate')}</label>
                  <select
                    value={formData.config?.baudrate || 9600}
                    onChange={e => handleChange('config.baudrate', parseInt(e.target.value))}
                    className={selectClass}
                  >
                    <option value="4800">4800</option>
                    <option value="9600">9600</option>
                    <option value="19200">19200</option>
                    <option value="38400">38400</option>
                    <option value="57600">57600</option>
                    <option value="115200">115200</option>
                  </select>
                </div>
              )}

              {/* NMEA Settings */}
              <div>
                <label className="block text-sm font-medium mb-2">{t('gps.configDialog.nmeaOutputRate')}</label>
                <select
                  value={formData.config?.nmea_output_rate_hz || 1}
                  onChange={e => handleChange('config.nmea_output_rate_hz', parseInt(e.target.value))}
                  className={selectClass}
                >
                  <option value="1">{t('gps.configDialog.nmeaRate1hz')}</option>
                  <option value="5">{t('gps.configDialog.nmeaRate5hz')}</option>
                  <option value="10">{t('gps.configDialog.nmeaRate10hz')}</option>
                </select>
              </div>
            </div>
          )}

          {/* RTK/NTRIP Tab */}
          {activeTab === 'rtk' && (
            <div className="space-y-6">
              <label className="flex items-center gap-3 cursor-pointer touch-target">
                <input
                  type="checkbox"
                  checked={formData.config?.ntrip_enabled || false}
                  onChange={e => handleChange('config.ntrip_enabled', e.target.checked)}
                  className="form-checkbox-touch"
                />
                <span className="font-semibold">{t('gps.configDialog.enableNtrip')}</span>
              </label>

              {formData.config?.ntrip_enabled && (
                <>
                  {/* NTRIP Caster Presets */}
                  <div>
                    <label className="block text-sm font-medium mb-2">{t('gps.configDialog.germanNtripCasters')}</label>
                    <div className="space-y-2">
                      {ntripCasters.map(caster => (
                        <button
                          key={caster.server}
                          onClick={() => {
                            handleChange('config.ntrip_server', caster.server);
                            handleChange('config.ntrip_port', caster.port);
                            haptics.trigger({ type: 'light' });
                          }}
                          className={`w-full p-3 border rounded-lg text-left transition-all touch-target ${borderClass} hover:border-blue-400`}
                        >
                          <div className="font-semibold">{caster.name}</div>
                          <div className="text-sm text-gray-500">
                            {caster.server}:{caster.port} • {caster.coverage}
                          </div>
                          {caster.requires_subscription && (
                            <div className="text-xs text-orange-500 mt-1">{t('gps.configDialog.requiresSubscription')}</div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Manual NTRIP Settings */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">{t('gps.configDialog.ntripServer')}</label>
                      <input
                        type="text"
                        value={formData.config?.ntrip_server || ''}
                        onChange={e => handleChange('config.ntrip_server', e.target.value)}
                        className={inputClass}
                        placeholder="sapos.de"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">{t('gps.configDialog.port')}</label>
                      <input
                        type="number"
                        value={formData.config?.ntrip_port || 2101}
                        onChange={e => handleChange('config.ntrip_port', parseInt(e.target.value))}
                        className={inputClass}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">{t('gps.configDialog.mountpoint')}</label>
                    <input
                      type="text"
                      value={formData.config?.ntrip_mountpoint || ''}
                      onChange={e => handleChange('config.ntrip_mountpoint', e.target.value)}
                      className={inputClass}
                      placeholder="VRS_3_4G_DE"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">{t('gps.configDialog.username')}</label>
                      <input
                        type="text"
                        value={formData.config?.ntrip_username || ''}
                        onChange={e => handleChange('config.ntrip_username', e.target.value)}
                        className={inputClass}
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">{t('gps.configDialog.password')}</label>
                      <input
                        type="password"
                        value={formData.config?.ntrip_password || ''}
                        onChange={e => handleChange('config.ntrip_password', e.target.value)}
                        className={inputClass}
                        autoComplete="off"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Advanced Tab */}
          {activeTab === 'advanced' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-2">{t('gps.configDialog.positioningMode')}</label>
                <select
                  value={formData.config?.positioning_mode || 'kinematic'}
                  onChange={e => handleChange('config.positioning_mode', e.target.value)}
                  className={selectClass}
                >
                  <option value="single">{t('gps.configDialog.modeSingle')}</option>
                  <option value="dgps">{t('gps.configDialog.modeDgps')}</option>
                  <option value="kinematic">{t('gps.configDialog.modeKinematic')}</option>
                  <option value="static">{t('gps.configDialog.modeStatic')}</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">{t('gps.configDialog.elevationMask')}</label>
                  <input
                    type="number"
                    value={formData.config?.elevation_mask || 15}
                    onChange={e => handleChange('config.elevation_mask', parseInt(e.target.value))}
                    className={inputClass}
                    min="0"
                    max="90"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">{t('gps.configDialog.maxReconnectAttempts')}</label>
                  <input
                    type="number"
                    value={formData.max_reconnect_attempts || 5}
                    onChange={e => handleChange('max_reconnect_attempts', parseInt(e.target.value))}
                    className={inputClass}
                    min="1"
                    max="20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">{t('gps.configDialog.reconnectDelay')}</label>
                <input
                  type="number"
                  value={formData.reconnect_delay_ms || 5000}
                  onChange={e => handleChange('reconnect_delay_ms', parseInt(e.target.value))}
                  className={inputClass}
                  step="1000"
                  min="1000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">{t('gps.configDialog.devicePriority')}</label>
                <input
                  type="number"
                  value={formData.priority || 1}
                  onChange={e => handleChange('priority', parseInt(e.target.value))}
                  className={inputClass}
                  min="1"
                  max="10"
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer touch-target">
                  <input
                    type="checkbox"
                    checked={formData.use_for_tracking !== false}
                    onChange={e => handleChange('use_for_tracking', e.target.checked)}
                    className="form-checkbox-touch"
                  />
                  <span>{t('gps.configDialog.useForTrackRecording')}</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer touch-target">
                  <input
                    type="checkbox"
                    checked={formData.use_for_samples !== false}
                    onChange={e => handleChange('use_for_samples', e.target.checked)}
                    className="form-checkbox-touch"
                  />
                  <span>{t('gps.configDialog.useForSampleRecording')}</span>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className={`flex items-center justify-between p-4 border-t ${borderClass} gap-3`}>
          <div className="flex gap-2">
            {device && onDelete && (
              <button
                onClick={handleDelete}
                className="touch-target px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <Trash2 className="w-5 h-5" />
                {t('common.delete')}
              </button>
            )}
            {device && (
              <button
                onClick={() => {
                  const newName = window.prompt(t('gps.configDialog.enterCloneName'), `${formData.name} (${t('gps.configDialog.copySuffix')})`);
                  if (newName) {
                    setFormData({ ...formData, id: undefined, name: newName });
                    toast.success(t('gps.configDialog.deviceCloned'));
                    haptics.trigger({ type: 'success' });
                  }
                }}
                className="touch-target px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <Copy className="w-5 h-5" />
                {t('gps.configDialog.clone')}
              </button>
            )}
          </div>
          
          <div className="flex gap-2">
            {onTest && (
              <button
                onClick={handleTest}
                disabled={isTesting}
                className="touch-target px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                {isTesting ? (
                  <>
                    <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                    {t('gps.configDialog.testing')}
                  </>
                ) : testResult === 'success' ? (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    {t('gps.configDialog.test')}
                  </>
                ) : testResult === 'error' ? (
                  <>
                    <XCircle className="w-5 h-5" />
                    {t('gps.configDialog.test')}
                  </>
                ) : (
                  <>
                    <TestTube className="w-5 h-5" />
                    {t('gps.configDialog.testConnection')}
                  </>
                )}
              </button>
            )}
            
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="touch-target px-6 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                  {t('common.saving')}
                </>
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  {t('gps.configDialog.saveDevice')}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
