/**
 * Compatibility bridge delegating `safeFetchJson` and `safeJsonParse` to the
 * centralized `apiService` wrapper in `src/utils/apiService.ts`.
 */

import {
  apiService,
  reportJsonParseFailure,
  type ApiRequestOptions,
  type ApiServiceResult,
} from '../utils/apiService';

export type SafeJsonResult<T = Record<string, unknown>> = ApiServiceResult<T>;

export async function safeFetchJson<T = Record<string, unknown>>(
  url: string,
  init?: ApiRequestOptions
): Promise<SafeJsonResult<T>> {
  return apiService.request<T>(url, init);
}

/**
 * Safely parse a JSON string (e.g., from sessionStorage/localStorage) without throwing.
 */
export function safeJsonParse<T>(raw: string | null | undefined, contextLabel: string): T | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    console.warn(`[Zacma JSON Diagnostic] Skipped non-JSON payload in ${contextLabel}`, {
      rawPreview: trimmed.slice(0, 120),
    });
    return null;
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch (err: unknown) {
    const parseErr = err instanceof Error ? err.message : String(err);
    reportJsonParseFailure({
      url: contextLabel,
      method: 'LOCAL_PARSE',
      status: 0,
      contentType: 'application/json',
      rawBodyPreview: trimmed.slice(0, 600),
      parseError: parseErr,
      timestamp: new Date().toISOString(),
      source: 'jsonParse',
    });
    return null;
  }
}
