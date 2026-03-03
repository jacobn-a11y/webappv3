import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "info";
  duration: number;
  exiting?: boolean;
}

interface ToastContextValue {
  showToast: (message: string, type?: "success" | "error" | "info", duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const DEFAULT_DURATIONS: Record<ToastItem["type"], number> = {
  success: 2800,
  error: 5000,
  info: 2800,
};

function ToastMessage({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(toast.duration);
  const startRef = useRef(Date.now());

  const startTimer = useCallback(() => {
    startRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      onDismiss(toast.id);
    }, remainingRef.current);
  }, [onDismiss, toast.id]);

  const pauseTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      remainingRef.current -= Date.now() - startRef.current;
      if (remainingRef.current < 0) remainingRef.current = 0;
    }
  }, []);

  useEffect(() => {
    startTimer();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [startTimer]);

  return (
    <div
      className={`toast toast--${toast.type}${toast.exiting ? " toast--exit" : ""}`}
      role="status"
      onMouseEnter={pauseTimer}
      onMouseLeave={startTimer}
    >
      <span className="toast__message">{toast.message}</span>
      <button
        type="button"
        className="toast__dismiss"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 200);
  }, []);

  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "info", duration?: number) => {
    const id = ++idRef.current;
    const dur = duration ?? DEFAULT_DURATIONS[type];
    setToasts((prev) => [...prev, { id, message, type, duration: dur }]);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <ToastMessage key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
