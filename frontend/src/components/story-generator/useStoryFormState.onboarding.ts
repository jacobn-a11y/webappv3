import { useCallback, useEffect, useState } from "react";
import { ONBOARDING_KEY, markOnboardingSeen } from "./useStoryFormState.helpers";

interface UseStoryOnboardingOptions {
  flowOpenedAt: number;
  trackSellerEvent: (
    eventType: string,
    metadata?: {
      step?: string;
      story_id?: string;
      action_name?: string;
      duration_ms?: number;
      metadata?: Record<string, unknown>;
    }
  ) => void;
}

export function useStoryOnboarding({
  flowOpenedAt,
  trackSellerEvent,
}: UseStoryOnboardingOptions) {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [firstStoryShared, setFirstStoryShared] = useState(false);
  const [onboardingElapsedSeconds, setOnboardingElapsedSeconds] = useState(0);

  useEffect(() => {
    try {
      const seen = localStorage.getItem(ONBOARDING_KEY) === "1";
      setShowOnboarding(!seen);
      if (seen) {
        setFirstStoryShared(true);
      }
    } catch {
      setShowOnboarding(false);
    }
  }, []);

  useEffect(() => {
    trackSellerEvent("modal_open", {
      step: "opened",
      metadata: { onboarding_visible: true },
    });
    // Intentionally once per modal mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showOnboarding) return;
    const interval = window.setInterval(() => {
      const elapsed = Math.max(0, Math.floor((Date.now() - flowOpenedAt) / 1000));
      setOnboardingElapsedSeconds(elapsed);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [flowOpenedAt, showOnboarding]);

  const handleDismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    trackSellerEvent("library_action", {
      action_name: "dismiss_onboarding",
      step: "onboarding",
    });
    markOnboardingSeen();
  }, [trackSellerEvent]);

  const handleShareAction = useCallback(() => {
    setFirstStoryShared(true);
    setShowOnboarding(false);
    markOnboardingSeen();
  }, []);

  return {
    showOnboarding,
    firstStoryShared,
    onboardingElapsedSeconds,
    onboardingWithinTarget: onboardingElapsedSeconds <= 60,
    handleDismissOnboarding,
    handleShareAction,
  };
}
