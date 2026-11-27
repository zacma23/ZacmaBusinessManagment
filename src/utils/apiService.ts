/**
 * Centralized API Service Wrapper & Automatic Fetch Interceptor.
 *
 * - Automatically intercepts browser `fetch()` requests and logs the requested URL,
 *   HTTP status code, and raw `Content-Type` header to the console BEFORE parsing.
 * - Wraps `Response.prototype.json()` on intercepted responses so no caller can
 *   blindly invoke `JSON.parse()` on HTML, plain text, or malformed payloads.
 * - Emits structured `JsonParseFailureDetail` events to `JsonParseErrorBoundary`
 *   so any JSON parsing failure immediately identifies the exact network culprit.
 */

export interface JsonParseFailureDetail {
  url: string;
  method: string;
  status: number;
  contentType: string;
  rawBodyPreview: string;
  parseError: string;
  timestamp: string;
  source: 'apiService' | 'fetchInterceptor' | 'jsonParse';
}

export class JsonParseNetworkError extends Error {
  public readonly detail: JsonParseFailureDetail;

  constructor(detail: JsonParseFailureDetail) {
    super(
      `JSON parse failure on ${detail.method} ${detail.url} (HTTP ${detail.status}, Content-Type: ${detail.contentType || 'none'}): ${detail.parseError}`
    );
    this.name = 'JsonParseNetworkError';
    this.detail = detail;
  }
}

export interface ApiRequestOptions extends RequestInit {
  /**
   * When true, non-JSON 404/405/HTML responses (e.g., optional backend probes on static hosts)
   * are still logged to the console before parsing, but won't trigger the global JSON Error Boundary.
   */
  allowStaticFallback?: boolean;
  /** Suppress emitting to the global JSON parse error boundary for this specific call. */
  silentBoundary?: boolean;
}

export interface ApiServiceResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  contentType: string;
  isJson: boolean;
  data: T | null;
  rawText: string;
  parseError: string | null;
  /** True when endpoint returned 404/405 or an HTML SPA fallback instead of JSON. */
  isEndpointUnavailable: boolean;
  /** Human-readable error extracted from JSON error payload or network/parse failure. */
  errorMessage: string | null;
  /** Populated whenever a JSON parsing or content-type mismatch failure occurs. */
  jsonParseFailure: JsonParseFailureDetail | null;
}

type JsonParseFailureListener = (detail: JsonParseFailureDetail) => void;

const failureListeners = new Set<JsonParseFailureListener>();
let lastJsonParseFailure: JsonParseFailureDetail | null = null;
let nativeFetchRef: typeof window.fetch | null = null;
let interceptorInstalled = false;

/**
 * Redact sensitive query parameters (e.g., API keys or tokens) before console logging or UI display.
 */
export function sanitizeUrlForLog(rawUrl: string): string {
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(rawUrl, base);
    for (const param of ['key', 'apiKey', 'api_key', 'token', 'access_token', 'id_token']) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '[REDACTED]');
      }
    }
    if (rawUrl.startsWith('/')) {
      return `${parsed.pathname}${parsed.search}`;
    }
    return parsed.toString();
  } catch {
    return rawUrl.replace(/([?&](?:key|apiKey|api_key|token)=)[^&]+/gi, '$1[REDACTED]');
  }
}

export function subscribeJsonParseFailures(listener: JsonParseFailureListener): () => void {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}

export function getLastJsonParseFailure(): JsonParseFailureDetail | null {
  return lastJsonParseFailure;
}

export function clearLastJsonParseFailure(): void {
  lastJsonParseFailure = null;
}

export function reportJsonParseFailure(detail: JsonParseFailureDetail): void {
  lastJsonParseFailure = detail;
  console.error('[Zacma Network JSON Culprit]', {
    url: detail.url,
    method: detail.method,
    status: detail.status,
    contentType: detail.contentType || '(none)',
    parseError: detail.parseError,
    rawBodyPreview: detail.rawBodyPreview,
    source: detail.source,
    timestamp: detail.timestamp,
  });
  for (const listener of failureListeners) {
    try {
      listener(detail);
    } catch {
      // Never let a listener error break reporting
    }
  }
}

