import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  ExternalLink,
  Film,
  ImagePlus,
  Lightbulb,
  Play,
  Plus,
  RefreshCw,
  Save,
  Send,
  Share2,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBox, Field, PageHeader, Segmented } from '../components/ui';
import { del, get, patch, post, put } from '../lib/api';
import { useApp } from '../lib/app-context';
import {
  blobToDataUrl,
  type Brand,
  canvasBlob,
  drawFrame,
  DURATION,
  type FormatKey,
  FORMATS,
  loadAssets,
  recordVideo,
  shrinkPhoto,
  type Spec,
  type TemplateKey,
  TEMPLATES,
  videoType,
} from '../social/graphics';

type Tab = 'ideas' | 'posted' | 'updates' | 'accounts';
interface SocialPost {
  id: string;
  status: 'idea' | 'draft' | 'posted' | 'dismissed';
  source: string;
  template: TemplateKey;
  fields: Record<string, any>;
  caption: string;
  newsUrl: string | null;
  results: { platform: string; ok: boolean; url?: string | null; error?: string; at: string }[];
  createdAt: string;
  postedAt: string | null;
}

const PLATFORM_NAMES: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  telegram: 'Telegram',
  portal: 'Customer app news',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  x: 'X (Twitter)',
  whatsapp: 'WhatsApp',
  snapchat: 'Snapchat',
};

function useBrand(): Brand {
  const { settings } = useApp();
  const s = settings.social;
  return { dark: s.brandDark, main: s.brandMain, pop: s.brandPop, light: s.brandLight, handle: s.handle, centre: settings.centerName };
}

/** Social: post ideas from game news, branded graphics and videos, posting, page numbers. */
export function SocialPage() {
  const [tab, setTab] = useState<Tab>('ideas');
  const [editing, setEditing] = useState<SocialPost | 'new' | null>(null);
  const qc = useQueryClient();
  const { toast } = useApp();
  const ideas = useQuery({ queryKey: ['social', 'posts', 'ideas'], queryFn: () => get<SocialPost[]>('/api/social/posts?status=ideas') });
  const getIdeas = useMutation({
    mutationFn: () => post<{ created: number; feeds: { ok: boolean }[] }>('/api/social/ideas'),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['social'] });
      if (r.created) toast('success', `${r.created} new idea${r.created > 1 ? 's' : ''} from the news`);
      else if (!r.feeds.length) toast('warning', 'Add game news websites first (News & posters → Outside news)');
      else toast('info', 'No new stories since last time');
    },
  });

  if (editing) return <Editor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />;
  const ideaCount = ideas.data?.length ?? 0;
  return (
    <>
      <PageHeader
        title="Social"
        subtitle="Daily post ideas from game news, ZMG-branded graphics and videos, and posting to your pages."
        actions={
          <>
            <button className="btn" disabled={getIdeas.isPending} onClick={() => getIdeas.mutate()}>
              <Lightbulb size={16} /> {getIdeas.isPending ? 'Reading the news…' : 'Get ideas now'}
            </button>
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Plus size={16} /> New graphic
            </button>
          </>
        }
      />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'ideas', label: ideaCount ? `Ideas & drafts (${ideaCount})` : 'Ideas & drafts' },
          { value: 'posted', label: 'Posted' },
          { value: 'updates', label: 'Page updates' },
          { value: 'accounts', label: 'Accounts & settings' },
        ]}
      />
      <ErrorBox error={getIdeas.error} />
      {tab === 'ideas' && <PostGrid status="ideas" onOpen={setEditing} empty={<IdeasEmpty onNew={() => setEditing('new')} />} />}
      {tab === 'posted' && <PostGrid status="posted" onOpen={setEditing} empty={<div className="card empty">Nothing posted yet.</div>} />}
      {tab === 'updates' && <Updates />}
      {tab === 'accounts' && <Accounts />}
    </>
  );
}

function IdeasEmpty({ onNew }: { onNew(): void }) {
  const { settings } = useApp();
  return (
    <div className="card empty">
      <h2>No ideas waiting</h2>
      <p>
        Every day at {settings.social.ideasTime} ZENAA turns the newest game news into ready-made graphics and tells you.
        {settings.newsFeeds.length === 0 && (
          <>
            {' '}
            First add game news websites in <Link to="/news">News &amp; posters → Outside news</Link>.
          </>
        )}
      </p>
      <button className="btn btn-primary" onClick={onNew}>
        <Plus size={16} /> Make a graphic yourself
      </button>
    </div>
  );
}

