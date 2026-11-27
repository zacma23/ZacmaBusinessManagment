/**
 * Safe HTTP/JSON fetch client for Zacma SaaS Portal.
 *
 * Never blindly calls `response.json()` or `JSON.parse()` on an unknown payload.
 * Always reads raw response text first, verifies Content-Type and JSON structure,
 * logs detailed diagnostics (URL, status, content-type, raw body preview, parse error)
 * whenever a request fails or returns non-JSON, and returns a structured result.
 */

export interface SafeJsonResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  contentType: string;
  isJson: boolean;
  data: T | null;
  rawText: string;
  parseError: string | null;
  /** True when the backend API route is not mounted (404/405 or HTML SPA fallback). */
  isEndpointUnavailable: boolean;
  /** Human-readable error message extracted from JSON error payload or HTTP/content diagnostic. */
  errorMessage: string | null;
}

function looksLikeHtmlDocument(text: string, contentType: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml')) {
    return true;
  }
  const trimmed = text.trimStart().slice(0, 80).toLowerCase();
  return (
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<head') ||
    trimmed.startsWith('<body') ||
    trimmed.startsWith('<?xml')
  );
}

function extractJsonErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.error === 'string' && obj.error.trim()) return obj.error.trim();
  if (obj.error && typeof obj.error === 'object') {
    const nested = obj.error as Record<string, unknown>;
    if (typeof nested.message === 'string' && nested.message.trim()) return nested.message.trim();
  }
  if (typeof obj.message === 'string' && obj.message.trim()) return obj.message.trim();
  if (typeof obj.reason === 'string' && obj.reason.trim()) return obj.reason.trim();
  return null;
}

export async function safeFetchJson<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit
): Promise<SafeJsonResult<T>> {
  const method = (init?.method || 'GET').toUpperCase();
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    console.error('[Zacma API Diagnostic] Network failure', {
      url,
      method,
      status: 0,
      contentType: '',
      rawBodyPreview: '',
      parseError: msg,
    });
    return {
      ok: false,
      status: 0,
      contentType: '',
      isJson: false,
      data: null,
      rawText: '',
      parseError: msg,
      isEndpointUnavailable: false,
      errorMessage: `Network error calling ${url}: ${msg}`,
    };
  }

  const status = response.status;
  const contentType = response.headers.get('content-type') || '';
  let rawText = '';
  try {
    rawText = await response.text();
  } catch (readErr: unknown) {
    const msg = readErr instanceof Error ? readErr.message : String(readErr);
    console.error('[Zacma API Diagnostic] Failed reading response body', {
      url,
      method,
      status,
      contentType,
      rawBodyPreview: '',
      parseError: msg,
    });
    return {
      ok: false,
      status,
      contentType,
      isJson: false,
      data: null,
      rawText: '',
      parseError: msg,
      isEndpointUnavailable: false,
      errorMessage: `Failed to read server response from ${url} (HTTP ${status}).`,
    };
  }

  const trimmed = rawText.trim();
  const isHtml = looksLikeHtmlDocument(trimmed, contentType);
  const contentTypeLooksJson =
    contentType.toLowerCase().includes('application/json') ||
    contentType.toLowerCase().includes('+json');
  const bodyLooksJson =
    trimmed.length > 0 &&
    (trimmed.startsWith('{') || trimmed.startsWith('['));

  let data: T | null = null;
  let isJson = false;
  let parseError: string | null = null;

  if (!isHtml && trimmed.length > 0 && (contentTypeLooksJson || bodyLooksJson)) {
    try {
      data = JSON.parse(trimmed) as T;
      isJson = true;
    } catch (err: unknown) {
      parseError = err instanceof Error ? err.message : String(err);
    }
  } else if (trimmed.length === 0) {
    parseError = 'Empty response body';
  } else if (isHtml) {
    parseError = `Expected JSON but received HTML (${contentType || 'text/html'})`;
  } else {
    parseError = `Expected JSON but received non-JSON content (${contentType || 'text/plain'})`;
  }

  const isEndpointUnavailable =
    !isJson && (status === 404 || status === 405 || isHtml);

  const ok = response.ok && isJson;

  if (!ok) {
    console.error('[Zacma API Diagnostic] Non-OK or invalid JSON response', {
      url,
      method,
      status,
      contentType: contentType || '(none)',
      rawBodyPreview: trimmed.slice(0, 500),
      parseError,
    });
  }

  let errorMessage: string | null = null;
  if (!ok) {
    const jsonErr = isJson ? extractJsonErrorMessage(data) : null;
    if (jsonErr) {
      errorMessage = jsonErr;
    } else if (isEndpointUnavailable) {
      errorMessage = `API endpoint ${url} is unavailable (HTTP ${status}, ${contentType || 'non-JSON'}). Please verify the backend API deployment.`;
    } else if (parseError) {
      errorMessage = `Invalid server response from ${url} (HTTP ${status}): ${parseError}`;
    } else {
      errorMessage = `Request to ${url} failed with HTTP ${status}.`;
    }
  }

  return {
    ok,
    status,
    contentType,
    isJson,
    data,
    rawText,
    parseError,
    isEndpointUnavailable,
    errorMessage,
  };
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
    console.error(`[Zacma JSON Diagnostic] Parse failed in ${contextLabel}`, {
      rawPreview: trimmed.slice(0, 200),
      parseError: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
