import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, MapPin, Plus, Swords } from 'lucide-react';
import { useState } from 'react';
import { DeleteButton } from '../components/DeleteButton';
import { ErrorBox, Field, Modal, PageHeader, Segmented } from '../components/ui';
import { Avatar, ScoreLine, TierBadge } from '../competitions/ui';
import { get, post, put } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDateTime } from '../lib/format';
import { GameChips, useGames } from './Leaderboard';
import { CustomerPicker } from './Stations';

const STATUS: Record<string, [string, string]> = {
  open: ['Looking', 'badge-info'],
  matched: ['Matched', 'badge-primary'],
  completed: ['Played', 'badge-success'],
  cancelled: ['Cancelled', ''],
  expired: ['Expired', ''],
};

export function FindMatchPage() {
  const { can, settings } = useApp();
  const games = useGames();
  const [gameId, setGameId] = useState('');
  const [pairing, setPairing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [scoring, setScoring] = useState<any>(null);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['competitions', 'matchmaking', gameId],
    queryFn: () => get(`/api/matchmaking${gameId ? `?gameId=${gameId}` : ''}`),
    refetchInterval: 20_000,
  });
  const cancel = useMutation({ mutationFn: (id: string) => post(`/api/matchmaking/requests/${id}/cancel`), onSuccess: () => qc.invalidateQueries({ queryKey: ['competitions'] }) });
  const manage = can('competitions.manage');
  const row = (r: any) => (
    <div key={r.id} className="cx-req">
      <Avatar name={r.player.name} src={r.player?.avatarUrl} size={40} />
      <div className="cx-req-main">
        <div className="toolbar" style={{ gap: 6 }}>
          <strong>{r.player.name}</strong>
          <TierBadge tier={r.player.tier} small />
          <span className="dim num" style={{ fontSize: 12 }}>
            {r.player.rating}
          </span>
          {r.opponent && (
            <>
              <span className="cx-vs">VS</span>
              <strong>{r.opponent.name}</strong>
              <TierBadge tier={r.opponent.tier} small />
            </>
          )}
          {r.challenge && !r.opponent && (
            <>
              <span className="cx-vs">CHALLENGES</span>
              <strong>{r.challenge.name}</strong>
            </>
          )}
        </div>
        <div className="dim" style={{ fontSize: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>{r.game}</span>
          <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
            {r.mode === 'online' ? <Globe size={12} /> : <MapPin size={12} />} {r.mode === 'online' ? 'Online (PSN)' : 'At the venue'}
          </span>
          <span>{r.preferredAt ? formatDateTime(r.preferredAt) : 'As soon as possible'}</span>
          {r.skill === 'similar' && <span>similar level only</span>}
          {r.player.fullName && <span>{r.player.fullName} · {r.player.code}</span>}
        </div>
        {r.note && <div style={{ fontSize: 13 }}>“{r.note}”</div>}
        {r.match && (
          <div style={{ maxWidth: 320, marginTop: 4 }}>
            <ScoreLine m={r.match} onClick={manage && r.match.status !== 'completed' ? () => setScoring(r.match) : undefined} />
          </div>
        )}
      </div>
      <span className={`badge ${STATUS[r.status]?.[1] ?? ''}`}>{STATUS[r.status]?.[0] ?? r.status}</span>
      {manage && r.status === 'open' && (
        <>
          <button className="btn btn-sm btn-primary" onClick={() => setPairing(r)}>
            <Swords size={14} /> Pair
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => cancel.mutate(r.id)}>
            Cancel
          </button>
        </>
      )}
      {manage && r.status === 'matched' && r.match?.status !== 'completed' && (
        <>
          <button className="btn btn-sm btn-primary" onClick={() => setScoring(r.match)}>
            Enter score
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => window.confirm('Cancel this match?') && cancel.mutate(r.id)}>
            Cancel
          </button>
        </>
      )}
      {manage && <DeleteButton icon url={`/api/matchmaking/requests/${r.id}`} what={`request #${r.number ?? ''}`.trim()} refresh={[['competitions']]} />}
    </div>
  );
  return (
    <>
      <PageHeader
        title="Find match"
        subtitle={settings.matchmakingEnabled ? 'Players looking for opponents — at the venue or online. Pair them, then record the score.' : 'Find match is switched off for customers (Settings)'}
        actions={
          manage && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> Request for a customer
            </button>
          )
        }
      />
      <div className="toolbar">
        <button type="button" className={`cx-chip ${!gameId ? 'on' : ''}`} style={{ background: !gameId ? 'var(--primary)' : 'var(--surface)', color: !gameId ? '#fff' : 'var(--text-muted)', borderColor: 'var(--border)' }} onClick={() => setGameId('')}>
          All games
        </button>
        <GameChips games={games.data ?? []} value={gameId} onChange={setGameId} light />
      </div>
      <ErrorBox error={q.error || cancel.error} />
      <div className="card">
        <div className="card-head">
          <h2>Looking for an opponent</h2>
          <span className="dim">{q.data?.open.length ?? 0}</span>
        </div>
        {q.data?.open.length === 0 && <div className="empty-inline">Nobody is looking right now. Players post requests from the portal → Find match.</div>}
        {q.data?.open.map(row)}
      </div>
      <div className="card">
        <div className="card-head">
          <h2>Matched & played (last 7 days)</h2>
        </div>
        {q.data?.history.length === 0 && <div className="empty-inline">No matches yet</div>}
        {q.data?.history.map(row)}
      </div>
      {pairing && <PairModal request={pairing} onClose={() => setPairing(null)} />}
      {creating && <NewRequestModal games={games.data ?? []} onClose={() => setCreating(false)} />}
      {scoring && <ScoreModal match={scoring} onClose={() => setScoring(null)} />}
    </>
  );
}

