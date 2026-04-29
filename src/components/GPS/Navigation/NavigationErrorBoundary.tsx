import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '../../ui/Button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  t?: (key: string, fallback?: string) => string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class NavigationErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Navigation component error:', error, errorInfo);
    
    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="flex flex-col items-center justify-center h-full p-6 bg-gray-50 dark:bg-gray-900">
          <div className="flex flex-col items-center max-w-md text-center">
            <div className="w-16 h-16 mb-4 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
            </div>
            
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              {this.props.t?.('navigation.errorBoundary.title') || 'Navigation Error'}
            </h3>
            
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              {this.props.t?.('navigation.errorBoundary.description') || 'Something went wrong with the navigation system. This could be due to map loading issues or route calculation problems.'}
            </p>

            {this.state.error && (
              <details className="mb-4 w-full">
                <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                  {this.props.t?.('navigation.errorBoundary.technicalDetails') || 'Technical details'}
                </summary>
                <pre className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs text-left overflow-auto max-h-32">
                  {this.state.error.message}
                </pre>
              </details>
            )}
            
            <Button
              onClick={this.handleRetry}
              variant="primary"
              icon={<RefreshCw className="w-4 h-4" />}
            >
              {this.props.t?.('navigation.errorBoundary.tryAgain') || 'Try Again'}
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Wrapper component to provide translation function
const NavigationErrorBoundaryWithTranslation = ({ children, ...props }: Omit<Props, 't'>) => {
  const { t } = useTranslation();
  return (
    <NavigationErrorBoundary t={t} {...props}>
      {children}
    </NavigationErrorBoundary>
  );
};

export default NavigationErrorBoundaryWithTranslation;