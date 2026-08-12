// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Project filesystem access for the Electron main process.
 *
 * All renderer file I/O funnels through here and is sandboxed to the currently
 * open project root — paths that escape it, by `..`, by being absolute, or by
 * following a link out, are refused, so neither a compromised renderer nor a
 * project someone else authored can read or write arbitrary files.
 */
import { readFile, writeFile, readdir, mkdir, rename, cp, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  PROJECT_MANIFEST_FILE,
  WORKSPACE_DIR,
  WORKSPACE_FILE,
  parseManifest,
  type ProjectManifest,
  type OpenedProject,
  type WorkspaceState,
  type DirEntry,
} from '../src/project/format';
import { META_EXT, isContentDir, isContentFile } from './contentPolicy';
import { resolveInside } from './pathSandbox';
import { capture } from './fileJournal';

export { META_EXT };

/** Resolve a project-relative path, refusing anything that escapes `root` — the
 *  security boundary for every fs op below (see pathSandbox). */
export function resolveInRoot(root: string, relPath: string): string {
  return resolveInside(root, relPath, 'project root');
}

/**
 * Read a project file as text, without the byte-order mark.
 *
 * A BOM is an encoding hint, not content — but `JSON.parse` treats it as a
 * syntax error, and every Windows tool that touches a file can leave one:
 * Notepad, `Out-File`, a spreadsheet export, an editor with "UTF-8 with BOM"
 * selected. Reading a project someone had edited that way failed with
 * `Unexpected token '﻿'` and nothing that named the file, which reads as
 * "the editor cannot open my project".
 *
 * Stripped HERE — the one door every project read goes through, in both
 * processes (the renderer's `fs.read` is this over IPC) — rather than at each
 * JSON.parse, because the parses are many and the door is one.
 */
