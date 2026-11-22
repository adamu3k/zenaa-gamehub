/** Player-facing competitions: rankings, tournaments and Find match. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Globe, MapPin, MessageCircle, Search, Swords, Trophy, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorBox, Field, Segmented } from '../components/ui';
import { Avatar, BoardTable, FormDots, Bracket, FORMAT_LABEL, GroupTables, Highlights, MyRankCard, placeLabel, Podium, ResultFeed, ScoreLine, TierBadge, TStatus, type Board, type BoardRow } from '../competitions/ui';
import { formatDateTime } from '../lib/format';
import { pget, ppost } from './portal-api';

export function usePortalGames() {
  return useQuery({ queryKey: ['portal', 'games'], queryFn: () => pget<any[]>('/api/portal/competitions/games'), staleTime: 300_000 });
}

function useGameChoice() {
  const games = usePortalGames();
  const [gameId, setGameId] = useState(() => {
    try {
      return localStorage.getItem('zenaa.portal.game') ?? '';
    } catch {
      return '';
    }
  });
  const valid = games.data?.some((g) => g.id === gameId) ? gameId : (games.data?.[0]?.id ?? '');
  const choose = (id: string) => {
    setGameId(id);
    try {
      localStorage.setItem('zenaa.portal.game', id);
    } catch {
      /* ignore */
    }
  };
  return { games: games.data ?? [], gameId: valid, choose };
}

