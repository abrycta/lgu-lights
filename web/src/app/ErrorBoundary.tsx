import { T } from "@abrycta/akari/react";
import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  /** The error goes to the console only; visitors see the plain message below. */
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-xl p-8 text-sm">
        <p className="font-medium">
          <T en="The data could not be loaded." ja="データを読み込めませんでした。" />
        </p>
        <button type="button" className="mt-4 underline underline-offset-4" onClick={() => location.reload()}>
          <T en="Reload" ja="再読み込み" />
        </button>
      </div>
    );
  }
}
