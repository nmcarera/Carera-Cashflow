/**
 * Create/rename/archive for categories, priorities, and household members.
 *
 * Assumption (documented per build brief's "simplest reversible
 * implementation" guidance): nothing here ever hard-deletes a row that a
 * transaction, rule, or savings goal might reference. "Delete" in the
 * settings UI always means archive — archived rows are hidden from pickers
 * but keep every past transaction's classification intact and can be
 * unarchived. This avoids a whole class of foreign-key and "why did my old
 * transactions lose their category" problems for a household-scale dataset
 * where a handful of archived-but-not-deleted rows costs nothing.
 */
import { randomUUID } from "node:crypto";
import { eq, ne, and } from "drizzle-orm";
import { db } from "../db/client";
import { categories, priorities, householdMembers } from "../db/schema";
import { writeAuditEntry } from "../audit/log";
import { CareraError } from "../logging/errors";

function assertName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new CareraError({ code: "SETTINGS_002_NAME_REQUIRED", category: "database" });
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export function createCategory(input: { name: string; color: string }) {
  const name = assertName(input.name);
  const existing = db.select().from(categories).where(eq(categories.name, name)).all()[0];
  if (existing) {
    throw new CareraError({ code: "SETTINGS_001_NAME_TAKEN", category: "database", context: { entityId: existing.id } });
  }
  const id = randomUUID();
  db.insert(categories).values({ id, name, color: input.color, archived: false, isSystem: false }).run();
  writeAuditEntry({ entityType: "category", entityId: id, field: "created", oldValue: null, newValue: name, changeSource: "manual" });
  return db.select().from(categories).where(eq(categories.id, id)).all()[0];
}

export function updateCategory(id: string, input: { name?: string; color?: string }) {
  const current = db.select().from(categories).where(eq(categories.id, id)).all()[0];
  if (!current) throw new CareraError({ code: "DB_002_CONSTRAINT_VIOLATION", category: "database", detail: "Category not found." });

  const next = { name: current.name, color: current.color };
  if (input.name !== undefined) {
    const name = assertName(input.name);
    const clash = db
      .select()
      .from(categories)
      .where(and(eq(categories.name, name), ne(categories.id, id)))
      .all()[0];
    if (clash) throw new CareraError({ code: "SETTINGS_001_NAME_TAKEN", category: "database" });
    next.name = name;
  }
  if (input.color !== undefined) next.color = input.color;

  db.update(categories).set(next).where(eq(categories.id, id)).run();
  if (input.name !== undefined && input.name !== current.name) {
    writeAuditEntry({ entityType: "category", entityId: id, field: "name", oldValue: current.name, newValue: next.name, changeSource: "manual" });
  }
  return db.select().from(categories).where(eq(categories.id, id)).all()[0];
}

export function setCategoryArchived(id: string, archived: boolean) {
  const current = db.select().from(categories).where(eq(categories.id, id)).all()[0];
  if (!current) throw new CareraError({ code: "DB_002_CONSTRAINT_VIOLATION", category: "database", detail: "Category not found." });
  db.update(categories).set({ archived }).where(eq(categories.id, id)).run();
  writeAuditEntry({
    entityType: "category",
    entityId: id,
    field: "archived",
    oldValue: String(current.archived),
    newValue: String(archived),
    changeSource: "manual",
  });
}

// ---------------------------------------------------------------------------
// Priorities
// ---------------------------------------------------------------------------

export function createPriority(input: { name: string; sortOrder?: number }) {
  const name = assertName(input.name);
  const existing = db.select().from(priorities).where(eq(priorities.name, name)).all()[0];
  if (existing) throw new CareraError({ code: "SETTINGS_001_NAME_TAKEN", category: "database" });
  const id = randomUUID();
  db.insert(priorities)
    .values({ id, name, archived: false, isSystem: false, sortOrder: input.sortOrder ?? 100 })
    .run();
  writeAuditEntry({ entityType: "priority", entityId: id, field: "created", oldValue: null, newValue: name, changeSource: "manual" });
  return db.select().from(priorities).where(eq(priorities.id, id)).all()[0];
}