export function isJsonParseError(err: unknown): boolean {
  if (err instanceof JsonParseNetworkError) return true;
  if (err instanceof SyntaxError) {
    const msg = err.message || '';
    return /json|unexpected (character|token|end)|line 1 column 1/i.test(msg);
  }
  if (err instanceof Error) {
    return /JSON\.parse|unexpected character at line 1|not valid JSON|JsonParseNetworkError/i.test(
      err.message
    );
  }
  return false;
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

function resolveRequestMeta(input: RequestInfo | URL, init?: RequestInit): {
  url: string;
  method: string;
} {
  let rawUrl = '';
  let method = init?.method || 'GET';
  if (typeof input === 'string') {
    rawUrl = input;
  } else if (input instanceof URL) {
    rawUrl = input.toString();
  } else if (typeof Request !== 'undefined' && input instanceof Request) {
    rawUrl = input.url;
    if (!init?.method && input.method) {
      method = input.method;
    }
  } else {
    rawUrl = String(input);
  }
  return {
    url: sanitizeUrlForLog(rawUrl),
    method: method.toUpperCase(),
  };
}

function getBaseFetch(): typeof window.fetch {
  if (nativeFetchRef) return nativeFetchRef;
  return window.fetch.bind(window);
}

function shouldLogInterceptedUrl(url: string): boolean {
  // Always log API calls and cross-origin data requests; skip Vite static asset chunks
  if (/\/api(\/|$|\?)/i.test(url)) return true;
  if (/^https?:\/\//i.test(url)) return true;
  if (/\.(js|mjs|ts|tsx|css|map|png|jpg|jpeg|webp|svg|ico|woff2?)(\?|$)/i.test(url)) {
    return false;
  }
  return true;
}

/**
 * Installs a global `window.fetch` interceptor once at application startup.
 * Every intercepted request logs URL, HTTP status code, and raw Content-Type before
 * parsing, and wraps `response.json()` so malformed/HTML responses immediately identify
 * the exact culprit in the network layer.
 */
export function installFetchInterceptor(): void {
  if (typeof window === 'undefined' || interceptorInstalled || typeof window.fetch !== 'function') {
    return;
  }

  nativeFetchRef = window.fetch.bind(window);
  interceptorInstalled = true;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { url, method } = resolveRequestMeta(input, init);
    const response = await nativeFetchRef!(input, init);
    const rawContentType = response.headers.get('content-type') || '(none)';

    if (shouldLogInterceptedUrl(url)) {
      console.info(
        `[API Fetch Intercept] ${method} ${url} | status=${response.status} | content-type=${rawContentType}`
      );
    }

    // Wrap response.json() so any caller invoking .json() directly is guarded before parsing
    const originalText = response.text.bind(response);
    const guardedJson = async (): Promise<unknown> => {
      console.info(
        `[API Pre-Parse] ${method} ${url} | status=${response.status} | content-type=${rawContentType}`
      );
      const rawText = await originalText();
      const trimmed = rawText.trim();
      const isHtml = looksLikeHtmlDocument(trimmed, rawContentType);

      if (isHtml || trimmed.length === 0) {
        const detail: JsonParseFailureDetail = {
          url,
          method,
          status: response.status,
          contentType: rawContentType,
          rawBodyPreview: trimmed.slice(0, 600),
          parseError: isHtml
            ? `Expected JSON but received HTML document (${rawContentType})`
            : 'Expected JSON but received an empty response body',
          timestamp: new Date().toISOString(),
          source: 'fetchInterceptor',
        };
        reportJsonParseFailure(detail);
        throw new JsonParseNetworkError(detail);
      }

      try {
        return JSON.parse(trimmed);
      } catch (err: unknown) {
        const parseErr = err instanceof Error ? err.message : String(err);
        const detail: JsonParseFailureDetail = {
          url,
          method,
          status: response.status,
          contentType: rawContentType,
          rawBodyPreview: trimmed.slice(0, 600),
          parseError: parseErr,
          timestamp: new Date().toISOString(),
          source: 'fetchInterceptor',
        };
        reportJsonParseFailure(detail);
        throw new JsonParseNetworkError(detail);
      }
    };

    try {
      Object.defineProperty(response, 'json', {
        value: guardedJson,
        configurable: true,
        writable: true,
      });
    } catch {
      // Fallback if Response instance is non-configurable in a constrained runtime
    }

    return response;
  };
}

/**
 * Centralized API request wrapper.
 * Logs URL, status code, and raw Content-Type to the console BEFORE parsing,
 * reads raw response text first, validates JSON structure, and reports any
 * unexpected JSON parsing failures to the standardized error boundary.
 */
async function request<T = Record<string, unknown>>(
  url: string,
  options: ApiRequestOptions = {}
): Promise<ApiServiceResult<T>> {
  const { allowStaticFallback = false, silentBoundary = false, ...fetchInit } = options;
  const method = (fetchInit.method || 'GET').toUpperCase();
  const safeUrl = sanitizeUrlForLog(url);

  let response: Response;
  try {
    response = await getBaseFetch()(url, fetchInit);
  } catch (networkErr: unknown) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    console.error('[API Service] Network failure', {
      url: safeUrl,
      method,
      status: 0,
      contentType: '(none)',
      error: msg,
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
      errorMessage: `Network error calling ${safeUrl}: ${msg}`,
      jsonParseFailure: null,
    };
  }

  const status = response.status;
  const rawContentType = response.headers.get('content-type') || '';

  // Log URL, status code, and raw content type BEFORE any parsing occurs
  console.info(
    `[API Service] ${method} ${safeUrl} | status=${status} | content-type=${rawContentType || '(none)'}`
  );

  let rawText = '';
  try {
    rawText = await response.text();
  } catch (readErr: unknown) {
    const msg = readErr instanceof Error ? readErr.message : String(readErr);
    console.error('[API Service] Failed reading raw response body', {
      url: safeUrl,
      method,
      status,
      contentType: rawContentType || '(none)',
      error: msg,
    });
    return {
      ok: false,
      status,
      contentType: rawContentType,
      isJson: false,
      data: null,
      rawText: '',
      parseError: msg,
      isEndpointUnavailable: false,
      errorMessage: `Failed to read server response from ${safeUrl} (HTTP ${status}).`,
      jsonParseFailure: null,
    };
  }

  const trimmed = rawText.trim();
  const isHtml = looksLikeHtmlDocument(trimmed, rawContentType);
  const contentTypeLooksJson =
    rawContentType.toLowerCase().includes('application/json') ||
    rawContentType.toLowerCase().includes('+json');
  const bodyLooksJson =
    trimmed.length > 0 && (trimmed.startsWith('{') || trimmed.startsWith('['));

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
    parseError = `Expected JSON but received HTML (${rawContentType || 'text/html'})`;
  } else {
    parseError = `Expected JSON but received non-JSON content (${rawContentType || 'text/plain'})`;
  }

  const isEndpointUnavailable = !isJson && (status === 404 || status === 405 || isHtml);
  const ok = response.ok && isJson;

  let jsonParseFailure: JsonParseFailureDetail | null = null;
  if (!isJson && parseError) {
    jsonParseFailure = {
      url: safeUrl,
      method,
      status,
      contentType: rawContentType || '(none)',
      rawBodyPreview: trimmed.slice(0, 600),
      parseError,
      timestamp: new Date().toISOString(),
      source: 'apiService',
    };

    const shouldNotifyBoundary =
      !silentBoundary &&
      (!allowStaticFallback || contentTypeLooksJson || status >= 500);

    if (shouldNotifyBoundary) {
      reportJsonParseFailure(jsonParseFailure);
    } else {
      console.warn('[API Service] Non-JSON fallback response detected', jsonParseFailure);
    }
  } else if (!ok) {
    console.error('[API Service] Non-OK JSON response', {
      url: safeUrl,
      method,
      status,
      contentType: rawContentType || '(none)',
      rawBodyPreview: trimmed.slice(0, 500),
    });
  }

  let errorMessage: string | null = null;
  if (!ok) {
    const jsonErr = isJson ? extractJsonErrorMessage(data) : null;
    if (jsonErr) {
      errorMessage = jsonErr;
    } else if (isEndpointUnavailable) {
      errorMessage = `API endpoint ${safeUrl} returned HTTP ${status} (${rawContentType || 'non-JSON'}) instead of JSON.`;
    } else if (parseError) {
      errorMessage = `Invalid JSON response from ${safeUrl} (HTTP ${status}): ${parseError}`;
    } else {
      errorMessage = `Request to ${safeUrl} failed with HTTP ${status}.`;
    }
  }

  return {
    ok,
    status,
    contentType: rawContentType,
    isJson,
    data,
    rawText,
    parseError,
    isEndpointUnavailable,
    errorMessage,
    jsonParseFailure,
  };
}

export const apiService = {
  request,
  get: <T = Record<string, unknown>>(url: string, options?: ApiRequestOptions) =>
    request<T>(url, { ...options, method: 'GET' }),
  post: <T = Record<string, unknown>>(
    url: string,
    body?: unknown,
    options?: ApiRequestOptions
  ) =>
    request<T>(url, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T = Record<string, unknown>>(
    url: string,
    body?: unknown,
    options?: ApiRequestOptions
  ) =>
    request<T>(url, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T = Record<string, unknown>>(
    url: string,
    body?: unknown,
    options?: ApiRequestOptions
  ) =>
    request<T>(url, {
      ...options,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  delete: <T = Record<string, unknown>>(url: string, options?: ApiRequestOptions) =>
    request<T>(url, { ...options, method: 'DELETE' }),
};