export async function readTextInRoot(abs: string): Promise<string> {
  const text = await readFile(abs, 'utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Require + parse a project's `project.esproject` manifest (no workspace load). */
export async function readManifest(root: string): Promise<ProjectManifest> {
  const manifestPath = path.join(root, PROJECT_MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new Error(`not an Estella project (missing ${PROJECT_MANIFEST_FILE}): ${root}`);
  }
  return parseManifest(JSON.parse(await readTextInRoot(manifestPath)));
}

/** Open a project: require + parse `project.esproject`, load workspace if present. */
export async function openProject(root: string): Promise<OpenedProject> {
  const manifest = await readManifest(root);

  let workspace: WorkspaceState = {};
  const wsPath = path.join(root, WORKSPACE_DIR, WORKSPACE_FILE);
  if (existsSync(wsPath)) {
    try {
      workspace = JSON.parse(await readTextInRoot(wsPath)) as WorkspaceState;
    } catch {
      // A corrupt workspace file is non-fatal — start clean.
    }
  }
  return { root, manifest, workspace };
}

/** `async` so a refused path REJECTS. Returning the promise directly let
 *  resolveInRoot throw synchronously out of a function typed `Promise`, which no
 *  `.catch()` sees — every sibling here rejects. */
export async function readInRoot(root: string, relPath: string): Promise<string> {
  return readTextInRoot(resolveInRoot(root, relPath));
}

/**
 * A WINDOW of a file's lines — `offset` 1-based, `limit` a count. Omit both and
 * it is the whole file, byte for byte, so every existing caller is unchanged.
 *
 * A caller that cannot page a large file has only one move when its reply comes
 * back truncated, which is to ask for the same thing again. A driver reading a
 * 200 KB declaration file spent four rounds on `offset: 40000`, `offset: 160000`,
 * `limit: 100` — every one of them silently dropped, every reply the identical
 * first 24 000 characters — and concluded "the offset doesn't seem to work". It
 * did not exist.
 *
 * An out-of-range offset is an ERROR naming the file's length rather than an
 * empty string: empty reads as "the file ends here", which is how a caller
 * decides it has seen everything.
 */
export async function readSliceInRoot(
  root: string, relPath: string, offset?: number, limit?: number,
): Promise<string> {
  const text = await readTextInRoot(resolveInRoot(root, relPath));
  if (offset === undefined && limit === undefined) return text;
  const lines = text.split('\n');
  const from = Math.max(1, Math.floor(offset ?? 1));
  if (from > lines.length) {
    throw new Error(
      `offset ${from} is past the end of ${relPath}, which has ${lines.length} line(s)`,
    );
  }
  const count = limit === undefined ? lines.length : Math.max(0, Math.floor(limit));
  return lines.slice(from - 1, from - 1 + count).join('\n');
}

/**
 * Read a file that is allowed not to exist — `null` instead of a throw.
 *
 * Optional project config (delivery groups, build profiles) is absent in most
 * projects, and "absent" is an ANSWER there, not a failure. Asking `read` for it
 * and swallowing the rejection still crossed IPC as a rejected handler, which
 * Electron logs as `Error occurred in handler for 'fs:read'` — a stack trace on
 * every project open for a file nothing was missing. A read that genuinely fails
 * (permissions, a directory, a bad path) still throws.
 */
export async function readOptionalInRoot(root: string, relPath: string): Promise<string | null> {
  try {
    return await readTextInRoot(resolveInRoot(root, relPath));
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw e;
  }
}

export async function writeInRoot(root: string, relPath: string, contents: string): Promise<void> {
  const abs = resolveInRoot(root, relPath);
  await capture(relPath, 'write');
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, contents, 'utf8');
}

/** Browsable entries only (contentPolicy) — the Content Browser's folder view. */
export async function readDirInRoot(root: string, relPath: string): Promise<DirEntry[]> {
  const entries = await readdir(resolveInRoot(root, relPath), { withFileTypes: true });
  return entries
    .filter((e) => (e.isDirectory() ? isContentDir(e.name) : isContentFile(e.name)))
    .map((e) => ({ name: e.name, isDir: e.isDirectory() }));
}

/** Project-relative, forward-slashed form of an absolute path under `root`. */
const toRel = (root: string, abs: string): string => path.relative(root, abs).split(path.sep).join('/');

/** Yield every file (recursively) under an absolute directory. */
async function* walkFiles(absDir: string): AsyncGenerator<string> {
  for (const e of await readdir(absDir, { withFileTypes: true })) {
    const p = path.join(absDir, e.name);
    if (e.isDirectory()) yield* walkFiles(p);
    else yield p;
  }
}

// Recursively yield project-relative paths of browsable files (contentPolicy).
async function* walkVisible(absDir: string, root: string): AsyncGenerator<string> {
  for (const e of await readdir(absDir, { withFileTypes: true })) {
    const p = path.join(absDir, e.name);
    if (e.isDirectory()) {
      if (isContentDir(e.name)) yield* walkVisible(p, root);
    } else if (isContentFile(e.name)) {
      yield toRel(root, p);
    }
  }
}

/** Project-relative paths of every browsable file under `relDir`, recursively —
 *  backs the Content Browser's project-wide (subtree) search. */
/**
 * Every visible file under a project directory. A directory that does not exist
 * lists as EMPTY rather than throwing: "what is in src/?" is a question, and a
 * project that has no src/ answers it with "nothing" — the raw
 * `ENOENT ... scandir` that came back instead read as a broken tool to whoever
 * asked, which is exactly how an agent's first orienting call failed.
 */
export async function listFilesInRoot(root: string, relDir: string): Promise<string[]> {
  const abs = resolveInRoot(root, relDir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for await (const rel of walkVisible(abs, root)) out.push(rel);
  return out;
}

/** One matching line, with where it is. */
export interface FileMatch {
  file: string;
  line: number;
  text: string;
}

/**
 * Lines matching `query` across the project's visible files — the door between
 * "list every path" and "read a file whole".
 *
 * Without it the only way to find where something is written is to page files
 * in a hundred lines at a time, which is what a 50k-line `.d.ts` turns into: the
 * question was "what is on `Input`", and the cost was most of a context window.
 *
 * `glob` filters paths. It accepts what its NAME promises — `*.ts`, `src/**`,
 * `src/*.ts` — and a plain substring (`.ts`, `src/`) still works, because that is
 * what the description used to say and both readings are reasonable. It was a
 * substring test alone, and the first caller wrote `*.ts`: a search that could
 * have matched returned nothing at all, which is the worst way for a filter to be
 * wrong. A parameter answers to its name.
 */
export function pathMatchesGlob(rel: string, glob: string): boolean {
  if (!glob.includes('*') && !glob.includes('?')) return rel.includes(glob);
  // `**` crosses directory separators, `*` and `?` do not.
  const pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, ' ')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/ /g, '.*');
  // Anchored, but a bare `*.ts` should match `src/main.ts` — a pattern naming no
  // directory is about the file name, which is how every shell and editor reads it.
  const re = new RegExp(`^${pattern}$`);
  return re.test(rel) || (!glob.includes('/') && re.test(rel.split('/').pop() ?? ''));
}
/** The staged SDK types, which the content walk skips because they sit under a dot dir. */
const SDK_TYPES_REL = '.esengine/sdk';

