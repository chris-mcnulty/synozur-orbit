import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * App-wide error boundary. Without this, any render-time exception unmounts the
 * whole React tree, leaving the (dark-themed) page body showing — a "black
 * screen" with no way to recover. This catches the error, logs it so the real
 * cause is visible in the console/production logs, and shows a recoverable UI.
 *
 * Importantly, hitting this boundary does NOT mean data was lost: anything
 * already saved on the server is unaffected. Reloading re-fetches it.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Caught a render error:", error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground"
        data-testid="error-boundary"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold" data-testid="text-error-title">
            Something went wrong
          </h1>
          <p className="max-w-md text-sm text-muted-foreground">
            This page hit an unexpected error. Your work is safe — anything already
            saved is still there. Reloading usually fixes it.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={this.handleReload} data-testid="button-reload">
            <RefreshCw className="mr-2 h-4 w-4" />
            Reload page
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              window.location.href = "/app";
            }}
            data-testid="button-go-home"
          >
            Go to dashboard
          </Button>
        </div>
        {error.message && (
          <details className="mt-2 max-w-md text-left">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Error details
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs text-muted-foreground">
              {error.message}
            </pre>
          </details>
        )}
      </div>
    );
  }
}
