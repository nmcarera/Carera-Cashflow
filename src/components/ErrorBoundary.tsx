"use client";

/**
 * Global UI error boundary (build brief §13). Catches rendering errors that
 * escape a page/component and shows a calm, specific message instead of a
 * blank screen or a raw stack trace. Component-level boundaries can wrap
 * individual widgets (e.g. a single chart) so one broken chart doesn't take
 * down the whole dashboard — see src/components/WidgetErrorBoundary.tsx.
 */
import React from "react";

interface Props {
  children: React.ReactNode;
  fallbackTitle?: string;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
     
    console.error("[UI error boundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="max-w-2xl mx-auto mt-16 p-6 rounded-xl border border-border bg-surface">
          <h1 className="text-lg font-semibold mb-2">
            {this.props.fallbackTitle ?? "Something on this page didn't render correctly"}
          </h1>
          <p className="text-sm text-muted mb-4">
            Your data has not been changed. This is a display problem, not a data-loss problem.
            Reloading the page usually resolves it; if it keeps happening, check the diagnostics
            page for the underlying error.
          </p>
          <p className="text-xs text-muted-2 font-mono break-all">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
