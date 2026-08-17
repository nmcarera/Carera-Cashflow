/**
 * Writes to `audit_log` — the append-only record of every change to a
 * classified/edited field (build brief §11, "auditability"). Every mutation
 * in src/lib/settings, src/lib/categorization, and src/lib/transactions goes
 * through this so the review queue, rule engine, and manual-edit paths never
 * silently diverge in what they record.
 *
 * This module never runs inside its own `db.transaction()` — callers that
 * need atomicity (e.g. "update the transaction AND log it") wrap both calls
 * in one transaction themselves, since better-sqlite3 transactions must be a
 * single synchronous callback.
 */
import { randomUUID } from "node:crypto";
import { db, type DB } from "../db/client";
import { auditLog } from "../db/schema";
import type { ChangeSource } from "../domain/enums";

/** The type of the `tx` parameter `db.transaction(tx => ...)` passes to its
 *  callback — derived from `DB` itself so it can never drift out of sync
 *  with the real driver type. Accepting this alongside `DB` is what lets
 *  callers pass either the top-level `db` or an in-flight transaction
 *  handle to `writeAuditEntry`. */
type TxHandle = Parameters<Parameters<DB["transaction"]>[0]>[0];

export interface AuditEntry {
  entityType: string;
  entityId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changeSource: ChangeSource;
  ruleId?: string | null;
  note?: string | null;
}

/** `handle` lets a caller pass a transaction handle (`tx` inside
 *  `db.transaction(tx => ...)`) so the audit row commits atomically with the
 *  change it describes; omit it to write standalone. */
export function writeAuditEntry(entry: AuditEntry, handle: DB | TxHandle = db): void {
  handle
    .insert(auditLog)
    .values({
      id: randomUUID(),
      entityType: entry.entityType,
      entityId: entry.entityId,
      field: entry.field,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      changeSource: entry.changeSource,
      ruleId: entry.ruleId ?? null,
      note: entry.note ?? null,
    })
    .run();
}

export function writeAuditEntries(entries: AuditEntry[], handle: DB | TxHandle = db): void {
  for (const entry of entries) writeAuditEntry(entry, handle);
}