/**
 * What a code search reaches: the project's own files, then the staged SDK types.
 *
 * The dot rule that keeps `.esengine` out of the Content Browser was excluding it
 * from search too — and search exists FOR that directory: the doc above names the
 * 50k-line `.d.ts` as the thing nobody should have to page a hundred lines at a
 * time, and it was the one file the walk could not see. `read_project_file` and
 * `lookup_symbol` both hand out paths inside it, so "no matches" for a symbol
 * those two had just named read as "it does not exist" — and the next twelve
 * calls were blind offsets into the file the search would have pointed at.
 * Project files come first so a hit in the user's own code still leads.
 */
async function* searchable(root: string): AsyncGenerator<string> {
  yield* walkVisible(root, root);
  const sdk = path.resolve(root, SDK_TYPES_REL);
  if (existsSync(sdk)) {
    for await (const abs of walkFiles(sdk)) yield toRel(root, abs);
  }
}

/**
 * A generated re-export line: `export { a as Foo, b as Bar, … }` — hundreds of
 * aliases on one line, in five near-identical index files.
 *
 * It matches EVERY symbol anyone searches for and says nothing about any of
 * them: the declaration is in another file, and the alias soup around the hit
 * is a different file's alphabet (one reader took `d4 as GpAxis` from the
 * wrong barrel and spent four calls on the wrong function). Clipped to 400
 * characters it is also unreadable. The declaration is still found — it is a
 * line in the file the barrel re-exports from.
 */