function Chips({ games, value, onChange }: { games: any[]; value: string; onChange(id: string): void }) {
  return (
    <div className="cx-chips">
      {games.map((g) => (
        <button key={g.id} type="button" className={`cx-chip ${value === g.id ? 'on' : ''}`} onClick={() => onChange(g.id)}>
          {g.name}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── Rankings ─────────────────────────

export function PortalLeaderboard({ me, money }: { me: any; money(n: number): string }) {
  const { games, gameId, choose } = useGameChoice();
  const [period, setPeriod] = useState<'all' | 'month' | 'week'>('all');
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<BoardRow | null>(null);
  const nav = useNavigate();
  const board = useQuery({
    queryKey: ['portal', 'board', gameId, period],
    queryFn: () => pget<Board>(`/api/portal/competitions/leaderboard?gameId=${gameId}&period=${period}`),
    enabled: !!gameId,
    refetchInterval: 30_000,
  });
  const results = useQuery({ queryKey: ['portal', 'results', gameId], queryFn: () => pget<any[]>(`/api/public/results?gameId=${gameId}&limit=10`).catch(() => []), enabled: !!gameId });
  const b = board.data;
  const rows = b ? (all ? b.rows : b.rows.slice(0, 10)) : [];
  void money;
  return (
    <>
      <div className="cx-hero">
        <div className="cx-hero-top">
          <div>
            <h1>
              <Trophy size={24} /> Rankings
            </h1>
            <div className="muted">Top players at the centre — win matches to climb</div>
          </div>
          <div className="cx-chips">
            {(
              [
                ['all', 'All time'],
                ['month', 'Month'],
                ['week', 'Week'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" className={`cx-chip ${period === k ? 'on' : ''}`} onClick={() => setPeriod(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="cx-hero-top" style={{ marginTop: 12 }}>
          <Chips games={games} value={gameId} onChange={choose} />
        </div>
        {b && b.rows.some((r) => !r.provisional) ? (
          <Podium rows={b.rows} onPick={setPicked} />
        ) : (
          <div className="cx-hero-empty">Be the first champion — play 3 matches to get ranked.</div>
        )}
      </div>
      <ErrorBox error={board.error} />
      {b && <MyRankCard me={b.me} game={b.game.name} />}
      {b && <Highlights h={b.highlights} totals={b.totals} />}
      <div className="card">
        <div className="card-head">
          <h2>{all ? 'All players' : 'Top 10'}</h2>
          {b && b.rows.length > 10 && (
            <button className="btn btn-sm" onClick={() => setAll(!all)}>
              {all ? 'Show top 10' : `Show all ${b.rows.length}`}
            </button>
          )}
        </div>
        {b && <BoardTable rows={rows} highlightId={me.id} onPick={setPicked} scoring={b.game.scoring} compact />}
        {b?.me && !rows.some((r) => r.customerId === me.id) && (
          <>
            <div className="dim" style={{ textAlign: 'center', fontSize: 12, padding: 4 }}>
              ⋯
            </div>
            <BoardTable rows={[b.me]} highlightId={me.id} scoring={b.game.scoring} compact />
          </>
        )}
      </div>
      <div className="card">
        <div className="card-head">
          <h2>Latest results</h2>
        </div>
        <ResultFeed items={results.data ?? []} highlightId={me.id} />
      </div>
      {picked && b && (
        <PlayerSheet
          row={picked}
          gameId={b.game.id}
          isMe={picked.customerId === me.id}
          onChallenge={() => nav(`/portal/match?challenge=${picked.customerId}&name=${encodeURIComponent(picked.name)}&game=${b.game.id}`)}
          onClose={() => setPicked(null)}
        />
      )}
    </>
  );
}

function PlayerSheet({ row, gameId, isMe, onChallenge, onClose }: { row: BoardRow; gameId: string; isMe: boolean; onChallenge(): void; onClose(): void }) {
  const h2h = useQuery({
    queryKey: ['portal', 'h2h', gameId, row.customerId],
    queryFn: () => pget(`/api/portal/competitions/head-to-head?gameId=${gameId}&opponentId=${row.customerId}`),
    enabled: !isMe,
  });
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sheet" role="dialog" aria-modal="true">
        <div className="modal-body" style={{ alignItems: 'center', textAlign: 'center' }}>
          <Avatar name={row.name} src={row?.avatarUrl} size={72} />
          <h2 style={{ fontSize: 22 }}>{row.name}</h2>
          <div className="toolbar" style={{ justifyContent: 'center' }}>
            <TierBadge tier={row.tier} />
            <strong>{row.provisional ? 'Placement' : `#${row.rank}`}</strong>
            <span className="num">{row.rating} rating</span>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', width: '100%' }}>
            {[
              ['Wins', row.won],
              ['Draws', row.drawn],
              ['Losses', row.lost],
              ['Win rate', `${row.winRate}%`],
              ['Goals', row.gf],
              ['Titles', row.titles],
            ].map(([l, v]) => (
              <div key={l as string} className="card stat" style={{ padding: 10 }}>
                <span className="stat-label" style={{ justifyContent: 'center' }}>{l}</span>
                <span className="stat-value" style={{ fontSize: 20 }}>{v}</span>
              </div>
            ))}
          </div>
          {!isMe && h2h.data && h2h.data.played > 0 && (
            <div style={{ width: '100%' }}>
              <div className="cx-hl-label" style={{ justifyContent: 'center' }}>You vs {row.name}</div>
              <div className="cx-feed-score num" style={{ display: 'inline-block', margin: '6px 0', fontSize: 20 }}>
                {h2h.data.aWins} – {h2h.data.draws} – {h2h.data.bWins}
              </div>
            </div>
          )}
          <div className="toolbar" style={{ justifyContent: 'center' }}>
            {!isMe && (
              <button className="btn btn-primary" onClick={onChallenge}>
                <Swords size={16} /> Challenge
              </button>
            )}
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Tournaments ─────────────────────────

export function PortalTournaments({ money }: { money(n: number): string }) {
  const list = useQuery({ queryKey: ['portal', 'tournaments'], queryFn: () => pget<any[]>('/api/portal/tournaments'), refetchInterval: 60_000 });
  const nav = useNavigate();
  return (
    <>
      <div className="cx-hero" style={{ paddingBottom: 20 }}>
        <div className="cx-hero-top">
          <div>
            <h1>
              <Trophy size={24} /> Tournaments
            </h1>
            <div className="muted">Sign up, follow the bracket live and win cash prizes</div>
          </div>
        </div>
      </div>
      <ErrorBox error={list.error} />
      {list.data?.length === 0 && <div className="card empty">No tournaments announced yet — check back soon.</div>}
      <div className="cx-tgrid">
        {(list.data ?? []).map((t) => (
          <button key={t.id} type="button" className="cx-tcard" onClick={() => nav(`/portal/cups/${t.id}`)}>
            <div className="toolbar">
              <TStatus s={t.status} />
              {t.registered && <span className="badge badge-success">You’re in</span>}
            </div>
            <h3>{t.name}</h3>
            <div className="dim" style={{ fontSize: 13 }}>
              {t.gameName} · {FORMAT_LABEL[t.format]} · {t.players}/{t.maxPlayers} players
              {t.startsAt ? ` · ${formatDateTime(t.startsAt)}` : ''}
            </div>
            <div className="toolbar">
              {t.prizePool > 0 && <span className="badge badge-warning">🏆 {money(t.prizePool)}</span>}
              <span className="badge">{t.entryFee > 0 ? `Entry ${money(t.entryFee)}` : 'Free entry'}</span>
              {t.champion && <span className="badge badge-success">👑 {t.champion.name}</span>}
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

export function PortalTournament({ me, money }: { me: any; money(n: number): string }) {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['portal', 'tournament', id], queryFn: () => pget(`/api/portal/tournaments/${id}`), refetchInterval: 20_000 });
  const reg = useMutation({ mutationFn: () => ppost(`/api/portal/tournaments/${id}/register`), onSuccess: () => qc.invalidateQueries({ queryKey: ['portal'] }) });
  const out = useMutation({ mutationFn: () => ppost(`/api/portal/tournaments/${id}/withdraw`), onSuccess: () => qc.invalidateQueries({ queryKey: ['portal'] }) });
  const [tab, setTab] = useState<'live' | 'players' | 'prizes'>('live');
  const d = q.data;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!d) return <div className="muted">Loading…</div>;
  const t = d.tournament;
  const mine = d.entries.find((e: any) => e.player?.id === me.id);
  return (
    <>
      <Link to="/portal/cups" className="dim" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
        <ArrowLeft size={14} /> Tournaments
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
            <h1>{t.name}</h1>
            <div className="muted">
              {t.gameName} · {d.entries.length}/{t.maxPlayers} players{t.startsAt ? ` · ${formatDateTime(t.startsAt)}` : ''}
            </div>
          </div>
          {t.status === 'registration' && t.publicRegistration && (
            <div>
              {mine ? (
                <button className="btn" disabled={out.isPending} onClick={() => window.confirm('Leave this tournament?') && out.mutate()}>
                  Withdraw
                </button>
              ) : (
                <button className="btn btn-primary" disabled={reg.isPending || d.entries.length >= t.maxPlayers} onClick={() => reg.mutate()}>
                  <UserPlus size={16} /> {d.entries.length >= t.maxPlayers ? 'Full' : 'Sign me up'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <ErrorBox error={reg.error || out.error} />
      {mine && t.status !== 'completed' && (
        <div className="card card-pad" style={{ borderColor: 'var(--success)' }}>
          ✅ You’re registered{t.entryFee > 0 && !mine.paid ? ` — pay the ${money(t.entryFee)} entry fee at the counter before the start` : ''}.
          {mine.status === 'eliminated' && ' You are out of this tournament — well played!'}
        </div>
      )}
      {d.champion && (
        <div className="cx-champion">
          <Avatar name={d.champion.name} src={d.champion?.avatarUrl} size={56} ring="#fff" />
          <div>
            <div style={{ fontWeight: 800, letterSpacing: '0.08em', fontSize: 12 }}>🏆 CHAMPION</div>
            <div className="big">{d.champion.name}</div>
          </div>
        </div>
      )}
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'live', label: t.format === 'league' ? 'Table & games' : 'Bracket & games' },
          { value: 'players', label: `Players (${d.entries.length})` },
          { value: 'prizes', label: 'Prizes' },
        ]}
      />
      {tab === 'live' && (
        <>
          {d.groups.length > 0 && <GroupTables groups={d.groups} highlightId={me.id} />}
          {d.bracket.rounds.length > 0 && (
            <div className="card card-pad">
              <Bracket bracket={d.bracket} highlightId={me.id} />
            </div>
          )}
          {d.upcoming.length > 0 && (
            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h2>Next games</h2>
              {d.upcoming.map((m: any) => (
                <ScoreLine key={m.id} m={m} highlightId={me.id} />
              ))}
            </div>
          )}
          {d.topScorers.length > 0 && (
            <div className="card">
              <div className="card-head">
                <h2>Top scorers</h2>
              </div>
              <div className="list">
                {d.topScorers.map((s: any, i: number) => (
                  <div key={s.player?.id} className="list-item">
                    <span className="cx-player-inline">
                      <strong className="num">{i + 1}</strong> <Avatar name={s.player?.name ?? '?'} src={s.player?.avatarUrl} size={24} /> {s.player?.name}
                    </span>
                    <strong className="num">{s.goals}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
          {d.groups.length === 0 && d.bracket.rounds.length === 0 && <div className="card empty">The draw happens when the tournament starts.</div>}
          {(t.description || t.rules) && (
            <div className="card card-pad" style={{ whiteSpace: 'pre-wrap' }}>
              {t.description}
              {t.rules && (
                <>
                  <h3 style={{ marginTop: 10 }}>Rules</h3>
                  <div className="muted">{t.rules}</div>
                </>
              )}
            </div>
          )}
        </>
      )}
      {tab === 'players' && (
        <div className="card list">
          {d.entries.map((e: any) => (
            <div key={e.id} className="list-item">
              <span className="cx-player-inline">
                <Avatar name={e.player?.name ?? '?'} src={e.player?.avatarUrl} size={30} /> <strong>{e.player?.name}</strong>
                {e.groupName && <span className="dim">Group {e.groupName}</span>}
              </span>
              <span>{e.finalPlace ? placeLabel(e.finalPlace) : e.status === 'eliminated' ? <span className="badge badge-danger">Out</span> : e.status === 'active' ? <span className="badge badge-primary">Still in</span> : ''}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'prizes' && (
        <div className="card">
          {t.prizes.length === 0 && <div className="empty-inline">No cash prizes for this one — it’s for glory and rating points.</div>}
          {[...t.prizes]
            .sort((a: any, b: any) => a.place - b.place)
            .map((p: any) => (
              <div key={p.place} className="cx-prize">
                <span className={`cx-prize-place p${p.place}`}>{p.place}</span>
                <span style={{ flex: 1 }}>
                  <strong>{money(p.amount)}</strong>
                  {p.label && <span className="dim"> · {p.label}</span>}
                  <div style={{ fontSize: 12 }}>
                    {d.entries
                      .filter((e: any) => e.finalPlace === p.place)
                      .map((e: any) => e.player?.name)
                      .join(', ')}
                  </div>
                </span>
              </div>
            ))}
        </div>
      )}
    </>
  );
}

// ───────────────────────── Find match ─────────────────────────

export function PortalFindMatch({ me }: { me: any }) {
  const qc = useQueryClient();
  const params = new URLSearchParams(window.location.search);
  const { games, gameId, choose } = useGameChoice();
  const challengeId = params.get('challenge');
  const [f, setF] = useState({ mode: 'venue' as 'venue' | 'online', skill: 'any' as 'any' | 'similar', when: 'now', at: '', note: '', lobbyCode: '' });
  const [target, setTarget] = useState<{ id: string; name: string; avatarUrl?: string | null } | null>(challengeId ? { id: challengeId, name: params.get('name') ?? 'player' } : null);
  useEffect(() => {
    const g = params.get('game');
    if (g) choose(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const list = useQuery({ queryKey: ['portal', 'mm', gameId], queryFn: () => pget(`/api/portal/matchmaking?gameId=${gameId}`), enabled: !!gameId, refetchInterval: 15_000 });
  const mine = useQuery({ queryKey: ['portal', 'mine', gameId], queryFn: () => pget(`/api/portal/competitions/me?gameId=${gameId}`), enabled: !!gameId, refetchInterval: 15_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['portal'] });
  const post = useMutation({
    mutationFn: () =>
      ppost('/api/portal/matchmaking', {
        gameId,
        mode: f.mode,
        skill: f.skill,
        preferredAt: f.when === 'later' && f.at ? new Date(f.at).toISOString() : null,
        note: f.note || null,
        lobbyCode: f.mode === 'online' ? f.lobbyCode || null : null,
        targetCustomerId: target?.id ?? null,
      }),
    onSuccess: () => {
      setF({ ...f, note: '', lobbyCode: '' });
      setTarget(null);
      refresh();
    },
  });
  const accept = useMutation({ mutationFn: (id: string) => ppost(`/api/portal/matchmaking/${id}/accept`), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: (id: string) => ppost(`/api/portal/matchmaking/${id}/cancel`), onSuccess: refresh });
  const err = post.error || accept.error || cancel.error || list.error;
  const open = (list.data?.open ?? []) as any[];
  const others = open.filter((r) => !r.mine);
  const myOpen = open.filter((r) => r.mine);
  return (
    <>
      <div className="cx-hero" style={{ paddingBottom: 20 }}>
        <div className="cx-hero-top">
          <div>
            <h1>
              <Swords size={24} /> Find match
            </h1>
            <div className="muted">Find an opponent at the centre or online. Results count on the leaderboard once both players confirm.</div>
          </div>
        </div>
        <div className="cx-hero-top" style={{ marginTop: 12 }}>
          <Chips games={games} value={gameId} onChange={choose} />
        </div>
      </div>
      <ErrorBox error={err} />
      {mine.data?.openMatches?.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Your matches</h2>
          </div>
          {mine.data.openMatches.map((m: any) => (
            <OpenMatch key={m.id} m={m} me={me} onDone={refresh} />
          ))}
        </div>
      )}
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>{target ? `Challenge ${target.name}` : 'I want to play'}</h2>
        {target && (
          <div className="toolbar">
            <Avatar name={target.name} src={target?.avatarUrl} size={32} /> <strong>{target.name}</strong>
            <button className="btn btn-sm btn-ghost" onClick={() => setTarget(null)}>
              Anyone instead
            </button>
          </div>
        )}
        <div className="form-grid">
          <Field label="Where">
            <Segmented
              value={f.mode}
              onChange={(v) => setF({ ...f, mode: v })}
              options={[
                { value: 'venue', label: 'At the centre' },
                { value: 'online', label: 'Online (PSN)' },
              ]}
            />
          </Field>
          <Field label="When">
            <Segmented
              value={f.when}
              onChange={(v) => setF({ ...f, when: v })}
              options={[
                { value: 'now', label: 'Now' },
                { value: 'later', label: 'Pick a time' },
              ]}
            />
          </Field>
          {f.when === 'later' && (
            <Field label="Time">
              <input className="input" type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} />
            </Field>
          )}
          {!target && (
            <Field label="Opponent">
              <Segmented
                value={f.skill}
                onChange={(v) => setF({ ...f, skill: v })}
                options={[
                  { value: 'any', label: 'Anyone' },
                  { value: 'similar', label: 'My level' },
                ]}
              />
            </Field>
          )}
          <Field label="Message (optional)" full>
            <input className="input" maxLength={200} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. 2 legs, 6-minute halves, I’m Real Madrid" />
          </Field>
        </div>
        {f.mode === 'online' && (
          <Field label="Room ID / password (optional)" full hint="eFootball Friend Match room, private lobby code… Only the player who accepts sees it. EA FC has no codes: you invite each other from your PSN/EA friends list.">
            <input className="input mono" maxLength={60} value={f.lobbyCode} onChange={(e) => setF({ ...f, lobbyCode: e.target.value })} placeholder="e.g. Room 482913 · pw 2580" />
          </Field>
        )}
        {f.mode === 'online' && !me.psnId && !me.eaId && <div className="hint">Add your PSN ID / EA ID in Profile so your opponent can find you online.</div>}
        <div>
          <button className="btn btn-primary" disabled={post.isPending || !gameId || (f.when === 'later' && !f.at)} onClick={() => post.mutate()}>
            <Swords size={16} /> {target ? 'Send challenge' : 'Find me a match'}
          </button>
        </div>
      </div>
      {myOpen.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Your open requests</h2>
          </div>
          {myOpen.map((r) => (
            <div key={r.id} className="cx-req">
              <div className="cx-req-main">
                <strong>{r.challenge ? `Challenge to ${r.challenge.name}` : 'Looking for an opponent'}</strong>
                <span className="dim" style={{ fontSize: 12 }}>
                  {r.mode === 'online' ? 'Online' : 'At the centre'} · {r.preferredAt ? formatDateTime(r.preferredAt) : 'now'} · expires {formatDateTime(r.expiresAt)}
                </span>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => cancel.mutate(r.id)}>
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="card">
        <div className="card-head">
          <h2>Players looking for a game</h2>
          <span className="dim">{others.length}</span>
        </div>
        {others.length === 0 && <div className="empty-inline">Nobody yet — post your own request above and others will see it.</div>}
        {others.map((r) => (
          <div key={r.id} className="cx-req">
            <Avatar name={r.player.name} src={r.player?.avatarUrl} size={42} />
            <div className="cx-req-main">
              <div className="toolbar" style={{ gap: 6 }}>
                <strong>{r.player.name}</strong>
                <TierBadge tier={r.player.tier} small />
                <span className="dim num" style={{ fontSize: 12 }}>
                  {r.player.rating}
                </span>
                {r.challenge && <span className="badge badge-warning">challenged you!</span>}
              </div>
              <span className="dim" style={{ fontSize: 12, display: 'inline-flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {r.mode === 'online' ? <Globe size={12} /> : <MapPin size={12} />} {r.mode === 'online' ? 'Online' : 'At the centre'} · {r.preferredAt ? formatDateTime(r.preferredAt) : 'now'}
                {r.skill === 'similar' && ' · similar level'}
              </span>
              {r.note && <span style={{ fontSize: 13 }}>“{r.note}”</span>}
            </div>
            <button className="btn btn-sm btn-primary" disabled={!r.canAccept || accept.isPending} onClick={() => accept.mutate(r.id)} title={r.canAccept ? '' : 'Level too different'}>
              {r.canAccept ? 'Accept' : 'Not your level'}
            </button>
          </div>
        ))}
      </div>
      <OpponentSearch
        gameId={gameId}
        onChallenge={(p) => (setTarget(p), window.scrollTo({ top: 0, behavior: 'smooth' }))}
        onAccept={(id) => accept.mutate(id)}
        accepting={accept.isPending}
      />
      {(list.data?.history ?? []).length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>History</h2>
          </div>
          {list.data.history.map((r: any) => (
            <div key={r.id} className="cx-req">
              <div className="cx-req-main">
                <strong>
                  {r.player.name} <span className="cx-vs">VS</span> {r.opponent?.name ?? '—'}
                </strong>
                <span className="dim" style={{ fontSize: 12 }}>
                  {r.status} · {formatDateTime(r.createdAt)}
                  {r.contact?.psnId ? ` · opponent PSN: ${r.contact.psnId}` : ''}
                  {r.contact?.eaId ? ` · EA ID: ${r.contact.eaId}` : ''}
                  {r.contact?.lobbyCode ? ` · room: ${r.contact.lobbyCode}` : ''}
                </span>
              </div>
              {r.match && (
                <div style={{ width: 200 }}>
                  <ScoreLine m={r.match} highlightId={me.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function OpenMatch({ m, me, onDone }: { m: any; me: any; onDone(): void }) {
  const [my, setMy] = useState('');
  const [their, setTheir] = useState('');
  const amHome = m.home?.id === me.id;
  const opp = amHome ? m.away : m.home;
  const report = useMutation({ mutationFn: () => ppost(`/api/portal/matches/${m.id}/report`, { myScore: Number(my), opponentScore: Number(their) }), onSuccess: onDone });
  const confirm = useMutation({ mutationFn: () => ppost(`/api/portal/matches/${m.id}/confirm`), onSuccess: onDone });
  const dispute = useMutation({ mutationFn: () => ppost(`/api/portal/matches/${m.id}/dispute`), onSuccess: onDone });
  const myScore = amHome ? m.homeScore : m.awayScore;
  const theirScore = amHome ? m.awayScore : m.homeScore;
  return (
    <div className="cx-req">
      <Avatar name={opp?.name ?? '?'} src={opp?.avatarUrl} size={40} />
      <div className="cx-req-main">
        <strong>
          You <span className="cx-vs">VS</span> {opp?.name}
        </strong>
        <span className="dim" style={{ fontSize: 12 }}>
          {m.note ? `${m.note} · ` : ''}
          {m.scheduledAt ? formatDateTime(m.scheduledAt) : ''}
        </span>
        {m.online && <OnlineInfo m={m} onDone={onDone} />}
        <ErrorBox error={report.error || confirm.error || dispute.error} />
      </div>
      {m.mustConfirm ? (
        <div className="toolbar">
          <span>
            {opp?.name} says <strong className="num">{myScore}–{theirScore}</strong> (you–them)
          </span>
          <button className="btn btn-sm btn-primary" onClick={() => confirm.mutate()}>
            Confirm
          </button>
          <button className="btn btn-sm" onClick={() => dispute.mutate()}>
            Wrong score
          </button>
        </div>
      ) : m.status === 'pending_confirmation' ? (
        <span className="badge badge-warning">Waiting for {opp?.name} to confirm</span>
      ) : m.canReport ? (
        <div className="toolbar" style={{ flexWrap: 'nowrap' }}>
          <input className="input num" style={{ width: 54 }} inputMode="numeric" placeholder="You" value={my} onChange={(e) => setMy(e.target.value.replace(/\D/g, ''))} />
          <span>–</span>
          <input className="input num" style={{ width: 54 }} inputMode="numeric" placeholder="Them" value={their} onChange={(e) => setTheir(e.target.value.replace(/\D/g, ''))} />
          <button className="btn btn-sm btn-primary" disabled={my === '' || their === '' || report.isPending} onClick={() => report.mutate()}>
            Report
          </button>
        </div>
      ) : (
        <span className="badge">Staff will enter the score</span>
      )}
    </div>
  );
}

/** Home-page teaser: my rank in the first game + live tournaments. */
export function CompeteTeaser({ me }: { me: any }) {
  const { games, gameId } = useGameChoice();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['portal', 'mine', gameId], queryFn: () => pget(`/api/portal/competitions/me?gameId=${gameId}`), enabled: !!gameId });
  const ts = useQuery({ queryKey: ['portal', 'tournaments'], queryFn: () => pget<any[]>('/api/portal/tournaments') });
  const live = (ts.data ?? []).filter((t) => t.status === 'live' || t.status === 'registration').slice(0, 2);
  if (!games.length) return null;
  const pending = (q.data?.openMatches ?? []).filter((m: any) => m.mustConfirm).length;
  return (
    <>
      {pending > 0 && (
        <button type="button" className="card card-pad" style={{ borderColor: 'var(--warning)', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }} onClick={() => nav('/portal/match')}>
          ⚠️ <strong>{pending} score{pending > 1 ? 's' : ''} to confirm</strong> — tap to check
        </button>
      )}
      <button type="button" onClick={() => nav('/portal/ranks')} style={{ all: 'unset', cursor: 'pointer', display: 'block' }}>
        <MyRankCard me={q.data?.me ?? null} game={q.data?.game?.name ?? games[0].name} />
      </button>
      {live.map((t) => (
        <button key={t.id} type="button" className="cx-tcard" onClick={() => nav(`/portal/cups/${t.id}`)}>
          <div className="toolbar">
            <TStatus s={t.status} />
            {t.registered && <span className="badge badge-success">You’re in</span>}
          </div>
          <h3>{t.name}</h3>
          <div className="dim" style={{ fontSize: 13 }}>
            {t.gameName} · {t.players}/{t.maxPlayers} players {t.status === 'registration' && !t.registered ? '· tap to sign up' : ''}
          </div>
        </button>
      ))}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Link to="/portal/match" className="btn btn-primary" style={{ height: 46 }}>
          <Swords size={17} /> Find match
        </Link>
        <Link to="/portal/ranks" className="btn" style={{ height: 46 }}>
          <Trophy size={17} /> Rankings
        </Link>
      </div>
    </>
  );
}

/** Online matches: opponent's PSN / EA ID, the room code either player sets, and how to meet in this game. */
function OnlineInfo({ m, onDone }: { m: any; onDone(): void }) {
  const [code, setCode] = useState(m.lobbyCode ?? '');
  const [editing, setEditing] = useState(false);
  const save = useMutation({
    mutationFn: () => ppost(`/api/portal/matches/${m.id}/lobby`, { lobbyCode: code.trim() || null }),
    onSuccess: () => {
      setEditing(false);
      onDone();
    },
  });
  return (
    <div className="hint" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
      <span>
        🌐 Online
        {m.opponentContact?.psnId ? ` · PSN: ${m.opponentContact.psnId}` : ''}
        {m.opponentContact?.eaId ? ` · EA ID: ${m.opponentContact.eaId}` : ''}
      </span>
      {editing || !m.lobbyCode ? (
        m.status === 'scheduled' && (
          <span className="toolbar" style={{ flexWrap: 'nowrap' }}>
            <input className="input mono" style={{ maxWidth: 220 }} maxLength={60} placeholder="Room ID / password" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn btn-sm" disabled={save.isPending} onClick={() => save.mutate()}>
              Share code
            </button>
          </span>
        )
      ) : (
        <span>
          Room / code: <b className="mono">{m.lobbyCode}</b>{' '}
          {m.status === 'scheduled' && (
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
              Change
            </button>
          )}
        </span>
      )}
      {m.howTo && <span className="dim">{m.howTo}</span>}
      <ErrorBox error={save.error} />
    </div>
  );
}

// ───────────────────────── Find opponents (search) ─────────────────────────

const FILTERS = [
  { value: 'all', label: 'Everyone' },
  { value: 'similar', label: 'My level' },
  { value: 'here', label: 'At the centre now' },
  { value: 'looking', label: 'Looking for a game' },
] as const;

/** Search any player by gamertag, name, PSN ID or EA ID, or browse by level / who is here now / who wants a game. */
function OpponentSearch({ gameId, onChallenge, onAccept, accepting }: { gameId: string; onChallenge(p: { id: string; name: string }): void; onAccept(requestId: string): void; accepting: boolean }) {
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('all');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const info = useQuery({ queryKey: ['portal', 'info'], queryFn: () => pget<any>('/api/portal/info'), staleTime: 60_000 });
  const res = useQuery({
    queryKey: ['portal', 'players', gameId, q, filter],
    queryFn: () => pget<any>(`/api/portal/players/search?gameId=${gameId}&filter=${filter}&q=${encodeURIComponent(q)}`),
    enabled: !!gameId,
    refetchInterval: 30_000,
  });
  const players = (res.data?.players ?? []) as any[];
  return (
    <div className="card">
      <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
        <h2>
          <Search size={18} style={{ verticalAlign: -3 }} /> Find opponents
        </h2>
        <span className="dim" style={{ fontSize: 12 }}>
          {res.data ? `${res.data.total} player${res.data.total === 1 ? '' : 's'} · your rating ${res.data.myRating}` : ''}
        </span>
      </div>
      <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 0 }}>
        <input className="input" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search gamertag, name, PSN ID or EA ID…" />
        <div className="cx-chips light">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" className={`cx-chip ${filter === f.value ? 'on' : ''}`} onClick={() => setFilter(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <ErrorBox error={res.error} />
      {res.isLoading && <div className="empty-inline">Searching…</div>}
      {res.data && players.length === 0 && (
        <div className="empty-inline">
          {q ? `Nobody called "${q}".` : filter === 'here' ? 'Nobody else is playing at the centre right now.' : filter === 'looking' ? 'Nobody is looking for a game right now — post your own request above.' : 'No players yet.'}
        </div>
      )}
      {players.map((r) => (
        <div key={r.player.id} className="cx-req opp-row">
          <Avatar name={r.player.name} src={r.player?.avatarUrl} size={42} ring={r.atCentre ? 'var(--success)' : undefined} />
          <div className="cx-req-main">
            <div className="toolbar" style={{ gap: 6 }}>
              <strong>{r.player.name}</strong>
              <TierBadge tier={r.tier} small />
              <span className="dim num" style={{ fontSize: 12 }}>
                {r.rating}
                {r.gap !== 0 && ` (${r.gap > 0 ? '+' : ''}${r.gap})`}
                {r.provisional && ' · new'}
              </span>
            </div>
            <span className="dim" style={{ fontSize: 12 }}>
              {r.played > 0 ? `${r.played} games · ${r.won}W ${r.drawn}D ${r.lost}L · ${r.winRate}% wins` : 'No results yet'}
              {r.lastPlayedAt ? ` · last ${formatDateTime(r.lastPlayedAt)}` : ''}
            </span>
            <div className="toolbar" style={{ gap: 6 }}>
              {r.form?.length > 0 && <FormDots form={r.form} />}
              {r.atCentre && <span className="badge badge-success">🟢 At the centre now</span>}
              {r.looking && (
                <span className="badge badge-warning">
                  Wants a game {r.looking.mode === 'online' ? '(online)' : '(at the centre)'}
                </span>
              )}
              {r.headToHead && (
                <span className="badge" title="Your results against this player">
                  You vs them: {r.headToHead.w}W {r.headToHead.d}D {r.headToHead.l}L
                </span>
              )}
              {r.hasPsn && <span className="badge">PSN</span>}
              {r.hasEa && <span className="badge">EA ID</span>}
            </div>
          </div>
          <div className="opp-actions">
            {r.looking ? (
              <button className="btn btn-sm btn-primary" disabled={accepting} onClick={() => onAccept(r.looking.requestId)}>
                Accept game
              </button>
            ) : (
              <button className="btn btn-sm btn-primary" onClick={() => onChallenge(r.player)}>
                <Swords size={14} /> Challenge
              </button>
            )}
            {info.data?.chatEnabled && (
              <button className="btn btn-sm" onClick={() => nav(`/portal/chat?to=${r.player.id}&name=${encodeURIComponent(r.player.name)}`)}>
                <MessageCircle size={14} /> Message
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
