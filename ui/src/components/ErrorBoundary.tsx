// Copyright GraphCaster. All Rights Reserved.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { track } from "../telemetry";

type Props = {
  children: ReactNode;
  onReset?: () => void;
  fallbackTitle?: string;
};

type State = {
  error: Error | null;
};

class ErrorBoundaryInner extends Component<Props & { t: (key: string) => string }, State> {
  constructor(props: Props & { t: (key: string) => string }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught error:", error, info);
    try {
      track({ type: "page.viewed", route: "__error__" });
    } catch {
      /* ignore */
    }
  }

  handleReset = (): void => {
    this.setState({ error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  handleReload = (): void => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render(): ReactNode {
    const { error } = this.state;
    const { children, onReset, fallbackTitle, t } = this.props;

    if (error === null) {
      return children;
    }

    const title = fallbackTitle ?? t("errorBoundary.title");

    return (
      <div className="gc-error-boundary" role="alert">
        <div className="gc-error-boundary-card">
          <h2 className="gc-error-boundary-title">{title}</h2>
          <details className="gc-error-boundary-details">
            <summary>{t("errorBoundary.detailsSummary")}</summary>
            <pre className="gc-error-boundary-message">{error.message}</pre>
          </details>
          <div className="gc-error-boundary-actions">
            {onReset ? (
              <button type="button" className="gc-error-boundary-btn" onClick={this.handleReset}>
                {t("errorBoundary.tryAgain")}
              </button>
            ) : null}
            <button type="button" className="gc-error-boundary-btn" onClick={this.handleReload}>
              {t("errorBoundary.reload")}
            </button>
            <a className="gc-error-boundary-link" href="/">
              {t("errorBoundary.goHome")}
            </a>
          </div>
        </div>
      </div>
    );
  }
}

export function ErrorBoundary(props: Props) {
  const { t } = useTranslation();
  return <ErrorBoundaryInner {...props} t={t} />;
}
