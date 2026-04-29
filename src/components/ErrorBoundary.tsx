import React, { Component, ErrorInfo, ReactNode } from 'react';
import i18n from '../i18n';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({
      error,
      errorInfo
    });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-900 text-white p-6 overflow-auto">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold mb-4 text-red-500">{i18n.t('errorBoundary.title')}</h1>
            
            <div className="bg-gray-800 rounded-lg p-4 mb-4">
              <h2 className="text-xl font-semibold mb-2">{i18n.t('errorBoundary.errorMessage')}</h2>
              <p className="text-red-400 font-mono text-sm break-all">
                {this.state.error?.toString()}
              </p>
            </div>

            {this.state.error?.stack && (
              <div className="bg-gray-800 rounded-lg p-4 mb-4">
                <h2 className="text-xl font-semibold mb-2">{i18n.t('errorBoundary.stackTrace')}</h2>
                <pre className="text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap break-all">
                  {this.state.error.stack}
                </pre>
              </div>
            )}

            {this.state.errorInfo && (
              <div className="bg-gray-800 rounded-lg p-4 mb-4">
                <h2 className="text-xl font-semibold mb-2">{i18n.t('errorBoundary.componentStack')}</h2>
                <pre className="text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap break-all">
                  {this.state.errorInfo.componentStack}
                </pre>
              </div>
            )}

            <button
              onClick={() => {
                this.setState({ hasError: false, error: null, errorInfo: null });
                window.location.reload();
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg text-lg"
            >
              {i18n.t('errorBoundary.reloadApp')}
            </button>

            <div className="mt-6 text-sm text-gray-400">
              <p>{i18n.t('errorBoundary.ifPersists')}</p>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>{i18n.t('errorBoundary.checkInternet')}</li>
                <li>{i18n.t('errorBoundary.clearData')}</li>
                <li>{i18n.t('errorBoundary.contactSupport')}</li>
              </ul>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
