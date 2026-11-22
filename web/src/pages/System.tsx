import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudUpload, DatabaseBackup, Download, RefreshCw, Rocket, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBox, Field, Modal, PageHeader } from '../components/ui';
import { ApiError, get, getToken, post } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDateTime } from '../lib/format';

const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

async function download(url: string, name: string) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.message ?? `Download failed (${res.status})`);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function SystemPage() {
  const { can } = useApp();
  const info = useQuery({ queryKey: ['system', 'info'], queryFn: () => get<any>('/api/system/info'), refetchInterval: 15_000 });
  return (
    <>
      <PageHeader title="Backup & updates" subtitle={`ZENAA ${info.data?.version ?? ''} — keep a copy of everything, move to a new PC, and install new versions.`} />
      {can('system.backup') && <Backups info={info.data} />}
      {can('system.update') && <Updates info={info.data} />}
    </>
  );
}

function Backups({ info }: { info: any }) {
  const { settings, toast } = useApp();
  const qc = useQueryClient();
  const files = useQuery({ queryKey: ['system', 'backups'], queryFn: () => get<any[]>('/api/system/backups') });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<{ file?: File; name?: string } | null>(null);
  const runNow = useMutation({
    mutationFn: () => post('/api/system/backups/run'),
    onSuccess: (r: any) => {
      toast('success', `Backup saved: ${r.name}`);
      qc.invalidateQueries({ queryKey: ['system'] });
    },
  });
  const last = info?.lastAutoBackup;
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <h2>
          <DatabaseBackup size={18} style={{ verticalAlign: -3 }} /> Backups
        </h2>
        <div className="toolbar">
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={async () => {
              setErr(null);
              setBusy(true);
              try {
                await download('/api/system/backup', `zenaa-backup-${new Date().toISOString().slice(0, 10)}.json.gz`);
              } catch (e) {
                setErr(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download size={14} /> {busy ? 'Preparing…' : 'Download everything (1 file)'}
          </button>
          <label className="btn btn-sm">
            <Upload size={14} /> Restore from file…
            <input type="file" accept=".gz,.json,application/gzip" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && setRestore({ file: e.target.files[0] })} />
          </label>
        </div>
      </div>
      <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          The download holds <b>everything</b>: customers, wallets, sessions, payments, shifts, tournaments, settings, staff and PINs. Keep it somewhere safe (it contains
          customer data). To move to a new computer: install ZENAA there, sign in with the first admin, then <b>Restore from file</b>.
        </div>
        <div className="alert alert-info">
          <CloudUpload size={14} style={{ verticalAlign: -2 }} /> <b>Automatic backups</b>:{' '}
          {settings.autoBackupHours ? (
            <>
              every {settings.autoBackupHours} h, keeping the last {settings.autoBackupKeep}, into <span className="mono">{info?.backupDir ?? '…'}</span> (on the server PC:
              the <span className="mono">backups</span> folder next to ZENAA).{' '}
            </>
          ) : (
            'off. '
          )}
          {last?.at && (last.error ? <span style={{ color: 'var(--danger)' }}>Last attempt failed: {last.error}. </span> : <>Last: {formatDateTime(last.at)}. </>)}
          To copy them to <b>Google Drive / OneDrive / Dropbox</b> automatically, put that folder inside your cloud-synced folder — see Help → 17.{' '}
          {settings ? <Link to="/settings#backup">Change schedule</Link> : null}
        </div>
        <ErrorBox error={err || runNow.error} />
        <div className="toolbar">
          <button className="btn btn-sm" disabled={runNow.isPending} onClick={() => runNow.mutate()}>
            Save a backup to the folder now
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Saved</th>
              <th className="right">Size</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {files.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="dim">
                  No backups in the folder yet.
                </td>
              </tr>
            )}
            {files.data?.slice(0, 40).map((f) => (
              <tr key={f.name}>
                <td className="mono" style={{ fontSize: 12 }}>
                  {f.name}
                  {f.kind === 'database' && <span className="badge" style={{ marginLeft: 6 }}>database dump</span>}
                </td>
                <td>{formatDateTime(f.at)}</td>
                <td className="right">{size(f.size)}</td>
                <td className="right" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => download(`/api/system/backups/${encodeURIComponent(f.name)}`, f.name).catch(setErr)}>
                    <Download size={14} />
                  </button>
                  {f.kind === 'zenaa' && (
                    <button className="btn btn-sm btn-ghost" onClick={() => setRestore({ name: f.name })}>
                      Restore
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {restore && <RestoreModal {...restore} onClose={() => setRestore(null)} />}
    </div>
  );
}

function RestoreModal({ file, name, onClose }: { file?: File; name?: string; onClose(): void }) {
  const { logout } = useApp();
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const url = `/api/system/restore?confirm=RESTORE${name ? `&file=${encodeURIComponent(name)}` : ''}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken() ?? ''}`, ...(file ? { 'content-type': 'application/octet-stream' } : {}) },
        body: file ?? undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data?.message ?? `Restore failed (${res.status})`);
      setDone(data);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  if (done)
    return (
      <Modal title="Restored" onClose={logout} footer={<button className="btn btn-primary" onClick={logout}>Sign in again</button>}>
        <p>
          Data restored from the backup of <b>{formatDateTime(done.restoredFrom)}</b> ({done.centerName}). Sign in again with an account from that backup.
        </p>
        {done.safetyCopy && <p className="dim">The data you replaced was saved first as {done.safetyCopy}.</p>}
      </Modal>
    );
  return (
    <Modal
      title="Restore a backup"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" disabled={typed !== 'RESTORE' || busy} onClick={go}>
            {busy ? 'Restoring…' : 'Replace all data'}
          </button>
        </>
      }
    >
      <div className="alert alert-danger">
        This <b>replaces all current data</b> with the backup <b className="mono">{file?.name ?? name}</b>. Anything recorded after that backup is removed (a safety copy of the
        current data is saved to the backup folder first). Everyone is signed out.
      </div>
      <Field label='Type RESTORE to confirm'>
        <input className="input mono" value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} autoFocus />
      </Field>
      <ErrorBox error={err} />
    </Modal>
  );
}

function Updates({ info }: { info: any }) {
  const { settings, toast } = useApp();
  const check = useQuery({ queryKey: ['system', 'update-check'], queryFn: () => get<any>('/api/system/update/check'), enabled: !!settings.updateRepo, retry: false, staleTime: 300_000 });
  const start = useMutation({ mutationFn: () => post('/api/system/update'), onSuccess: () => toast('info', 'Update started — ZENAA restarts in a few minutes. This page reconnects by itself.') });
  const st = info?.updater?.status;
  return (
    <div className="card">
      <div className="card-head">
        <h2>
          <Rocket size={18} style={{ verticalAlign: -3 }} /> Updates
        </h2>
        {settings.updateRepo && (
          <button className="btn btn-sm" onClick={() => check.refetch()} disabled={check.isFetching}>
            <RefreshCw size={14} /> Check now
          </button>
        )}
      </div>
      <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <dl className="kv">
          <dt>This version</dt>
          <dd className="mono">{info?.version ?? '…'}</dd>
          <dt>Update source</dt>
          <dd>{settings.updateRepo ? <span className="mono">github.com/{settings.updateRepo} ({settings.updateBranch})</span> : <span className="dim">Not set up yet</span>}</dd>
          <dt>Updater on the PC</dt>
          <dd>
            {info?.updater?.installed ? <span className="badge badge-success">Running</span> : <span className="badge badge-warning">Not running</span>}
            {info?.updater?.lastSeen && <span className="dim"> · last seen {formatDateTime(info.updater.lastSeen)}</span>}
          </dd>
          {st && (
            <>
              <dt>Last update</dt>
              <dd>
                <span className={`badge ${st.state === 'done' ? 'badge-success' : st.state === 'failed' ? 'badge-danger' : 'badge-info'}`}>{st.state}</span> {st.message}{' '}
                {st.at && <span className="dim">({formatDateTime(st.at)})</span>}
              </dd>
            </>
          )}
        </dl>
        {!settings.updateRepo ? (
          <div className="alert alert-info">
            When the project is on GitHub, put its name (e.g. <span className="mono">yourname/zenaa-gamehub</span>) in <Link to="/settings#system">Settings → System</Link> and run{' '}
            <span className="mono">infra\updater\install-updater.ps1</span> once on the server PC. Then a new version installs with one click. Guide: Help → 17.
          </div>
        ) : (
          <>
            <ErrorBox error={check.error || start.error} />
            {check.data?.available ? (
              <div className="alert alert-success">
                <b>Version {check.data.latest} is available.</b> The updater backs up the data, downloads the new version and restarts ZENAA (about 2–5 minutes; screens and
                timers reconnect by themselves).
                {check.data.notes && <pre style={{ whiteSpace: 'pre-wrap', marginTop: 8, fontSize: 12 }}>{check.data.notes}</pre>}
              </div>
            ) : check.data ? (
              <div className="dim">You have the latest version ({check.data.current}).</div>
            ) : null}
            <div className="toolbar">
              <button className="btn btn-primary" disabled={!check.data?.available || start.isPending || !info?.updater?.installed} onClick={() => start.mutate()}>
                <Rocket size={16} /> Update now
              </button>
              {!info?.updater?.installed && <span className="dim">Start the updater on the server PC first (Help → 17).</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
