import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Copy, ExternalLink, Megaphone, Pin, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBox, Field } from '../components/ui';
import { formatDateTime, parseMoney } from '../lib/format';
import { pget, ppost } from './portal-api';

export const KIND_LABEL: Record<string, string> = {
  news: 'News',
  event: 'Event',
  promo: 'Promo',
  tournament: 'Tournament',
  announcement: 'Announcement',
};
const KIND_BADGE: Record<string, string> = { promo: 'badge-success', event: 'badge-info', tournament: 'badge-primary', announcement: 'badge-warning', news: '' };

export const SOCIALS: { key: string; label: string; emoji: string }[] = [
  { key: 'youtube', label: 'YouTube', emoji: '▶️' },
  { key: 'tiktok', label: 'TikTok', emoji: '🎵' },
  { key: 'instagram', label: 'Instagram', emoji: '📸' },
  { key: 'facebook', label: 'Facebook', emoji: '👍' },
  { key: 'x', label: 'X', emoji: '✖️' },
  { key: 'snapchat', label: 'Snapchat', emoji: '👻' },
  { key: 'whatsapp', label: 'WhatsApp', emoji: '💬' },
  { key: 'website', label: 'Website', emoji: '🌐' },
];

export function useNews() {
  return useQuery({ queryKey: ['portal', 'news'], queryFn: () => pget<any>('/api/public/news'), staleTime: 60_000, refetchInterval: 120_000 });
}

export function FollowUs({ links }: { links?: Record<string, string> }) {
  const list = SOCIALS.filter((s) => links?.[s.key]);
  if (!list.length) return null;
  return (
    <div className="card card-pad">
      <h2 style={{ marginTop: 0 }}>Follow us</h2>
      <div className="dim" style={{ marginBottom: 10, fontSize: 14 }}>
        Highlights, tournament streams and promos first. Subscribe and turn on notifications 🔔
      </div>
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        {list.map((s) => (
          <a key={s.key} className="btn" href={links![s.key]} target="_blank" rel="noreferrer">
            <span aria-hidden>{s.emoji}</span> {s.label} <ExternalLink size={12} />
          </a>
        ))}
      </div>
    </div>
  );
}

function PostCard({ p }: { p: any }) {
  const internal = p.linkUrl?.startsWith('/');
  return (
    <article className="card" style={{ overflow: 'hidden' }}>
      {p.imageUrl && <img className="post-img" src={p.imageUrl} alt="" loading="lazy" style={{ borderRadius: 0 }} />}
      <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="toolbar" style={{ gap: 6 }}>
          <span className={`badge ${KIND_BADGE[p.kind] ?? ''}`}>{KIND_LABEL[p.kind] ?? p.kind}</span>
          {p.pinned && (
            <span className="badge">
              <Pin size={11} /> Pinned
            </span>
          )}
          <span className="dim" style={{ fontSize: 12 }}>
            {formatDateTime(p.createdAt)}
          </span>
        </div>
        <h2 style={{ margin: 0 }}>{p.title}</h2>
        {p.eventAt && (
          <div style={{ fontWeight: 600 }}>
            <CalendarClock size={14} style={{ verticalAlign: -2 }} /> {formatDateTime(p.eventAt)}
          </div>
        )}
        {p.body && <div style={{ whiteSpace: 'pre-wrap' }}>{p.body}</div>}
        {p.linkUrl &&
          (internal ? (
            <Link className="btn btn-primary" to={p.linkUrl} style={{ alignSelf: 'flex-start' }}>
              {p.linkLabel || 'Open'}
            </Link>
          ) : (
            <a className="btn btn-primary" href={p.linkUrl} target="_blank" rel="noreferrer" style={{ alignSelf: 'flex-start' }}>
              {p.linkLabel || 'Open'} <ExternalLink size={14} />
            </a>
          ))}
      </div>
    </article>
  );
}

