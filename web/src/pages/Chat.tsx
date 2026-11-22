import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, MessageCircleOff, MessagesSquare, Send, Trash2, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBox, PageHeader } from '../components/ui';
import { del, get, post } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDateTime } from '../lib/format';

/** Staff view of the customer chat: read every room, post as the venue, delete messages, mute players. */
export function ChatPage() {
  const { settings, toast } = useApp();
  const qc = useQueryClient();
  const [room, setRoom] = useState('lobby');
  const [text, setText] = useState('');
  const rooms = useQuery({ queryKey: ['chat', 'rooms'], queryFn: () => get<any[]>('/api/chat/rooms'), refetchInterval: 10_000 });
  const msgs = useQuery({ queryKey: ['chat', 'messages', room], queryFn: () => get<any>(`/api/chat/messages?room=${encodeURIComponent(room)}`), refetchInterval: 5_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['chat'] });
  const send = useMutation({ mutationFn: () => post('/api/chat/messages', { body: text }), onSuccess: () => (setText(''), refresh()) });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/chat/messages/${id}`), onSuccess: refresh });
  const keep = useMutation({ mutationFn: (id: string) => post(`/api/chat/messages/${id}/keep`), onSuccess: refresh });
  const mute = useMutation({
    mutationFn: (v: { customerId: string; muted: boolean }) => post('/api/chat/mute', v),
    onSuccess: (_r, v) => (toast('success', v.muted ? 'Player muted — they can read but not write' : 'Player can chat again'), refresh()),
  });
  const end = useRef<HTMLDivElement>(null);
  const list = (msgs.data?.messages ?? []) as any[];
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [list.length, room]);
  const reportedTotal = (rooms.data ?? []).reduce((n, r) => n + r.reported, 0);
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
      />
      <ErrorBox error={rooms.error || msgs.error || send.error || remove.error || mute.error} />
      <div className="chat-staff">
        <div className="card chat-rooms">
          <div className="card-head">
            <h2>Chats</h2>
            {reportedTotal > 0 && <span className="badge badge-danger">{reportedTotal} reported</span>}
          </div>
          <div className="list">
            {(rooms.data ?? []).map((r) => (
              <button key={r.room} className={`list-item chat-room-btn ${room === r.room ? 'active' : ''}`} onClick={() => setRoom(r.room)}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.room === 'lobby' ? <MessagesSquare size={14} style={{ verticalAlign: -2 }} /> : null} {r.title}
                </span>
                <span className="toolbar" style={{ gap: 4 }}>
                  {r.reported > 0 && <span className="badge badge-danger">{r.reported}</span>}
                  <span className="dim num" style={{ fontSize: 12 }}>
                    {r.count}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="card chat-panel">
          <div className="card-head">
            <h2>{(rooms.data ?? []).find((r) => r.room === room)?.title ?? 'Lobby (everyone)'}</h2>
            {room !== 'lobby' && <span className="dim" style={{ fontSize: 12 }}>Private chat between two players (read only)</span>}
          </div>
          <div className="chat-scroll">
            {list.length === 0 && <div className="empty-inline">No messages yet</div>}
            {list.map((m) => (
              <div key={m.id} className={`chat-msg ${m.from.staff ? 'staff' : ''} ${m.reported ? 'reported' : ''}`}>
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
            ))}
            <div ref={end} />
          </div>
          {room === 'lobby' && (
            <form
              className="chat-compose"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) send.mutate();
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
