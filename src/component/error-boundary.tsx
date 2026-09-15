import { Component, type ErrorInfo, type ReactNode } from "react";

import { createLogger } from "@/lib/logger";

const logger = createLogger("ErrorBoundary");

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error("caught render error", { error, componentStack: info.componentStack });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-background p-8 text-center">
          <p className="text-muted-foreground">エラーが発生しました</p>
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            onClick={() => {
              // 同じ URL を再読み込みして状態を作り直す（SPA フォールバックで index.html が返る）。
              window.location.reload();
            }}
          >
            再読み込み
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
