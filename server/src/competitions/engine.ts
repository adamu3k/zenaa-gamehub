/**
 * Pure competition maths — no database. Ratings, leaderboards, standings, fixtures and brackets.
 *
 * Rating: Elo (start 1000, K = 32) with the World Football Elo goal-difference multiplier, so a 5–0 counts
 * for more than a 1–0. Walkovers (byes, forfeits) never change ratings or stats.
 */

export interface PlayedMatch {
  id: string;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
  /** Penalties decide a knockout winner but the match still counts as a draw for stats and rating. */
  winnerId: string | null;
  playedAt: Date;
  tournamentId?: string | null;
}

export type Outcome = 'W' | 'D' | 'L';

export const START_RATING = 1000;
const K = 32;
/** Players with fewer matches than this are "provisional" and listed after ranked players. */
export const MIN_RANKED_MATCHES = 3;

export const TIERS = [
  { name: 'Legend', min: 1500 },
  { name: 'Diamond', min: 1350 },
  { name: 'Platinum', min: 1200 },
  { name: 'Gold', min: 1050 },
  { name: 'Silver', min: 900 },
  { name: 'Bronze', min: -Infinity },
] as const;
export const tierFor = (rating: number) => TIERS.find((t) => rating >= t.min)!.name;

const gdMultiplier = (gd: number) => (gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8);

/** Rating change for the home player (the away player gets the negative). */
export function eloDelta(homeRating: number, awayRating: number, homeScore: number, awayScore: number) {
  const expected = 1 / (1 + 10 ** ((awayRating - homeRating) / 400));
  const actual = homeScore > awayScore ? 1 : homeScore === awayScore ? 0.5 : 0;
  return Math.round(K * gdMultiplier(Math.abs(homeScore - awayScore)) * (actual - expected));
}

export interface PlayerStats {
  customerId: string;
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
  peakRating: number;
  tier: string;
  /** Most recent last: e.g. ['W','W','D','L','W']. */
  form: Outcome[];
  streak: { type: Outcome; count: number } | null;
  longestWinStreak: number;
  cleanSheets: number;
  provisional: boolean;
  lastPlayedAt: string | null;
  allTimePlayed: number;
}

interface Acc extends Omit<PlayerStats, 'winRate' | 'tier' | 'provisional' | 'ratingChange' | 'gd'> {
  ratingAtStart: number;
  results: Outcome[];
  curWin: number;
}

/**
 * Builds per-player stats. Ratings always use every match ever played; the other numbers only count
 * matches inside [from, to) when given (weekly / monthly boards).
 */
export function computeStats(
  all: PlayedMatch[],
  opts: { from?: Date | null; to?: Date | null; /** ratingChange is measured from here (default: from). */ changeSince?: Date | null } = {},
): Map<string, PlayerStats> {
  const pivot = opts.changeSince ?? opts.from ?? null;
  const ms = [...all].sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime() || a.id.localeCompare(b.id));
  const acc = new Map<string, Acc>();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) {
      a = {
        customerId: id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0, rating: START_RATING, ratingAtStart: START_RATING,
        peakRating: START_RATING, form: [], streak: null, longestWinStreak: 0, cleanSheets: 0, lastPlayedAt: null, allTimePlayed: 0, results: [], curWin: 0,
      };
      acc.set(id, a);
    }
    return a;
  };
  const inWindow = (d: Date) => (!opts.from || d >= opts.from) && (!opts.to || d < opts.to);
  for (const m of ms) {
    const h = get(m.homeId);
    const a = get(m.awayId);
    const d = eloDelta(h.rating, a.rating, m.homeScore, m.awayScore);
    h.rating += d;
    a.rating -= d;
    h.peakRating = Math.max(h.peakRating, h.rating);
    a.peakRating = Math.max(a.peakRating, a.rating);
    h.allTimePlayed++;
    a.allTimePlayed++;
    if (pivot && m.playedAt < pivot) {
      h.ratingAtStart = h.rating;
      a.ratingAtStart = a.rating;
    }
    if (!inWindow(m.playedAt)) continue;
    const side = (p: Acc, gf: number, ga: number) => {
      const r: Outcome = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
      p.played++;
      p.gf += gf;
      p.ga += ga;
      if (ga === 0) p.cleanSheets++;
      if (r === 'W') p.won++;
      else if (r === 'D') p.drawn++;
      else p.lost++;
      p.points += r === 'W' ? 3 : r === 'D' ? 1 : 0;
      p.results.push(r);
      p.curWin = r === 'W' ? p.curWin + 1 : 0;
      p.longestWinStreak = Math.max(p.longestWinStreak, p.curWin);
      p.lastPlayedAt = m.playedAt.toISOString();
    };
    side(h, m.homeScore, m.awayScore);
    side(a, m.awayScore, m.homeScore);
  }
  const out = new Map<string, PlayerStats>();
  for (const a of acc.values()) {
    if (a.played === 0 && (opts.from || opts.to)) continue;
    let streak: PlayerStats['streak'] = null;
    for (let i = a.results.length - 1; i >= 0; i--) {
      if (!streak) streak = { type: a.results[i], count: 1 };
      else if (a.results[i] === streak.type) streak.count++;
      else break;
    }
    const { results, curWin, ratingAtStart, ...rest } = a;
    out.set(a.customerId, {
      ...rest,
      gd: a.gf - a.ga,
      form: results.slice(-5),
      streak,
      winRate: a.played ? Math.round((a.won / a.played) * 1000) / 10 : 0,
      ratingChange: a.rating - ratingAtStart,
      tier: tierFor(a.rating),
      provisional: a.allTimePlayed < MIN_RANKED_MATCHES,
    });
  }
  return out;
}

