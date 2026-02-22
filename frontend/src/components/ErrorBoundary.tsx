import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-state" role="alert">
          <div className="error-state__icon">
            <svg
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              stroke="#dc2626"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="24" cy="24" r="20" />
              <path d="M24 16v10M24 30v2" />
            </svg>
          </div>
          <h2 className="error-state__title">Something went wrong</h2>
          <p className="error-state__message">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <div className="error-state__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={this.handleReset}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
