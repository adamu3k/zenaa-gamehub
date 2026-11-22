/**
 * Venue TV board (/board): public, no sign-in. Rotates through each game's leaderboard and shows live
 * tournaments and the latest results. Open it on a TV browser or a PC connected to a TV and press F11.
 */
import { useQuery } from '@tanstack/react-query';
import { Maximize, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BoardTable, Bracket, GroupTables, Highlights, Podium, ResultFeed, TStatus, type Board } from '../competitions/ui';
import { pget } from './portal-api';

export function TvBoard() {
  const games = useQuery({ queryKey: ['tv', 'games'], queryFn: () => pget<any[]>('/api/public/games'), refetchInterval: 300_000 });
  const info = useQuery({ queryKey: ['tv', 'info'], queryFn: () => pget('/api/portal/info'), staleTime: 300_000 });
  const ts = useQuery({ queryKey: ['tv', 'tournaments'], queryFn: () => pget<any[]>('/api/public/tournaments'), refetchInterval: 60_000 });
  const live = (ts.data ?? []).filter((t) => t.status === 'live');
  // Slides: one per game with matches, then one per live tournament.
  const slides = [...(games.data ?? []).map((g) => ({ kind: 'game' as const, id: g.id })), ...live.map((t) => ({ kind: 'cup' as const, id: t.id }))];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => x + 1), 25_000);
    return () => clearInterval(t);
  }, []);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const slide = slides.length ? slides[i % slides.length] : null;
  return (
    <div className="cx-tv" data-theme="dark">
      <div className="toolbar">
        <div className="brand" style={{ padding: 0, fontSize: 20 }}>
          <div className="brand-mark" style={{ width: 42, height: 42 }}>
            <Trophy size={22} />
          </div>
          <div>
            {(info.data as any)?.centerName ?? 'ZENAA GAMEHUB'}
            <small>Leaderboard · scan the portal QR at the counter to join</small>
          </div>
        </div>
        <div className="spacer" />
        <div className="num" style={{ fontSize: 28, fontWeight: 800 }}>
          {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
        <button className="btn btn-ghost btn-icon" style={{ color: '#fff' }} onClick={() => document.documentElement.requestFullscreen?.()} aria-label="Full screen">
          <Maximize size={18} />
        </button>
      </div>
      {games.error && <div className="error-box">{(games.error as Error).message}</div>}
      {slide?.kind === 'game' && <GameSlide gameId={slide.id} />}
      {slide?.kind === 'cup' && <CupSlide id={slide.id} />}
      {slides.length > 1 && (
        <div className="toolbar" style={{ justifyContent: 'center' }}>
          {slides.map((s, k) => (
            <span key={s.kind + s.id} style={{ width: 10, height: 10, borderRadius: 5, background: k === i % slides.length ? '#fff' : 'rgba(255,255,255,0.25)' }} />
          ))}
        </div>
      )}
    </div>
  );
}

function GameSlide({ gameId }: { gameId: string }) {
  const b = useQuery({ queryKey: ['tv', 'board', gameId], queryFn: () => pget<Board>(`/api/public/leaderboard?gameId=${gameId}&limit=10`), refetchInterval: 30_000 });
  const r = useQuery({ queryKey: ['tv', 'results', gameId], queryFn: () => pget<any[]>(`/api/public/results?gameId=${gameId}&limit=8`), refetchInterval: 30_000 });
  if (!b.data) return null;
  return (
    <>
      <div className="cx-hero">
        <div className="cx-hero-top">
          <h1 style={{ fontSize: 34 }}>
            <Trophy size={32} /> {b.data.game.name}
          </h1>
          <span className="muted" style={{ fontSize: 16 }}>
            {b.data.totals.matches} matches · {b.data.totals.goals} goals
          </span>
        </div>
        {b.data.rows.some((x) => !x.provisional) ? <Podium rows={b.data.rows} /> : <div className="cx-hero-empty">Play 3 matches to appear on the board!</div>}
      </div>
      <div className="cx-tv-grid">
        <div className="card">
          <BoardTable rows={b.data.rows.slice(0, 10)} scoring={b.data.game.scoring} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Highlights h={b.data.highlights} totals={b.data.totals} />
          <div className="card">
            <div className="card-head">
              <h2>Latest results</h2>
            </div>
            <ResultFeed items={r.data ?? []} />
          </div>
        </div>
      </div>
    </>
  );
}

function CupSlide({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['tv', 'cup', id], queryFn: () => pget(`/api/public/tournaments/${id}`), refetchInterval: 20_000 });
  const d = q.data as any;
  if (!d) return null;
  return (
    <>
      <div className="cx-hero" style={{ paddingBottom: 20 }}>
        <div className="cx-hero-top">
          <h1 style={{ fontSize: 34 }}>
            <Trophy size={32} /> {d.tournament.name}
          </h1>
          <TStatus s={d.tournament.status} />
        </div>
        <div className="muted" style={{ position: 'relative', zIndex: 1, fontSize: 16 }}>
          {d.progress.played}/{d.progress.total} matches played{d.prizePool ? ' · cash prizes' : ''}
        </div>
      </div>
      {d.bracket.rounds.length > 0 && (
        <div className="card card-pad">
          <Bracket bracket={d.bracket} />
        </div>
      )}
      {d.groups.length > 0 && <GroupTables groups={d.groups} />}
    </>
  );
}
