import React from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import { useDarkMode } from '../../hooks/useDarkMode';

export interface ConfirmationData {
  id: string;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
  hideCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

interface ConfirmationDialogProps {
  confirmation: ConfirmationData;
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({ confirmation }) => {
  const [isDarkMode] = useDarkMode();

  const getIcon = () => {
    switch (confirmation.type) {
      case 'danger':
        return <AlertTriangle className="w-6 h-6 text-red-400" />;
      case 'warning':
        return <AlertTriangle className="w-6 h-6 text-yellow-400" />;
      default:
        return <AlertTriangle className="w-6 h-6 text-blue-400" />;
    }
  };

  const getConfirmButtonStyle = () => {
    switch (confirmation.type) {
      case 'danger':
        return isDarkMode
          ? 'bg-red-900/20 text-red-400 hover:bg-red-900/30 border-red-500/30'
          : 'bg-red-50 text-red-600 hover:bg-red-100 border-red-200';
      case 'warning':
        return isDarkMode
          ? 'bg-yellow-900/20 text-yellow-400 hover:bg-yellow-900/30 border-yellow-500/30'
          : 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100 border-yellow-200';
      default:
        return isDarkMode
          ? 'bg-blue-900/20 text-blue-400 hover:bg-blue-900/30 border-blue-500/30'
          : 'bg-blue-50 text-blue-600 hover:bg-blue-100 border-blue-200';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[10000]">
      <div
        className={
          `
          max-w-md w-full rounded-2xl shadow-2xl border backdrop-blur-xl
          transform transition-all duration-300 ease-out
          ${isDarkMode
            ? 'bg-gray-900/90 border-gray-700/50'
            : 'bg-white/90 border-gray-200/70'
          }
        `
        }
      >
        <div className="p-6 pb-4">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              {getIcon()}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                {confirmation.title}
              </h3>
              <p className={`text-sm leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {confirmation.message}
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 pb-6">
          <div className={`flex gap-3 ${confirmation.hideCancel ? 'justify-end' : ''}`}>
            {!confirmation.hideCancel && (
              <button
                onClick={confirmation.onCancel}
                className={
                  `
                  flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
                  transition-all duration-200 border font-medium text-sm
                  ${isDarkMode
                    ? 'bg-gray-800/50 text-gray-300 hover:bg-gray-800 border-gray-600/50'
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border-gray-200'
                  }
                `
                }
              >
                <X className="w-4 h-4" />
                {confirmation.cancelText || 'Cancel'}
              </button>
            )}
            <button
              onClick={confirmation.onConfirm}
              className={
                `
                ${confirmation.hideCancel ? 'flex-none w-full' : 'flex-1'}
                flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
                transition-all duration-200 border font-medium text-sm
                ${getConfirmButtonStyle()}
              `
              }
            >
              <Check className="w-4 h-4" />
              {confirmation.confirmText || 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
export default ConfirmationDialog;