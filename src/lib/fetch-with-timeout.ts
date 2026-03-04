/**
 * Fetch with timeout for outbound API calls.
 * Prevents indefinite hangs when external services are slow or unresponsive.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

export interface FetchWithTimeoutOptions extends Omit<RequestInit, "signal"> {
  timeoutMs?: number;
}

/**
 * Performs fetch with an AbortController-based timeout.
 * Throws on timeout (AbortError) or network failure.
 */
export async function fetchWithTimeout(
  url: string | URL,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}