/** A story from another game news site: opens on that site. */
function OutsideCard({ i }: { i: any }) {
  return (
    <a className="card outside-card" href={i.url} target="_blank" rel="noreferrer noopener">
      {i.imageUrl && <img src={i.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
      <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="toolbar" style={{ gap: 6 }}>
          <span className="badge badge-info">Game news · {i.source}</span>
          {i.publishedAt && (
            <span className="dim" style={{ fontSize: 12 }}>
              {formatDateTime(i.publishedAt)}
            </span>
          )}
        </div>
        <h2 style={{ margin: 0, fontSize: 18 }}>{i.title}</h2>
        {i.summary && <div className="dim" style={{ fontSize: 14 }}>{i.summary}</div>}
        <span className="outside-more">
          Read on {i.source} <ExternalLink size={13} />
        </span>
      </div>
    </a>
  );
}

const outsideOf = (d: any) => ((d?.outside ?? []) as any[]).slice(0, d?.outsideShow ?? 0);

/** Pinned posts first, then your posts and outside stories by date. */
function mixFeed(d: any) {
  const posts = (d?.posts ?? []) as any[];
  const pinned = posts.filter((p) => p.pinned).map((p) => ({ kind: 'post' as const, p, at: Date.parse(p.createdAt) }));
  const rest = [
    ...posts.filter((p) => !p.pinned).map((p) => ({ kind: 'post' as const, p, at: Date.parse(p.createdAt) })),
    ...outsideOf(d).map((i) => ({ kind: 'outside' as const, p: i, at: i.publishedAt ? Date.parse(i.publishedAt) : 0 })),
  ].sort((a, b) => b.at - a.at);
  return [...pinned, ...rest];
}

/** Portal "News" tab: game news, upcoming events, promotions, tournaments. */
export function NewsFeed() {
  const q = useNews();
  const feed = mixFeed(q.data);
  return (
    <>
      <h1 style={{ margin: '4px 0 12px' }}>
        <Megaphone size={22} style={{ verticalAlign: -3 }} /> News & events
      </h1>
      <ErrorBox error={q.error} />
      {q.data && feed.length === 0 && <div className="card card-pad muted">No news yet — check back soon.</div>}
      <div style={{ display: 'grid', gap: 14 }}>
        {feed.map((x) => (x.kind === 'post' ? <PostCard key={x.p.id} p={x.p} /> : <OutsideCard key={x.p.url} i={x.p} />))}
      </div>
      <div style={{ marginTop: 14 }}>
        <FollowUs links={q.data?.socialLinks} />
      </div>
    </>
  );
}

/** Home page: the newest 2 posts, plus up to 2 stories from other game news sites. */
export function NewsPreview() {
  const q = useNews();
  const posts = q.data?.posts.slice(0, 2) ?? [];
  const outside = outsideOf(q.data).slice(0, 2);
  if (!posts.length && !outside.length) return null;
  return (
    <div className="card">
      <div className="card-head">
        <h2>
          <Megaphone size={18} style={{ verticalAlign: -3 }} /> Latest
        </h2>
        <Link to="/portal/news">All news</Link>
      </div>
      <div className="list">
        {posts.map((p: any) => (
          <Link key={p.id} to="/portal/news" className="list-item" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span>
              <span className={`badge ${KIND_BADGE[p.kind] ?? ''}`}>{KIND_LABEL[p.kind] ?? p.kind}</span> <strong>{p.title}</strong>
              {p.eventAt && <div className="dim" style={{ fontSize: 12 }}>{formatDateTime(p.eventAt)}</div>}
            </span>
          </Link>
        ))}
        {outside.map((i: any) => (
          <a key={i.url} href={i.url} target="_blank" rel="noreferrer noopener" className="list-item outside-row" style={{ textDecoration: 'none', color: 'inherit' }}>
            {i.imageUrl && <img src={i.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="badge badge-info">{i.source}</span> <strong>{i.title}</strong>
            </span>
            <ExternalLink size={14} className="dim" />
          </a>
        ))}
      </div>
    </div>
  );
}

// ───────────── MoMo top-up (no gateway) ─────────────

function copy(text: string) {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    /* clipboard not available */
  }
}

/** Ghana-style USSD hint per network. */
const HOW_TO: Record<string, string> = {
  'MTN MoMo': 'Dial *170# → 1 Transfer Money → 1 MoMo User (or open the MoMo app) → enter the number below → amount → Reference: your code → PIN.',
  'Telecel Cash': 'Dial *110# → 1 Send Money → 1 Telecel Cash → enter the number below → amount → Reference: your code → PIN.',
  'AT Money': 'Dial *110# → Send Money → AT Money user → enter the number below → amount → Reference: your code → PIN.',
};

export function MomoTopup({ money, currencyCode, minorUnits }: { money(v: number): string; currencyCode: string; minorUnits: number }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['portal', 'momo'], queryFn: () => pget<any>('/api/portal/momo') });
  const [network, setNetwork] = useState('');
  const [amount, setAmount] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const unit = 10 ** minorUnits;
  const parsed = parseMoney(amount, minorUnits);
  const create = useMutation({
    mutationFn: () => ppost('/api/portal/momo', { amount: parsed, network: network || q.data.accounts[0].network }),
    onSuccess: (r: any) => {
      setActive(r.id);
      qc.invalidateQueries({ queryKey: ['portal', 'momo'] });
    },
  });
  // Keep showing a request that is still waiting after a page reload.
  useEffect(() => {
    if (!active && q.data?.requests?.length) {
      const waiting = q.data.requests.find((r: any) => r.status === 'pending');
      if (waiting) setActive(waiting.id);
    }
  }, [q.data, active]);
  if (!q.data) return null;
  if (!q.data.enabled) return null;
  if (active) return <MomoWaiting id={active} money={money} onDone={() => setActive(null)} />;
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0 }}>
        <Smartphone size={18} style={{ verticalAlign: -3 }} /> Top up with MoMo — no fees from us
      </h2>
      <div className="dim" style={{ fontSize: 14 }}>
        Send mobile money to our number with your personal code as the reference. Your wallet fills up as soon as we receive it.
      </div>
      {q.data.accounts.length > 1 && (
        <div className="toolbar">
          {q.data.accounts.map((a: any) => (
            <button key={a.network} className={`btn btn-sm ${(network || q.data.accounts[0].network) === a.network ? 'btn-primary' : ''}`} onClick={() => setNetwork(a.network)}>
              {a.network}
            </button>
          ))}
        </div>
      )}
      <div className="toolbar">
        {[20, 50, 100].map((x) => (
          <button key={x} type="button" className={`btn btn-sm ${parsed === x * unit ? 'btn-primary' : ''}`} onClick={() => setAmount(String(x))}>
            {money(x * unit)}
          </button>
        ))}
      </div>
      <Field label={`Amount (${currencyCode})`} hint={`From ${money(q.data.min)}${q.data.max ? ` to ${money(q.data.max)}` : ''}`}>
        <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Other amount" />
      </Field>
      <ErrorBox error={create.error} />
      <button className="btn btn-primary" disabled={create.isPending || parsed == null || parsed < q.data.min} onClick={() => create.mutate()}>
        Get my MoMo code
      </button>
    </div>
  );
}

