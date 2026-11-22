import { useState } from 'react';
/** Shared competition visuals for the staff app, the player portal and the venue TV board. */
import { Crown, Flame, Medal, Swords, Target, TrendingDown, TrendingUp, Trophy, Zap } from 'lucide-react';
import type { ReactNode } from 'react';

export interface BoardRow {
  rank: number;
  customerId: string;
  name: string;
  avatarUrl?: string | null;
  player: { id: string; name: string; fullName?: string; code?: string; avatarUrl?: string | null } | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  winRate: number;
  rating: number;
  ratingChange: number;
  tier: string;
  form: ('W' | 'D' | 'L')[];
  streak: { type: 'W' | 'D' | 'L'; count: number } | null;
  titles: number;
  provisional: boolean;
  longestWinStreak: number;
  cleanSheets: number;
}

export interface Board {
  game: { id: string; name: string; scoring: string };
  period: 'all' | 'month' | 'week';
  totals: { matches: number; goals: number; players: number };
  rows: BoardRow[];
  me: BoardRow | null;
  highlights: {
    biggestWin: { winner: any; loser: any; score: string; playedAt: string } | null;
    topScorer: { name: string; value: number } | null;
    longestStreak: { name: string; value: number } | null;
    mostActive: { name: string; value: number } | null;
    onFire: { name: string; value: number } | null;
  };
}

const hue = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};

export function Avatar({ name, size = 40, ring, src }: { name: string; size?: number; ring?: string; src?: string | null }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken)
    return (
      <img
        className="cx-avatar"
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setBroken(true)}
        style={{ width: size, height: size, objectFit: 'cover', boxShadow: ring ? `0 0 0 3px var(--surface), 0 0 0 5px ${ring}` : undefined }}
      />
    );
  const h = hue(name);
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className="cx-avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${h} 80% 58%), hsl(${(h + 50) % 360} 85% 45%))`,
        boxShadow: ring ? `0 0 0 3px var(--surface), 0 0 0 5px ${ring}` : undefined,
      }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export const TIER_STYLE: Record<string, string> = {
  Legend: 'tier-legend',
  Diamond: 'tier-diamond',
  Platinum: 'tier-platinum',
  Gold: 'tier-gold',
  Silver: 'tier-silver',
  Bronze: 'tier-bronze',
};

export function TierBadge({ tier, small }: { tier: string; small?: boolean }) {
  return <span className={`cx-tier ${TIER_STYLE[tier] ?? ''} ${small ? 'sm' : ''}`}>{tier}</span>;
}

export function FormDots({ form }: { form: string[] }) {
  if (!form.length) return <span className="dim">—</span>;
  return (
    <span className="cx-form" aria-label={`Last ${form.length}: ${form.join(' ')}`}>
      {form.map((f, i) => (
        <span key={i} className={`cx-dot ${f}`}>
          {f}
        </span>
      ))}
    </span>
  );
}

