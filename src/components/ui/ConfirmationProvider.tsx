import React, { useState, useCallback, useRef, createContext, useContext } from 'react';
import ConfirmationDialog, { ConfirmationData } from './ConfirmationDialog';

interface ConfirmationContextType {
  showConfirmation: (
    title: string,
    message: string,
    options?: {
      confirmText?: string;
      cancelText?: string;
      type?: 'danger' | 'warning' | 'info';
      hideCancel?: boolean;
    }
  ) => Promise<boolean>;
}

const ConfirmationContext = createContext<ConfirmationContextType | null>(null);

export const useConfirmation = () => {
  const context = useContext(ConfirmationContext);
  if (!context) {
    throw new Error('useConfirmation must be used within a ConfirmationProvider');
  }
  return context;
};

interface ConfirmationProviderProps {
  children: React.ReactNode;
}

export const ConfirmationProvider: React.FC<ConfirmationProviderProps> = ({ children }) => {
  const [confirmation, setConfirmation] = useState<ConfirmationData | null>(null);
  const idCounterRef = useRef(0);

  const showConfirmation = useCallback((
    title: string,
    message: string,
    options: {
      confirmText?: string;
      cancelText?: string;
      type?: 'danger' | 'warning' | 'info';
      hideCancel?: boolean;
    } = {}
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      const id = `confirmation-${idCounterRef.current++}`;
      
      const confirmationData: ConfirmationData = {
        id,
        title,
        message,
        confirmText: options.confirmText,
        cancelText: options.cancelText,
        type: options.type || 'info',
        hideCancel: options.hideCancel,
        onConfirm: () => {
          setConfirmation(null);
          resolve(true);
        },
        onCancel: () => {
          setConfirmation(null);
          resolve(false);
        }
      };

      setConfirmation(confirmationData);
    });
  }, []);

  const contextValue: ConfirmationContextType = {
    showConfirmation
  };

  return (
    <ConfirmationContext.Provider value={contextValue}>
      {children}
      {confirmation && <ConfirmationDialog confirmation={confirmation} />}
    </ConfirmationContext.Provider>
  );
};