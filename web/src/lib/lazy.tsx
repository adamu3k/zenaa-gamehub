/**
 * Page loading that never leaves a black screen:
 *  - pages are downloaded only when opened (smaller first load, faster start on phones);
 *  - if a page file fails to download (Wi-Fi blip, or the app was just updated), it retries, then reloads once;
 *  - if a page crashes while drawing, a friendly box offers "Try again" instead of a blank screen.
 */
import { Component, lazy, type ComponentType, type ReactNode, Suspense } from 'react';

const RELOADED = 'zenaa.chunk-reload';

/** React.lazy for a named export, with retries and one automatic page reload on a stale build. */
export function page<T>(load: () => Promise<T>, name: keyof T) {
  return lazy(async () => {
    for (let i = 0; ; i++) {
      try {
        const m = await load();
        try {
          sessionStorage.removeItem(RELOADED);
        } catch {
          /* private mode */
        }
        return { default: m[name] as unknown as ComponentType<any> };
      } catch (e) {
        if (i < 2) {
          await new Promise((r) => setTimeout(r, 600 * (i + 1)));
          continue;
        }
        // Probably a new version was installed: reload once to get the new file list.
        let done = false;
        try {
          done = sessionStorage.getItem(RELOADED) === '1';
          sessionStorage.setItem(RELOADED, '1');
        } catch {
          /* ignore */
        }
        if (!done) window.location.reload();
        throw e;
      }
    }
  });
}

/** Spinner shown while a page downloads. */
export function PageLoading() {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="spinner" />
      <span>Loading…</span>
    </div>
  );
}

interface BoundaryState {
  error: Error | null;
}
/** Catches a crash in one page so the rest of the app keeps working. */
export class PageBoundary extends Component<{ children: ReactNode; resetKey?: string }, BoundaryState> {
  state: BoundaryState = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('Page crashed:', error);
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card card-pad" style={{ maxWidth: 560, margin: '40px auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>This page did not open properly</h2>
        <p className="muted">It is usually a slow or dropped connection. Your data is safe.</p>
        <code className="dim" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {String(this.state.error.message || this.state.error).slice(0, 300)}
        </code>
        <div className="toolbar">
          <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button className="btn" onClick={() => window.location.reload()}>
            Reload the app
          </button>
        </div>
      </div>
    );
  }
}

/** Boundary + Suspense around a page. */
export function PageFrame({ children, resetKey }: { children: ReactNode; resetKey?: string }) {
  return (
    <PageBoundary resetKey={resetKey}>
      <Suspense fallback={<PageLoading />}>{children}</Suspense>
    </PageBoundary>
  );
}
