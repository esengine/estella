/**
 * @file  Project filesystem access for the Electron main process.
 *
 * All renderer file I/O funnels through here and is sandboxed to the currently
 * open project root — paths that escape the root (via `..` or absolute) are
 * refused, so a compromised/buggy renderer can't read or write arbitrary files.
 * See RC12 §E7.
 */
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

/** Persist editor-local workspace state to `.esengine/workspace.json`. */
export async function saveWorkspace(root: string, workspace: WorkspaceState): Promise<void> {
  const dir = path.join(root, WORKSPACE_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, WORKSPACE_FILE), JSON.stringify(workspace, null, 2) + '\n', 'utf8');
}
