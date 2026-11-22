import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Pencil, Pin, Plus, Printer, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { OutsideFeeds } from './NewsFeeds';
import { ErrorBox, Field, Modal, PageHeader, Segmented } from '../components/ui';
import { del, get, patch, post } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDateTime } from '../lib/format';
import { KIND_LABEL, SOCIALS } from '../portal/PortalExtras';

type Tab = 'posts' | 'feeds' | 'posters';

export function NewsPage() {
  const [tab, setTab] = useState<Tab>('posts');
  return (
    <>
      <PageHeader title="News & posters" subtitle="Post game news, upcoming events and promotions to the customer app, and print QR posters for the counter and walls." />
      <div className="toolbar no-print" style={{ marginBottom: 12 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'posts', label: 'News & events' },
            { value: 'feeds', label: 'Game news from other sites' },
            { value: 'posters', label: 'QR posters' },
          ]}
        />
      </div>
      {tab === 'posts' ? <Posts /> : tab === 'feeds' ? <OutsideFeeds /> : <Posters />}
    </>
  );
}

function Posts() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['posts'], queryFn: () => get<any[]>('/api/posts') });
  const [editing, setEditing] = useState<any>(null);
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/posts/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['posts'] }) });
  return (
    <div className="card">
      <div className="card-head">
        <h2>Posts</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>
          <Plus size={14} /> New post
        </button>
      </div>
      <ErrorBox error={q.error || remove.error} />
      <div className="list">
        {q.data?.length === 0 && <div className="list-item dim">No posts yet. Tournaments are posted automatically when you open registration.</div>}
        {q.data?.map((p) => {
          const live = p.published && (!p.publishAt || new Date(p.publishAt) <= new Date()) && (!p.expiresAt || new Date(p.expiresAt) > new Date());
          return (
            <div className="list-item" key={p.id} style={{ alignItems: 'flex-start', gap: 12 }}>
              {p.imageUrl ? (
                <img src={p.imageUrl} alt="" style={{ width: 84, height: 56, objectFit: 'cover', borderRadius: 8 }} />
              ) : (
                <div style={{ width: 84, height: 56, borderRadius: 8, background: 'var(--surface-2)' }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="toolbar" style={{ gap: 6 }}>
                  <span className="badge">{KIND_LABEL[p.kind] ?? p.kind}</span>
                  {p.pinned && (
                    <span className="badge badge-primary">
                      <Pin size={11} /> Pinned
                    </span>
                  )}
                  <span className={`badge ${live ? 'badge-success' : 'badge-warning'}`}>{live ? 'Live' : p.published ? 'Scheduled / expired' : 'Draft'}</span>
                </div>
                <strong>{p.title}</strong>
                <div className="dim" style={{ fontSize: 12 }}>
                  {formatDateTime(p.createdAt)}
                  {p.eventAt ? ` · event ${formatDateTime(p.eventAt)}` : ''}
                  {p.expiresAt ? ` · until ${formatDateTime(p.expiresAt)}` : ''}
                </div>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => setEditing(p)} aria-label="Edit">
                <Pencil size={14} />
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => confirm(`Delete "${p.title}"?`) && remove.mutate(p.id)} aria-label="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>
      {editing && <PostModal post={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const toLocalInput = (d?: string | null) => {
  if (!d) return '';
  const x = new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

/** Shrinks a picture in the browser (max 1280 px, JPEG) so posts load fast on phones. */
async function resizeImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('That file is not a picture'));
      i.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function PostModal({ post: p, onClose }: { post: any; onClose(): void }) {
  const qc = useQueryClient();
  const { toast } = useApp();
  const isNew = !p.id;
  const [f, setF] = useState({
    kind: p.kind ?? 'news',
    title: p.title ?? '',
    body: p.body ?? '',
    linkUrl: p.linkUrl ?? '',
    linkLabel: p.linkLabel ?? '',
    eventAt: toLocalInput(p.eventAt),
    expiresAt: toLocalInput(p.expiresAt),
    publishAt: toLocalInput(p.publishAt),
    pinned: !!p.pinned,
    published: p.published ?? true,
  });
  const [image, setImage] = useState<string | null | undefined>(undefined); // undefined = unchanged
  const [imgErr, setImgErr] = useState<unknown>(null);
  const preview = image === undefined ? p.imageUrl : image;
  const save = useMutation({
    mutationFn: () => {
      const body: any = {
        ...f,
        linkUrl: f.linkUrl.trim() || null,
        linkLabel: f.linkLabel.trim() || null,
        eventAt: fromLocalInput(f.eventAt),
        expiresAt: fromLocalInput(f.expiresAt),
        publishAt: fromLocalInput(f.publishAt),
      };
      if (image !== undefined) body.image = image;
      return isNew ? post('/api/posts', body) : patch(`/api/posts/${p.id}`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['posts'] });
      toast('success', isNew ? 'Posted to the customer app' : 'Post updated');
      onClose();
    },
  });
  return (
    <Modal
      title={isNew ? 'New post' : 'Edit post'}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={f.title.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>
            {f.published ? (isNew ? 'Publish' : 'Save') : 'Save draft'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Type">
          <select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Event date & time" hint="For events, launches, tournaments (optional)">
          <input className="input" type="datetime-local" value={f.eventAt} onChange={(e) => setF({ ...f, eventAt: e.target.value })} />
        </Field>
        <Field label="Title" full>
          <input className="input" value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. EA FC 26 Team of the Week is live" />
        </Field>
        <Field label="Text" full>
          <textarea className="textarea" rows={6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="What's happening, prices, times, rules…" />
        </Field>
        <Field label="Picture" full hint="Flyers, game art, tournament posters. Resized automatically.">
          <div className="toolbar">
            <label className="btn btn-sm">
              <ImagePlus size={14} /> Choose picture
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    setImage(await resizeImage(file));
                    setImgErr(null);
                  } catch (err) {
                    setImgErr(err);
                  }
                }}
              />
            </label>
            {preview && (
              <button className="btn btn-sm btn-ghost" onClick={() => setImage(null)}>
                Remove picture
              </button>
            )}
          </div>
          {preview && <img className="post-img" src={preview} alt="" style={{ marginTop: 8, maxHeight: 200 }} />}
          <ErrorBox error={imgErr} />
        </Field>
        <Field label="Button link" hint="https://… (YouTube, sign-up form) or /portal/cups, /portal/book, /portal/match">
          <input className="input" value={f.linkUrl} onChange={(e) => setF({ ...f, linkUrl: e.target.value })} />
        </Field>
        <Field label="Button text">
          <input className="input" value={f.linkLabel} maxLength={40} onChange={(e) => setF({ ...f, linkLabel: e.target.value })} placeholder="e.g. Watch, Register, Book now" />
        </Field>
        <Field label="Show from" hint="Empty = now">
          <input className="input" type="datetime-local" value={f.publishAt} onChange={(e) => setF({ ...f, publishAt: e.target.value })} />
        </Field>
        <Field label="Hide after" hint="Empty = keep showing (e.g. end of a promo)">
          <input className="input" type="datetime-local" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />
        </Field>
      </div>
      <div className="toolbar" style={{ marginTop: 8 }}>
        <label className="check">
          <input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} /> Pin to the top
        </label>
        <label className="check">
          <input type="checkbox" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} /> Published
        </label>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function Posters() {
  const { settings } = useApp();
  const origin = window.location.origin;
  const base = (settings.publicUrl || origin).replace(/\/$/, '');
  const local = !settings.publicUrl && /\/\/(localhost|127\.)/.test(origin);
  const posters = [
    { title: 'Join & get the app', sub: 'Sign up in 30 seconds — book stations, top up, see your rank', url: `${base}/portal?signup` },
    ...(settings.momoTopupEnabled && settings.momoAccounts.length ? [{ title: 'Top up with MoMo', sub: 'Scan → choose amount → send MoMo with your code. No fees.', url: `${base}/portal/wallet` }] : []),
    { title: 'News, events & promos', sub: 'Tournaments, new games and offers', url: `${base}/portal/news` },
    ...(settings.matchmakingEnabled ? [{ title: 'Find a match', sub: 'Challenge a player here or online', url: `${base}/portal/match` }] : []),
    { title: 'Tournaments', sub: 'Register for the next cup', url: `${base}/portal/cups` },
    ...SOCIALS.filter((s) => settings.socialLinks?.[s.key as keyof typeof settings.socialLinks]).map((s) => ({
      title: `${s.emoji} Follow us on ${s.label}`,
      sub: 'Highlights, streams and giveaways',
      url: settings.socialLinks[s.key as keyof typeof settings.socialLinks],
    })),
  ];
  return (
    <>
      {local && (
        <div className="alert alert-warning no-print">
          You opened ZENAA as localhost, so these codes would point to "localhost" — phones can't open that. Set the public address in Settings → Customer portal (e.g.
          http://192.168.1.10:8080 on your Wi-Fi, or your https address).
        </div>
      )}
      <div className="toolbar no-print" style={{ marginBottom: 12 }}>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
          <Printer size={14} /> Print posters
        </button>
        <span className="dim" style={{ fontSize: 13 }}>
          Add YouTube, TikTok, Instagram… in Settings → Socials and they appear here.
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {posters.map((p) => (
          <div className="qr-poster card" key={p.url + p.title}>
            <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: 1, opacity: 0.7 }}>{settings.centerName}</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{p.title}</div>
            <img src={`/api/qr?text=${encodeURIComponent(p.url)}`} alt={`QR code for ${p.url}`} />
            <div className="dim">{p.sub}</div>
            <div className="mono dim" style={{ fontSize: 11, wordBreak: 'break-all' }}>
              {p.url}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
