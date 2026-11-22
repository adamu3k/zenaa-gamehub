import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gamepad, MonitorPlay, Plus, Settings2, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorBox, Field, Modal } from '../components/ui';
import { BoardTable, FormDots, Highlights, Podium, ResultFeed, TierBadge, type Board, type BoardRow } from '../competitions/ui';
import { del, get, patch, post, put } from '../lib/api';
import { useApp } from '../lib/app-context';
import { CustomerPicker } from './Stations';

export function useGames() {
  return useQuery({ queryKey: ['competitions', 'games'], queryFn: () => get<any[]>('/api/games'), staleTime: 60_000 });
}

/** Game + period chips used on the leaderboard hero. */
export function GameChips({ games, value, onChange, light }: { games: any[]; value: string; onChange(id: string): void; light?: boolean }) {
  return (
    <div className={`cx-chips ${light ? 'light' : ''}`}>
      {games
        .filter((g) => g.active !== false)
        .map((g) => (
          <button key={g.id} type="button" className={`cx-chip ${value === g.id ? 'on' : ''}`} onClick={() => onChange(g.id)}>
            {g.shortName || g.name}
          </button>
        ))}
    </div>
  );
}

export function LeaderboardPage() {
  const { can } = useApp();
  const games = useGames();
  const [gameId, setGameId] = useState('');
  const [period, setPeriod] = useState<'all' | 'month' | 'week'>('all');
  const [recording, setRecording] = useState(false);
  const [managing, setManaging] = useState(false);
  const [player, setPlayer] = useState<BoardRow | null>(null);
  const [editing, setEditing] = useState<any>(null);
  useEffect(() => {
    if (!gameId && games.data?.length) setGameId(games.data.find((g) => g.active)?.id ?? games.data[0].id);
  }, [games.data, gameId]);
  const board = useQuery({
    queryKey: ['competitions', 'leaderboard', gameId, period],
    queryFn: () => get<Board>(`/api/leaderboard?gameId=${gameId}&period=${period}`),
    enabled: !!gameId,
  });
  const results = useQuery({
    queryKey: ['competitions', 'results', gameId],
    queryFn: () => get<any[]>(`/api/matches?gameId=${gameId}&limit=25`),
    enabled: !!gameId,
  });
  const b = board.data;
  return (
    <>
      <div className="cx-hero">
        <div className="cx-hero-top">
          <div>
            <h1>
              <Trophy size={26} /> Leaderboard
            </h1>
            <div className="muted">{b ? `${b.game.name} · ${b.totals.players} ranked players` : 'Who is leading, who beat who, who is champion'}</div>
          </div>
          <div className="toolbar">
            <a className="btn btn-sm" href="/board" target="_blank" rel="noreferrer" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', borderColor: 'transparent' }}>
              <MonitorPlay size={15} /> TV board
            </a>
            {can('competitions.manage') && (
              <>
                <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', borderColor: 'transparent' }} onClick={() => setManaging(true)}>
                  <Settings2 size={15} /> Games
                </button>
                <button className="btn btn-sm btn-primary" onClick={() => setRecording(true)}>
                  <Plus size={15} /> Record result
                </button>
              </>
            )}
          </div>
        </div>
        <div className="cx-hero-top" style={{ marginTop: 14 }}>
          <GameChips games={games.data ?? []} value={gameId} onChange={setGameId} />
          <div className="cx-chips">
            {(
              [
                ['all', 'All time'],
                ['month', 'This month'],
                ['week', 'This week'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" className={`cx-chip ${period === k ? 'on' : ''}`} onClick={() => setPeriod(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {b && b.rows.some((r) => !r.provisional) ? (
          <Podium rows={b.rows} onPick={setPlayer} />
        ) : (
          <div className="cx-hero-empty">
            <Gamepad size={34} />
            <div style={{ fontWeight: 700, marginTop: 6 }}>No ranked players yet</div>
            <div style={{ fontSize: 13 }}>Players get a rank after 3 recorded matches. Record results here, run a tournament, or let players use Find match.</div>
          </div>
        )}
      </div>
      <ErrorBox error={board.error || games.error} />
      {b && <Highlights h={b.highlights} totals={b.totals} />}
      <div className="grid two-col">
        <div className="card">
          <div className="card-head">
            <h2>Rankings</h2>
            <span className="dim" style={{ fontSize: 12 }}>
              {period === 'all' ? 'Sorted by rating · arrows show the last 7 days' : 'Sorted by points (3 win, 1 draw) this period'}
            </span>
          </div>
          {b && <BoardTable rows={b.rows} onPick={setPlayer} scoring={b.game.scoring} showCode />}
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Latest results</h2>
          </div>
          <div onClick={(e) => {
            const el = (e.target as HTMLElement).closest('[data-id]');
            if (el && can('competitions.manage')) setEditing(results.data?.find((m) => m.id === el.getAttribute('data-id')));
          }}>
            {(results.data ?? []).length === 0 ? (
              <div className="empty-inline">No results yet</div>
            ) : (
              (results.data ?? []).map((m) => (
                <div key={m.id} data-id={m.id} style={{ cursor: can('competitions.manage') ? 'pointer' : undefined }}>
                  <ResultFeed items={[m]} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      {recording && <RecordResultModal gameId={gameId} games={games.data ?? []} onClose={() => setRecording(false)} />}
      {managing && <GamesModal onClose={() => setManaging(false)} />}
      {player && b && <PlayerModal row={player} gameId={b.game.id} gameName={b.game.name} onClose={() => setPlayer(null)} />}
      {editing && <EditResultModal match={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RecordResultModal({ gameId, games, onClose }: { gameId: string; games: any[]; onClose(): void }) {
  const { toast } = useApp();
  const qc = useQueryClient();
  const [g, setG] = useState(gameId);
  const [home, setHome] = useState<any>(null);
  const [away, setAway] = useState<any>(null);
  const [hs, setHs] = useState('');
  const [as, setAs] = useState('');
  const [note, setNote] = useState('');
  const game = games.find((x) => x.id === g);
  const m = useMutation({
    mutationFn: () => post('/api/matches', { gameId: g, homeId: home.id, awayId: away.id, homeScore: Number(hs), awayScore: Number(as), note: note || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['competitions'] });
      toast('success', `Result saved: ${home.fullName} ${hs}–${as} ${away.fullName}`);
      onClose();
    },
  });
  const valid = home && away && home.id !== away.id && hs !== '' && as !== '' && (game?.allowDraws || hs !== as);
  return (
    <Modal
      title="Record a match result"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid || m.isPending} onClick={() => m.mutate()}>
            Save result
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <Field label="Game">
        <select className="select" value={g} onChange={(e) => setG(e.target.value)}>
          {games.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Player 1 (home)">
        <CustomerPicker value={home} onChange={setHome} />
      </Field>
      <Field label="Player 2 (away)">
        <CustomerPicker value={away} onChange={setAway} />
      </Field>
      <div className="form-grid">
        <Field label={`${home?.fullName ?? 'Player 1'} score`}>
          <input className="input num" inputMode="numeric" value={hs} onChange={(e) => setHs(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label={`${away?.fullName ?? 'Player 2'} score`}>
          <input className="input num" inputMode="numeric" value={as} onChange={(e) => setAs(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
      {game && !game.allowDraws && hs !== '' && hs === as && <div className="hint">{game.name} has no draws — enter the deciding score.</div>}
      <Field label="Note (optional)">
        <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Station PS-03, extra time" />
      </Field>
      <div className="hint">New players without an account: register them in Customers first (name only is enough). Add a gamertag there to show it on the board.</div>
    </Modal>
  );
}

function EditResultModal({ match, onClose }: { match: any; onClose(): void }) {
  const { toast } = useApp();
  const qc = useQueryClient();
  const [hs, setHs] = useState(String(match.homeScore ?? ''));
  const [as, setAs] = useState(String(match.awayScore ?? ''));
  const done = () => {
    qc.invalidateQueries({ queryKey: ['competitions'] });
    onClose();
  };
  const save = useMutation({ mutationFn: () => put(`/api/matches/${match.id}/result`, { homeScore: Number(hs), awayScore: Number(as) }), onSuccess: () => (toast('success', 'Result corrected'), done()) });
  const remove = useMutation({ mutationFn: () => del(`/api/matches/${match.id}`), onSuccess: () => (toast('success', 'Match deleted'), done()) });
  return (
    <Modal
      title={`Match #${match.number}`}
      onClose={onClose}
      footer={
        <>
          {!match.tournamentId && (
            <button className="btn btn-ghost" style={{ color: 'var(--danger)', marginRight: 'auto' }} disabled={remove.isPending} onClick={() => window.confirm('Delete this match? It disappears from the leaderboard.') && remove.mutate()}>
              Delete match
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" disabled={save.isPending || hs === '' || as === ''} onClick={() => save.mutate()}>
            Save correction
          </button>
        </>
      }
    >
      <ErrorBox error={save.error || remove.error} />
      {match.tournamentId && <div className="hint">Tournament match — open the tournament to correct knockout results.</div>}
      <div className="form-grid">
        <Field label={match.home?.fullName ?? match.home?.name}>
          <input className="input num" inputMode="numeric" value={hs} onChange={(e) => setHs(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label={match.away?.fullName ?? match.away?.name}>
          <input className="input num" inputMode="numeric" value={as} onChange={(e) => setAs(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
    </Modal>
  );
}

function PlayerModal({ row, gameId, gameName, onClose }: { row: BoardRow; gameId: string; gameName: string; onClose(): void }) {
  const [vs, setVs] = useState<any>(null);
  const recent = useQuery({ queryKey: ['competitions', 'player', row.customerId, gameId], queryFn: () => get<any[]>(`/api/matches?gameId=${gameId}&customerId=${row.customerId}&limit=10`) });
  const h2h = useQuery({
    queryKey: ['competitions', 'h2h', gameId, row.customerId, vs?.id],
    queryFn: () => get(`/api/head-to-head?gameId=${gameId}&a=${row.customerId}&b=${vs.id}`),
    enabled: !!vs,
  });
  return (
    <Modal wide title={`${row.name}${row.player?.fullName && row.player.fullName !== row.name ? ` · ${row.player.fullName}` : ''}`} onClose={onClose}>
      <div className="toolbar">
        <TierBadge tier={row.tier} />
        <span>
          <strong>{row.provisional ? 'Placement' : `#${row.rank}`}</strong> in {gameName}
        </span>
        <span className="dim mono">{row.player?.code}</span>
        <div className="spacer" />
        <FormDots form={row.form} />
      </div>
      <div className="grid stats">
        {[
          ['Rating', row.rating, `peak ${(row as any).peakRating ?? row.rating}`],
          ['Record', `${row.won}-${row.drawn}-${row.lost}`, `${row.winRate}% wins`],
          ['Goals', `${row.gf}:${row.ga}`, `${row.cleanSheets} clean sheets`],
          ['Best streak', `${row.longestWinStreak} W`, row.titles ? `${row.titles} title${row.titles > 1 ? 's' : ''}` : 'no titles yet'],
        ].map(([l, v, s]) => (
          <div key={l as string} className="card stat">
            <span className="stat-label">{l}</span>
            <span className="stat-value">{v}</span>
            <span className="stat-sub">{s}</span>
          </div>
        ))}
      </div>
      <div className="grid two-col">
        <div className="card">
          <div className="card-head">
            <h2>Recent matches</h2>
          </div>
          <ResultFeed items={recent.data ?? []} highlightId={row.customerId} />
        </div>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>Head-to-head</h2>
          <CustomerPicker value={vs} onChange={setVs} />
          {h2h.data && (
            <>
              <div className="toolbar" style={{ justifyContent: 'center', fontSize: 15 }}>
                <strong>{h2h.data.a?.name}</strong>
                <span className="cx-feed-score num">
                  {h2h.data.aWins} – {h2h.data.draws} – {h2h.data.bWins}
                </span>
                <strong>{h2h.data.b?.name}</strong>
              </div>
              <div className="dim" style={{ textAlign: 'center', fontSize: 12 }}>
                {h2h.data.played} matches · goals {h2h.data.aGoals}:{h2h.data.bGoals}
              </div>
              <ResultFeed items={h2h.data.matches} empty="They have not played each other yet" />
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function GamesModal({ onClose }: { onClose(): void }) {
  const qc = useQueryClient();
  const games = useGames();
  const [f, setF] = useState({ name: '', shortName: '', scoring: 'goals', allowDraws: true });
  const add = useMutation({
    mutationFn: () => post('/api/games', { ...f, shortName: f.shortName || null }),
    onSuccess: () => {
      setF({ name: '', shortName: '', scoring: 'goals', allowDraws: true });
      qc.invalidateQueries({ queryKey: ['competitions'] });
    },
  });
  const toggle = useMutation({
    mutationFn: (g: any) => patch(`/api/games/${g.id}`, { active: !g.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['competitions'] }),
  });
  return (
    <Modal title="Games" onClose={onClose}>
      <ErrorBox error={add.error || toggle.error} />
      <div className="card list">
        {(games.data ?? []).map((g) => (
          <div key={g.id} className="list-item">
            <span>
              <strong>{g.name}</strong> <span className="dim">· {g.scoring}{g.allowDraws ? ' · draws allowed' : ' · no draws'}</span>
            </span>
            <button className="btn btn-sm" onClick={() => toggle.mutate(g)}>
              {g.active ? 'Hide' : 'Show'}
            </button>
          </div>
        ))}
      </div>
      <h3>Add a game</h3>
      <div className="form-grid">
        <Field label="Name">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="EA SPORTS FC 26" />
        </Field>
        <Field label="Short name">
          <input className="input" value={f.shortName} onChange={(e) => setF({ ...f, shortName: e.target.value })} placeholder="FC 26" />
        </Field>
        <Field label="Scored in">
          <select className="select" value={f.scoring} onChange={(e) => setF({ ...f, scoring: e.target.value })}>
            <option value="goals">Goals (football)</option>
            <option value="points">Points (basketball…)</option>
            <option value="rounds">Rounds (fighting games)</option>
          </select>
        </Field>
        <Field label="Draws">
          <label className="check">
            <input type="checkbox" checked={f.allowDraws} onChange={(e) => setF({ ...f, allowDraws: e.target.checked })} /> A match can end level
          </label>
        </Field>
      </div>
      <div>
        <button className="btn btn-primary" disabled={f.name.trim().length < 2 || add.isPending} onClick={() => add.mutate()}>
          Add game
        </button>
      </div>
    </Modal>
  );
}
