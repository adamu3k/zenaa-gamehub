import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Clock, Copy, ExternalLink, Flag, Gift, MessageCircle, MessagesSquare, Send, Swords, Ticket } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar } from '../competitions/ui';
import { ErrorBox } from '../components/ui';
import { formatDateTime, formatTime } from '../lib/format';
import { SOCIALS } from './PortalExtras';
import { pget, ppost } from './portal-api';
import { PeopleFinder } from './PortalPlay';

// ───────────────────────── Chat ─────────────────────────

const seenKey = (to: string) => `zenaa.chat.seen.${to}`;
const getSeen = (to: string) => {
  try {
    return Number(localStorage.getItem(seenKey(to)) ?? 0);
  } catch {
    return 0;
  }
};
const setSeen = (to: string, n: number) => {
  try {
    if (n > getSeen(to)) localStorage.setItem(seenKey(to), String(n));
  } catch {
    /* private mode */
  }
};

/** Unread private conversations (for the nav badge). */
export function useChatUnread(enabled: boolean) {
  const q = useQuery({ queryKey: ['portal', 'chat', 'threads'], queryFn: () => pget<any>('/api/portal/chat'), enabled, refetchInterval: 20_000, retry: false });
  const dms = (q.data?.threads ?? []).filter((t: any) => !t.lastMine && t.lastNumber > getSeen(t.to)).length;
  const lobby = !!q.data && q.data.lobby.lastNumber > getSeen('lobby');
  return { dms, lobby };
}

export function PortalChat() {
  const [params, setParams] = useSearchParams();
  const to = params.get('to') || 'lobby';
  const threads = useQuery({ queryKey: ['portal', 'chat', 'threads'], queryFn: () => pget<any>('/api/portal/chat'), refetchInterval: 10_000 });
  const open = (id: string, name?: string) => setParams(id === 'lobby' ? {} : { to: id, ...(name ? { name } : {}) });
  const list = (threads.data?.threads ?? []) as any[];
  return (
    <>
      <h1 style={{ margin: '4px 0 0' }}>
        <MessagesSquare size={22} style={{ verticalAlign: -3 }} /> Chat
      </h1>
      <ErrorBox error={threads.error} />
      <div className={`pc-wrap ${to !== 'lobby' ? 'in-dm' : ''}`}>
        <div className="card pc-threads">
          <button className={`pc-thread ${to === 'lobby' ? 'active' : ''}`} onClick={() => open('lobby')}>
            <span className="pc-ico">
              <MessagesSquare size={18} />
            </span>
            <span className="pc-thread-main">
              <strong>Lobby</strong>
              <span className="dim">Everyone at the centre</span>
            </span>
            {threads.data && threads.data.lobby.lastNumber > getSeen('lobby') && to !== 'lobby' && <span className="pc-dot" />}
          </button>
          <PeopleFinder onOpen={(id, name) => open(id, name)} />
          <div className="dim pc-sub">Private messages</div>
          {list.length === 0 && <div className="dim pc-empty">Find a player above, tap a name in the Lobby, or "Message" in Find match, to talk privately.</div>}
          {list.map((t) => (
            <button key={t.to} className={`pc-thread ${to === t.to ? 'active' : ''}`} onClick={() => open(t.to, t.name)}>
              <Avatar name={t.name} src={t?.avatarUrl} size={34} />
              <span className="pc-thread-main">
                <strong>{t.name}</strong>
                <span className="dim">
                  {t.lastMine ? 'You: ' : ''}
                  {t.lastText}
                </span>
              </span>
              {!t.lastMine && t.lastNumber > getSeen(t.to) && to !== t.to && <span className="pc-dot" />}
            </button>
          ))}
        </div>
        <Conversation key={to} to={to} fallbackName={params.get('name') ?? 'Player'} onBack={() => open('lobby')} onOpen={open} />
      </div>
    </>
  );
}

