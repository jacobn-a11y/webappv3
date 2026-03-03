interface AdminErrorStateProps {
  message: string;
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
  guidance?: string;
}

export function isPermissionError(message: string): boolean {
  const value = message.toLowerCase();
  return (
    value.includes("permission") ||
    value.includes("denied") ||
    value.includes("forbidden") ||
    value.includes("unauthorized")
  );
}

export function AdminErrorState({
  message,
  title = "Request Failed",
  onRetry,
  retryLabel = "Retry",
  guidance,
}: AdminErrorStateProps) {
  return (
    <section className="admin-error-state" role="alert">
      <h3 className="admin-error-state__title">{title}</h3>
      <p className="admin-error-state__message">{message}</p>
      <p className="admin-error-state__guidance">
        {guidance ??
          (isPermissionError(message)
            ? "You do not have access to perform this action. Contact an organization owner or admin."
            : "Retry the request. If the issue persists, verify the service health and API configuration.")}
      </p>
      {onRetry && (
        <button
          type="button"
          className="btn btn--secondary btn--sm admin-error-state__retry"
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      )}
    </section>
  );
}
