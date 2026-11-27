import React from 'react';
import {
  AlertOctagon,
  Check,
  Copy,
  RefreshCw,
  RotateCcw,
  Terminal,
  X,
} from 'lucide-react';
import {
  clearLastJsonParseFailure,
  getLastJsonParseFailure,
  isJsonParseError,
  JsonParseNetworkError,
  subscribeJsonParseFailures,
  type JsonParseFailureDetail,
} from '../utils/apiService';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasJsonError: boolean;
  isRenderCrash: boolean;
  failure: JsonParseFailureDetail | null;
  copied: boolean;
}

/**
 * Standardized Error Boundary specifically for JSON parsing failures.
 *
 * Catches BOTH:
 * 1. Synchronous React tree `SyntaxError` / `JsonParseNetworkError` crashes.
 * 2. Asynchronous network-layer JSON parsing failures intercepted by `apiService`
 *    or `installFetchInterceptor()` (including unhandled promise rejections),
 *    displaying the exact offending URL, HTTP status, raw Content-Type, and body preview.
 */
export class JsonParseErrorBoundary extends React.Component<Props, State> {
  private unsubscribeFailure: (() => void) | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasJsonError: false,
      isRenderCrash: false,
      failure: null,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> | null {
    if (!isJsonParseError(error)) {
      // Let outer general ErrorBoundary handle non-JSON runtime crashes
      throw error;
    }

    if (error instanceof JsonParseNetworkError) {
      return {
        hasJsonError: true,
        isRenderCrash: true,
        failure: error.detail,
      };
    }

    const recent = getLastJsonParseFailure();
    return {
      hasJsonError: true,
      isRenderCrash: true,
      failure: recent || {
        url: typeof window !== 'undefined' ? window.location.href : 'unknown',
        method: 'UNKNOWN',
        status: 0,
        contentType: 'unknown',
        rawBodyPreview: '',
        parseError: error.message || 'Invalid JSON syntax encountered during rendering.',
        timestamp: new Date().toISOString(),
        source: 'jsonParse',
      },
    };
  }

  componentDidCatch(error: Error) {
    if (isJsonParseError(error)) {
      console.error('[JsonParseErrorBoundary] Caught JSON parsing crash in render tree:', error);
    }
  }

  componentDidMount() {
    this.unsubscribeFailure = subscribeJsonParseFailures((detail) => {
      this.setState({
        hasJsonError: true,
        isRenderCrash: false,
        failure: detail,
        copied: false,
      });
    });

    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  componentWillUnmount() {
    if (this.unsubscribeFailure) {
      this.unsubscribeFailure();
      this.unsubscribeFailure = null;
    }
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  private handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    if (!isJsonParseError(reason)) return;

    event.preventDefault();
    const detail: JsonParseFailureDetail =
      reason instanceof JsonParseNetworkError
        ? reason.detail
        : getLastJsonParseFailure() || {
            url: typeof window !== 'undefined' ? window.location.href : 'unknown',
            method: 'ASYNC',
            status: 0,
            contentType: 'unknown',
            rawBodyPreview: '',
            parseError: reason instanceof Error ? reason.message : String(reason),
            timestamp: new Date().toISOString(),
            source: 'jsonParse',
          };

    this.setState({
      hasJsonError: true,
      isRenderCrash: false,
      failure: detail,
      copied: false,
    });
  };

  private handleDismiss = () => {
    clearLastJsonParseFailure();
    this.setState({
      hasJsonError: false,
      isRenderCrash: false,
      failure: null,
      copied: false,
    });
  };

  private handleCopyDiagnostics = () => {
    if (!this.state.failure) return;
    const report = JSON.stringify(this.state.failure, null, 2);
    void navigator.clipboard.writeText(report);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2500);
  };

  private renderDiagnosticCard(failure: JsonParseFailureDetail, isBlocking: boolean) {
    return (
      <div className="max-w-2xl w-full bg-white border border-red-200 rounded-xl shadow-lg overflow-hidden">
        <div className="bg-red-50 border-b border-red-200 px-5 py-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <AlertOctagon className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-slate-900">
                Network JSON Parsing Failure Detected
              </h2>
              <p className="text-xs text-red-800 mt-0.5">
                A network request returned non-JSON or malformed JSON content. Exact network culprit
                details are captured below.
              </p>
            </div>
          </div>
          {!isBlocking && (
            <button
              type="button"
              onClick={this.handleDismiss}
              aria-label="Dismiss JSON error report"
              className="p-1 text-red-700 hover:text-red-900 hover:bg-red-100 rounded-lg cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-5 space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg sm:col-span-2">
              <div className="text-[11px] font-semibold text-slate-500">Culprit Endpoint</div>
              <div className="font-mono text-slate-900 font-semibold mt-1 break-all">
                {failure.method} {failure.url}
              </div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="text-[11px] font-semibold text-slate-500">HTTP Status</div>
              <div
                className={`font-mono font-bold text-sm mt-1 ${
                  failure.status >= 400 || failure.status === 0
                    ? 'text-red-600'
                    : 'text-amber-700'
                }`}
              >
                {failure.status || 'Network Error'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="text-[11px] font-semibold text-slate-500">Raw Content-Type</div>
              <div className="font-mono text-slate-900 mt-1 break-all">
                {failure.contentType || '(none)'}
              </div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="text-[11px] font-semibold text-slate-500">Parse Error</div>
              <div className="font-mono text-red-700 mt-1 break-words">{failure.parseError}</div>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 mb-1.5">
              <Terminal className="w-3.5 h-3.5" />
              <span>Raw Server Response Preview</span>
            </div>
            <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] leading-relaxed overflow-auto max-h-44 whitespace-pre-wrap break-all">
              {failure.rawBodyPreview || '(Empty response body)'}
            </pre>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={this.handleCopyDiagnostics}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
            >
              {this.state.copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-emerald-700">Copied Report</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Diagnostic Report</span>
                </>
              )}
            </button>

            <div className="flex items-center gap-2">
              {!isBlocking && (
                <button
                  type="button"
                  onClick={this.handleDismiss}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Dismiss &amp; Continue</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white rounded-lg cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reload Portal</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  render() {
    const { hasJsonError, isRenderCrash, failure } = this.state;

    if (hasJsonError && isRenderCrash && failure) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          {this.renderDiagnosticCard(failure, true)}
        </div>
      );
    }

    return (
      <>
        {this.props.children}
        {hasJsonError && !isRenderCrash && failure && (
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Network JSON Parsing Failure"
            className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4"
          >
            {this.renderDiagnosticCard(failure, false)}
          </div>
        )}
      </>
    );
  }
}