function Conversation({ to, fallbackName, onBack, onOpen }: { to: string; fallbackName: string; onBack(): void; onOpen(id: string, name: string): void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['portal', 'chat', 'messages', to], queryFn: () => pget<any>(`/api/portal/chat/messages?to=${encodeURIComponent(to)}`), refetchInterval: 3_000 });
  const send = useMutation({
    mutationFn: () => ppost('/api/portal/chat/messages', { to, body: text }),
    onSuccess: () => {
      setText('');
      qc.invalidateQueries({ queryKey: ['portal', 'chat'] });
    },
  });
  const report = useMutation({ mutationFn: (id: string) => ppost(`/api/portal/chat/messages/${id}/report`), onSuccess: () => setPicked(null) });
  const msgs = (q.data?.messages ?? []) as any[];
  const last = msgs.length ? msgs[msgs.length - 1].number : 0;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
    if (last) setSeen(to, last);
  }, [last, to]);
  const title = to === 'lobby' ? 'Lobby' : (q.data?.other?.name ?? fallbackName);
  return (
    <div className="card pc-conv">
      <div className="pc-conv-head">
        {to !== 'lobby' && (
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onBack} aria-label="Back to the lobby">
            <ArrowLeft size={18} />
          </button>
        )}
        {to === 'lobby' ? <MessagesSquare size={20} /> : <Avatar name={title} size={30} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>{title}</strong>
          <div className="dim" style={{ fontSize: 12 }}>
            {to === 'lobby' ? 'Everyone can read this. Be kind — staff remove bad messages.' : 'Private · staff can read chats to keep everyone safe'}
          </div>
        </div>
        {to !== 'lobby' && (
          <button className="btn btn-sm" onClick={() => nav(`/portal/match?challenge=${to}&name=${encodeURIComponent(title)}`)}>
            <Swords size={14} /> Challenge
          </button>
        )}
      </div>
      <ErrorBox error={q.error || send.error || report.error} />
      <div className="pc-scroll">
        {msgs.length === 0 && !q.isLoading && <div className="dim pc-empty">{to === 'lobby' ? 'No messages yet — say hi 👋' : `Say hi to ${title} 👋`}</div>}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1];
          const showName = !m.mine && (!prev || prev.from.id !== m.from.id || prev.from.staff !== m.from.staff);
          return (
            <div key={m.id} className={`pc-msg ${m.mine ? 'mine' : ''} ${m.from.staff ? 'staff' : ''}`}>
              {showName && (
                <button className="pc-name" disabled={m.from.staff || to !== 'lobby'} onClick={() => setPicked(picked === m.id ? null : m.id)}>
                  {!m.from.staff && <Avatar name={m.from.name} size={18} src={m.from.avatarUrl} />} {m.from.name}
                  {m.from.staff && <span className="badge badge-primary">staff</span>}
                </button>
              )}
              <div className="pc-bubble" onClick={() => !m.mine && !m.from.staff && setPicked(picked === m.id ? null : m.id)}>
                {m.deleted ? <i className="dim">Message removed</i> : m.body}
                <span className="pc-time">{formatTime(m.createdAt)}</span>
              </div>
              {picked === m.id && !m.mine && !m.from.staff && (
                <div className="toolbar pc-actions">
                  {to === 'lobby' && m.from.id && (
                    <button className="btn btn-sm" onClick={() => onOpen(m.from.id, m.from.name)}>
                      <MessageCircle size={13} /> Message {m.from.name}
                    </button>
                  )}
                  {m.from.id && (
                    <button className="btn btn-sm" onClick={() => nav(`/portal/match?challenge=${m.from.id}&name=${encodeURIComponent(m.from.name)}`)}>
                      <Swords size={13} /> Challenge
                    </button>
                  )}
                  {!m.deleted && (
                    <button className="btn btn-sm btn-ghost" onClick={() => report.mutate(m.id)}>
                      <Flag size={13} /> Report
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {q.data?.muted ? (
        <div className="hint" style={{ margin: 12 }}>
          Staff have paused your chat. You can still read messages — ask at the counter.
        </div>
      ) : (
        <form
          className="pc-compose"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() && !send.isPending) send.mutate();
          }}
        >
          <input className="input" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={to === 'lobby' ? 'Message everyone…' : `Message ${title}…`} enterKeyHint="send" />
          <button className="btn btn-primary btn-icon" disabled={!text.trim() || send.isPending} aria-label="Send">
            <Send size={17} />
          </button>
        </form>
      )}
    </div>
  );
}

// ───────────────────────── Rewards ─────────────────────────

function copyText(t: string, done: () => void) {
  try {
    navigator.clipboard.writeText(t).then(done, done);
  } catch {
    done();
  }
}

function CodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="rw-code" onClick={() => copyText(code, () => (setCopied(true), setTimeout(() => setCopied(false), 1500)))} title="Copy">
      <span className="mono">{code}</span> {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

export function PortalRewards({ money }: { money(n: number): string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['portal', 'rewards'], queryFn: () => pget<any>('/api/portal/rewards') });
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [handles, setHandles] = useState<Record<string, string>>({});
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<ReactNode>(null);
  const done = () => {
    qc.invalidateQueries({ queryKey: ['portal', 'rewards'] });
    qc.invalidateQueries({ queryKey: ['portal', 'me'] });
  };
  const claim = useMutation({
    mutationFn: (id: string) => ppost<any>(`/api/portal/rewards/${id}/claim`, { handle: handles[id] ?? '' }),
    onSuccess: (r) => {
      setMsg(r.status === 'approved' ? `🎉 ${money(r.bonusAmount)} added to your wallet!` : 'Thanks! Staff will check and add your bonus soon.');
      done();
    },
  });
  const redeem = useMutation({
    mutationFn: () => ppost<any>('/api/portal/rewards/code', { code }),
    onSuccess: (r) => {
      setCode('');
      setMsg(
        <>
          🎉 {r.title}: {r.bonusAmount > 0 ? `${money(r.bonusAmount)} added to your wallet` : 'unlocked'}
          {r.promoCode && (
            <>
              {' '}
              · your promo code: <CodeChip code={r.promoCode} />
            </>
          )}
        </>,
      );
      done();
    },
  });
  const d = q.data;
  const follow = (d?.follow ?? []) as any[];
  const total = follow.filter((o) => !o.status).reduce((n, o) => n + o.bonusAmount, 0);
  return (
    <>
      <div className="rw-hero">
        <Gift size={30} />
        <div>
          <h1>Rewards</h1>
          <div>{total > 0 ? `Follow us and earn up to ${money(total)} of free play` : 'Free play and discounts for our fans'}</div>
        </div>
      </div>
      <ErrorBox error={q.error || claim.error || redeem.error} />
      {msg && (
        <div className="card card-pad rw-msg" onClick={() => setMsg(null)}>
          {msg}
        </div>
      )}

      {follow.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Follow & subscribe</h2>
          </div>
          <div className="list">
            {follow.map((o) => {
              const s = SOCIALS.find((x) => x.key === o.platform);
              return (
                <div key={o.id} className="rw-item">
                  <span className="rw-emoji" aria-hidden>
                    {s?.emoji ?? '⭐'}
                  </span>
                  <div className="rw-main">
                    <strong>{o.title}</strong>
                    <span className="dim" style={{ fontSize: 13 }}>
                      {o.bonusAmount > 0 && <b style={{ color: 'var(--success)' }}>+{money(o.bonusAmount)}</b>}
                      {o.bonusAmount > 0 && o.hasPromoCode && ' + '}
                      {o.hasPromoCode && 'a promo code'}
                      {o.description ? ` · ${o.description}` : ''}
                    </span>
                    {o.status === 'approved' && (
                      <span className="rw-status ok">
                        <Check size={14} /> Done — bonus added{o.promoCode && <> · promo code <CodeChip code={o.promoCode} /></>}
                      </span>
                    )}
                    {o.status === 'pending' && (
                      <span className="rw-status wait">
                        <Clock size={14} /> Staff are checking — your bonus comes soon
                      </span>
                    )}
                    {o.status === 'rejected' && <span className="rw-status no">Not approved{o.note ? `: ${o.note}` : ''}. Ask at the counter.</span>}
                    {!o.status && (
                      <div className="rw-steps">
                        <a className="btn btn-sm" href={o.url} target="_blank" rel="noreferrer" onClick={() => setOpened({ ...opened, [o.id]: true })}>
                          1. Open {s?.label ?? 'the page'} <ExternalLink size={12} />
                        </a>
                        {(opened[o.id] || handles[o.id]) && (
                          <form
                            className="rw-claim"
                            onSubmit={(e) => {
                              e.preventDefault();
                              claim.mutate(o.id);
                            }}
                          >
                            <input
                              className="input"
                              value={handles[o.id] ?? ''}
                              onChange={(e) => setHandles({ ...handles, [o.id]: e.target.value })}
                              placeholder={`Your ${s?.label ?? ''} username`}
                              maxLength={60}
                            />
                            <button className="btn btn-primary btn-sm" disabled={(handles[o.id] ?? '').trim().length < 2 || claim.isPending}>
                              2. I followed — get bonus
                            </button>
                          </form>
                        )}
                        {!opened[o.id] && !handles[o.id] && <span className="dim" style={{ fontSize: 12 }}>Follow, then come back here.</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {d?.hasCodes && (
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ margin: 0 }}>
            <Ticket size={18} style={{ verticalAlign: -3 }} /> Have a bonus code?
          </h2>
          <div className="dim" style={{ fontSize: 13 }}>
            We share codes on our live streams, posters and WhatsApp status.
          </div>
          <form
            className="rw-claim"
            onSubmit={(e) => {
              e.preventDefault();
              redeem.mutate();
            }}
          >
            <input className="input mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" maxLength={30} autoCapitalize="characters" />
            <button className="btn btn-primary" disabled={!code.trim() || redeem.isPending}>
              Redeem
            </button>
          </form>
          {(d?.redeemed ?? []).length > 0 && (
            <div className="dim" style={{ fontSize: 12 }}>
              Used: {(d.redeemed as any[]).map((r) => `${r.title} (${money(r.bonusAmount)})`).join(', ')}
            </div>
          )}
        </div>
      )}

      {(d?.packages ?? []).length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>
              <Gift size={18} style={{ verticalAlign: -3 }} /> Play more, get more
            </h2>
            <span className="dim" style={{ fontSize: 12 }}>
              Bonuses are added to your account automatically
            </span>
          </div>
          <div className="list">
            {(d.packages as any[]).map((p) => {
              const pct = Math.min(100, Math.round((p.progress / p.target) * 100));
              const show = (v: number) => (p.goal === 'spend' ? money(v) : playTime(v));
              const prize = [p.bonusAmount > 0 && `${money(p.bonusAmount)} bonus`, p.bonusMinutes > 0 && `${playTime(p.bonusMinutes)} free`].filter(Boolean).join(' + ');
              const when = p.period === 'day' ? 'today' : p.period === 'week' ? 'this week' : p.period === 'month' ? 'this month' : p.validTo ? `by ${formatDateTime(p.validTo)}` : '';
              const again = p.period === 'once' ? 'Watch out for the next offer.' : `Come back ${p.period === 'day' ? 'tomorrow' : `next ${p.period}`} for another bonus.`;
              return (
                <div key={p.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>
                      <strong>{p.name}</strong>
                      <div className="dim" style={{ fontSize: 12 }}>
                        {p.description || `${p.goal === 'spend' ? 'Spend' : 'Play'} ${show(p.target)} ${when} → ${prize}`}
                      </div>
                    </span>
                    {p.earned ? <span className="badge badge-success">✓ Bonus added</span> : <span className="badge badge-info">{prize}</span>}
                  </div>
                  <div style={{ height: 8, borderRadius: 99, background: 'rgba(127,127,127,.25)', overflow: 'hidden' }}>
                    <div style={{ width: `${p.earned ? 100 : pct}%`, height: '100%', background: p.earned ? '#22c55e' : 'var(--primary, #1d44f9)' }} />
                  </div>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {p.earned ? `Done ${when}. ${again}` : `${show(p.progress)} of ${show(p.target)} ${when}`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(d?.promoCodes ?? []).length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Promo codes</h2>
            <span className="dim" style={{ fontSize: 12 }}>
              Give the code at the counter when you pay
            </span>
          </div>
          <div className="list">
            {(d.promoCodes as any[]).map((p) => (
              <div key={p.code} className="list-item">
                <span>
                  <strong>{p.percentOff != null ? `${p.percentOff}% off` : `${money(p.amountOff)} off`}</strong>
                  {p.description && <span className="dim"> · {p.description}</span>}
                  <div className="dim" style={{ fontSize: 12 }}>
                    {p.minSpend > 0 ? `Spend ${money(p.minSpend)} or more` : 'Any spend'}
                    {p.validTo ? ` · until ${formatDateTime(p.validTo)}` : ''}
                  </div>
                </span>
                <CodeChip code={p.code} />
              </div>
            ))}
          </div>
        </div>
      )}

      {d && follow.length === 0 && !d.hasCodes && (d.promoCodes ?? []).length === 0 && (d.packages ?? []).length === 0 && <div className="card card-pad muted">No rewards right now — check back soon.</div>}
    </>
  );
}

/** Home page: a small "earn free play" card when there is something to claim. */
export function RewardsTeaser({ money }: { money(n: number): string }) {
  const q = useQuery({ queryKey: ['portal', 'rewards'], queryFn: () => pget<any>('/api/portal/rewards'), retry: false, staleTime: 60_000 });
  const open = useMemo(() => ((q.data?.follow ?? []) as any[]).filter((o) => !o.status), [q.data]);
  if (!open.length && !q.data?.hasCodes) return null;
  const total = open.reduce((n, o) => n + o.bonusAmount, 0);
  return (
    <Link to="/portal/rewards" className="card rw-teaser">
      <Gift size={26} />
      <span style={{ flex: 1 }}>
        <strong>{total > 0 ? `Get ${money(total)} free play` : 'Rewards waiting'}</strong>
        <span className="dim" style={{ display: 'block', fontSize: 13 }}>
          {open.length ? `Follow us on ${open.map((o) => SOCIALS.find((s) => s.key === o.platform)?.label ?? 'our page').join(', ')}` : 'Have a bonus code? Redeem it here'}
        </span>
      </span>
      <span className="btn btn-sm btn-primary">Open</span>
    </Link>
  );
}

/** Phones: every page, since the bottom bar only has room for five. */
export function MorePage({ items, onSignOut }: { items: { to: string; label: string; icon: any; badge?: ReactNode }[]; onSignOut(): void }) {
  return (
    <>
      <h1 style={{ margin: '4px 0 0' }}>More</h1>
      <div className="more-grid">
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} className="card more-tile">
            <n.icon size={24} />
            <span>{n.label}</span>
            {n.badge}
          </NavLink>
        ))}
      </div>
      <button className="btn" onClick={onSignOut}>
        Sign out
      </button>
    </>
  );
}

/** 90 → "1 h 30 min". */
function playTime(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}
