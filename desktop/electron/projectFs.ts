/**
 * @file  Project filesystem access for the Electron main process.
 *
 * All renderer file I/O funnels through here and is sandboxed to the currently
 * open project root — paths that escape the root (via `..` or absolute) are
 * refused, so a compromised/buggy renderer can't read or write arbitrary files.
 * See RC12 §E7.
 */
import { readFile, writeFile, readdir, mkdir, rename, cp, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
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

/**
 * Resolve a project-relative path, refusing anything that escapes `root`.
 * Pure (no I/O) — the security boundary for every fs op below.
 */
export function resolveInRoot(root: string, relPath: string): string {
  const resolved = path.resolve(root, relPath);
  const rel = path.relative(root, resolved);
  if (rel === '') return resolved; // the root itself
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path "${relPath}" escapes the project root`);
  }
  return resolved;
}

/** Require + parse a project's `project.esproject` manifest (no workspace load). */
export async function readManifest(root: string): Promise<ProjectManifest> {
  const manifestPath = path.join(root, PROJECT_MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new Error(`not an Estella project (missing ${PROJECT_MANIFEST_FILE}): ${root}`);
  }
  return parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
}

/** Open a project: require + parse `project.esproject`, load workspace if present. */
export async function openProject(root: string): Promise<OpenedProject> {
  const manifest = await readManifest(root);

  let workspace: WorkspaceState = {};
  const wsPath = path.join(root, WORKSPACE_DIR, WORKSPACE_FILE);
  if (existsSync(wsPath)) {
    try {
      workspace = JSON.parse(await readFile(wsPath, 'utf8')) as WorkspaceState;
    } catch {
      // A corrupt workspace file is non-fatal — start clean.
    }
  }
  return { root, manifest, workspace };
}

export function readInRoot(root: string, relPath: string): Promise<string> {
  return readFile(resolveInRoot(root, relPath), 'utf8');
}

export async function writeInRoot(root: string, relPath: string, contents: string): Promise<void> {
  const abs = resolveInRoot(root, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, contents, 'utf8');
}

export async function readDirInRoot(root: string, relPath: string): Promise<DirEntry[]> {
  const entries = await readdir(resolveInRoot(root, relPath), { withFileTypes: true });
  return entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
}

/** Sidecar suffix carrying an asset's uuid/type/importer (see assetDb). */
export const META_EXT = '.meta';

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
  await mkdir(path.dirname(to), { recursive: true });
  await rename(from, to);
  const fromMeta = from + META_EXT;
  if (existsSync(fromMeta)) await rename(fromMeta, to + META_EXT);
}

/** Create a folder; refuses if it already exists (the caller owns name choice). */
export async function mkdirInRoot(root: string, relPath: string): Promise<void> {
  const abs = resolveInRoot(root, relPath);
  if (existsSync(abs)) throw new Error(`"${relPath}" already exists`);
  await mkdir(abs, { recursive: true });
}

/** Assign a fresh uuid to a `.meta` file (a duplicated asset must not share one). */
async function regenMetaUuid(metaAbs: string): Promise<void> {
  try {
    const meta = JSON.parse(await readFile(metaAbs, 'utf8'));
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
