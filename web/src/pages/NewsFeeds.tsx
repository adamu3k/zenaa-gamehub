import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorBox, Field } from '../components/ui';
import { get, post, put } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDateTime } from '../lib/format';

/** Well-known game news feeds (checked working). Kept family-friendly. */
const SUGGESTED = [
  { name: 'PlayStation Blog', url: 'https://blog.playstation.com/feed/' },
  { name: 'Push Square', url: 'https://www.pushsquare.com/feeds/latest' },
  { name: 'IGN', url: 'https://feeds.feedburner.com/ign/all' },
  { name: 'GameSpot', url: 'https://www.gamespot.com/feeds/mashup/' },
  { name: 'Eurogamer', url: 'https://www.eurogamer.net/feed' },
];

/** News page → "Game news from other sites": RSS feeds whose newest stories appear next to your own posts. */
export function OutsideFeeds() {
  const { settings, toast } = useApp();
  const qc = useQueryClient();
  const [feeds, setFeeds] = useState(settings.newsFeeds ?? []);
  const [count, setCount] = useState(settings.newsFeedCount ?? 2);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  useEffect(() => {
    setFeeds(settings.newsFeeds ?? []);
    setCount(settings.newsFeedCount ?? 2);
  }, [settings]);
  const status = useQuery({ queryKey: ['news-feeds'], queryFn: () => get<any>('/api/news-feeds') });
  const test = useMutation({ mutationFn: (u: string) => post<any>('/api/news-feeds/test', { url: u }) });
  const refresh = useMutation({ mutationFn: () => post<any>('/api/news-feeds/refresh'), onSuccess: (r) => qc.setQueryData(['news-feeds'], r) });
  const save = useMutation({
    mutationFn: (next: { feeds: typeof feeds; count: number }) => put('/api/settings', { ...settings, newsFeeds: next.feeds, newsFeedCount: next.count }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['settings'] });
      toast('success', 'Saved — reading the sites now');
      refresh.mutate();
    },
  });
  const add = (u: string, n: string) => {
    const clean = u.trim();
    if (!clean || feeds.some((f) => f.url === clean)) return;
    const next = [...feeds, { url: clean, name: n.trim() }];
    setFeeds(next);
    setUrl('');
    setName('');
    test.reset();
    save.mutate({ feeds: next, count });
  };
  const remove = (u: string) => {
    const next = feeds.filter((f) => f.url !== u);
    setFeeds(next);
    save.mutate({ feeds: next, count });
  };
  const st = (u: string) => (status.data?.status ?? []).find((s: any) => s.url === u);
  const items = (status.data?.items ?? []) as any[];
  return (
    <>
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Game news from other sites</h2>
        <div className="muted" style={{ fontSize: 14 }}>
          Add a game news website and the newest stories show in the customer app's <b>News</b> (and on its home page) next to your own posts, with the picture,
          the site's name and a link to read the full story there. ZENAA checks the sites once an hour. Paste the site's <b>RSS feed</b> link, or just the website
          address — most news sites announce their feed and ZENAA finds it.
        </div>
        <ErrorBox error={save.error || refresh.error || test.error} />
        <div className="form-grid">
          <Field label="Website or RSS feed address" full>
            <input className="input mono" value={url} onChange={(e) => (setUrl(e.target.value), test.reset())} placeholder="https://www.pushsquare.com/feeds/latest" />
          </Field>
          <Field label="Name to show (optional)" hint="Empty = the site's own name">
            <input className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="Push Square" />
          </Field>
          <div className="toolbar" style={{ alignSelf: 'end' }}>
            <button className="btn" disabled={!url.trim() || test.isPending} onClick={() => test.mutate(url.trim())}>
              {test.isPending ? 'Checking…' : 'Test'}
            </button>
            <button className="btn btn-primary" disabled={!url.trim() || save.isPending || feeds.length >= 8} onClick={() => add(test.data?.ok && test.data.feedUrl ? test.data.feedUrl : url, name)}>
              <Plus size={14} /> Add
            </button>
          </div>
        </div>
        {test.data &&
          (test.data.ok ? (
            <div className="hint">
              <CheckCircle2 size={14} style={{ verticalAlign: -2, color: 'var(--success)' }} /> <b>{test.data.title}</b> — {test.data.count} stories found
              {test.data.feedUrl !== url.trim() && <> (feed: <span className="mono">{test.data.feedUrl}</span>)</>}. Newest: “{test.data.sample?.[0]?.title}”
            </div>
          ) : (
            <div className="hint" style={{ borderColor: 'var(--danger)' }}>
              <XCircle size={14} style={{ verticalAlign: -2, color: 'var(--danger)' }} /> Can't read it: {test.data.error}
            </div>
          ))}
        <div>
          <div className="dim" style={{ fontSize: 13, marginBottom: 6 }}>
            Quick add (checked working):
          </div>
          <div className="toolbar" style={{ flexWrap: 'wrap' }}>
            {SUGGESTED.filter((s) => !feeds.some((f) => f.url === s.url)).map((s) => (
              <button key={s.url} className="btn btn-sm" disabled={save.isPending || feeds.length >= 8} onClick={() => add(s.url, s.name)}>
                <Plus size={12} /> {s.name}
              </button>
            ))}
          </div>
        </div>
        <Field label="Stories from other sites to show" hint="Shown after your pinned posts; your own posts always come first on the home page. 0 = switch off.">
          <select className="select" value={count} onChange={(e) => (setCount(Number(e.target.value)), save.mutate({ feeds, count: Number(e.target.value) }))}>
            {[0, 1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'None (off)' : n}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Sites ({feeds.length}/8)</h2>
          <button className="btn btn-sm" disabled={!feeds.length || refresh.isPending} onClick={() => refresh.mutate()}>
            <RefreshCw size={14} /> {refresh.isPending ? 'Reading…' : 'Check now'}
          </button>
        </div>
        <div className="list">
          {feeds.length === 0 && <div className="list-item dim">No sites yet — use Quick add above.</div>}
          {feeds.map((f) => {
            const s = st(f.url);
            return (
              <div key={f.url} className="list-item" style={{ gap: 10 }}>
                <span style={{ minWidth: 0 }}>
                  <strong>{f.name || s?.title || new URL(f.url).hostname}</strong>
                  <div className="dim mono" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {f.url}
                  </div>
                  {s && (
                    <div style={{ fontSize: 12, color: s.ok ? 'var(--success)' : 'var(--danger)' }}>
                      {s.ok ? `${s.count} stories` : `Not working: ${s.error}`}
                    </div>
                  )}
                </span>
                <button className="btn btn-ghost btn-icon btn-sm" aria-label="Remove" onClick={() => remove(f.url)}>
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
        {status.data?.fetchedAt && (
          <div className="dim" style={{ fontSize: 12, padding: '8px 16px' }}>
            Last checked {formatDateTime(status.data.fetchedAt)}
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Newest stories (preview)</h2>
            <span className="dim" style={{ fontSize: 12 }}>
              Customers see the newest {count}
            </span>
          </div>
          <div className="list">
            {items.map((i, n) => (
              <a key={i.url} className="list-item" href={i.url} target="_blank" rel="noreferrer" style={{ gap: 10, textDecoration: 'none', color: 'inherit', opacity: n < count ? 1 : 0.5 }}>
                {i.imageUrl ? (
                  <img src={i.imageUrl} alt="" loading="lazy" style={{ width: 84, height: 50, objectFit: 'cover', borderRadius: 8, flex: 'none' }} />
                ) : (
                  <div style={{ width: 84, height: 50, borderRadius: 8, background: 'var(--surface-2)', flex: 'none' }} />
                )}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong>{i.title}</strong>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {i.source}
                    {i.publishedAt ? ` · ${formatDateTime(i.publishedAt)}` : ''}
                  </div>
                </span>
                <ExternalLink size={14} />
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
