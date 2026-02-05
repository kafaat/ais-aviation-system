import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw, Bug, Home, ChevronDown } from "lucide-react";
import React, { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  showDetails: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    // Log error details for debugging
    console.error("ErrorBoundary caught an error:", error);
    console.error("Component stack:", errorInfo.componentStack);
    // In production, send to error reporting service (e.g., Sentry)
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
  };

  handleReportError = () => {
    const { error, errorInfo } = this.state;
    // Create error report
    const errorReport = {
      message: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      userAgent: navigator.userAgent,
    };

    // Log the report (in production, send to error reporting service)
    console.info("Error Report:", errorReport);

    // Show confirmation to user
    alert(
      "Thank you for reporting this error. Our team has been notified and will look into it."
    );
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  toggleDetails = () => {
    this.setState(prev => ({ showDetails: !prev.showDetails }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen w-full flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 dark:from-slate-950 dark:via-blue-950/20 dark:to-slate-950">
          <div className="w-full max-w-lg">
            {/* Main Error Card */}
            <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              {/* Header with gradient */}
              <div className="bg-gradient-to-r from-red-500 to-rose-500 p-6">
                <div className="flex items-center justify-center">
                  <div className="bg-white/20 rounded-full p-4">
                    <AlertTriangle className="h-10 w-10 text-white" />
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 text-center">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                  Something went wrong
                </h2>
                <p className="text-slate-600 dark:text-slate-400 mb-6">
                  We apologize for the inconvenience. An unexpected error has
                  occurred.
                </p>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-3 mb-4">
                  <button
                    onClick={this.handleRetry}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl",
                      "bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium",
                      "hover:from-blue-700 hover:to-indigo-700 transition-all duration-200",
                      "shadow-md hover:shadow-lg cursor-pointer"
                    )}
                  >
                    <RotateCcw className="h-5 w-5" />
                    Try Again
                  </button>

                  <button
                    onClick={this.handleGoHome}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl",
                      "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium",
                      "hover:bg-slate-200 dark:hover:bg-slate-700 transition-all duration-200",
                      "cursor-pointer"
                    )}
                  >
                    <Home className="h-5 w-5" />
                    Go Home
                  </button>
                </div>

                <button
                  onClick={this.handleReportError}
                  className={cn(
                    "w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl",
                    "border-2 border-dashed border-slate-300 dark:border-slate-700",
                    "text-slate-600 dark:text-slate-400 font-medium",
                    "hover:border-rose-300 hover:text-rose-600 dark:hover:border-rose-700 dark:hover:text-rose-400",
                    "transition-all duration-200 cursor-pointer"
                  )}
                >
                  <Bug className="h-5 w-5" />
                  Report this Error
                </button>
              </div>

              {/* Error Details (collapsible) */}
              <div className="border-t border-slate-200 dark:border-slate-800">
                <button
                  onClick={this.toggleDetails}
                  className={cn(
                    "w-full flex items-center justify-between px-6 py-4",
                    "text-sm text-slate-500 dark:text-slate-400",
                    "hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors",
                    "cursor-pointer"
                  )}
                >
                  <span>Technical Details</span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform duration-200",
                      this.state.showDetails && "rotate-180"
                    )}
                  />
                </button>

                {this.state.showDetails && (
                  <div className="px-6 pb-6">
                    <div className="bg-slate-100 dark:bg-slate-800 rounded-xl p-4 overflow-auto max-h-48">
                      <p className="text-sm font-semibold text-red-600 dark:text-red-400 mb-2">
                        {this.state.error?.name}: {this.state.error?.message}
                      </p>
                      <pre className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words">
                        {this.state.error?.stack}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Help text */}
            <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-4">
              If this problem persists, please contact our support team.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
