import { ArrowLeft, Maximize, MousePointer2, Power } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { post } from '../lib/api';

/**
 * Remote view of a station screen (VNC), full page. Uses noVNC (served from /novnc, MPL-2.0) through ZENAA's bridge:
 * the station PC needs a VNC server (TightVNC, UltraVNC) — Android TV: droidVNC-NG. Help → 22.
 */
export function RemoteViewPage() {
  const { id } = useParams();
  const box = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<any>(null);
  const [status, setStatus] = useState('Connecting…');
  const [name, setName] = useState('');
  const [viewOnly, setViewOnly] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let rfb: any = null;
    let cancelled = false;
    (async () => {
      try {
        setStatus('Connecting…');
        const t: any = await post(`/api/stations/${id}/vnc`);
        if (cancelled) return;
        setName(t.name);
        const url = '/novnc/core/rfb.js';
        const { default: RFB } = await import(/* @vite-ignore */ url);
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        rfb = new RFB(box.current, `${proto}://${window.location.host}${t.path}`, { credentials: { password: t.password } });
        rfbRef.current = rfb;
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.viewOnly = true;
        rfb.addEventListener('connect', () => setStatus(''));
        rfb.addEventListener('disconnect', (e: any) =>
          setStatus(
            e.detail?.clean
              ? 'Disconnected.'
              : `Could not connect to ${t.host}:${t.port}. Is the VNC server running on the station computer, and is port ${t.port} allowed in its firewall?`,
          ),
        );
        rfb.addEventListener('credentialsrequired', () => {
          const pw = window.prompt('VNC password for this station');
          if (pw != null) rfb.sendCredentials({ password: pw });
        });
        rfb.addEventListener('securityfailure', (e: any) => setStatus(`Refused by the station: ${e.detail?.reason || 'wrong VNC password?'} (edit the station → Remote view)`));
      } catch (e: any) {
        setStatus(e?.message ?? String(e));
      }
    })();
    return () => {
      cancelled = true;
      try {
        rfb?.disconnect();
      } catch {
        /* already closed */
      }
    };
  }, [id, attempt]);

  const toggleControl = () => {
    const next = !viewOnly;
    setViewOnly(next);
    if (rfbRef.current) rfbRef.current.viewOnly = next;
  };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#000' }}>
      <div className="toolbar" style={{ padding: '8px 12px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <Link to="/stations" className="btn btn-sm btn-ghost">
          <ArrowLeft size={14} /> Stations
        </Link>
        <strong>{name || 'Remote view'}</strong>
        <span className="spacer" style={{ flex: 1 }} />
        <button className={`btn btn-sm ${viewOnly ? '' : 'btn-primary'}`} onClick={toggleControl} title="Off: you only watch. On: your mouse and keyboard control the station.">
          <MousePointer2 size={14} /> {viewOnly ? 'Watching only — take control' : 'Controlling — stop'}
        </button>
        <button className="btn btn-sm" onClick={() => rfbRef.current?.sendCtrlAltDel()} disabled={viewOnly}>
          Ctrl+Alt+Del
        </button>
        <button className="btn btn-sm" onClick={() => document.documentElement.requestFullscreen?.()}>
          <Maximize size={14} /> Full screen
        </button>
        {status && (
          <button className="btn btn-sm" onClick={() => setAttempt((n) => n + 1)}>
            <Power size={14} /> Reconnect
          </button>
        )}
      </div>
      {status && (
        <div className="alert alert-info" style={{ margin: 12 }}>
          {status}
        </div>
      )}
      <div ref={box} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
