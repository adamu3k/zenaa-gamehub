import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eraser, Flag, MessageCircleOff, MessagesSquare, RefreshCw, Search, Send, Trash2, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBox, PageHeader } from '../components/ui';
import { del, get, post } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDateTime } from '../lib/format';

/** Round profile picture, or the first letters of the name on a colour made from the name. */
export function Avatar({ name, url, size = 34, staff }: { name: string; url?: string | null; size?: number; staff?: boolean }) {
  const [broken, setBroken] = useState(false);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return url && !broken ? (
    <img className="chat-avatar" src={url} alt="" width={size} height={size} style={{ width: size, height: size }} onError={() => setBroken(true)} loading="lazy" />
  ) : (
    <span
      className="chat-avatar"
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.4, background: staff ? 'var(--primary)' : `hsl(${h} 55% 42%)` }}
    >
      {initials || '?'}
    </span>
  );
}

/** Staff view of the customer chat: read every room, post as the venue, delete messages, mute players. */
export function ChatPage() {
  const { settings, toast, can } = useApp();
  const qc = useQueryClient();
  const [room, setRoom] = useState('lobby');
  const [text, setText] = useState('');
  const [find, setFind] = useState('');
  const rooms = useQuery({ queryKey: ['chat', 'rooms'], queryFn: () => get<any[]>('/api/chat/rooms'), refetchInterval: 10_000 });
  const msgs = useQuery({
    queryKey: ['chat', 'messages', room],
    queryFn: () => get<any>(`/api/chat/messages?room=${encodeURIComponent(room)}`),
    refetchInterval: 4_000,
    placeholderData: (prev) => (prev && (prev as any).room === room ? prev : undefined),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['chat'] });
  const send = useMutation({ mutationFn: () => post('/api/chat/messages', { body: text }), onSuccess: () => (setText(''), refresh()), onError: (e: Error) => toast('error', e.message) });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/chat/messages/${id}`), onSuccess: refresh });
  const keep = useMutation({ mutationFn: (id: string) => post(`/api/chat/messages/${id}/keep`), onSuccess: refresh });
  const clear = useMutation({
    mutationFn: () => del<{ removed: number }>(`/api/chat/room?room=${encodeURIComponent(room)}`),
    onSuccess: (r) => (toast('success', `Cleared ${r.removed} message${r.removed === 1 ? '' : 's'}`), refresh()),
    onError: (e: Error) => toast('error', e.message),
  });
  const mute = useMutation({
    mutationFn: (v: { customerId: string; muted: boolean }) => post('/api/chat/mute', v),
    onSuccess: (_r, v) => (toast('success', v.muted ? 'Player muted — they can read but not write' : 'Player can chat again'), refresh()),
  });
  const scroller = useRef<HTMLDivElement>(null);
  const list = (msgs.data?.messages ?? []) as any[];
  const atBottom = useRef(true);
  // Follow new messages only when already at the bottom (so reading older ones is not interrupted).
  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [list.length, room]);
  useEffect(() => {
    atBottom.current = true;
  }, [room]);
  const reportedTotal = (rooms.data ?? []).reduce((n, r) => n + r.reported, 0);
  const f = find.trim().toLowerCase();
  const shownRooms = useMemo(() => (rooms.data ?? []).filter((r) => !f || r.title.toLowerCase().includes(f)), [rooms.data, f]);
  const current = (rooms.data ?? []).find((r) => r.room === room);
  const busy = rooms.isFetching || msgs.isFetching;
  return (
    <>
      <PageHeader
        title="Customer chat"
        subtitle={
          <>
            What customers write in the app's Chat. Delete bad messages and mute players who break the rules.{' '}
            {!settings.chatEnabled && (
              <b>
                Chat is switched off — <Link to="/settings#chat">Settings → Customer chat</Link>.
              </b>
            )}
          </>
        }
        actions={
          <button className="btn btn-sm" onClick={refresh} disabled={busy} title="Load the newest messages now">
            <RefreshCw size={14} className={busy ? 'spin' : ''} /> Refresh
          </button>
        }
      />
      <ErrorBox error={rooms.error || msgs.error || send.error || remove.error || mute.error} />
      <div className="chat-staff">
        <div className="card chat-rooms">
          <div className="card-head">
            <h2>Chats</h2>
            {reportedTotal > 0 && <span className="badge badge-danger">{reportedTotal} reported</span>}
          </div>
          {(rooms.data?.length ?? 0) > 6 && (
            <div style={{ padding: '0 12px 8px', position: 'relative' }}>
              <Search size={14} className="dim" style={{ position: 'absolute', left: 22, top: 11 }} />
              <input className="input" style={{ paddingLeft: 30 }} placeholder="Find a player…" value={find} onChange={(e) => setFind(e.target.value)} />
            </div>
          )}
          <div className="list">
            {shownRooms.map((r) => (
              <button key={r.room} className={`list-item chat-room-btn ${room === r.room ? 'active' : ''}`} onClick={() => setRoom(r.room)}>
                <span className="chat-room-pics">
                  {r.room === 'lobby' ? (
                    <span className="chat-avatar" style={{ width: 34, height: 34, background: 'var(--primary)' }}>
                      <MessagesSquare size={16} />
                    </span>
                  ) : (
                    (r.people ?? []).map((p: any) => <Avatar key={p.id} name={p.name} url={p.avatarUrl} size={28} />)
                  )}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                <span className="toolbar" style={{ gap: 4 }}>
                  {r.reported > 0 && <span className="badge badge-danger">{r.reported}</span>}
                  <span className="dim num" style={{ fontSize: 12 }}>
                    {r.count}
                  </span>
                </span>
              </button>
            ))}
            {!shownRooms.length && <div className="empty-inline">No chats found</div>}
          </div>
        </div>
        <div className="card chat-panel">
          <div className="card-head">
            {current?.people?.length ? (
              <span className="chat-room-pics">
                {current.people.map((p: any) => (
                  <Avatar key={p.id} name={p.name} url={p.avatarUrl} size={32} />
                ))}
              </span>
            ) : null}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2>{current?.title ?? 'Lobby (everyone)'}</h2>
              {room !== 'lobby' && <span className="dim" style={{ fontSize: 12 }}>Private chat between two players (read only)</span>}
            </div>
            {can('chat.moderate') && list.length > 0 && (
              <button
                className="btn btn-sm btn-ghost"
                style={{ color: 'var(--danger)' }}
                disabled={clear.isPending}
                onClick={() => window.confirm(`Delete every message in "${current?.title ?? 'this chat'}"? This cannot be undone.`) && clear.mutate()}
              >
                <Eraser size={14} /> Clear chat
              </button>
            )}
          </div>
          <div
            className="chat-scroll"
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget;
              atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
            }}
          >
            {msgs.isLoading && <div className="page-loading" style={{ minHeight: 120 }}><span className="spinner" /></div>}
            {!msgs.isLoading && list.length === 0 && <div className="empty-inline">No messages yet</div>}
            {list.map((m) => (
              <div key={m.id} className={`chat-row ${m.from.staff ? 'staff' : ''}`}>
                <Avatar name={m.from.staff ? settings.centerName : m.from.name} url={m.from.avatarUrl} staff={m.from.staff} />
                <div className={`chat-msg ${m.from.staff ? 'staff' : ''} ${m.reported ? 'reported' : ''}`}>
                  <div className="chat-meta">
                    <strong>{m.from.staff ? `${m.from.name} (${m.from.fullName ?? 'staff'})` : m.from.name}</strong>
                    {!m.from.staff && m.from.fullName && m.from.fullName !== m.from.name && <span className="dim"> · {m.from.fullName}</span>}
                    {m.from.muted && <span className="badge badge-warning">muted</span>}
                    <span className="dim"> · {formatDateTime(m.createdAt)}</span>
                    {m.reported && (
                      <span className="badge badge-danger">
                        <Flag size={11} /> reported
                      </span>
                    )}
                  </div>
                  <div className="chat-body">{m.deleted ? <i className="dim">Message removed</i> : m.body}</div>
                  {!m.deleted && (
                    <div className="toolbar chat-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => remove.mutate(m.id)} title="Delete this message">
                        <Trash2 size={13} /> Delete
                      </button>
                      {m.reported && (
                        <button className="btn btn-ghost btn-sm" onClick={() => keep.mutate(m.id)}>
                          It's fine
                        </button>
                      )}
                      {m.from.id && (
                        <button className="btn btn-ghost btn-sm" onClick={() => mute.mutate({ customerId: m.from.id, muted: !m.from.muted })}>
                          {m.from.muted ? <Volume2 size={13} /> : <MessageCircleOff size={13} />} {m.from.muted ? 'Unmute' : 'Mute player'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {room === 'lobby' && (
            <form
              className="chat-compose"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) {
                  atBottom.current = true;
                  send.mutate();
                }
              }}
            >
              <input className="input" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Write to everyone as ${settings.centerName}…`} />
              <button className="btn btn-primary" disabled={!text.trim() || send.isPending}>
                <Send size={15} /> Send
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