function MomoWaiting({ id, money, onDone }: { id: string; money(v: number): string; onDone(): void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['portal', 'momo', id],
    queryFn: () => pget<any>(`/api/portal/momo/${id}`),
    refetchInterval: (query) => ((query.state.data as any)?.status === 'pending' ? 4000 : false),
  });
  const [txn, setTxn] = useState('');
  const submit = useMutation({ mutationFn: () => ppost(`/api/portal/momo/${id}/txn`, { txnId: txn.trim() }), onSuccess: () => q.refetch() });
  const cancel = useMutation({ mutationFn: () => ppost(`/api/portal/momo/${id}/cancel`, {}), onSuccess: onDone });
  const r = q.data;
  useEffect(() => {
    if (r?.status === 'confirmed') {
      qc.invalidateQueries({ queryKey: ['portal', 'me'] });
      qc.invalidateQueries({ queryKey: ['portal', 'momo'] });
    }
  }, [r?.status, qc]);
  if (!r) return <div className="card card-pad muted">Loading…</div>;
  if (r.status === 'confirmed')
    return (
      <div className="card card-pad" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        <CheckCircle2 size={56} color="var(--success)" />
        <h2 style={{ margin: 0 }}>Payment received</h2>
        <div>
          <b>{money(r.amount)}</b> was added to your wallet. New balance: <b>{money(r.balance)}</b>
        </div>
        <div className="dim" style={{ fontSize: 12 }}>
          Ref {r.code}
          {r.txnId ? ` · Transaction ${r.txnId}` : ''}
        </div>
        <button className="btn btn-primary" onClick={onDone}>
          Done
        </button>
      </div>
    );
  if (r.status === 'rejected')
    return (
      <div className="card card-pad">
        <h2 style={{ marginTop: 0 }}>Top-up not confirmed</h2>
        <div className="alert alert-danger">{r.note || 'Please see the counter.'}</div>
        <button className="btn" onClick={onDone}>
          OK
        </button>
      </div>
    );
  const acc = r.account;
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0 }}>Send {money(r.amount)} by {r.network}</h2>
      <div className="momo-steps" style={{ display: 'grid', gap: 10 }}>
        <div className="card card-pad" style={{ background: 'var(--surface-2)' }}>
          <div className="dim" style={{ fontSize: 12 }}>1 · Send to</div>
          <div style={{ fontSize: 24, fontWeight: 800 }} className="mono">
            {acc?.number}{' '}
            <button className="btn btn-ghost btn-sm" onClick={() => copy(acc?.number ?? '')} aria-label="Copy number">
              <Copy size={14} />
            </button>
          </div>
          <div className="dim">{acc?.name}</div>
        </div>
        <div className="card card-pad" style={{ background: 'var(--surface-2)' }}>
          <div className="dim" style={{ fontSize: 12 }}>2 · Amount</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{money(r.amount)}</div>
          <div className="dim" style={{ fontSize: 12 }}>Exactly this amount</div>
        </div>
        <div className="card card-pad" style={{ background: 'var(--primary-soft)' }}>
          <div className="dim" style={{ fontSize: 12 }}>3 · Reference (very important)</div>
          <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: 3 }} className="mono">
            {r.code}{' '}
            <button className="btn btn-ghost btn-sm" onClick={() => copy(r.code)} aria-label="Copy code">
              <Copy size={14} />
            </button>
          </div>
          {/^\d+$/.test(r.code) && <div className="dim" style={{ fontSize: 12 }}>Numbers only — type it on any phone, even a keypad phone.</div>}
        </div>
      </div>
      {HOW_TO[r.network] && <div className="hint">{HOW_TO[r.network]}</div>}
      <div className="alert alert-info">⏳ Waiting for your payment… this page updates by itself.</div>
      <Field label="Already sent? Type the Transaction ID from your MoMo SMS (speeds it up)">
        <div className="toolbar" style={{ flexWrap: 'nowrap' }}>
          <input className="input mono" value={txn} onChange={(e) => setTxn(e.target.value.toUpperCase())} placeholder="e.g. 51234567890" />
          <button className="btn" disabled={txn.trim().length < 6 || submit.isPending} onClick={() => submit.mutate()}>
            Send
          </button>
        </div>
      </Field>
      {r.txnId && <div className="dim" style={{ fontSize: 13 }}>Transaction ID {r.txnId} received — we'll confirm it shortly.</div>}
      <ErrorBox error={submit.error || cancel.error} />
      <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => cancel.mutate()}>
        Cancel this top-up
      </button>
    </div>
  );
}
