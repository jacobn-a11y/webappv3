import { MERGE_BASE_URL, PAGE_SIZE, type MergePaginatedResponse } from "./merge-api-types.js";
import { MergeApiError } from "./merge-api-error.js";

export class MergeHttpClient {
  constructor(private readonly apiKey: string) {}

  async paginate<T>(
    path: string,
    accountToken: string,
    modifiedAfter: string | undefined,
    handler: (item: T) => Promise<void>
  ): Promise<void> {
    let cursor: string | null = null;

    do {
      const params: Record<string, string> = {
        page_size: String(PAGE_SIZE),
      };
      if (cursor) params.cursor = cursor;
      if (modifiedAfter) params.modified_after = modifiedAfter;

      const page = await this.get<MergePaginatedResponse<T>>(path, params, accountToken);
      for (const item of page.results) {
        await handler(item);
      }
      cursor = page.next;
    } while (cursor);
  }

  async get<T>(
    path: string,
    params: Record<string, string> = {},
    accountToken?: string
  ): Promise<T> {
    return this.withRetry(async () => {
      const url = new URL(`${MERGE_BASE_URL}${path}`);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      };
      if (accountToken) {
        headers["X-Account-Token"] = accountToken;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(url.toString(), {
          method: "GET",
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const body = await response.text();
          throw new MergeApiError(
            `Merge API GET ${path} failed: ${response.status} ${response.statusText}`,
            response.status,
            body
          );
        }

        return response.json() as Promise<T>;
      } catch (err) {
        clearTimeout(timeout);
        if (err instanceof Error && err.name === "AbortError") {
          throw new MergeApiError(`Merge API GET ${path} timed out after 30s`, 408, "");
        }
        throw err;
      }
    });
  }

  async post<T>(
    path: string,
    body: Record<string, unknown>,
    accountToken?: string
  ): Promise<T> {
    return this.withRetry(async () => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      };
      if (accountToken) {
        headers["X-Account-Token"] = accountToken;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(`${MERGE_BASE_URL}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const respBody = await response.text();
          throw new MergeApiError(
            `Merge API POST ${path} failed: ${response.status} ${response.statusText}`,
            response.status,
            respBody
          );
        }

        return response.json() as Promise<T>;
      } catch (err) {
        clearTimeout(timeout);
        if (err instanceof Error && err.name === "AbortError") {
          throw new MergeApiError(`Merge API POST ${path} timed out after 30s`, 408, "");
        }
        throw err;
      }
    });
  }

  private async withRetry<T>(operation: () => Promise<T>, retries = 3): Promise<T> {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await operation();
      } catch (err) {
        const isRetryable =
          err instanceof MergeApiError && (err.statusCode >= 500 || err.statusCode === 429);
        if (!isRetryable || attempt === retries - 1) {
          throw err;
        }
        const delay = Math.min(1000 * 2 ** attempt, 10_000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error("Retry exhausted");
  }
}
