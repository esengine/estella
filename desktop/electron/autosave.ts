// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    autosave.ts
 * @brief   Crash-recovery snapshot store under `<root>/.esengine/autosave/`.
 *
 * The renderer periodically serializes every DIRTY editor document (through the
 * same model its real save uses) and hands the bytes here; we mirror each under
 * the autosave dir at the document's own project-relative path. These are
 * snapshots, NOT saves — the document stays dirty. After a crash + the app's
 * render-gone reload, {@link listAutosave} surfaces the snapshots that are newer
 * than their on-disk file so the open prompt can offer to restore them; a normal
 * save (which post-dates the snapshot) makes them non-recoverable.
 */
import { writeFile, mkdir, rm, stat, readdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { WORKSPACE_DIR } from '../src/project/format';
import { resolveInRoot } from './projectFs';

const AUTOSAVE_SUBDIR = 'autosave';

/** One dirty document's serialized snapshot: its real project-relative path plus
 *  the exact bytes a save would have written. */
export interface AutosaveEntry {
  rel: string;
  contents: string;
}

/** A snapshot whose content is unsaved (newer than, or without, its on-disk
 *  file) — a crash-recovery candidate. */
export interface RecoverableEntry {
  rel: string;
  snapshotMtimeMs: number;
  /** The on-disk file's mtime, or null when it no longer exists. */
  fileMtimeMs: number | null;
}

const autosaveRoot = (root: string): string => path.join(root, WORKSPACE_DIR, AUTOSAVE_SUBDIR);

/** Forward-slashed, leading-slash-stripped project-relative path. */
function normRel(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\/+/, '');
}

/** Absolute path of a real project-relative path's snapshot (sandboxed to root). */
function snapAbs(root: string, rel: string): string {
  return resolveInRoot(root, path.posix.join(WORKSPACE_DIR, AUTOSAVE_SUBDIR, normRel(rel)));
}

async function* walkFiles(absDir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return; // no autosave dir yet
  }
  for (const e of entries) {
    const p = path.join(absDir, e.name);
    if (e.isDirectory()) yield* walkFiles(p);
    else yield p;
  }
}

/**
 * Reconcile the autosave dir with the current dirty set: (re)write each entry's
 * snapshot and delete any leftover snapshot NOT in the set — so a document that
 * was saved (hence no longer dirty, hence absent) has its snapshot dropped on the
 * next sync.
 */
export async function syncAutosave(root: string, entries: AutosaveEntry[]): Promise<void> {
  const keep = new Set<string>();
  for (const e of entries) {
    const rel = normRel(e.rel);
    if (!rel) continue;
    keep.add(rel);
    const abs = snapAbs(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, e.contents, 'utf8');
  }
  const base = autosaveRoot(root);
  for await (const abs of walkFiles(base)) {
    const rel = path.relative(base, abs).split(path.sep).join('/');
    if (!keep.has(rel)) await rm(abs, { force: true });
  }
}

/**
 * The recoverable snapshots: those newer than their on-disk file, or whose file
 * is gone. A snapshot older-or-equal to its file was superseded by a real save —
 * not a recovery candidate.
 */
export async function listAutosave(root: string): Promise<RecoverableEntry[]> {
  const base = autosaveRoot(root);
  const out: RecoverableEntry[] = [];
  for await (const abs of walkFiles(base)) {
    const rel = path.relative(base, abs).split(path.sep).join('/');
    let snapshotMtimeMs: number;
    try {
      snapshotMtimeMs = (await stat(abs)).mtimeMs;
    } catch {
      continue;
    }
    let fileMtimeMs: number | null = null;
    try {
      fileMtimeMs = (await stat(resolveInRoot(root, rel))).mtimeMs;
    } catch {
      fileMtimeMs = null;
    }
    if (fileMtimeMs === null || snapshotMtimeMs > fileMtimeMs) {
      out.push({ rel, snapshotMtimeMs, fileMtimeMs });
    }
  }
  return out;
}

/** Copy the named snapshots over their real files (recover the unsaved edits),
 *  then clear the whole autosave dir — the recovery is consumed. */
export async function restoreAutosave(root: string, rels: string[]): Promise<void> {
  for (const raw of rels) {
    const rel = normRel(raw);
    if (!rel) continue;
    const from = snapAbs(root, rel);
    if (!existsSync(from)) continue;
    const to = resolveInRoot(root, rel);
    await mkdir(path.dirname(to), { recursive: true });
    await cp(from, to);
  }
  await clearAutosave(root);
}

/** Drop every snapshot (discard the recovery, or after everything is saved). */
export async function clearAutosave(root: string): Promise<void> {
  await rm(autosaveRoot(root), { recursive: true, force: true });
}