function PairModal({ request, onClose }: { request: any; onClose(): void }) {
  const qc = useQueryClient();
  const { toast } = useApp();
  const [opp, setOpp] = useState<any>(null);
  const m = useMutation({
    mutationFn: () => post('/api/matchmaking/pair', { requestId: request.id, opponentId: opp.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['competitions'] });
      toast('success', `Paired ${request.player.name} with ${opp.fullName}`);
      onClose();
    },
  });
  return (
    <Modal
      title={`Find an opponent for ${request.player.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!opp || m.isPending} onClick={() => m.mutate()}>
            Create match
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <div className="dim">
        {request.game} · rating {request.player.rating} ({request.player.tier}){request.skill === 'similar' ? ' · wants a similar level (±150)' : ''}
      </div>
      <CustomerPicker value={opp} onChange={setOpp} />
    </Modal>
  );
}

function NewRequestModal({ games, onClose }: { games: any[]; onClose(): void }) {
  const qc = useQueryClient();
  const [c, setC] = useState<any>(null);
  const [f, setF] = useState({ gameId: games.find((g) => g.active)?.id ?? '', mode: 'venue' as 'venue' | 'online', skill: 'any' as 'any' | 'similar', preferredAt: '', note: '' });
  const m = useMutation({
    mutationFn: () =>
      post('/api/matchmaking/requests', { customerId: c.id, gameId: f.gameId, mode: f.mode, skill: f.skill, preferredAt: f.preferredAt ? new Date(f.preferredAt).toISOString() : null, note: f.note || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['competitions'] });
      onClose();
    },
  });
  return (
    <Modal
      title="Post a Find-match request for a customer"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!c || !f.gameId || m.isPending} onClick={() => m.mutate()}>
            Post request
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <CustomerPicker value={c} onChange={setC} />
      <div className="form-grid">
        <Field label="Game">
          <select className="select" value={f.gameId} onChange={(e) => setF({ ...f, gameId: e.target.value })}>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="When">
          <input className="input" type="datetime-local" value={f.preferredAt} onChange={(e) => setF({ ...f, preferredAt: e.target.value })} />
        </Field>
        <Field label="Where">
          <Segmented value={f.mode} onChange={(v) => setF({ ...f, mode: v })} options={[{ value: 'venue', label: 'At the venue' }, { value: 'online', label: 'Online' }]} />
        </Field>
        <Field label="Opponent level">
          <Segmented value={f.skill} onChange={(v) => setF({ ...f, skill: v })} options={[{ value: 'any', label: 'Anyone' }, { value: 'similar', label: 'Similar' }]} />
        </Field>
        <Field label="Note" full>
          <input className="input" value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Best of 3, 6-min halves" />
        </Field>
      </div>
    </Modal>
  );
}

function ScoreModal({ match, onClose }: { match: any; onClose(): void }) {
  const qc = useQueryClient();
  const { toast } = useApp();
  const [hs, setHs] = useState(match.homeScore != null ? String(match.homeScore) : '');
  const [as, setAs] = useState(match.awayScore != null ? String(match.awayScore) : '');
  const m = useMutation({
    mutationFn: () => put(`/api/matches/${match.id}/result`, { homeScore: Number(hs), awayScore: Number(as) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['competitions'] });
      toast('success', 'Result saved — leaderboard updated');
      onClose();
    },
  });
  return (
    <Modal
      title="Enter the score"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={hs === '' || as === '' || m.isPending} onClick={() => m.mutate()}>
            Save result
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      {match.status === 'pending_confirmation' && <div className="hint">A player reported this score and the opponent has not confirmed yet. Saving here makes it final.</div>}
      {match.note && <div className="hint">{match.note}</div>}
      <div className="form-grid">
        <Field label={match.home?.fullName ?? match.home?.name}>
          <input className="input num" autoFocus inputMode="numeric" value={hs} onChange={(e) => setHs(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label={match.away?.fullName ?? match.away?.name}>
          <input className="input num" inputMode="numeric" value={as} onChange={(e) => setAs(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
    </Modal>
  );
}
