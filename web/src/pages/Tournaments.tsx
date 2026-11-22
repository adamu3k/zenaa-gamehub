import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Banknote, Crown, Play, Plus, Shuffle, Trash2, Trophy, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorBox, Field, Modal, PageHeader, Segmented } from '../components/ui';
import { Avatar, Bracket, FORMAT_LABEL, GroupTables, placeLabel, ScoreLine, TStatus, type MatchV } from '../competitions/ui';
import { del, get, patch, post, put } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDateTime, parseMoney, toMajorString } from '../lib/format';
import { useGames } from './Leaderboard';
import { CustomerPicker } from './Stations';

export function TournamentsPage() {
  const { money, can } = useApp();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['competitions', 'tournaments'], queryFn: () => get<any[]>('/api/tournaments') });
  return (
    <>
      <PageHeader
        title="Tournaments"
        subtitle="Knockout cups, leagues and group stages with divisions, prizes and live brackets"
        actions={
          can('competitions.manage') && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> New tournament
            </button>
          )
        }
      />
      <ErrorBox error={list.error} />
      {list.data?.length === 0 && (
        <div className="card empty">
          <Trophy size={32} />
          <div>No tournaments yet. Create one, add players (or open registration in the portal), then press Start to draw the fixtures.</div>
        </div>
      )}
      <div className="cx-tgrid">
        {(list.data ?? []).map((t) => (
          <button key={t.id} type="button" className="cx-tcard" onClick={() => nav(`/tournaments/${t.id}`)}>
            <div className="toolbar">
              <TStatus s={t.status} />
              <span className="badge">{FORMAT_LABEL[t.format]}</span>
              <div className="spacer" />
              <span className="dim" style={{ fontSize: 12 }}>
                #{t.number}
              </span>
            </div>
            <h3>{t.name}</h3>
            <div className="dim" style={{ fontSize: 13 }}>
              {t.gameName} · {t.players}/{t.maxPlayers} players
              {t.startsAt ? ` · ${formatDateTime(t.startsAt)}` : ''}
            </div>
            <div className="toolbar">
              {t.prizePool > 0 && (
                <span className="badge badge-warning">
                  <Trophy size={12} /> {money(t.prizePool)} prizes
                </span>
              )}
              {t.entryFee > 0 && <span className="badge">Entry {money(t.entryFee)}</span>}
              {t.champion && (
                <span className="badge badge-success">
                  <Crown size={12} /> {t.champion.name}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
      {creating && <TournamentForm onClose={() => setCreating(false)} onSaved={(t) => nav(`/tournaments/${t.id}`)} />}
    </>
  );
}

function TournamentForm({ tournament, onClose, onSaved }: { tournament?: any; onClose(): void; onSaved?(t: any): void }) {
  const { settings, toast, money } = useApp();
  const qc = useQueryClient();
  const games = useGames();
  const mu = settings.currencyMinorUnits;
  const started = tournament && !['draft', 'registration'].includes(tournament.status);
  const [f, setF] = useState({
    name: tournament?.name ?? '',
    gameId: tournament?.gameId ?? '',
    format: tournament?.format ?? 'knockout',
    maxPlayers: String(tournament?.maxPlayers ?? 16),
    groupCount: String(tournament?.groupCount ?? 4),
    advancePerGroup: String(tournament?.advancePerGroup ?? 2),
    doubleRoundRobin: tournament?.doubleRoundRobin ?? false,
    thirdPlaceMatch: tournament?.thirdPlaceMatch ?? true,
    pointsWin: String(tournament?.pointsWin ?? 3),
    pointsDraw: String(tournament?.pointsDraw ?? 1),
    entryFee: toMajorString(tournament?.entryFee ?? 0, mu),
    prizes: ((tournament?.prizes as any[]) ?? [
      { place: 1, amount: 0 },
      { place: 2, amount: 0 },
      { place: 3, amount: 0 },
    ]).map((p) => ({ place: String(p.place), amount: toMajorString(p.amount, mu), label: p.label ?? '' })),
    publicRegistration: tournament?.publicRegistration ?? true,
    startsAt: tournament?.startsAt ? new Date(tournament.startsAt).toISOString().slice(0, 16) : '',
    description: tournament?.description ?? '',
    rules: tournament?.rules ?? '',
  });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const gameId = f.gameId || games.data?.find((g) => g.active)?.id || '';
  const m = useMutation({
    mutationFn: () => {
      const prizes = f.prizes
        .filter((p) => p.amount.trim() && Number(p.place) > 0)
        .map((p) => {
          const amount = parseMoney(p.amount, mu);
          if (amount == null) throw new Error(`Prize for place ${p.place} is not a valid amount`);
          return { place: Number(p.place), amount, label: p.label || null };
        })
        .filter((p) => p.amount > 0);
      const entryFee = f.entryFee.trim() ? parseMoney(f.entryFee, mu) : 0;
      if (entryFee == null) throw new Error('Entry fee is not a valid amount');
      const body: any = {
        name: f.name,
        gameId,
        format: f.format,
        maxPlayers: Number(f.maxPlayers),
        groupCount: f.format === 'groups_knockout' ? Number(f.groupCount) : 1,
        advancePerGroup: Number(f.advancePerGroup),
        doubleRoundRobin: f.doubleRoundRobin,
        thirdPlaceMatch: f.thirdPlaceMatch,
        pointsWin: Number(f.pointsWin),
        pointsDraw: Number(f.pointsDraw),
        entryFee,
        prizes,
        publicRegistration: f.publicRegistration,
        startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null,
        description: f.description || null,
        rules: f.rules || null,
      };
      if (started) for (const k of ['format', 'groupCount', 'advancePerGroup', 'doubleRoundRobin', 'thirdPlaceMatch', 'gameId', 'pointsWin', 'pointsDraw']) delete body[k];
      return tournament ? patch(`/api/tournaments/${tournament.id}`, body) : post('/api/tournaments', body);
    },
    onSuccess: (t: any) => {
      qc.invalidateQueries({ queryKey: ['competitions'] });
      toast('success', tournament ? 'Tournament updated' : 'Tournament created — now add players');
      onSaved?.(t);
      onClose();
    },
  });
  const pool = f.prizes.reduce((s, p) => s + (parseMoney(p.amount, mu) ?? 0), 0);
  return (
    <Modal
      wide
      title={tournament ? `Edit ${tournament.name}` : 'New tournament'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={m.isPending || f.name.trim().length < 2 || !gameId} onClick={() => m.mutate()}>
            {tournament ? 'Save' : 'Create tournament'}
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <div className="form-grid">
        <Field label="Name">
          <input className="input" autoFocus value={f.name} onChange={set('name')} placeholder="ZENAA FC Championship" />
        </Field>
        <Field label="Game">
          <select className="select" value={gameId} onChange={set('gameId')} disabled={started}>
            {(games.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Format" full hint={started ? 'Locked after the start' : undefined}>
          <Segmented
            value={f.format}
            onChange={(v) => !started && setF({ ...f, format: v })}
            options={[
              { value: 'knockout', label: 'Knockout cup' },
              { value: 'league', label: 'League (everyone plays everyone)' },
              { value: 'groups_knockout', label: 'Groups / divisions + knockout' },
            ]}
          />
        </Field>
        <Field label="Maximum players">
          <input className="input" inputMode="numeric" value={f.maxPlayers} onChange={set('maxPlayers')} />
        </Field>
        {f.format === 'groups_knockout' && (
          <>
            <Field label="Groups (divisions)" hint="Players are spread in seed order, A B C D D C B A…">
              <input className="input" inputMode="numeric" value={f.groupCount} onChange={set('groupCount')} disabled={started} />
            </Field>
            <Field label="Go through from each group">
              <input className="input" inputMode="numeric" value={f.advancePerGroup} onChange={set('advancePerGroup')} disabled={started} />
            </Field>
          </>
        )}
        {f.format !== 'knockout' && (
          <>
            <Field label="Points for a win / draw">
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input" inputMode="numeric" value={f.pointsWin} onChange={set('pointsWin')} disabled={started} />
                <input className="input" inputMode="numeric" value={f.pointsDraw} onChange={set('pointsDraw')} disabled={started} />
              </div>
            </Field>
            <Field label="Matches">
              <label className="check">
                <input type="checkbox" checked={f.doubleRoundRobin} onChange={set('doubleRoundRobin')} disabled={started} /> Play each opponent twice (home & away)
              </label>
            </Field>
          </>
        )}
        {f.format !== 'league' && (
          <Field label="Knockout">
            <label className="check">
              <input type="checkbox" checked={f.thirdPlaceMatch} onChange={set('thirdPlaceMatch')} disabled={started} /> Third-place play-off
            </label>
          </Field>
        )}
        <Field label="Starts">
          <input className="input" type="datetime-local" value={f.startsAt} onChange={set('startsAt')} />
        </Field>
        <Field label={`Entry fee (${settings.currencyCode})`} hint="0 = free">
          <input className="input" inputMode="decimal" value={f.entryFee} onChange={set('entryFee')} />
        </Field>
        <Field label="Portal registration" full>
          <label className="check">
            <input type="checkbox" checked={f.publicRegistration} onChange={set('publicRegistration')} /> Players can sign themselves up in the customer portal while registration is open
          </label>
        </Field>
      </div>
      <h3>
        Cash prizes <span className="dim" style={{ fontWeight: 500 }}>· pool {money(pool)}</span>
      </h3>
      <div className="card list">
        {f.prizes.map((p, i) => (
          <div key={i} className="list-item" style={{ gap: 8 }}>
            <span className={`cx-prize-place p${p.place}`}>{p.place}</span>
            <input className="input" style={{ maxWidth: 70 }} inputMode="numeric" value={p.place} onChange={(e) => setF({ ...f, prizes: f.prizes.map((x, j) => (j === i ? { ...x, place: e.target.value.replace(/\D/g, '') } : x)) })} />
            <input className="input" inputMode="decimal" placeholder={`Amount (${settings.currencyCode})`} value={p.amount} onChange={(e) => setF({ ...f, prizes: f.prizes.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} />
            <input className="input" placeholder="Label (optional), e.g. + trophy" value={p.label} onChange={(e) => setF({ ...f, prizes: f.prizes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => setF({ ...f, prizes: f.prizes.filter((_, j) => j !== i) })} aria-label="Remove prize">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <div>
        <button type="button" className="btn btn-sm" onClick={() => setF({ ...f, prizes: [...f.prizes, { place: String(f.prizes.length + 1), amount: '', label: '' }] })}>
          <Plus size={14} /> Add prize place
        </button>
      </div>
      <Field label="Description (shown in the portal)">
        <textarea className="textarea" value={f.description} onChange={set('description')} />
      </Field>
      <Field label="Rules">
        <textarea className="textarea" value={f.rules} onChange={set('rules')} placeholder="e.g. 6-minute halves, legendary difficulty, no custom tactics, extra time + penalties in knockout" />
      </Field>
    </Modal>
  );
}

export function TournamentDetailPage() {
  const { id } = useParams();
  const { money, can, toast } = useApp();
  const qc = useQueryClient();
  const manage = can('competitions.manage');
  const q = useQuery({ queryKey: ['competitions', 'tournament', id], queryFn: () => get(`/api/tournaments/${id}`) });
  const [tab, setTab] = useState<'overview' | 'bracket' | 'groups' | 'fixtures' | 'players' | 'prizes'>('overview');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<MatchV | null>(null);
  const [shuffle, setShuffle] = useState(true);
  const refresh = () => qc.invalidateQueries({ queryKey: ['competitions'] });
  const status = useMutation({ mutationFn: (s: string) => post(`/api/tournaments/${id}/status`, { status: s }), onSuccess: refresh });
  const start = useMutation({
    mutationFn: () => post(`/api/tournaments/${id}/start`, { shuffle }),
    onSuccess: () => {
      refresh();
      toast('success', 'Tournament started — fixtures drawn');
      setTab(d?.tournament.format === 'league' ? 'groups' : d?.tournament.format === 'knockout' ? 'bracket' : 'groups');
    },
  });
  const nav = useNavigate();
  const remove = useMutation({ mutationFn: () => del(`/api/tournaments/${id}`), onSuccess: () => (refresh(), nav('/tournaments')) });
  const d = q.data;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!d) return <div className="muted">Loading…</div>;
  const t = d.tournament;
  const setup = t.status === 'draft' || t.status === 'registration';
  const tabs = [
    { value: 'overview', label: 'Overview' },
    ...(d.bracket.rounds.length ? [{ value: 'bracket', label: 'Bracket' }] : []),
    ...(d.groups.length ? [{ value: 'groups', label: t.format === 'league' ? 'Table' : 'Groups' }] : []),
    ...(d.rounds.length ? [{ value: 'fixtures', label: 'Fixtures' }] : []),
    { value: 'players', label: `Players (${d.entries.length})` },
    { value: 'prizes', label: 'Prizes' },
  ] as { value: typeof tab; label: string }[];
  const pct = d.progress.total ? Math.round((d.progress.played / d.progress.total) * 100) : 0;
  return (
    <>
      <Link to="/tournaments" className="dim" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
        <ArrowLeft size={14} /> All tournaments
      </Link>
      <div className="cx-hero" style={{ paddingBottom: 20 }}>
        <div className="cx-hero-top">
          <div>
            <div className="toolbar" style={{ marginBottom: 6 }}>
              <TStatus s={t.status} />
              <span className="badge" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}>
                {FORMAT_LABEL[t.format]}
              </span>
            </div>
            <h1>
              <Trophy size={24} /> {t.name}
            </h1>
            <div className="muted">
              {t.gameName} · {d.entries.length}/{t.maxPlayers} players{t.startsAt ? ` · ${formatDateTime(t.startsAt)}` : ''}
              {d.prizePool > 0 ? ` · ${money(d.prizePool)} in prizes` : ''}
            </div>
          </div>
          {manage && (
            <div className="toolbar">
              <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', borderColor: 'transparent' }} onClick={() => setEditing(true)}>
                Edit
              </button>
              {t.status === 'draft' && (
                <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', borderColor: 'transparent' }} onClick={() => status.mutate('registration')}>
                  Open registration
                </button>
              )}
              {t.status === 'registration' && (
                <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', borderColor: 'transparent' }} onClick={() => status.mutate('draft')}>
                  Close registration
                </button>
              )}
              {t.status === 'live' && (
                <button className="btn btn-sm btn-danger" onClick={() => window.confirm('Cancel this tournament? Results stay on the leaderboard.') && status.mutate('cancelled')}>
                  Cancel
                </button>
              )}
              {(setup || t.status === 'cancelled') && (
                <button className="btn btn-sm btn-ghost" style={{ color: '#fca5a5' }} onClick={() => window.confirm('Delete this tournament?') && remove.mutate()}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          )}
        </div>
        {!setup && d.progress.total > 0 && (
          <div style={{ position: 'relative', zIndex: 1, marginTop: 16 }}>
            <div className="toolbar" style={{ fontSize: 12, marginBottom: 6 }}>
              <span>
                {d.progress.played} of {d.progress.total} matches played
              </span>
              <div className="spacer" />
              <span>{pct}%</span>
            </div>
            <div className="cx-progress">
              <div style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>
      <ErrorBox error={status.error || start.error || remove.error} />
      {d.champion && (
        <div className="cx-champion">
          <Avatar name={d.champion.name} src={d.champion?.avatarUrl} size={60} ring="#fff" />
          <div>
            <div style={{ fontWeight: 800, letterSpacing: '0.08em', fontSize: 12 }}>🏆 CHAMPION</div>
            <div className="big">{d.champion.name}</div>
            {d.champion.fullName && <div style={{ fontSize: 13 }}>{d.champion.fullName}</div>}
          </div>
        </div>
      )}
      {setup && manage && (
        <div className="card card-pad toolbar" style={{ borderColor: 'var(--primary)' }}>
          <div>
            <strong>Ready to start?</strong>
            <div className="dim" style={{ fontSize: 13 }}>
              Starting locks the player list and draws {t.format === 'knockout' ? 'the bracket' : t.format === 'league' ? 'every fixture' : 'the groups and their fixtures'}. Set seeds on the Players tab, or
              draw at random.
            </div>
          </div>
          <div className="spacer" />
          <label className="check" style={{ border: 0 }}>
            <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} /> <Shuffle size={14} /> Random draw
          </label>
          <button className="btn btn-sm" onClick={() => setAdding(true)}>
            <UserPlus size={15} /> Add player
          </button>
          <button className="btn btn-primary" disabled={start.isPending || d.entries.length < 2} onClick={() => window.confirm(`Start with ${d.entries.length} players?`) && start.mutate()}>
            <Play size={15} /> Start tournament
          </button>
        </div>
      )}
      <div className="tabs" style={{ overflowX: 'auto' }}>
        {tabs.map((x) => (
          <button key={x.value} className={tab === x.value ? 'on' : ''} onClick={() => setTab(x.value)}>
            {x.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview d={d} onMatch={manage && t.status === 'live' ? setResult : undefined} />}
      {tab === 'bracket' && (
        <div className="card card-pad">
          <Bracket bracket={d.bracket} onMatch={manage && t.status === 'live' ? setResult : undefined} />
          {manage && t.status === 'live' && <div className="hint" style={{ marginTop: 10 }}>Click a match to enter or correct its score.</div>}
        </div>
      )}
      {tab === 'groups' && <GroupTables groups={d.groups} />}
      {tab === 'fixtures' && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))' }}>
          {d.rounds.map((r: any) => (
            <div key={r.round} className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h3>Matchday {r.round}</h3>
              {r.matches.map((m: MatchV) => (
                <div key={m.id}>
                  {m.groupName && <div className="dim" style={{ fontSize: 11 }}>Group {m.groupName}</div>}
                  <ScoreLine m={m} onClick={manage && t.status === 'live' ? () => setResult(m) : undefined} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {tab === 'players' && <Players d={d} onAdd={() => setAdding(true)} />}
      {tab === 'prizes' && <Prizes d={d} />}
      {editing && <TournamentForm tournament={t} onClose={() => setEditing(false)} />}
      {adding && <AddPlayer tournamentId={t.id} onClose={() => setAdding(false)} />}
      {result && <ResultModal match={result} knockout={['knockout', 'third_place'].includes(result.stage)} allowDraws={t.allowDraws} onClose={() => setResult(null)} />}
    </>
  );
}

function Overview({ d, onMatch }: { d: any; onMatch?(m: MatchV): void }) {
  const { money } = useApp();
  const t = d.tournament;
  return (
    <div className="grid two-col">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card">
          <div className="card-head">
            <h2>Next matches</h2>
          </div>
          <div className="card-pad" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 230px), 1fr))' }}>
            {d.upcoming.length === 0 && <div className="dim">{t.status === 'live' ? 'Waiting for earlier results' : 'Fixtures appear when the tournament starts'}</div>}
            {d.upcoming.map((m: MatchV) => (
              <div key={m.id}>
                <div className="dim" style={{ fontSize: 11 }}>
                  {m.stage === 'knockout' ? (d.bracket.rounds.find((r: any) => r.round === m.round)?.name ?? 'Knockout') : m.stage === 'third_place' ? '3rd place' : m.groupName ? `Group ${m.groupName} · matchday ${m.round}` : `Matchday ${m.round}`}
                </div>
                <ScoreLine m={m} onClick={onMatch ? () => onMatch(m) : undefined} />
              </div>
            ))}
          </div>
        </div>
        {(t.description || t.rules) && (
          <div className="card card-pad" style={{ whiteSpace: 'pre-wrap', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {t.description && <div>{t.description}</div>}
            {t.rules && (
              <>
                <h3>Rules</h3>
                <div className="muted">{t.rules}</div>
              </>
            )}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card">
          <div className="card-head">
            <h2>Top scorers</h2>
          </div>
          <div className="list">
            {d.topScorers.length === 0 && <div className="empty-inline">No goals yet</div>}
            {d.topScorers.map((s: any, i: number) => (
              <div key={s.player?.id} className="list-item">
                <span className="cx-player-inline">
                  <strong className="num" style={{ width: 18 }}>{i + 1}</strong>
                  <Avatar name={s.player?.name ?? '?'} src={s.player?.avatarUrl} size={26} /> {s.player?.name}
                </span>
                <span>
                  <strong className="num">{s.goals}</strong> <span className="dim">in {s.played}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Prizes</h2>
            {t.entryFee > 0 && <span className="dim">Entry {money(t.entryFee)}</span>}
          </div>
          <PrizeList prizes={t.prizes} entries={d.entries} />
        </div>
      </div>
    </div>
  );
}

export function PrizeList({ prizes, entries }: { prizes: any[]; entries: any[] }) {
  const { money } = useApp();
  if (!prizes.length) return <div className="empty-inline">No cash prizes set</div>;
  return (
    <div>
      {[...prizes]
        .sort((a, b) => a.place - b.place)
        .map((p) => {
          const winners = entries.filter((e) => e.finalPlace === p.place);
          return (
            <div key={p.place} className="cx-prize">
              <span className={`cx-prize-place p${p.place}`}>{p.place}</span>
              <span style={{ flex: 1 }}>
                <strong>{money(p.amount)}</strong>
                {p.label && <span className="dim"> · {p.label}</span>}
                {winners.length > 0 && <div style={{ fontSize: 12 }}>{winners.map((w) => w.player?.name).join(', ')}</div>}
              </span>
            </div>
          );
        })}
    </div>
  );
}

function Players({ d, onAdd }: { d: any; onAdd(): void }) {
  const { can, money } = useApp();
  const qc = useQueryClient();
  const t = d.tournament;
  const setup = t.status === 'draft' || t.status === 'registration';
  const manage = can('competitions.manage');
  const up = useMutation({ mutationFn: ({ e, body }: { e: any; body: any }) => patch(`/api/tournaments/${t.id}/entries/${e.id}`, body), onSuccess: () => qc.invalidateQueries({ queryKey: ['competitions'] }) });
  const rm = useMutation({ mutationFn: (e: any) => del(`/api/tournaments/${t.id}/entries/${e.id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['competitions'] }) });
  return (
    <div className="card">
      <div className="card-head">
        <h2>
          <Users size={16} /> Players
        </h2>
        {manage && setup && (
          <button className="btn btn-sm btn-primary" onClick={onAdd}>
            <UserPlus size={15} /> Add player
          </button>
        )}
      </div>
      <ErrorBox error={up.error || rm.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Seed</th>
              <th>Player</th>
              {t.format === 'groups_knockout' && <th>Group</th>}
              <th>Status</th>
              {t.entryFee > 0 && <th>Entry fee</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {d.entries.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-inline">
                  No players yet
                </td>
              </tr>
            )}
            {d.entries.map((e: any) => (
              <tr key={e.id}>
                <td style={{ width: 90 }}>
                  {setup && manage ? (
                    <input
                      className="input"
                      style={{ width: 64, height: 32 }}
                      inputMode="numeric"
                      defaultValue={e.seed ?? ''}
                      placeholder="–"
                      onBlur={(ev) => {
                        const v = ev.target.value.trim();
                        if (String(e.seed ?? '') !== v) up.mutate({ e, body: { seed: v ? Number(v) : null } });
                      }}
                    />
                  ) : (
                    <span className="num">{e.seed ?? '–'}</span>
                  )}
                </td>
                <td>
                  <span className="cx-player-inline">
                    <Avatar name={e.player?.name ?? '?'} src={e.player?.avatarUrl} size={28} />
                    <span>
                      <strong>{e.player?.name}</strong>
                      <div className="dim" style={{ fontSize: 12 }}>
                        {e.player?.fullName} · {e.player?.code}
                      </div>
                    </span>
                  </span>
                </td>
                {t.format === 'groups_knockout' && <td>{e.groupName ?? '–'}</td>}
                <td>
                  {e.finalPlace ? (
                    <span className="badge badge-warning">{placeLabel(e.finalPlace)}</span>
                  ) : (
                    <span className={`badge ${e.status === 'active' ? 'badge-primary' : e.status === 'eliminated' ? 'badge-danger' : ''}`}>
                      {e.status === 'registered' ? 'Registered' : e.status === 'active' ? 'Still in' : e.status === 'eliminated' ? 'Out' : e.status}
                    </span>
                  )}
                </td>
                {t.entryFee > 0 && (
                  <td>
                    {e.paid ? (
                      <span className="badge badge-success" title={e.paidNote ?? ''}>
                        Paid{e.paidNote ? ` · ${e.paidNote}` : ''}
                      </span>
                    ) : manage ? (
                      <span className="toolbar" style={{ flexWrap: 'nowrap' }}>
                        <button className="btn btn-sm" onClick={() => up.mutate({ e, body: { paid: true, paidNote: 'Cash' } })}>
                          Cash
                        </button>
                        <button className="btn btn-sm" onClick={() => up.mutate({ e, body: { chargeWallet: true } })} title={`Take ${money(t.entryFee)} from the wallet`}>
                          Wallet
                        </button>
                      </span>
                    ) : (
                      <span className="badge badge-warning">Unpaid</span>
                    )}
                  </td>
                )}
                <td className="right">
                  {setup && manage && (
                    <button className="btn btn-ghost btn-icon" onClick={() => rm.mutate(e)} aria-label="Remove player">
                      <Trash2 size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Prizes({ d }: { d: any }) {
  const { can, money, toast } = useApp();
  const qc = useQueryClient();
  const t = d.tournament;
  const [method, setMethod] = useState<'wallet' | 'cash' | 'mobile_money'>('wallet');
  const pay = useMutation({
    mutationFn: (e: any) => post(`/api/tournaments/${t.id}/entries/${e.id}/prize`, { method }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['competitions'] });
      toast('success', 'Prize recorded as paid');
    },
  });
  const winners = d.entries.filter((e: any) => e.prizeAmount);
  return (
    <div className="grid two-col">
      <div className="card">
        <div className="card-head">
          <h2>
            <Banknote size={16} /> Prize payouts
          </h2>
          {can('competitions.manage') && t.status === 'completed' && (
            <Segmented
              value={method}
              onChange={setMethod}
              options={[
                { value: 'wallet', label: 'To wallet' },
                { value: 'cash', label: 'Cash' },
                { value: 'mobile_money', label: 'MoMo' },
              ]}
            />
          )}
        </div>
        <ErrorBox error={pay.error} />
        <div className="list">
          {t.status !== 'completed' && <div className="empty-inline">Winners and their prizes appear here when the tournament finishes.</div>}
          {t.status === 'completed' && winners.length === 0 && <div className="empty-inline">No prize places set — edit the tournament to add prizes.</div>}
          {winners.map((e: any) => (
            <div key={e.id} className="list-item">
              <span className="cx-player-inline">
                <span className={`cx-prize-place p${e.finalPlace}`}>{e.finalPlace}</span>
                <span>
                  <strong>{e.player?.name}</strong>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {e.player?.fullName} · {e.player?.code}
                  </div>
                </span>
              </span>
              <span className="toolbar" style={{ flexWrap: 'nowrap' }}>
                <strong className="num">{money(e.prizeAmount)}</strong>
                {e.prizePaid ? (
                  <span className="badge badge-success">Paid · {e.prizePaidNote}</span>
                ) : (
                  can('competitions.manage') && (
                    <button className="btn btn-sm btn-primary" disabled={pay.isPending} onClick={() => window.confirm(`Pay ${money(e.prizeAmount)} to ${e.player?.name} (${method.replace('_', ' ')})?`) && pay.mutate(e)}>
                      Pay
                    </button>
                  )
                )}
              </span>
            </div>
          ))}
        </div>
        {method !== 'wallet' && t.status === 'completed' && (
          <div className="hint" style={{ padding: '0 18px 14px' }}>
            Cash or MoMo paid from the drawer: also record it as Cash out on the Shift page so the drawer balances.
          </div>
        )}
      </div>
      <div className="card">
        <div className="card-head">
          <h2>Prize table</h2>
          {t.entryFee > 0 && <span className="dim">Fees collected {money(d.entryFeesCollected)}</span>}
        </div>
        <PrizeList prizes={t.prizes} entries={d.entries} />
      </div>
    </div>
  );
}

function AddPlayer({ tournamentId, onClose }: { tournamentId: string; onClose(): void }) {
  const qc = useQueryClient();
  const { toast } = useApp();
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [c, setC] = useState<any>(null);
  const [n, setN] = useState({ fullName: '', phone: '', gamertag: '' });
  const m = useMutation({
    mutationFn: () =>
      post(`/api/tournaments/${tournamentId}/entries`, mode === 'existing' ? { customerId: c.id } : { newPlayer: { fullName: n.fullName, phone: n.phone || null, gamertag: n.gamertag || null } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['competitions'] });
      toast('success', 'Player added');
      setC(null);
      setN({ fullName: '', phone: '', gamertag: '' });
    },
  });
  return (
    <Modal
      title="Add a player"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Done
          </button>
          <button className="btn btn-primary" disabled={m.isPending || (mode === 'existing' ? !c : n.fullName.trim().length < 2)} onClick={() => m.mutate()}>
            Add
          </button>
        </>
      }
    >
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'existing', label: 'Existing customer' },
          { value: 'new', label: 'New player' },
        ]}
      />
      <ErrorBox error={m.error} />
      {mode === 'existing' ? (
        <CustomerPicker value={c} onChange={setC} />
      ) : (
        <div className="form-grid">
          <Field label="Full name">
            <input className="input" autoFocus value={n.fullName} onChange={(e) => setN({ ...n, fullName: e.target.value })} />
          </Field>
          <Field label="Gamertag (optional)">
            <input className="input" value={n.gamertag} onChange={(e) => setN({ ...n, gamertag: e.target.value })} />
          </Field>
          <Field label="Phone (optional)" full>
            <input className="input" inputMode="tel" value={n.phone} onChange={(e) => setN({ ...n, phone: e.target.value })} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

function ResultModal({ match, knockout, allowDraws, onClose }: { match: MatchV; knockout: boolean; allowDraws: boolean; onClose(): void }) {
  const qc = useQueryClient();
  const { toast } = useApp();
  const [hs, setHs] = useState(match.homeScore != null ? String(match.homeScore) : '');
  const [as, setAs] = useState(match.awayScore != null ? String(match.awayScore) : '');
  const [hp, setHp] = useState(match.homePens != null ? String(match.homePens) : '');
  const [ap, setAp] = useState(match.awayPens != null ? String(match.awayPens) : '');
  const done = () => {
    qc.invalidateQueries({ queryKey: ['competitions'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => put(`/api/matches/${match.id}/result`, { homeScore: Number(hs), awayScore: Number(as), ...(knockout && hs === as ? { homePens: Number(hp), awayPens: Number(ap) } : {}) }),
    onSuccess: () => (toast('success', 'Result saved'), done()),
  });
  const wo = useMutation({ mutationFn: (winner: string) => put(`/api/matches/${match.id}/result`, { walkoverWinnerId: winner }), onSuccess: done });
  const clear = useMutation({ mutationFn: () => post(`/api/matches/${match.id}/clear`), onSuccess: done });
  const level = hs !== '' && hs === as;
  const needPens = knockout && level;
  const valid = hs !== '' && as !== '' && (!level || (knockout ? hp !== '' && ap !== '' && hp !== ap : allowDraws));
  const digits = (fn: (v: string) => void) => (e: any) => fn(e.target.value.replace(/\D/g, ''));
  return (
    <Modal
      title={`${match.home?.name} vs ${match.away?.name}`}
      onClose={onClose}
      footer={
        <>
          {match.status === 'completed' && (
            <button className="btn btn-ghost" style={{ marginRight: 'auto' }} disabled={clear.isPending} onClick={() => clear.mutate()}>
              Clear result
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            Save result
          </button>
        </>
      }
    >
      <ErrorBox error={save.error || wo.error || clear.error} />
      <div className="form-grid">
        <Field label={match.home?.name ?? 'Home'}>
          <input className="input num" autoFocus inputMode="numeric" value={hs} onChange={digits(setHs)} style={{ fontSize: 22, height: 50, textAlign: 'center' }} />
        </Field>
        <Field label={match.away?.name ?? 'Away'}>
          <input className="input num" inputMode="numeric" value={as} onChange={digits(setAs)} style={{ fontSize: 22, height: 50, textAlign: 'center' }} />
        </Field>
        {needPens && (
          <>
            <Field label="Penalties (home)">
              <input className="input num" inputMode="numeric" value={hp} onChange={digits(setHp)} />
            </Field>
            <Field label="Penalties (away)">
              <input className="input num" inputMode="numeric" value={ap} onChange={digits(setAp)} />
            </Field>
          </>
        )}
      </div>
      {level && !knockout && !allowDraws && <div className="hint">This game has no draws — enter the deciding score.</div>}
      {knockout && (
        <div className="toolbar">
          <span className="dim" style={{ fontSize: 12 }}>
            Player didn’t show up?
          </span>
          <button className="btn btn-sm" onClick={() => match.home && wo.mutate(match.home.id)}>
            {match.home?.name} wins by walkover
          </button>
          <button className="btn btn-sm" onClick={() => match.away && wo.mutate(match.away.id)}>
            {match.away?.name} wins by walkover
          </button>
        </div>
      )}
    </Modal>
  );
}
