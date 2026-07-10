// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Launcher-supporting main-process ops: the recent-projects list and
 *        project thumbnails. Lives in main because it touches arbitrary paths
 *        (recents point anywhere) and userData — outside the renderer's
 *        project-root sandbox. See RC12 §E7.
 */
import { app } from 'electron';
import { readFile, writeFile, readdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  PROJECT_MANIFEST_FILE,
  isTransientProjectPath,
  parseManifest,
  type RecentEntry,
  type TemplateEntry,
} from '../src/project/format';

type StoredRecent = Pick<RecentEntry, 'name' | 'root' | 'openedAt'>;

const recentsFile = (): string => path.join(app.getPath('userData'), 'estella-recents.json');

// The recents file is project HISTORY, not the view. This cap only guards the file
// against unbounded growth — it is NOT a display limit: the Launcher already presents
// recents with a search box + grid/list, so how many to SHOW is the display's call,
// not the store's. Kept generous so real history survives; stale entries (project
// moved/deleted) are hidden at read time by listRecents, not pruned here, so a
// temporarily-offline drive re-appears when it is back.
const MAX_RECENTS = 50;

async function readStored(): Promise<StoredRecent[]> {
  try {
    const raw = JSON.parse(await readFile(recentsFile(), 'utf8'));
    return Array.isArray(raw) ? (raw as StoredRecent[]) : [];
  } catch {
    return [];
  }
}

/** A project's `thumbnail.png` as a base64 data URL (CSP allows `img-src data:`). */
async function thumbnailUrl(root: string): Promise<string | undefined> {
  const file = path.join(root, 'thumbnail.png');
  if (!existsSync(file)) return undefined;
  try {
    const bytes = await readFile(file);
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch {
    return undefined;
  }
}

/** The manifest's build badge (engineBuildId, else the project version). */
async function manifestBuild(root: string): Promise<string | undefined> {
  try {
    const m = parseManifest(JSON.parse(await readFile(path.join(root, PROJECT_MANIFEST_FILE), 'utf8')));
    return m.engineBuildId ?? m.version;
  } catch {
    return undefined;
  }
}

/** Canonical identity of a project root: resolved to one absolute spelling and
 *  case-folded on Windows (its paths are case-insensitive). Entries keep their
 *  stored spelling for display — only comparisons go through this, so the same
 *  folder opened as `F:\x` and `F:/x` is one recent, not two. */
function canonRoot(root: string): string {
  const r = path.resolve(root);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/** Recent projects, newest first, with stale entries (no manifest) dropped and
 *  spelling-variant duplicates collapsed to their newest entry. */
export async function listRecents(): Promise<RecentEntry[]> {
  const stored = await readStored();
  const seen = new Set<string>();
  const out: RecentEntry[] = [];
  for (const r of stored) {
    if (!r?.root || !existsSync(path.join(r.root, PROJECT_MANIFEST_FILE))) continue;
    const key = canonRoot(r.root);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, build: await manifestBuild(r.root), thumbnail: await thumbnailUrl(r.root) });
  }
  return out;
}

/** Record a freshly-opened project at the top of the recents list (de-duped, newest first). */
export async function addRecent(root: string, name: string): Promise<void> {
  const key = canonRoot(root);
  const stored = (await readStored()).filter((r) => !!r?.root && canonRoot(r.root) !== key);
  stored.unshift({ root: path.resolve(root), name, openedAt: Date.now() });
  await writeFile(recentsFile(), JSON.stringify(stored.slice(0, MAX_RECENTS), null, 2));
}

/** Drop a project from the recents list. The project on disk is untouched — this
 *  only forgets it in the launcher (the user's explicit "remove from recents"). */
export async function removeRecent(root: string): Promise<void> {
  const key = canonRoot(root);
  const stored = (await readStored()).filter((r) => !!r?.root && canonRoot(r.root) !== key);
  await writeFile(recentsFile(), JSON.stringify(stored, null, 2));
}

// New-project template roots, in gallery order: bundled blank-slate starters
// first, then the sample projects (each root holds real project dirs). Dev
// reads the in-repo trees; a packaged app reads the copies electron-builder
// stages under resources/ (extraResources — real files, outside the asar, so
// createFromTemplate's directory copy works on them).
const templateRoots = (): Array<{ root: string; kind: TemplateEntry['kind'] }> =>
  app.isPackaged
    ? [
        { root: path.join(process.resourcesPath, 'templates'), kind: 'starter' },
        { root: path.join(process.resourcesPath, 'examples'), kind: 'example' },
      ]
    : [
        { root: path.join(process.env.APP_ROOT ?? '', 'templates'), kind: 'starter' },
        { root: path.join(process.env.APP_ROOT ?? '', '..', 'examples'), kind: 'example' },
      ];

export async function listTemplates(): Promise<TemplateEntry[]> {
  const out: TemplateEntry[] = [];
  const seen = new Set<string>();
  for (const { root, kind } of templateRoots()) {
    if (!existsSync(root)) continue;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || seen.has(entry.name)) continue;
      const dir = path.join(root, entry.name);
      if (!existsSync(path.join(dir, PROJECT_MANIFEST_FILE))) continue;
      seen.add(entry.name);
      let name = entry.name;
      let description: string | undefined;
      let tag: string | undefined;
      try {
        const m = parseManifest(JSON.parse(await readFile(path.join(dir, PROJECT_MANIFEST_FILE), 'utf8')));
        name = m.name;
        description = m.description;
        tag = m.tag;
      } catch {
        // keep dir-name-only
      }
      out.push({ name, dir, kind, description, tag, thumbnail: await thumbnailUrl(dir) });
    }
  }
  return out;
}

/** Copy a template into `<location>/<name>`, stamp the manifest name, return the new root.
 *  Transient state (`.esengine` staging, node_modules, …) stays behind. */
export async function createFromTemplate(templateDir: string, location: string, name: string): Promise<string> {
  const dest = path.join(location, name);
  if (existsSync(dest)) throw new Error(`a folder already exists at ${dest}`);
  await cp(templateDir, dest, {
    recursive: true,
    filter: (src) => !isTransientProjectPath(path.relative(templateDir, src)),
  });
  const manifestPath = path.join(dest, PROJECT_MANIFEST_FILE);
  const m = parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  m.name = name;
  await writeFile(manifestPath, JSON.stringify(m, null, 2) + '\n');
  return dest;
}
