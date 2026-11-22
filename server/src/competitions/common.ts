import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../db/index.js';
import { customers, games } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { formatCustomerCode } from '../services/wallet.js';

export interface PlayerInfo {
  id: string;
  /** Public name: gamertag, else first name + last initial ("Kofi B."). */
  name: string;
  gamertag: string | null;
  fullName: string;
  code: string;
  hidden: boolean;
  psnId: string | null;
  eaId: string | null;
  avatarUrl: string | null;
}

/** Public URL of a customer's profile picture (null = show the initial). */
export function avatarUrl(id: string, at: Date | null | undefined) {
  return at ? `/api/avatars/${id}?v=${at.getTime()}` : null;
}

export function publicName(c: { fullName: string; gamertag: string | null }) {
  if (c.gamertag) return c.gamertag;
  const parts = c.fullName.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

export async function loadPlayers(db: DbOrTx, ids: (string | null | undefined)[]): Promise<Map<string, PlayerInfo>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map();
  const rows = await db
    .select({ id: customers.id, fullName: customers.fullName, gamertag: customers.gamertag, number: customers.number, hidden: customers.leaderboardHidden, psnId: customers.psnId, eaId: customers.eaId, avatarAt: customers.avatarAt })
    .from(customers)
    .where(inArray(customers.id, uniq));
  return new Map(
    rows.map((r) => [r.id, { id: r.id, name: publicName(r), gamertag: r.gamertag, fullName: r.fullName, code: formatCustomerCode(r.number), hidden: r.hidden, psnId: r.psnId, eaId: r.eaId, avatarUrl: avatarUrl(r.id, r.avatarAt) }]),
  );
}

/** Minimal player reference for API answers. Staff also see the real name and customer code. */
export function ref(p: PlayerInfo | undefined, staff: boolean) {
  if (!p) return null;
  if (staff) return { id: p.id, name: p.name, fullName: p.fullName, code: p.code, avatarUrl: p.avatarUrl };
  // Players who chose "hide me from the public leaderboard" are anonymous on public screens too.
  return { id: p.id, name: p.hidden ? 'Private player' : p.name, avatarUrl: p.hidden ? null : p.avatarUrl };
}

export async function getGame(db: DbOrTx, id?: string | null) {
  if (id) {
    const [g] = await db.select().from(games).where(eq(games.id, id));
    if (!g) throw notFound('Game');
    return g;
  }
  const [g] = await db.select().from(games).where(eq(games.active, true)).orderBy(asc(games.sortOrder), asc(games.name)).limit(1);
  if (!g) throw badRequest('Add a game first (Leaderboard → Games)');
  return g;
}

export async function activeGames(db: DbOrTx) {
  return db.select().from(games).where(and(eq(games.active, true))).orderBy(asc(games.sortOrder), asc(games.name));
}

/** Score words per game type, for labels. */
export const SCORE_WORD: Record<string, string> = { goals: 'Goals', points: 'Points', rounds: 'Rounds' };
