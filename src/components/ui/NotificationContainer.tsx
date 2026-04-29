import React, { useState, useCallback, useRef } from 'react';
import Notification, { NotificationData, NotificationType } from './Notification';

interface NotificationContainerProps {
  children: React.ReactNode;
}

let addNotificationRef: ((notification: Omit<NotificationData, 'id'>) => void) | null = null;

export const showNotification = (
  type: NotificationType,
  title: string,
  message?: string,
  duration?: number
) => {
  if (addNotificationRef) {
    addNotificationRef({
      type,
      title,
      message,
      duration,
    });
  }
};

const NotificationContainer: React.FC<NotificationContainerProps> = ({ children }) => {
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const idCounterRef = useRef(0);

  const addNotification = useCallback((notification: Omit<NotificationData, 'id'>) => {
    const id = `notification-${idCounterRef.current++}`;
    setNotifications(prev => [...prev, { ...notification, id }]);
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // Set the global reference
  addNotificationRef = addNotification;

  return (
    <>
      {children}
      
      {/* Notification Container */}
      <div className="fixed inset-0 pointer-events-none z-[9999] flex items-center justify-center p-4">
        <div className="flex flex-col gap-3 max-w-md w-full">
          {notifications.map((notification) => (
            <div key={notification.id} className="pointer-events-auto">
              <Notification
                notification={notification}
                onRemove={removeNotification}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

export default NotificationContainer;