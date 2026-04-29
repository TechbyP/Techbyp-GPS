import React, { useEffect } from 'react';
import { Check, X, AlertTriangle, Info } from 'lucide-react';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface NotificationData {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number;
}

interface NotificationProps {
  notification: NotificationData;
  onRemove: (id: string) => void;
}

const Notification: React.FC<NotificationProps> = ({ notification, onRemove }) => {
  useEffect(() => {
    if (notification.duration !== 0) {
      const timer = setTimeout(() => {
        onRemove(notification.id);
      }, notification.duration || 4000);

      return () => clearTimeout(timer);
    }
  }, [notification.id, notification.duration, onRemove]);

  const getIcon = () => {
    switch (notification.type) {
      case 'success':
        return <Check className="w-5 h-5 text-green-400" />;
      case 'error':
        return <X className="w-5 h-5 text-red-400" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
      case 'info':
        return <Info className="w-5 h-5 text-blue-400" />;
    }
  };

  const getColors = () => {
    switch (notification.type) {
      case 'success':
        return 'bg-green-900/20 border-green-500/30 text-green-100';
      case 'error':
        return 'bg-red-900/20 border-red-500/30 text-red-100';
      case 'warning':
        return 'bg-yellow-900/20 border-yellow-500/30 text-yellow-100';
      case 'info':
        return 'bg-blue-900/20 border-blue-500/30 text-blue-100';
    }
  };

  return (
    <div 
      className={`
        flex items-center justify-center gap-3 p-4 rounded-2xl border backdrop-blur-xl shadow-lg
        transform transition-all duration-300 ease-in-out
        hover:scale-105 cursor-pointer
        ${getColors()}
      `}
      onClick={() => onRemove(notification.id)}
    >
      <div className="flex-shrink-0">
        {getIcon()}
      </div>
      <div className="flex-1 text-center">
        <h4 className="text-sm font-semibold">
          {notification.title}
        </h4>
        {notification.message && (
          <p className="text-xs opacity-90 mt-1">
            {notification.message}
          </p>
        )}
      </div>
    </div>
  );
};

export default Notification;