export function updatePriority(id: string, input: { name?: string; sortOrder?: number }) {
  const current = db.select().from(priorities).where(eq(priorities.id, id)).all()[0];
  if (!current) throw new CareraError({ code: "DB_002_CONSTRAINT_VIOLATION", category: "database", detail: "Priority not found." });

  const next: { name: string; sortOrder: number } = { name: current.name, sortOrder: current.sortOrder };
  if (input.name !== undefined) {
    const name = assertName(input.name);
    const clash = db
      .select()
      .from(priorities)
      .where(and(eq(priorities.name, name), ne(priorities.id, id)))
      .all()[0];
    if (clash) throw new CareraError({ code: "SETTINGS_001_NAME_TAKEN", category: "database" });
    next.name = name;
  }
  if (input.sortOrder !== undefined) next.sortOrder = input.sortOrder;

  db.update(priorities).set(next).where(eq(priorities.id, id)).run();
  if (input.name !== undefined && input.name !== current.name) {
    writeAuditEntry({ entityType: "priority", entityId: id, field: "name", oldValue: current.name, newValue: next.name, changeSource: "manual" });
  }
  return db.select().from(priorities).where(eq(priorities.id, id)).all()[0];
}

export function setPriorityArchived(id: string, archived: boolean) {
  const current = db.select().from(priorities).where(eq(priorities.id, id)).all()[0];
  if (!current) throw new CareraError({ code: "DB_002_CONSTRAINT_VIOLATION", category: "database", detail: "Priority not found." });
  db.update(priorities).set({ archived }).where(eq(priorities.id, id)).run();
  writeAuditEntry({
    entityType: "priority",
    entityId: id,
    field: "archived",
    oldValue: String(current.archived),
    newValue: String(archived),
    changeSource: "manual",
  });
}

// ---------------------------------------------------------------------------
// Household members
// ---------------------------------------------------------------------------

export function createHouseholdMember(input: { name: string; initials: string; color: string }) {
  const name = assertName(input.name);
  const id = randomUUID();
  db.insert(householdMembers)
    .values({ id, name, initials: input.initials.trim().toUpperCase().slice(0, 3), color: input.color, archived: false })
    .run();
  writeAuditEntry({ entityType: "household_member", entityId: id, field: "created", oldValue: null, newValue: name, changeSource: "manual" });
  return db.select().from(householdMembers).where(eq(householdMembers.id, id)).all()[0];
}

export function updateHouseholdMember(id: string, input: { name?: string; initials?: string; color?: string }) {
  const current = db.select().from(householdMembers).where(eq(householdMembers.id, id)).all()[0];
  if (!current) throw new CareraError({ code: "DB_002_CONSTRAINT_VIOLATION", category: "database", detail: "Household member not found." });

  const next = { name: current.name, initials: current.initials, color: current.color };
  if (input.name !== undefined) next.name = assertName(input.name);
  if (input.initials !== undefined) next.initials = input.initials.trim().toUpperCase().slice(0, 3);
  if (input.color !== undefined) next.color = input.color;

  db.update(householdMembers).set(next).where(eq(householdMembers.id, id)).run();
  if (input.name !== undefined && input.name !== current.name) {
    writeAuditEntry({ entityType: "household_member", entityId: id, field: "name", oldValue: current.name, newValue: next.name, changeSource: "manual" });
  }
  return db.select().from(householdMembers).where(eq(householdMembers.id, id)).all()[0];
}

export function setHouseholdMemberArchived(id: string, archived: boolean) {
  const current = db.select().from(householdMembers).where(eq(householdMembers.id, id)).all()[0];
  if (!current) throw new CareraError({ code: "DB_002_CONSTRAINT_VIOLATION", category: "database", detail: "Household member not found." });
  db.update(householdMembers).set({ archived }).where(eq(householdMembers.id, id)).run();
  writeAuditEntry({
    entityType: "household_member",
    entityId: id,
    field: "archived",
    oldValue: String(current.archived),
    newValue: String(archived),
    changeSource: "manual",
  });
}
