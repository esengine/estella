// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    fileJournal.ts
 * @brief   Before-images of the project files a transaction is about to change,
 *          so writing one can be taken back the way editing a scene already can.
 *
 * The editor's undo stack covers the DOCUMENT and stops at the disk, which is
 * why the tool catalog had to call every file write `irreversible` and ask the
 * user before each one. But a write is only irreversible when nobody kept the
 * bytes it overwrote. This keeps them: a transaction is opened around an agent
 * turn, every project path a write is about to touch is captured first, and one
 * revert puts the whole set back.
 *
 * Three rules make the capture trustworthy:
 *
 *   - FIRST capture of a path wins. A turn that writes the same file four times
 *     must revert to what was there before the first write, not the third.
 *   - Order is kept and unwound LIFO, so a rename followed by a write to the new
 *     name comes apart in the order that leaves each step's precondition intact.
 *   - A path too big to hold is recorded as UNJOURNALED rather than skipped
 *     silently. A revert that quietly leaves a 400MB import in place, while the
 *     UI says the turn was taken back, is worse than one that says what it could
 *     not restore.
 *
 * Copies live in the OS temp dir, next to the trash-undo holding area and for
 * the same reason: a project must not grow an undo directory, and a machine that
 * loses power owes nobody these bytes.
 */
import { mkdir, cp, rm, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { META_EXT } from './contentPolicy';
import { resolveInside } from './pathSandbox';

const HOLDING_DIR = path.join(tmpdir(), 'estella-agent-journal');

/**
 * How much of a project one transaction may hold onto. Sized for authoring —
 * scripts, scenes, prefabs, a sprite or two. An import that drags in a video
 * does not fit, which is the case the partial report exists for: holding
 * gigabytes for one import spends a disk nobody agreed to.
 */
let budgetBytes = 256 * 1024 * 1024;

/** How many finished transactions stay restorable. Older ones are dropped from
 *  the disk as soon as a newer turn pushes them past this. */
const RETAINED = 8;

/** What happened to one path, in the terms the transcript reports it. */
export type ChangeKind = 'add' | 'modify' | 'remove';

/** One captured path: what it was before, and what the write did to it. */
interface Entry {
  /** Project-relative, with `/` separators — the identity the UI shows. */
  rel: string;
  kind: ChangeKind;
  /** Directory inside the transaction's holding dir, or null when the path did
   *  not exist (revert deletes) or could not be held (revert cannot). */
  backup: string | null;
  /** True when the path existed but the budget refused to hold it. */
  unjournaled: boolean;
  /** Whether the captured path was a directory (revert restores it whole). */
  isDir: boolean;
}

interface Transaction {
  id: string;
  root: string;
  /** Insertion-ordered; `capture` is a no-op once a path is in here. */
  entries: Map<string, Entry>;
  bytes: number;
  open: boolean;
}

/** A transaction's changes as the editor renders them. */
export interface JournalChange {
  path: string;
  kind: ChangeKind;
  /** True when a revert cannot put this path back (see {@link BUDGET_BYTES}). */
  unjournaled: boolean;
}

/** What a revert managed. `restored` + `unjournaled` is every path it tried. */
export interface RevertResult {
  /** Project-relative paths whose prior state is back on disk. */
  restored: string[];
  /** Paths left as the transaction made them, because nothing was held. */
  unjournaled: string[];
  /** Paths whose restore threw, with the reason — a disk that filled, a file
   *  the user opened in another program and locked. Never swallowed. */
  failed: Array<{ path: string; error: string }>;
}

const transactions = new Map<string, Transaction>();
/** Finished ids, oldest first — the retention ring (see {@link RETAINED}). */
const finished: string[] = [];
let active: Transaction | null = null;

/**
 * Open a transaction and make it the one every write door captures into.
 *
 * One at a time by design. Doors capture AMBIENTLY rather than being handed an
 * id, which is what catches a write the agent caused indirectly; concurrent
 * transactions would make "which owns this write" unanswerable at the door.
 */
export function beginTransaction(root: string): string {
  if (active) endTransaction();
  const id = randomUUID();
  active = { id, root, entries: new Map(), bytes: 0, open: true };
  transactions.set(id, active);
  return id;
}

/** Close the open transaction; its captures stay restorable until retention
 *  drops them. Returns its id, or null when none was open. */
export function endTransaction(): string | null {
  if (!active) return null;
  const id = active.id;
  active.open = false;
  active = null;
  finished.push(id);
  while (finished.length > RETAINED) {
    const old = finished.shift()!;
    void discard(old);
  }
  return id;
}

/** The open transaction's id, or null. Doors use it only to decide whether to
 *  capture; the id itself belongs to whoever opened it. */
export function activeTransaction(): string | null {
  return active?.id ?? null;
}

/** What a door is about to do. The journal turns it into a {@link ChangeKind}:
 *  a write to a path that does not exist is an add, to one that does a modify. */
export type Intent = 'write' | 'remove';

/**
 * Hold what `relPath` is right now, before the caller changes it. A no-op with
 * no transaction open, which is why every door can call it unconditionally.
 *
 * The door says what it INTENDS; add-vs-modify is answered here, by the side
 * that has just looked at the path.
 */
export async function capture(relPath: string, intent: Intent): Promise<void> {
  const tx = active;
  if (!tx) return;
  const rel = relPath.split(path.sep).join('/');
  if (tx.entries.has(rel)) return;

  let abs: string;
  try {
    abs = resolveInside(tx.root, rel, 'project root');
  } catch {
    // A path the sandbox refuses is not this module's to report on — the door
    // itself is about to throw for the same reason.
    return;
  }

  if (!existsSync(abs)) {
    // A tombstone, not a copy: revert deletes what the transaction created.
    // A `remove` of something that is not there changed nothing worth recording.
    if (intent === 'write') {
      tx.entries.set(rel, { rel, kind: 'add', backup: null, unjournaled: false, isDir: false });
    }
    return;
  }

  const kind: ChangeKind = intent === 'remove' ? 'remove' : 'modify';
  const info = await stat(abs);
  const size = info.isDirectory() ? await dirSize(abs) : info.size;
  const meta = abs + META_EXT;
  const metaSize = existsSync(meta) ? (await stat(meta)).size : 0;

  if (tx.bytes + size + metaSize > budgetBytes) {
    tx.entries.set(rel, { rel, kind, backup: null, unjournaled: true, isDir: info.isDirectory() });
    return;
  }

  const backup = path.join(HOLDING_DIR, tx.id, String(tx.entries.size));
  await mkdir(backup, { recursive: true });
  await cp(abs, path.join(backup, 'item'), { recursive: true });
  // The sidecar travels with the file, so a revert restores the asset's uuid
  // along with its bytes — every `@uuid:` reference to it survives the round trip.
  if (metaSize) await cp(meta, path.join(backup, 'item' + META_EXT));
  tx.bytes += size + metaSize;
  tx.entries.set(rel, { rel, kind, backup, unjournaled: false, isDir: info.isDirectory() });
}

/** Capture several paths in the order given (a door that writes a set). */
export async function captureAll(relPaths: readonly string[], intent: Intent): Promise<void> {
  for (const rel of relPaths) await capture(rel, intent);
}

async function dirSize(abs: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(abs, { withFileTypes: true })) {
    const child = path.join(abs, entry.name);
    if (entry.isDirectory()) total += await dirSize(child);
    else if (entry.isFile()) total += (await stat(child)).size;
    // A budget that walked symlinks could be talked into counting the whole
    // disk by a project that contains one pointing at `/`.
  }
  return total;
}

