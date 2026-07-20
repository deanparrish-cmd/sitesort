import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  children: ReactNode;
  /** When this value changes (e.g. route path), the boundary resets so navigation recovers from a crash. */
  resetKey?: string;
};

type State = { error: Error | null };

// A stale bundle (open in a tab across a deploy) fails to fetch a lazy
// route's chunk by its now-replaced hashed filename — see App.tsx's
// lazyWithRetry, which already auto-reloads once for this. This is a
// second line of defense for any throw that gets here anyway (e.g. a
// route that isn't lazy-loaded, or the reload flag already having been
// spent this session): "Try again" can't fix a broken module reference by
// clearing component state, so detect the shape and force a hard reload
// instead of re-rendering the same crashed tree.
function isChunkLoadError(error: Error): boolean {
  const msg = error.message || "";
  return /Failed to fetch dynamically imported module|Loading chunk|Failed to load module script|error loading dynamically imported module/i.test(msg);
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  handleRetry = () => {
    if (this.state.error && isChunkLoadError(this.state.error)) {
      window.location.reload();
      return;
    }
    this.setState({ error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen w-full flex items-center justify-center bg-background p-6">
          <div className="max-w-md w-full text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-destructive" />
            </div>
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              This part of SiteSort hit an unexpected problem. Your data is safe — try again, or reload the page.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" onClick={this.handleRetry}>Try again</Button>
              <Button onClick={this.handleReload}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Reload page
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