function PostGrid({ status, onOpen, empty }: { status: 'ideas' | 'posted'; onOpen(p: SocialPost): void; empty: React.ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['social', 'posts', status], queryFn: () => get<SocialPost[]>(`/api/social/posts?status=${status}`) });
  const remove = useMutation({
    mutationFn: (p: SocialPost) => (p.source === 'news' ? patch(`/api/social/posts/${p.id}`, { status: 'dismissed' }) : del(`/api/social/posts/${p.id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['social'] }),
  });
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <div className="muted">Loading…</div>;
  if (!q.data.length) return <>{empty}</>;
  return (
    <div className="social-grid">
      {q.data.map((p) => (
        <div key={p.id} className="card social-card">
          <button style={{ all: 'unset', cursor: 'pointer' }} onClick={() => onOpen(p)} title="Open">
            <Thumb post={p} />
          </button>
          <div className="toolbar" style={{ gap: 6 }}>
            <span className={`badge ${p.status === 'idea' ? 'badge-primary' : p.status === 'posted' ? 'badge-success' : ''}`}>
              {p.status === 'idea' ? 'New idea' : p.status === 'draft' ? 'Draft' : 'Posted'}
            </span>
            <span className="dim" style={{ fontSize: 12 }}>
              {TEMPLATES[p.template]?.label}
            </span>
          </div>
          <strong style={{ fontSize: 13, lineHeight: 1.3 }}>{String(p.fields.headline ?? p.fields.p1Name ?? '').slice(0, 90) || 'Untitled'}</strong>
          {p.fields.source && <span className="dim" style={{ fontSize: 12 }}>From {p.fields.source}</span>}
          {p.status === 'posted' && (
            <div className="toolbar" style={{ gap: 4 }}>
              {p.results.filter((r) => r.ok).map((r, i) =>
                r.url ? (
                  <a key={i} className="badge badge-success" href={r.url} target="_blank" rel="noreferrer">
                    {PLATFORM_NAMES[r.platform] ?? r.platform} ↗
                  </a>
                ) : (
                  <span key={i} className="badge">
                    {PLATFORM_NAMES[r.platform] ?? r.platform}
                  </span>
                ),
              )}
            </div>
          )}
          <div className="toolbar" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-primary" onClick={() => onOpen(p)}>
              {p.status === 'posted' ? 'Open' : 'Edit & post'}
            </button>
            <button className="btn btn-sm btn-ghost" title={p.source === 'news' ? 'Not interested' : 'Delete'} onClick={() => remove.mutate(p)}>
              {p.source === 'news' ? <X size={14} /> : <Trash2 size={14} />}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Still picture of a post (pictures the staff uploaded load when the post is opened). */
function Thumb({ post: p }: { post: SocialPost }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const brand = useBrand();
  useEffect(() => {
    let off = false;
    const spec: Spec = { template: p.template, format: (p.fields.format as FormatKey) ?? 'post', fields: p.fields };
    loadAssets(spec).then((a) => !off && ref.current && drawFrame(ref.current, spec, a, brand, Infinity));
    return () => {
      off = true;
    };
  }, [p, brand]);
  return <canvas ref={ref} className="social-thumb" />;
}

// ───────── Editor ─────────

function Editor({ initial, onClose }: { initial: SocialPost | null; onClose(): void }) {
  const { settings, toast } = useApp();
  const qc = useQueryClient();
  const brand = useBrand();
  const full = useQuery({ queryKey: ['social', 'post', initial?.id], queryFn: () => get<SocialPost>(`/api/social/posts/${initial!.id}`), enabled: !!initial });
  const [postId, setPostId] = useState<string | null>(initial?.id ?? null);
  const [template, setTemplate] = useState<TemplateKey>(initial?.template ?? 'news');
  const [format, setFormat] = useState<FormatKey>((initial?.fields.format as FormatKey) ?? 'post');
  const [fields, setFields] = useState<Record<string, any>>(initial?.fields ?? { tag: 'GAMING NEWS' });
  const [caption, setCaption] = useState(initial?.caption ?? '');
  const [loaded, setLoaded] = useState(!initial);
  useEffect(() => {
    if (full.data && !loaded) {
      setFields(full.data.fields);
      setCaption(full.data.caption);
      setLoaded(true);
    }
  }, [full.data, loaded]);

  const spec: Spec = useMemo(() => ({ template, format, fields }), [template, format, fields]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [assets, setAssets] = useState<Awaited<ReturnType<typeof loadAssets>> | null>(null);
  const imageKeys = TEMPLATES[template].fields.filter((f) => f.kind === 'image').map((f) => String(fields[f.key] ?? ''));
  useEffect(() => {
    let off = false;
    loadAssets(spec).then((a) => !off && setAssets(a));
    return () => {
      off = true;
    };
  }, [template, imageKeys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const [playing, setPlaying] = useState(true);
  const [recording, setRecording] = useState<number | null>(null);
  useEffect(() => {
    if (!assets || !canvas.current || recording !== null) return;
    if (!playing) {
      drawFrame(canvas.current, spec, assets, brand, Infinity);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const loop = () => {
      const t = ((performance.now() - start) / 1000) % (DURATION + 1.5);
      if (canvas.current) drawFrame(canvas.current, spec, assets, brand, Math.min(t, DURATION));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [assets, spec, brand, playing, recording]);

  const [video, setVideo] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => setVideo(null), [spec]);

  const setField = (k: string, v: unknown) => setFields((f) => ({ ...f, [k]: v }));
  const slug = String(fields.headline ?? fields.p1Name ?? 'zmg')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40);

  const save = useMutation({
    mutationFn: async () => {
      const body = { template, fields: { ...fields, format }, caption };
      const row = postId ? await patch<SocialPost>(`/api/social/posts/${postId}`, body) : await post<SocialPost>('/api/social/posts', body);
      setPostId(row.id);
      qc.invalidateQueries({ queryKey: ['social'] });
      return row;
    },
  });

  const still = async () => {
    if (!canvas.current || !assets) throw new Error('Still loading');
    setPlaying(false);
    drawFrame(canvas.current, spec, assets, brand, Infinity);
    return canvasBlob(canvas.current, 'image/jpeg', 0.92);
  };
  const download = (b: Blob, name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const makeVideo = async () => {
    if (!canvas.current || !assets) return;
    try {
      setRecording(0);
      const blob = await recordVideo(canvas.current, (t) => drawFrame(canvas.current!, spec, assets, brand, t), DURATION + 1, (p) => setRecording(p));
      setVideo({ blob, url: URL.createObjectURL(blob) });
      toast('success', `Video ready (${blob.type.includes('mp4') ? 'MP4' : 'WebM'}, ${(blob.size / 1e6).toFixed(1)} MB)`);
    } catch (e: any) {
      toast('error', e.message ?? String(e));
    } finally {
      setRecording(null);
    }
  };

  const rebuildCaption = () => {
    const t = settings.social.captionTemplate;
    const v: Record<string, string> = {
      title: String(fields.headline ?? ''),
      summary: String(fields.sub ?? ''),
      source: String(fields.source ?? ''),
      link: full.data?.newsUrl ?? '',
      centre: settings.centerName,
      hashtags: settings.social.hashtags,
      handle: settings.social.handle,
    };
    setCaption(t.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)).replace(/\n{3,}/g, '\n\n').trim());
  };

  const status = full.data?.status ?? initial?.status;
  return (
    <>
      <PageHeader
        title={initial ? (status === 'idea' ? 'Post idea' : status === 'posted' ? 'Posted graphic' : 'Draft') : 'New graphic'}
        subtitle={full.data?.newsUrl ? <a href={full.data.newsUrl} target="_blank" rel="noreferrer">Read the original story ↗</a> : 'Pick a look, type your text, then post or download.'}
        actions={
          <>
            <button className="btn" onClick={onClose}>
              <ArrowLeft size={16} /> Back
            </button>
            <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => toast('success', 'Saved') })}>
              <Save size={16} /> Save draft
            </button>
          </>
        }
      />
      <ErrorBox error={save.error} />
      <div className="social-editor">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3>Look</h3>
            <div className="tpl-pick">
              {(Object.keys(TEMPLATES) as TemplateKey[]).map((k) => (
                <button key={k} type="button" className={template === k ? 'on' : ''} onClick={() => setTemplate(k)} title={TEMPLATES[k].about}>
                  {TEMPLATES[k].label}
                </button>
              ))}
            </div>
            <span className="dim" style={{ fontSize: 12 }}>
              {TEMPLATES[template].about}
            </span>
            <Field label="Size">
              <Segmented value={format} onChange={setFormat} options={(Object.keys(FORMATS) as FormatKey[]).map((k) => ({ value: k, label: FORMATS[k].label }))} />
            </Field>
            <span className="dim" style={{ fontSize: 12 }}>
              {FORMATS[format].hint}
            </span>
          </div>

          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3>Text & pictures</h3>
            {TEMPLATES[template].fields.map((f) =>
              f.kind === 'image' ? (
                <ImageField key={f.key} label={f.label} value={fields[f.key]} onChange={(v) => setField(f.key, v)} />
              ) : f.kind === 'rows' ? (
                <RowsField key={f.key} value={fields[f.key]} onChange={(v) => setField(f.key, v)} onSub={(s) => setField('sub', s)} />
              ) : (
                <Field key={f.key} label={f.label} hint={f.hint}>
                  {f.kind === 'textarea' ? (
                    <textarea className="input" rows={f.key === 'headline' ? 3 : 2} placeholder={f.placeholder} value={fields[f.key] ?? ''} onChange={(e) => setField(f.key, e.target.value)} />
                  ) : (
                    <input className="input" placeholder={f.placeholder} value={fields[f.key] ?? ''} onChange={(e) => setField(f.key, e.target.value)} />
                  )}
                </Field>
              ),
            )}
          </div>

          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="toolbar">
              <h3 style={{ flex: 1 }}>Caption</h3>
              <button className="btn btn-sm btn-ghost" onClick={rebuildCaption} title="Settings → caption pattern">
                <Sparkles size={14} /> Write from the text
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => navigator.clipboard?.writeText(caption).then(() => toast('success', 'Caption copied'))}>
                <Copy size={14} /> Copy
              </button>
            </div>
            <textarea className="input" rows={7} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="What you write under the post…" />
            <span className={`dim ${caption.length > 2200 ? 'text-danger' : ''}`} style={{ fontSize: 12 }}>
              {caption.length} / 2200 characters (Instagram's limit; Telegram shows the first 1024)
            </span>
          </div>

          <PublishPanel ensureSaved={() => save.mutateAsync()} caption={caption} still={still} video={video} slug={slug} download={download} results={full.data?.results ?? initial?.results ?? []} />
        </div>

        <div className="social-stage">
          <canvas ref={canvas} />
          {recording !== null && (
            <div className="alert alert-info">
              Recording the video… {Math.round(recording * 100)}% — keep this tab open and visible.
            </div>
          )}
          <div className="toolbar">
            <button className="btn btn-sm" onClick={() => setPlaying(!playing)} disabled={recording !== null}>
              {playing ? <Square size={14} /> : <Play size={14} />} {playing ? 'Show finished picture' : 'Play animation'}
            </button>
            <button className="btn btn-sm" disabled={!assets || recording !== null} onClick={async () => download(await still(), `${slug}.jpg`)}>
              <Download size={14} /> Picture (JPG)
            </button>
            <button className="btn btn-sm" disabled={!assets || recording !== null || !videoType()} onClick={makeVideo} title={videoType() ? 'Records the 6-second animation' : 'This browser cannot make videos'}>
              <Film size={14} /> {video ? 'Make video again' : 'Make video'}
            </button>
          </div>
          {video && (
            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <video src={video.url} controls loop muted playsInline style={{ width: '100%', borderRadius: 8 }} />
              <button className="btn btn-sm" onClick={() => download(video.blob, `${slug}.${video.blob.type.includes('mp4') ? 'mp4' : 'webm'}`)}>
                <Download size={14} /> Download video ({video.blob.type.includes('mp4') ? 'MP4' : 'WebM'})
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ImageField({ label, value, onChange }: { label: string; value: unknown; onChange(v: string | null): void }) {
  const file = useRef<HTMLInputElement>(null);
  const { toast } = useApp();
  const v = typeof value === 'string' ? value : '';
  const isData = v.startsWith('data:') || v.startsWith('upload:');
  return (
    <Field label={label}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="toolbar">
          <input
            className="input"
            style={{ flex: 1, minWidth: 160 }}
            placeholder="Picture address (https://…) or upload"
            value={isData ? '' : v}
            onChange={(e) => onChange(e.target.value.trim() || null)}
          />
          <button type="button" className="btn btn-sm" onClick={() => file.current?.click()}>
            <ImagePlus size={14} /> Upload
          </button>
          {v && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(null)} title="Remove">
              <X size={14} />
            </button>
          )}
        </div>
        {isData && <span className="dim" style={{ fontSize: 12 }}>Uploaded picture in use.</span>}
        <div className="toolbar" style={{ gap: 6 }}>
          <span className="dim" style={{ fontSize: 12 }}>
            Brand pictures:
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange('/brand/merch-black.jpg')}>
            Black merch
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange('/brand/merch-white.jpg')}>
            White merch
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange('/brand/avatar.png')}>
            ZMG logo
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              onChange(await shrinkPhoto(f));
            } catch (err: any) {
              toast('error', err.message);
            }
          }}
        />
      </div>
    </Field>
  );
}

function RowsField({ value, onChange, onSub }: { value: unknown; onChange(v: string): void; onSub(s: string): void }) {
  const { toast } = useApp();
  const [period, setPeriod] = useState<'month' | 'week' | 'all'>('month');
  const fill = async () => {
    try {
      const games = await get<any[]>('/api/games');
      const g = games.find((x) => x.active) ?? games[0];
      if (!g) return toast('warning', 'No games in Leaderboard yet');
      const b = await get<any>(`/api/leaderboard?gameId=${g.id}&period=${period}`);
      const rows = (b.rows ?? []).slice(0, 10).map((r: any) => `${r.name}, ${r.points} pts`);
      if (!rows.length) return toast('info', 'No results for that period yet');
      onChange(rows.join('\n'));
      onSub(`${g.name} · ${period === 'month' ? 'This month' : period === 'week' ? 'This week' : 'All time'}`);
    } catch (e: any) {
      toast('error', e.message);
    }
  };
  return (
    <Field label="Players" hint="One per line: name, score (top 3 are highlighted)">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea className="input mono" rows={8} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} placeholder={'Kwame, 24 pts\nAma, 21 pts'} />
        <div className="toolbar">
          <select className="select" style={{ width: 140 }} value={period} onChange={(e) => setPeriod(e.target.value as any)}>
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="all">All time</option>
          </select>
          <button type="button" className="btn btn-sm" onClick={fill}>
            <RefreshCw size={14} /> Fill from your rankings
          </button>
        </div>
      </div>
    </Field>
  );
}

// ───────── Posting ─────────

const MANUAL = [
  { key: 'tiktok', label: 'TikTok', url: 'https://www.tiktok.com/upload' },
  { key: 'youtube', label: 'YouTube Shorts', url: 'https://studio.youtube.com' },
  { key: 'x', label: 'X (Twitter)', url: 'https://x.com/compose/post' },
  { key: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/' },
  { key: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/' },
  { key: 'snapchat', label: 'Snapchat', url: 'https://www.snapchat.com/' },
  { key: 'whatsapp', label: 'WhatsApp status', url: 'https://web.whatsapp.com/' },
];

function PublishPanel(props: {
  ensureSaved(): Promise<SocialPost>;
  caption: string;
  still(): Promise<Blob>;
  video: { blob: Blob; url: string } | null;
  slug: string;
  download(b: Blob, name: string): void;
  results: SocialPost['results'];
}) {
  const { toast } = useApp();
  const qc = useQueryClient();
  const acc = useQuery({ queryKey: ['social', 'accounts'], queryFn: () => get<any>('/api/social/accounts') });
  const [chosen, setChosen] = useState<string[]>(['portal']);
  const [what, setWhat] = useState<'picture' | 'video'>('picture');
  const [results, setResults] = useState(props.results);
  useEffect(() => setResults(props.results), [props.results]);
  useEffect(() => {
    if (acc.data) setChosen((c) => Array.from(new Set([...c, ...(['facebook', 'instagram', 'telegram'] as const).filter((k) => acc.data[k]?.connected)])));
  }, [acc.data]);
  useEffect(() => {
    if (!props.video) setWhat('picture');
  }, [props.video]);
  const toggle = (k: string) => setChosen((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));

  const publish = useMutation({
    mutationFn: async () => {
      const row = await props.ensureSaved();
      const pic = await props.still();
      const thumb = await blobToDataUrl(pic);
      const media = what === 'video' && props.video ? await blobToDataUrl(props.video.blob) : thumb;
      return post<{ results: SocialPost['results'] }>(`/api/social/posts/${row.id}/publish`, { platforms: chosen, caption: props.caption, media, thumb: thumb.length < 1_400_000 ? thumb : undefined });
    },
    onSuccess: (r) => {
      setResults((x) => [...x, ...r.results]);
      qc.invalidateQueries({ queryKey: ['social'] });
      const good = r.results.filter((x) => x.ok).length;
      toast(good === r.results.length ? 'success' : good ? 'warning' : 'error', `Posted to ${good} of ${r.results.length}`);
    },
  });

  const share = async () => {
    try {
      const blob = what === 'video' && props.video ? props.video.blob : await props.still();
      const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('webm') ? 'webm' : 'jpg';
      const file = new File([blob], `${props.slug}.${ext}`, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.clipboard?.writeText(props.caption).catch(() => undefined);
        await navigator.share({ files: [file], text: props.caption });
      } else {
        props.download(blob, file.name);
        await navigator.clipboard?.writeText(props.caption).catch(() => undefined);
        toast('info', 'Downloaded, and the caption is copied — paste it in the app');
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') toast('error', e.message ?? String(e));
    }
  };
  const mark = useMutation({
    mutationFn: async (k: string) => {
      const row = await props.ensureSaved();
      return post<SocialPost>(`/api/social/posts/${row.id}/mark-posted`, { platforms: [k] });
    },
    onSuccess: (row) => {
      setResults(row.results);
      qc.invalidateQueries({ queryKey: ['social'] });
    },
  });

  const status = (k: string) => (k === 'portal' ? { connected: true } : acc.data?.[k]);
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3>Post it</h3>
      {props.video && (
        <Segmented
          value={what}
          onChange={setWhat}
          options={[
            { value: 'picture', label: 'Post the picture' },
            { value: 'video', label: 'Post the video' },
          ]}
        />
      )}
      <div className="platform-list">
        {(['facebook', 'instagram', 'telegram', 'portal'] as const).map((k) => {
          const s = status(k);
          return (
            <label key={k} className="check" title={s?.connected ? '' : 'Not connected yet (Accounts & settings)'}>
              <input type="checkbox" disabled={!s?.connected} checked={!!s?.connected && chosen.includes(k)} onChange={() => toggle(k)} /> {PLATFORM_NAMES[k]}
              {!s?.connected && <span className="dim"> (connect)</span>}
            </label>
          );
        })}
      </div>
      <ErrorBox error={publish.error} />
      <button className="btn btn-primary" disabled={publish.isPending || !chosen.length} onClick={() => publish.mutate()}>
        <Send size={16} /> {publish.isPending ? 'Posting…' : `Post ${what === 'video' ? 'video' : 'picture'} now`}
      </button>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>Post it yourself (TikTok, YouTube, X, Snapchat, WhatsApp…)</strong>
        <span className="dim" style={{ fontSize: 12 }}>
          On a phone, <b>Share</b> opens the app with the {what === 'video' ? 'video' : 'picture'} ready (the caption is copied — paste it). On a PC it downloads the file.
        </span>
        <div className="toolbar">
          <button className="btn btn-sm" onClick={share}>
            <Share2 size={14} /> Share…
          </button>
          {MANUAL.map((m) => (
            <a key={m.key} className="btn btn-sm btn-ghost" href={m.url} target="_blank" rel="noreferrer">
              {m.label} <ExternalLink size={12} />
            </a>
          ))}
        </div>
        <div className="toolbar" style={{ gap: 6 }}>
          <span className="dim" style={{ fontSize: 12 }}>
            I posted it on:
          </span>
          {MANUAL.map((m) => (
            <button key={m.key} className="btn btn-sm" disabled={mark.isPending} onClick={() => mark.mutate(m.key)}>
              <Check size={12} /> {m.label}
            </button>
          ))}
        </div>
      </div>

      {results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <strong style={{ fontSize: 13 }}>Where it went</strong>
          {results.map((r, i) => (
            <div key={i} style={{ fontSize: 13 }}>
              {r.ok ? '✅' : '❌'} {PLATFORM_NAMES[r.platform] ?? r.platform} · {new Date(r.at).toLocaleString()}
              {r.url && (
                <>
                  {' '}
                  ·{' '}
                  <a href={r.url} target="_blank" rel="noreferrer">
                    open ↗
                  </a>
                </>
              )}
              {!r.ok && r.error && <div className="dim">{r.error}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────── Page updates ─────────

function Updates() {
  const [force, setForce] = useState(0);
  const q = useQuery({ queryKey: ['social', 'insights', force], queryFn: () => get<any>(`/api/social/insights${force ? '?force=1' : ''}`) });
  const n = (v: unknown) => (typeof v === 'number' ? v.toLocaleString() : '—');
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <div className="muted">Loading page numbers…</div>;
  const d = q.data;
  const none = !d.facebook && !d.instagram && !d.telegram;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="toolbar">
        <span className="dim" style={{ flex: 1, fontSize: 12 }}>
          Checked {new Date(d.checkedAt).toLocaleTimeString()}
        </span>
        <button className="btn btn-sm" onClick={() => setForce((x) => x + 1)} disabled={q.isFetching}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <div className="stat-tiles">
        {d.facebook && !d.facebook.error && (
          <div className="card stat-tile">
            <span className="muted">Facebook followers</span>
            <span className="v">{n(d.facebook.followers)}</span>
            <span className="dim">{n(d.facebook.likes)} page likes</span>
          </div>
        )}
        {d.instagram && !d.instagram.error && (
          <div className="card stat-tile">
            <span className="muted">Instagram followers</span>
            <span className="v">{n(d.instagram.followers)}</span>
            <span className="dim">@{d.instagram.username} · {n(d.instagram.mediaCount)} posts</span>
          </div>
        )}
        {d.telegram && !d.telegram.error && (
          <div className="card stat-tile">
            <span className="muted">Telegram members</span>
            <span className="v">{n(d.telegram.members)}</span>
            <span className="dim">{d.telegram.title}</span>
          </div>
        )}
        <div className="card stat-tile">
          <span className="muted">Posted from ZENAA (30 days)</span>
          <span className="v">{n(d.zenaa?.posted30)}</span>
          <span className="dim">
            {n(d.zenaa?.ideas)} ideas · {n(d.zenaa?.drafts)} drafts waiting
          </span>
        </div>
      </div>
      {['facebook', 'instagram', 'telegram'].map((k) => d[k]?.error && <div key={k} className="error-box">{PLATFORM_NAMES[k]}: {d[k].error}</div>)}
      {none && <div className="card empty">Connect Facebook, Instagram or Telegram (Accounts & settings) to see followers and how your latest posts are doing here.</div>}
      {(['facebook', 'instagram'] as const).map(
        (k) =>
          d[k]?.posts?.length > 0 && (
            <div key={k} className="card card-pad">
              <h3>Latest on {PLATFORM_NAMES[k]}</h3>
              {d[k].posts.map((p: any, i: number) => (
                <a key={i} className="feed-post" href={p.url} target="_blank" rel="noreferrer">
                  {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span />}
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{p.text || '(no text)'}</span>
                    <span className="dim" style={{ fontSize: 12 }}>
                      {new Date(p.at).toLocaleString()} · ❤ {n(p.reactions ?? p.likes)} · 💬 {n(p.comments)}
                      {p.shares != null ? ` · ↗ ${n(p.shares)}` : ''}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          ),
      )}
    </div>
  );
}

// ───────── Accounts & settings ─────────

function Accounts() {
  const { settings, toast } = useApp();
  const qc = useQueryClient();
  const acc = useQuery({ queryKey: ['social', 'accounts'], queryFn: () => get<any>('/api/social/accounts') });
  const [a, setA] = useState({ fbPageId: '', fbToken: '', igUserId: '', tgBotToken: '', tgChatId: '' });
  useEffect(() => {
    if (acc.data) setA((x) => ({ ...x, fbPageId: acc.data.facebook.pageId, igUserId: acc.data.instagram.userId, tgChatId: acc.data.telegram.chatId }));
  }, [acc.data]);
  const [checkMsg, setCheckMsg] = useState<Record<string, { ok: boolean; message: string }>>({});
  const saveAcc = useMutation({
    mutationFn: async (disconnect?: string) => {
      await put('/api/social/accounts', disconnect ? { disconnect: [disconnect] } : a);
      const r = await post<any>('/api/social/accounts/check');
      return r;
    },
    onSuccess: (r) => {
      setCheckMsg(r.result);
      setA((x) => ({ ...x, fbToken: '', tgBotToken: '' }));
      qc.invalidateQueries({ queryKey: ['social'] });
    },
  });

  const [s, setS] = useState(settings.social);
  const [links, setLinks] = useState(settings.socialLinks);
  useEffect(() => {
    setS(settings.social);
    setLinks(settings.socialLinks);
  }, [settings.social, settings.socialLinks]);
  const saveSettings = useMutation({
    mutationFn: () => put('/api/settings', { ...settings, social: s, socialLinks: links }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast('success', 'Saved');
    },
  });
  const d = acc.data;
  const tick = (ok?: boolean) => (ok ? <span className="badge badge-success">Connected</span> : <span className="badge">Not connected</span>);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Post directly</h2>
        <ErrorBox error={saveAcc.error} />
        <div className="toolbar">
          <h3 style={{ flex: 1 }}>Facebook Page</h3>
          {tick(d?.facebook.connected)}
        </div>
        {d?.facebook.pageName && <span className="muted">{d.facebook.pageName}</span>}
        <Field label="Page ID" hint="Facebook → your Page → About → Page transparency (a long number)">
          <input className="input mono" value={a.fbPageId} onChange={(e) => setA({ ...a, fbPageId: e.target.value.trim() })} />
        </Field>
        <Field label="Page access token" hint={d?.facebook.connected ? 'Saved — leave empty to keep it' : 'See Help → 23 for how to get a long-lasting token'}>
          <input className="input mono" type="password" autoComplete="off" value={a.fbToken} onChange={(e) => setA({ ...a, fbToken: e.target.value.trim() })} placeholder={d?.facebook.connected ? '••••••••' : 'EAAB…'} />
        </Field>
        <div className="toolbar">
          <h3 style={{ flex: 1 }}>Instagram</h3>
          {tick(d?.instagram.connected)}
        </div>
        <span className="dim" style={{ fontSize: 12 }}>
          Uses the Facebook token: link your Instagram professional account to the Facebook Page and press Save & check — it is found automatically.
          {d?.instagram.username && <b> @{d.instagram.username}</b>}
        </span>
        {d && !d.instagram.publicUrlOk && (
          <div className="hint">
            Instagram copies each picture from your ZENAA address, so ZENAA must be on the internet with https (Settings → Socials &amp; public address). Until then, use Share / Download for Instagram.
          </div>
        )}
        <div className="toolbar">
          <h3 style={{ flex: 1 }}>Telegram channel</h3>
          {tick(d?.telegram.connected)}
        </div>
        {d?.telegram.title && <span className="muted">{d.telegram.title}</span>}
        <Field label="Bot token" hint="Telegram → @BotFather → /newbot. Then add the bot to your channel as an admin.">
          <input className="input mono" type="password" autoComplete="off" value={a.tgBotToken} onChange={(e) => setA({ ...a, tgBotToken: e.target.value.trim() })} placeholder={d?.telegram.connected ? '••••••••' : '123456:ABC…'} />
        </Field>
        <Field label="Channel">
          <input className="input mono" value={a.tgChatId} onChange={(e) => setA({ ...a, tgChatId: e.target.value.trim() })} placeholder="@yourchannel" />
        </Field>
        {Object.entries(checkMsg).map(([k, v]) => (
          <div key={k} className={v.ok ? 'alert alert-info' : 'error-box'}>
            {PLATFORM_NAMES[k]}: {v.message}
          </div>
        ))}
        <div className="toolbar">
          <button className="btn btn-primary" disabled={saveAcc.isPending} onClick={() => saveAcc.mutate(undefined)}>
            <Save size={16} /> Save & check
          </button>
          {d?.facebook.connected && (
            <button className="btn btn-ghost" onClick={() => window.confirm('Disconnect Facebook and Instagram?') && saveAcc.mutate('facebook')}>
              Disconnect Facebook
            </button>
          )}
          {d?.telegram.connected && (
            <button className="btn btn-ghost" onClick={() => saveAcc.mutate('telegram')}>
              Disconnect Telegram
            </button>
          )}
        </div>
        <span className="dim" style={{ fontSize: 12 }}>
          TikTok, YouTube, X, Snapchat and WhatsApp don't let small businesses post automatically without a paid or approved developer app, so ZENAA gives you the finished file and caption to post there in two taps (Share).
          Tokens stay on the ZENAA server and are never shown again.
        </span>
      </div>

      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Daily ideas & captions</h2>
        <ErrorBox error={saveSettings.error} />
        <label className="check">
          <input type="checkbox" checked={s.ideasOn} onChange={(e) => setS({ ...s, ideasOn: e.target.checked })} /> Make post ideas from game news every day
        </label>
        <div className="form-grid">
          <Field label="At">
            <input className="input" type="time" value={s.ideasTime} onChange={(e) => setS({ ...s, ideasTime: e.target.value || '09:00' })} />
          </Field>
          <Field label="Ideas per day">
            <input className="input" type="number" min={1} max={10} value={s.ideasPerDay} onChange={(e) => setS({ ...s, ideasPerDay: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="Text me when ideas are ready" hint="Sent by the MoMo phone (ZENAA MoMo app). Empty = alert in ZENAA only." full>
            <input className="input" value={s.notifyPhone} onChange={(e) => setS({ ...s, notifyPhone: e.target.value })} placeholder="024 000 0000" />
          </Field>
        </div>
        <span className="dim" style={{ fontSize: 12 }}>
          News comes from the websites in <Link to="/news">News &amp; posters → Outside news</Link> ({settings.newsFeeds.length} set).
        </span>
        <Field label="Handle printed on graphics" hint="e.g. @zenaamegagames">
          <input className="input" value={s.handle} onChange={(e) => setS({ ...s, handle: e.target.value })} />
        </Field>
        <Field label="Hashtags">
          <input className="input" value={s.hashtags} onChange={(e) => setS({ ...s, hashtags: e.target.value })} />
        </Field>
        <Field label="Caption pattern" hint="{title} {summary} {source} {link} {centre} {hashtags} {handle}">
          <textarea className="input" rows={5} value={s.captionTemplate} onChange={(e) => setS({ ...s, captionTemplate: e.target.value })} />
        </Field>
        <h3>Brand colours for graphics</h3>
        <div className="form-grid">
          {(
            [
              ['brandDark', 'Dark (navy)'],
              ['brandMain', 'Main (blue)'],
              ['brandPop', 'Highlight (lime)'],
              ['brandLight', 'Light (pale lime)'],
            ] as const
          ).map(([k, l]) => (
            <Field key={k} label={l}>
              <div className="color-input">
                <input type="color" value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} />
                <span className="mono">{s[k]}</span>
              </div>
            </Field>
          ))}
        </div>
        <h3>Your social pages</h3>
        <span className="dim" style={{ fontSize: 12 }}>
          Shown in the customer app ("Follow us") and on QR posters.
        </span>
        <div className="form-grid">
          {(Object.keys(links) as (keyof typeof links)[]).map((k) => (
            <Field key={k} label={k === 'x' ? 'X (Twitter)' : k[0].toUpperCase() + k.slice(1)}>
              <input className="input" value={links[k]} onChange={(e) => setLinks({ ...links, [k]: e.target.value })} placeholder={k === 'whatsapp' ? '0240000000' : 'https://…'} />
            </Field>
          ))}
        </div>
        <button className="btn btn-primary" disabled={saveSettings.isPending} onClick={() => saveSettings.mutate()}>
          <Save size={16} /> Save
        </button>
      </div>
    </div>
  );
}