function isReExportBarrel(line: string): boolean {
  return line.length > 400 && /^export\s+(type\s+)?\{/.test(line);
}

export async function searchInRoot(
  root: string,
  opts: { query: string; regex?: boolean; glob?: string; maxResults?: number },
): Promise<FileMatch[]> {
  const query = opts.query ?? '';
  if (!query) throw new Error('search needs a query');
  const max = Math.max(1, Math.min(opts.maxResults ?? 100, 500));
  const re = opts.regex
    ? new RegExp(query, 'i')
    : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const out: FileMatch[] = [];
  for await (const rel of searchable(root)) {
    if (opts.glob && !pathMatchesGlob(rel, opts.glob)) continue;
    let text: string;
    try {
      text = await readFile(resolveInRoot(root, rel), 'utf8');
    } catch {
      continue; // Unreadable or binary — a search is not the place to report it.
    }
    // A minified bundle or a generated .d.ts can hold one line of a megabyte;
    // returning it verbatim is how a "search" becomes the thing it was meant to
    // replace. The location still lands, the line is just clipped.
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      const line = lines[i].trim();
      if (isReExportBarrel(line)) continue;
      out.push({ file: rel, line: i + 1, text: line.slice(0, 400) });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/**
 * Rename / move a file or folder within the project. A file's `.meta` sidecar
 * travels with it so rename preserves asset identity (uuid). Refuses to clobber
 * an existing destination.
 */
export async function renameInRoot(root: string, fromRel: string, toRelPath: string): Promise<void> {
  const from = resolveInRoot(root, fromRel);
  const to = resolveInRoot(root, toRelPath);
  if (from === to) return;
  if (existsSync(to)) throw new Error(`"${toRelPath}" already exists`);
  // Both ends, because a rename changes both: putting back only the source
  // would leave the file in two places, only the destination in neither.
  await capture(fromRel, 'remove');
  await capture(toRelPath, 'write');
  await mkdir(path.dirname(to), { recursive: true });
  await rename(from, to);
  const fromMeta = from + META_EXT;
  if (existsSync(fromMeta)) await rename(fromMeta, to + META_EXT);
}

/** Create a folder; refuses if it already exists (the caller owns name choice). */
export async function mkdirInRoot(root: string, relPath: string): Promise<void> {
  const abs = resolveInRoot(root, relPath);
  if (existsSync(abs)) throw new Error(`"${relPath}" already exists`);
  await capture(relPath, 'write');
  await mkdir(abs, { recursive: true });
}

/** Assign a fresh uuid to a `.meta` file (a duplicated asset must not share one). */
async function regenMetaUuid(metaAbs: string): Promise<void> {
  try {
    const meta = JSON.parse(await readTextInRoot(metaAbs));
    meta.uuid = randomUUID();
    await writeFile(metaAbs, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  } catch {
    // Leave a malformed sidecar untouched — the scanner will warn on it anyway.
  }
}

/**
 * Duplicate a file or folder next to itself ("foo.png" → "foo copy.png", then
 * "foo copy 2.png"…). Every copied `.meta` sidecar gets a NEW uuid — two assets
 * can't share an identity in the registry. Returns the new project-relative path.
 */
export async function duplicateInRoot(root: string, relPath: string): Promise<string> {
  const from = resolveInRoot(root, relPath);
  if (!existsSync(from)) throw new Error(`"${relPath}" does not exist`);
  const isDir = (await stat(from)).isDirectory();

  const dir = path.dirname(from);
  const base = path.basename(from);
  const ext = isDir ? '' : path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  let to = '';
  for (let i = 1; ; i++) {
    to = path.join(dir, `${stem}${i === 1 ? ' copy' : ` copy ${i}`}${ext}`);
    if (!existsSync(to)) break;
  }
  await capture(toRel(root, to), 'write');

  await cp(from, to, { recursive: true });
  if (isDir) {
    for await (const f of walkFiles(to)) if (f.endsWith(META_EXT)) await regenMetaUuid(f);
  } else {
    const fromMeta = from + META_EXT;
    if (existsSync(fromMeta)) {
      await cp(fromMeta, to + META_EXT);
      await regenMetaUuid(to + META_EXT);
    }
  }
  return toRel(root, to);
}

// Pre-trash snapshots for the delete-undo toast. shell.trashItem has no restore
// API, so undo rewrites the file from a copy taken just before the trash — the
// `.meta` travels along, so the uuid (and every `@uuid:` ref to it) survives.
const TRASH_HOLDING_DIR = path.join(tmpdir(), 'estella-trash-undo');
const TOKEN_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Copy a file/folder (+ sidecar) into the holding dir; returns a restore token. */
export async function snapshotForTrash(root: string, relPath: string): Promise<string> {
  const abs = resolveInRoot(root, relPath);
  if (!existsSync(abs)) throw new Error(`"${relPath}" does not exist`);
  const token = randomUUID();
  const dir = path.join(TRASH_HOLDING_DIR, token);
  await mkdir(dir, { recursive: true });
  await cp(abs, path.join(dir, 'item'), { recursive: true });
  const meta = abs + META_EXT;
  if (existsSync(meta)) await cp(meta, path.join(dir, 'item' + META_EXT));
  return token;
}

/** Undo a trash: rewrite `relPath` (+ `.meta`) from its pre-trash snapshot.
 *  Refuses if the path has been re-taken in the meantime. */
export async function restoreTrashed(root: string, relPath: string, token: string): Promise<void> {
  // The token names a directory — reject anything that isn't a plain uuid.
  if (!TOKEN_SHAPE.test(token)) throw new Error('invalid restore token');
  const dir = path.join(TRASH_HOLDING_DIR, token);
  const item = path.join(dir, 'item');
  if (!existsSync(item)) throw new Error('nothing to restore (snapshot expired)');
  const abs = resolveInRoot(root, relPath);
  if (existsSync(abs)) throw new Error(`"${relPath}" already exists`);
  await mkdir(path.dirname(abs), { recursive: true });
  await cp(item, abs, { recursive: true });
  const meta = item + META_EXT;
  if (existsSync(meta)) await cp(meta, abs + META_EXT);
  await rm(dir, { recursive: true, force: true });
}

/** Size + modified time for the asset tooltip / inspector metadata. */
export async function statInRoot(
  root: string,
  relPath: string,
): Promise<{ size: number; mtimeMs: number; isDir: boolean }> {
  const s = await stat(resolveInRoot(root, relPath));
  return { size: s.size, mtimeMs: s.mtimeMs, isDir: s.isDirectory() };
}

/** Persist editor-local workspace state to `.esengine/workspace.json`. */
export async function saveWorkspace(root: string, workspace: WorkspaceState): Promise<void> {
  const dir = path.join(root, WORKSPACE_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, WORKSPACE_FILE), JSON.stringify(workspace, null, 2) + '\n', 'utf8');
}