/** What a transaction has touched so far, in the order it touched it. */
export function changes(id: string): JournalChange[] {
  const tx = transactions.get(id);
  if (!tx) return [];
  return [...tx.entries.values()].map((e) => ({
    path: e.rel,
    kind: e.kind,
    unjournaled: e.unjournaled,
  }));
}

/** Whether `id` still holds enough to be worth offering a revert for. */
export function isRestorable(id: string): boolean {
  const tx = transactions.get(id);
  return !!tx && tx.entries.size > 0;
}

/**
 * Put every captured path back, newest capture first, and say what happened.
 * LIFO because captures depend on each other: `Scripts/` then `Scripts/HP.ts`
 * comes apart file-first. One failure does not stop the rest — a half-abandoned
 * revert leaves a project nobody asked for, and this is what finishes it.
 */
export async function revert(id: string): Promise<RevertResult> {
  const tx = transactions.get(id);
  const out: RevertResult = { restored: [], unjournaled: [], failed: [] };
  if (!tx) return out;
  if (tx === active) endTransaction();

  for (const entry of [...tx.entries.values()].reverse()) {
    if (entry.unjournaled) {
      out.unjournaled.push(entry.rel);
      continue;
    }
    try {
      await restore(tx.root, entry);
      out.restored.push(entry.rel);
    } catch (e) {
      out.failed.push({ path: entry.rel, error: (e as Error)?.message ?? String(e) });
    }
  }
  // Reverting consumes the transaction: the copies have served their purpose,
  // and a second revert of the same id would restore stale bytes over whatever
  // the user has done since.
  await discard(id);
  return out;
}

async function restore(root: string, entry: Entry): Promise<void> {
  const abs = resolveInside(root, entry.rel, 'project root');
  const meta = abs + META_EXT;
  if (entry.backup === null) {
    // The transaction created it; taking the transaction back removes it.
    await rm(abs, { recursive: true, force: true });
    await rm(meta, { force: true });
    return;
  }
  const item = path.join(entry.backup, 'item');
  const itemMeta = item + META_EXT;
  await rm(abs, { recursive: true, force: true });
  await mkdir(path.dirname(abs), { recursive: true });
  await cp(item, abs, { recursive: true });
  if (existsSync(itemMeta)) await cp(itemMeta, meta);
  else await rm(meta, { force: true });
}

/** Forget a transaction and delete its copies — the user kept the work. */
export async function discard(id: string): Promise<void> {
  const tx = transactions.get(id);
  if (!tx) return;
  if (tx === active) endTransaction();
  transactions.delete(id);
  const i = finished.indexOf(id);
  if (i >= 0) finished.splice(i, 1);
  await rm(path.join(HOLDING_DIR, id), { recursive: true, force: true }).catch(() => {});
}

/** Drop everything — a project switch, or shutdown. */
export async function discardAll(): Promise<void> {
  active = null;
  const ids = [...transactions.keys()];
  transactions.clear();
  finished.length = 0;
  for (const id of ids) {
    await rm(path.join(HOLDING_DIR, id), { recursive: true, force: true }).catch(() => {});
  }
}

/** Project-relative paths a revert of `id` would touch — what the editor
 *  refreshes afterwards. */
export function touchedPaths(id: string): string[] {
  return [...(transactions.get(id)?.entries.values() ?? [])].map((e) => e.rel);
}

export const __testing = {
  HOLDING_DIR,
  RETAINED,
  /** Shrink the budget so a test can reach it without writing 256MB. */
  setBudget(bytes: number): number {
    const was = budgetBytes;
    budgetBytes = bytes;
    return was;
  },
};