export type SortKey = 'rating' | 'points' | 'wins' | 'goals' | 'winrate';

/** Orders players; provisional players (fewer than 3 matches) always come after ranked ones. */
export function rankPlayers(stats: PlayerStats[], sort: SortKey = 'rating') {
  const key: Record<SortKey, (p: PlayerStats) => number[]> = {
    rating: (p) => [p.rating, p.points, p.gd, p.gf],
    points: (p) => [p.points, p.gd, p.gf, p.rating],
    wins: (p) => [p.won, p.winRate, p.gd, p.rating],
    goals: (p) => [p.gf, p.gd, p.rating],
    winrate: (p) => [p.winRate, p.played, p.rating],
  };
  const cmp = (a: PlayerStats, b: PlayerStats) => {
    if (a.provisional !== b.provisional) return a.provisional ? 1 : -1;
    const ka = key[sort](a);
    const kb = key[sort](b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return a.customerId.localeCompare(b.customerId);
  };
  return [...stats].sort(cmp).map((p, i) => ({ ...p, rank: i + 1 }));
}

// ───────────────────────── League / group tables ─────────────────────────

export interface StandingRow {
  customerId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  form: Outcome[];
}

/** Group/league table: points, then goal difference, goals scored, head-to-head points, then seed order. */
export function standings(
  playerIds: string[],
  ms: Pick<PlayedMatch, 'homeId' | 'awayId' | 'homeScore' | 'awayScore'>[],
  pts = { win: 3, draw: 1 },
): StandingRow[] {
  const rows = new Map(playerIds.map((id) => [id, { customerId: id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0, form: [] as Outcome[] }]));
  for (const m of ms) {
    const h = rows.get(m.homeId);
    const a = rows.get(m.awayId);
    if (!h || !a) continue;
    const apply = (r: StandingRow, gf: number, ga: number) => {
      r.played++;
      r.gf += gf;
      r.ga += ga;
      r.gd = r.gf - r.ga;
      const o: Outcome = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
      if (o === 'W') (r.won++, (r.points += pts.win));
      else if (o === 'D') (r.drawn++, (r.points += pts.draw));
      else r.lost++;
      r.form = [...r.form, o].slice(-5);
    };
    apply(h, m.homeScore, m.awayScore);
    apply(a, m.awayScore, m.homeScore);
  }
  const h2h = (x: string, y: string) => {
    let px = 0;
    let py = 0;
    for (const m of ms) {
      if ((m.homeId === x && m.awayId === y) || (m.homeId === y && m.awayId === x)) {
        const xs = m.homeId === x ? m.homeScore : m.awayScore;
        const ys = m.homeId === x ? m.awayScore : m.homeScore;
        if (xs > ys) px += pts.win;
        else if (ys > xs) py += pts.win;
        else (px += pts.draw, (py += pts.draw));
      }
    }
    return py - px;
  };
  const order = new Map(playerIds.map((id, i) => [id, i]));
  return [...rows.values()].sort(
    (a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || h2h(a.customerId, b.customerId) || order.get(a.customerId)! - order.get(b.customerId)!,
  );
}

// ───────────────────────── Fixtures ─────────────────────────

/** Round-robin fixtures (circle method). Everyone plays everyone once, or twice with swapped sides. */
export function roundRobin(ids: string[], double = false): { round: number; homeId: string; awayId: string }[] {
  const list: (string | null)[] = [...ids];
  if (list.length % 2) list.push(null);
  const n = list.length;
  const out: { round: number; homeId: string; awayId: string }[] = [];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a && b) out.push(r % 2 === 0 ? { round: r + 1, homeId: a, awayId: b } : { round: r + 1, homeId: b, awayId: a });
    }
    list.splice(1, 0, list.pop()!); // rotate everyone except the first
  }
  if (double) {
    const first = out.length;
    for (let i = 0; i < first; i++) out.push({ round: out[i].round + n - 1, homeId: out[i].awayId, awayId: out[i].homeId });
  }
  return out;
}

/** Splits seeded players into groups in snake order (A B C D D C B A …) so groups are balanced. */
export function snakeGroups(seeded: string[], groupCount: number): Map<string, string[]> {
  const names = Array.from({ length: groupCount }, (_, i) => String.fromCharCode(65 + i));
  const groups = new Map(names.map((n) => [n, [] as string[]]));
  seeded.forEach((id, i) => {
    const row = Math.floor(i / groupCount);
    const col = i % groupCount;
    groups.get(names[row % 2 === 0 ? col : groupCount - 1 - col])!.push(id);
  });
  return groups;
}

export const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/** Standard bracket seeding order: 1 v 8, 4 v 5, 2 v 7, 3 v 6 … so top seeds meet as late as possible. */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/** First-round pairs for a knockout bracket; null = bye (the other player goes through). */
export function firstRound(seeded: string[]): [string | null, string | null][] {
  const size = nextPow2(seeded.length);
  const order = seedOrder(size);
  const at = (seed: number) => seeded[seed - 1] ?? null;
  const out: [string | null, string | null][] = [];
  for (let i = 0; i < size; i += 2) out.push([at(order[i]), at(order[i + 1])]);
  return out;
}

export function roundName(round: number, totalRounds: number) {
  const left = totalRounds - round;
  if (left === 0) return 'Final';
  if (left === 1) return 'Semi-finals';
  if (left === 2) return 'Quarter-finals';
  return `Round of ${2 ** (left + 1)}`;
}
