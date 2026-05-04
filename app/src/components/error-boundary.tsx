import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[Nomi] React Error Boundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // The full stack trace is a developer aid, not a user-facing
      // signal. End users get a short message + reload button; the
      // stack only renders in dev builds where it actually helps.
      const showStack = import.meta.env.DEV;
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="max-w-lg w-full space-y-4 text-center">
            <h1 className="text-2xl font-bold text-destructive">Something went wrong</h1>
            <p className="text-muted-foreground">
              The application encountered an error. Please refresh the page.
            </p>
            {showStack && (
              <pre className="bg-muted p-4 rounded text-left text-sm overflow-auto max-h-64">
                {this.state.error?.message}
                {"\n"}
                {this.state.error?.stack}
              </pre>
            )}
            {!showStack && this.state.error?.message && (
              <p className="text-xs text-muted-foreground font-mono">
                {this.state.error.message}
              </p>
            )}
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