export function Delta({ value }: { value: number }) {
  if (!value) return <span className="cx-delta flat">±0</span>;
  return (
    <span className={`cx-delta ${value > 0 ? 'up' : 'down'}`}>
      {value > 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
      {value > 0 ? '+' : ''}
      {value}
    </span>
  );
}

const PODIUM_COLORS = ['#ffd54a', '#c9d3e3', '#e39a5b'];

export function Podium({ rows, onPick }: { rows: BoardRow[]; onPick?(r: BoardRow): void }) {
  const top = rows.filter((r) => !r.provisional).slice(0, 3);
  if (top.length === 0) return null;
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : [top[0]];
  return (
    <div className="cx-podium">
      {order.map((r) => {
        const place = r.rank;
        return (
          <button key={r.customerId} type="button" className={`cx-step p${place}`} onClick={() => onPick?.(r)}>
            {place === 1 && <Crown className="cx-crown" size={30} />}
            <Avatar name={r.name} src={r?.avatarUrl} size={place === 1 ? 84 : 66} ring={PODIUM_COLORS[place - 1]} />
            <div className="cx-step-name">{r.name}</div>
            <TierBadge tier={r.tier} small />
            <div className="cx-step-rating">{r.rating}</div>
            <div className="cx-step-meta">
              {r.won}W · {r.drawn}D · {r.lost}L
            </div>
            <div className="cx-plinth" style={{ ['--c' as any]: PODIUM_COLORS[place - 1] }}>
              <span>{place}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function BoardTable({
  rows,
  highlightId,
  onPick,
  scoring = 'goals',
  showCode,
  compact,
}: {
  rows: BoardRow[];
  highlightId?: string | null;
  onPick?(r: BoardRow): void;
  scoring?: string;
  showCode?: boolean;
  compact?: boolean;
}) {
  const word = scoring === 'points' ? 'PTS' : scoring === 'rounds' ? 'RDS' : 'GD';
  if (!rows.length) return <div className="empty-inline">No matches recorded yet — results appear here as soon as they are entered.</div>;
  return (
    <div className="cx-board">
      <div className="cx-row cx-head">
        <span>#</span>
        <span>Player</span>
        <span className="hide-sm">Form</span>
        <span className="hide-sm">W-D-L</span>
        <span className="hide-sm">{word}</span>
        <span className="hide-xs">Win %</span>
        <span className="right">Rating</span>
      </div>
      {rows.map((r) => (
        <button
          type="button"
          key={r.customerId}
          className={`cx-row ${r.rank <= 3 && !r.provisional ? `top${r.rank}` : ''} ${highlightId === r.customerId ? 'me' : ''} ${r.provisional ? 'prov' : ''}`}
          onClick={() => onPick?.(r)}
        >
          <span className="cx-rank">{r.provisional ? '–' : r.rank}</span>
          <span className="cx-player">
            <Avatar name={r.name} src={r?.avatarUrl} size={compact ? 30 : 36} />
            <span style={{ minWidth: 0 }}>
              <span className="cx-name">
                {r.name}
                {r.titles > 0 && (
                  <span className="cx-titles" title={`${r.titles} tournament title${r.titles > 1 ? 's' : ''}`}>
                    <Trophy size={12} />
                    {r.titles > 1 ? r.titles : ''}
                  </span>
                )}
                {r.streak?.type === 'W' && r.streak.count >= 3 && (
                  <span className="cx-fire" title={`${r.streak.count} wins in a row`}>
                    <Flame size={12} />
                    {r.streak.count}
                  </span>
                )}
              </span>
              <span className="cx-sub">
                <TierBadge tier={r.tier} small />
                {r.provisional ? <span className="dim">placement · {r.played}/3</span> : <span className="dim">{r.played} played</span>}
                {showCode && r.player?.code && <span className="dim mono">{r.player.code}</span>}
              </span>
            </span>
          </span>
          <span className="hide-sm">
            <FormDots form={r.form} />
          </span>
          <span className="hide-sm num">
            {r.won}-{r.drawn}-{r.lost}
          </span>
          <span className={`hide-sm num ${r.gd > 0 ? 'pos' : r.gd < 0 ? 'neg' : ''}`}>{r.gd > 0 ? `+${r.gd}` : r.gd}</span>
          <span className="hide-xs">
            <span className="cx-bar">
              <span style={{ width: `${r.winRate}%` }} />
            </span>
            <span className="num cx-pct">{r.winRate}%</span>
          </span>
          <span className="right cx-rating">
            <strong className="num">{r.rating}</strong>
            <Delta value={r.ratingChange} />
          </span>
        </button>
      ))}
    </div>
  );
}

export function Highlights({ h, totals }: { h: Board['highlights']; totals: Board['totals'] }) {
  const cards: { icon: ReactNode; label: string; value: ReactNode; sub: ReactNode; tone: string }[] = [
    { icon: <Swords size={16} />, label: 'Matches', value: totals.matches, sub: `${totals.goals} goals · ${totals.players} players`, tone: 'violet' },
    h.biggestWin
      ? { icon: <Zap size={16} />, label: 'Biggest win', value: h.biggestWin.score, sub: `${h.biggestWin.winner?.name} vs ${h.biggestWin.loser?.name}`, tone: 'pink' }
      : null,
    h.topScorer ? { icon: <Target size={16} />, label: 'Top scorer', value: h.topScorer.value, sub: h.topScorer.name, tone: 'amber' } : null,
    h.onFire
      ? { icon: <Flame size={16} />, label: 'On fire', value: `${h.onFire.value} W`, sub: `${h.onFire.name} — wins in a row`, tone: 'red' }
      : h.longestStreak
        ? { icon: <Medal size={16} />, label: 'Best streak', value: `${h.longestStreak.value} W`, sub: h.longestStreak.name, tone: 'red' }
        : null,
  ].filter(Boolean) as any[];
  return (
    <div className="cx-highlights">
      {cards.map((c) => (
        <div key={c.label} className={`cx-hl ${c.tone}`}>
          <span className="cx-hl-label">
            {c.icon} {c.label}
          </span>
          <span className="cx-hl-value">{c.value}</span>
          <span className="cx-hl-sub">{c.sub}</span>
        </div>
      ))}
    </div>
  );
}

/** Rating hero for the signed-in player. */
export function MyRankCard({ me, game }: { me: BoardRow | null; game: string }) {
  if (!me) {
    return (
      <div className="cx-mycard">
        <div>
          <div className="cx-hl-label">Your {game} rank</div>
          <div className="cx-mycard-big">Unranked</div>
          <div className="dim">Play 3 recorded matches to get your rank. Use Find match to get a game.</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`cx-mycard ${TIER_STYLE[me.tier] ?? ''}`}>
      <Avatar name={me.name} src={me?.avatarUrl} size={58} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="cx-hl-label">Your {game} rank</div>
        <div className="cx-mycard-big">
          {me.provisional ? 'Placement' : `#${me.rank}`} <TierBadge tier={me.tier} />
        </div>
        <div className="cx-mycard-stats">
          <span>
            <strong>{me.rating}</strong> rating <Delta value={me.ratingChange} />
          </span>
          <span>
            <strong>{me.won}</strong>W <strong>{me.drawn}</strong>D <strong>{me.lost}</strong>L
          </span>
          <span>
            <strong>{me.winRate}%</strong> wins
          </span>
        </div>
      </div>
      <FormDots form={me.form} />
    </div>
  );
}

// ───────────────────────── Matches, groups, bracket ─────────────────────────

export interface MatchV {
  id: string;
  number: number;
  stage: string;
  round: number | null;
  groupName: string | null;
  status: string;
  home: { id: string; name: string } | null;
  away: { id: string; name: string } | null;
  homeScore: number | null;
  awayScore: number | null;
  homePens: number | null;
  awayPens: number | null;
  winnerId: string | null;
  walkover: boolean;
  playedAt: string | null;
  scheduledAt: string | null;
  note: string | null;
}

export function ScoreLine({ m, onClick, highlightId }: { m: MatchV; onClick?(): void; highlightId?: string | null }) {
  const done = m.status === 'completed';
  const side = (p: MatchV['home'], score: number | null, pens: number | null) => (
    <span className={`cx-side ${done && m.winnerId && p?.id === m.winnerId ? 'win' : ''} ${p?.id && p.id === highlightId ? 'me' : ''}`}>
      <span className="cx-side-name">{p?.name ?? 'TBD'}</span>
      <span className="cx-side-score num">
        {m.walkover ? (p?.id === m.winnerId ? 'W/O' : '') : done || m.status === 'pending_confirmation' ? score : ''}
        {pens != null && <small> ({pens})</small>}
      </span>
    </span>
  );
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`cx-match ${done ? 'done' : ''} ${onClick ? 'click' : ''}`} onClick={onClick}>
      {side(m.home, m.homeScore, m.homePens)}
      {side(m.away, m.awayScore, m.awayPens)}
      {m.status === 'pending_confirmation' && <span className="cx-match-tag">awaiting confirmation</span>}
    </Tag>
  );
}

export function ResultFeed({ items, highlightId, empty = 'No results yet' }: { items: MatchV[]; highlightId?: string | null; empty?: string }) {
  if (!items.length) return <div className="empty-inline">{empty}</div>;
  return (
    <div className="cx-feed">
      {items.map((m) => {
        const hw = m.homeScore! > m.awayScore!;
        const aw = m.awayScore! > m.homeScore!;
        return (
          <div key={m.id} className={`cx-feed-item ${highlightId && (m.home?.id === highlightId || m.away?.id === highlightId) ? 'me' : ''}`}>
            <span className={`cx-feed-name ${hw ? 'win' : ''}`}>{m.home?.name}</span>
            <span className="cx-feed-score num">
              {m.homeScore} – {m.awayScore}
            </span>
            <span className={`cx-feed-name right ${aw ? 'win' : ''}`}>{m.away?.name}</span>
            <span className="cx-feed-when dim">
              {m.stage !== 'friendly' ? `${m.stage === 'third_place' ? '3rd place' : m.stage === 'knockout' ? 'Knockout' : m.groupName ? `Group ${m.groupName}` : 'League'} · ` : ''}
              {m.playedAt ? new Date(m.playedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function GroupTables({ groups, highlightId }: { groups: any[]; highlightId?: string | null }) {
  return (
    <div className="cx-groups">
      {groups.map((g) => (
        <div key={g.key} className="card">
          <div className="card-head">
            <h2>{g.name}</h2>
          </div>
          <div className="table-wrap">
            <table className="cx-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th className="right">P</th>
                  <th className="right">W</th>
                  <th className="right">D</th>
                  <th className="right">L</th>
                  <th className="right">GD</th>
                  <th className="right">Pts</th>
                  <th className="hide-sm">Form</th>
                </tr>
              </thead>
              <tbody>
                {g.table.map((r: any) => (
                  <tr key={r.customerId} className={`${r.qualifies ? 'q' : ''} ${r.customerId === highlightId ? 'me' : ''}`}>
                    <td className="num">{r.position}</td>
                    <td style={{ fontWeight: 600 }}>
                      <span className="cx-player-inline">
                        <Avatar name={r.player?.name ?? '?'} src={r.player?.avatarUrl} size={24} /> {r.player?.name}
                      </span>
                    </td>
                    <td className="right num">{r.played}</td>
                    <td className="right num">{r.won}</td>
                    <td className="right num">{r.drawn}</td>
                    <td className="right num">{r.lost}</td>
                    <td className="right num">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                    <td className="right num">
                      <strong>{r.points}</strong>
                    </td>
                    <td className="hide-sm">
                      <FormDots form={r.form} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Bracket({ bracket, onMatch, highlightId }: { bracket: { rounds: { round: number; name: string; matches: MatchV[] }[]; thirdPlace: MatchV | null }; onMatch?(m: MatchV): void; highlightId?: string | null }) {
  if (!bracket.rounds.length) return null;
  return (
    <div className="cx-bracket-wrap">
      <div className="cx-bracket">
        {bracket.rounds.map((r) => (
          <div key={r.round} className="cx-round">
            <div className="cx-round-name">{r.name}</div>
            <div className="cx-round-matches">
              {r.matches.map((m) => (
                <div key={m.id} className="cx-slot">
                  <ScoreLine m={m} highlightId={highlightId} onClick={onMatch && m.home && m.away && !(m.walkover && m.note === 'Bye') ? () => onMatch(m) : undefined} />
                </div>
              ))}
            </div>
          </div>
        ))}
        {bracket.thirdPlace && (
          <div className="cx-round">
            <div className="cx-round-name">3rd place</div>
            <div className="cx-round-matches">
              <div className="cx-slot">
                <ScoreLine m={bracket.thirdPlace} highlightId={highlightId} onClick={onMatch && bracket.thirdPlace.home && bracket.thirdPlace.away ? () => onMatch(bracket.thirdPlace!) : undefined} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const FORMAT_LABEL: Record<string, string> = { knockout: 'Knockout', league: 'League', groups_knockout: 'Groups + knockout' };
export const T_STATUS: Record<string, [string, string]> = {
  draft: ['Draft', ''],
  registration: ['Registration open', 'badge-info'],
  live: ['Live', 'badge-danger'],
  completed: ['Finished', 'badge-success'],
  cancelled: ['Cancelled', ''],
};
export function TStatus({ s }: { s: string }) {
  const [l, c] = T_STATUS[s] ?? [s, ''];
  return (
    <span className={`badge ${c}`}>
      {s === 'live' && <span className="cx-live-dot" />}
      {l}
    </span>
  );
}

export function placeLabel(n: number | null | undefined) {
  if (!n) return '';
  return n === 1 ? '🥇 Champion' : n === 2 ? '🥈 Runner-up' : n === 3 ? '🥉 3rd' : `${n}th`;
}
