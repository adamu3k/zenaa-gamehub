import type { Actor } from '../context.js';
import type { DbOrTx } from '../db/index.js';
import { auditLogs } from '../db/schema.js';

export async function audit(
  db: DbOrTx,
  actor: Actor,
  action: string,
  entity?: { type: string; id: string },
  details?: Record<string, unknown>,
) {
  await db.insert(auditLogs).values({
    staffId: actor.staffId,
    action,
    entityType: entity?.type,
    entityId: entity?.id,
    details: actor.approvedBy && actor.approvedBy !== actor.staffId ? { ...(details ?? {}), approvedBy: actor.approvedBy } : details,
    ip: actor.ip,
  });
}
