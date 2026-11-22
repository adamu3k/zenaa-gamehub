/** "Install app" support: manifest switching, service worker, and an install button that works on every phone. */
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

/** Points the page at the right manifest (portal vs staff) and registers the service worker. */
export function setupPwa(kind: 'portal' | 'staff') {
  const href = kind === 'portal' ? '/portal.webmanifest' : '/app.webmanifest';
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* not critical */
    });
  }
}

export const isStandalone = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Install button: uses the browser's install prompt where available (Android Chrome, Edge, desktop Chrome on
 * HTTPS); otherwise shows the steps (iPhone: Share → Add to Home Screen; Android over plain http: ⋮ → Add to Home screen).
 */
export function InstallButton({ compact, label = 'Install app' }: { compact?: boolean; label?: string }) {
  const [, force] = useState(0);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  if (isStandalone()) return null;
  const click = async () => {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice.catch(() => null);
      deferred = null;
      force((n) => n + 1);
    } else setHelp(true);
  };
  return (
    <>
      <button type="button" className={`btn ${compact ? 'btn-sm' : 'btn-primary'} install-btn`} onClick={click}>
        <Download size={compact ? 14 : 16} /> {label}
      </button>
      {help && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setHelp(false)}>
          <div className="modal sheet" role="dialog" aria-modal="true">
            <div className="modal-head">
              <h2>Add to your home screen</h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setHelp(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              {isIos() ? (
                <ol className="install-steps">
                  <li>
                    Open this page in <strong>Safari</strong>.
                  </li>
                  <li>
                    Tap the <Share size={15} /> <strong>Share</strong> button at the bottom.
                  </li>
                  <li>
                    Choose <SquarePlus size={15} /> <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
                  </li>
                </ol>
              ) : (
                <ol className="install-steps">
                  <li>
                    Open the browser menu <strong>⋮</strong> (top right in Chrome).
                  </li>
                  <li>
                    Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                  </li>
                  <li>Confirm — the app icon appears on your home screen and opens full screen.</li>
                </ol>
              )}
              {!window.isSecureContext && (
                <div className="hint">This address is not https, so your phone adds a shortcut instead of a full app. Ask the centre for the https link for the best experience.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
