import { useState } from 'react';
import { Upload, X, FileText, CheckCircle } from 'lucide-react';
import Button from '../ui/Button';
import { useDarkMode } from '../../hooks/useDarkMode';
import { useLanguage } from '../../hooks/useLanguage';
import toast from 'react-hot-toast';
import { gpsAPI } from '../../services/api';

interface ShapefileImporterProps {
  projectId: number;
  onSuccess?: () => void;
  onCancel?: () => void;
}

interface FileStatus {
  shp: File | null;
  shx: File | null;
  dbf: File | null;
  prj: File | null;
  cpg: File | null;
}

export default function ShapefileImporter({
  projectId,
  onSuccess,
  onCancel,
}: ShapefileImporterProps) {
  const [isDarkMode] = useDarkMode();
  const { t } = useLanguage();
  const [files, setFiles] = useState<FileStatus>({
    shp: null,
    shx: null,
    dbf: null,
    prj: null,
    cpg: null,
  });
  const [name, setName] = useState('');
  const [color, setColor] = useState('#00FF00');
  const [uploading, setUploading] = useState(false);

  const handleFileChange = (type: keyof FileStatus, file: File | null) => {
    setFiles((prev) => ({ ...prev, [type]: file }));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files);

    droppedFiles.forEach((file) => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext && ['shp', 'shx', 'dbf', 'prj', 'cpg'].includes(ext)) {
        handleFileChange(ext as keyof FileStatus, file);
      }
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const isValid = files.shp && files.shx && files.dbf && name.trim();

  const handleUpload = async () => {
    if (!isValid) {
      toast.error(t('gps.requiredFilesError') || 'Please provide required files (.shp, .shx, .dbf) and a name');
      return;
    }

    setUploading(true);
    try {
      await gpsAPI.uploadShapefile(
        projectId,
        files.shp!,
        files.shx!,
        files.dbf!,
        files.prj,
        files.cpg,
        name,
        color
      );

      toast.success(t('gps.shapefileImportSuccess') || 'Shapefile imported successfully!');
      onSuccess?.();
    } catch (error: any) {
      console.error('Error uploading shapefile:', error);
      // Handle error response properly - convert object to string if needed
      let errorMsg = t('gps.shapefileImportError') || 'Failed to import shapefile';
      if (error.response?.data?.detail) {
        errorMsg = typeof error.response.data.detail === 'string' 
          ? error.response.data.detail 
          : JSON.stringify(error.response.data.detail);
      } else if (error.message) {
        errorMsg = error.message;
      }
      toast.error(errorMsg);
    } finally {
      setUploading(false);
    }
  };

  const FileInput = ({
    type,
    required = false,
  }: {
    type: keyof FileStatus;
    required?: boolean;
  }) => {
    const file = files[type];
    const accept = `.${type}`;

    return (
      <div className="flex items-center gap-3">
        <label
          className={`
            flex-1 flex items-center gap-3 p-4 rounded-xl border-2 border-dashed cursor-pointer
            transition-all active:scale-[0.98] touch-manipulation
            ${
              file
                ? isDarkMode
                  ? 'border-green-500 bg-green-500/10'
                  : 'border-green-500 bg-green-50'
                : isDarkMode
                ? 'border-gray-600 hover:border-gray-500 bg-gray-800/50'
                : 'border-gray-300 hover:border-gray-400 bg-gray-50'
            }
          `}
        >
          <input
            type="file"
            accept={accept}
            onChange={(e) => {
              const selectedFile = e.target.files?.[0] || null;
              handleFileChange(type, selectedFile);
            }}
            className="hidden"
          />
          {file ? (
            <>
              <CheckCircle className="w-6 h-6 text-green-500 dark:text-green-400 flex-shrink-0" />
              <span
                className={`flex-1 text-base font-medium truncate ${
                  isDarkMode ? 'text-gray-200' : 'text-gray-700'
                }`}
              >
                {file.name}
              </span>
            </>
          ) : (
            <>
              <FileText
                className={`w-6 h-6 ${
                  isDarkMode ? 'text-gray-400' : 'text-gray-500'
                } flex-shrink-0`}
              />
              <div className="flex flex-col flex-1 min-w-0">
                <span
                  className={`text-base font-medium ${
                    isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}
                >
                  Select .{type.toUpperCase()} file {required && '*'}
                </span>
                <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  Tap to browse
                </span>
              </div>
            </>
          )}
        </label>
        {file && (
          <button
            onClick={() => handleFileChange(type, null)}
            className={`
              p-3 rounded-xl transition-colors
              ${
                isDarkMode
                  ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200'
                  : 'hover:bg-gray-200 text-gray-500 hover:text-gray-700'
              }
            `}
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      className={`
        p-6 rounded-xl
        ${isDarkMode ? 'bg-gray-800' : 'bg-white'}
      `}
    >
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Upload
            className={`w-6 h-6 ${
              isDarkMode ? 'text-blue-400' : 'text-blue-600'
            }`}
          />
          <h3
            className={`text-xl font-semibold ${
              isDarkMode ? 'text-white' : 'text-gray-900'
            }`}
          >
            {t('gps.importShapefile') || 'Import Shapefile'}
          </h3>
        </div>
        {onCancel && (
          <button
            onClick={onCancel}
            className={`
              p-2 rounded-lg transition-colors
              ${
                isDarkMode
                  ? 'hover:bg-gray-700 text-gray-400'
                  : 'hover:bg-gray-100 text-gray-500'
              }
            `}
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className={`
          mb-6 p-8 rounded-lg border-2 border-dashed text-center
          ${
            isDarkMode
              ? 'border-gray-600 bg-gray-900/50'
              : 'border-gray-300 bg-gray-50'
          }
        `}
      >
        <Upload
          className={`w-12 h-12 mx-auto mb-3 ${
            isDarkMode ? 'text-gray-400' : 'text-gray-400'
          }`}
        />
        <p
          className={`text-sm mb-1 ${
            isDarkMode ? 'text-gray-300' : 'text-gray-600'
          }`}
        >
          {t('gps.dragDropFiles') || 'Drag and drop shapefile components here'}
        </p>
        <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          {t('gps.useFileInputs') || 'or use the file inputs below'}
        </p>
      </div>

      <div className="space-y-4 mb-6">
        <div>
          <label
            className={`block text-sm font-medium mb-2 ${
              isDarkMode ? 'text-gray-300' : 'text-gray-700'
            }`}
          >
            {t('gps.name') || 'Name'} *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('gps.fieldBoundaryName') || 'Field boundary name'}
            className={`
              w-full px-4 py-2 rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none
              ${
                isDarkMode
                  ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
                  : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
              }
            `}
          />
        </div>

        <div>
          <label
            className={`block text-sm font-medium mb-2 ${
              isDarkMode ? 'text-gray-300' : 'text-gray-700'
            }`}
          >
            {t('gps.color') || 'Color'}
          </label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className={`
              w-full h-10 rounded-lg cursor-pointer
              ${isDarkMode ? 'bg-gray-700' : 'bg-white'}
            `}
          />
        </div>

        <div>
          <label
            className={`block text-sm font-medium mb-2 ${
              isDarkMode ? 'text-gray-300' : 'text-gray-700'
            }`}
          >
            {t('gps.requiredFiles') || 'Required Files'}
          </label>
          <div className="space-y-2">
            <FileInput type="shp" required />
            <FileInput type="shx" required />
            <FileInput type="dbf" required />
          </div>
        </div>

        <div>
          <label
            className={`block text-sm font-medium mb-2 ${
              isDarkMode ? 'text-gray-300' : 'text-gray-700'
            }`}
          >
            {t('gps.optionalFiles') || 'Optional Files'}
          </label>
          <div className="space-y-2">
            <FileInput type="prj" />
            <FileInput type="cpg" />
          </div>
        </div>
      </div>

      <div
        className={`
          p-4 rounded-lg mb-6
          ${isDarkMode ? 'bg-blue-500/10' : 'bg-blue-50'}
        `}
      >
        <p
          className={`text-sm ${
            isDarkMode ? 'text-blue-300' : 'text-blue-700'
          }`}
        >
          <strong>{t('gps.tip') || 'Tip'}:</strong> {t('gps.shapefileTip') || 'All five files (.shp, .shx, .dbf, .prj, .cpg) should have the same base filename. The .prj file contains coordinate system information.'}
        </p>
      </div>

      <div className="flex gap-3">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} className="flex-1">
            {t('gps.cancel') || 'Cancel'}
          </Button>
        )}
        <Button
          variant="primary"
          onClick={handleUpload}
          disabled={!isValid || uploading}
          className="flex-1"
        >
          {uploading ? (t('gps.uploading') || 'Uploading...') : (t('gps.importShapefile') || 'Import Shapefile')}
        </Button>
      </div>
    </div>
  );
}
