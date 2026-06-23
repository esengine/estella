// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
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
  parseManifest,
  type RecentEntry,
  type TemplateEntry,
} from '../src/project/format';

type StoredRecent = Pick<RecentEntry, 'name' | 'root' | 'openedAt'>;

const recentsFile = (): string => path.join(app.getPath('userData'), 'estella-recents.json');

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

/** Recent projects, newest first, with stale entries (no manifest) dropped. */
export async function listRecents(): Promise<RecentEntry[]> {
  const stored = await readStored();
  const out: RecentEntry[] = [];
  for (const r of stored) {
    if (!r?.root || !existsSync(path.join(r.root, PROJECT_MANIFEST_FILE))) continue;
    out.push({ ...r, build: await manifestBuild(r.root), thumbnail: await thumbnailUrl(r.root) });
  }
  return out;
}

/** Record a freshly-opened project at the top of the recents list (cap 12). */
export async function addRecent(root: string, name: string): Promise<void> {
  const stored = (await readStored()).filter((r) => r.root !== root);
  stored.unshift({ root, name, openedAt: Date.now() });
  await writeFile(recentsFile(), JSON.stringify(stored.slice(0, 12), null, 2));
}

// New-project templates. In dev these are the in-repo examples (each is a real
// project dir); a packaged build would point this at a bundled templates dir.
const templatesDir = (): string => path.join(process.env.APP_ROOT ?? '', '..', 'examples');

export async function listTemplates(): Promise<TemplateEntry[]> {
  const root = templatesDir();
  if (!existsSync(root)) return [];
  const out: TemplateEntry[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    if (!existsSync(path.join(dir, PROJECT_MANIFEST_FILE))) continue;
    let description: string | undefined;
    let tag: string | undefined;
    try {
      const m = parseManifest(JSON.parse(await readFile(path.join(dir, PROJECT_MANIFEST_FILE), 'utf8')));
      description = m.description;
      tag = m.tag;
    } catch {
      // keep name-only
    }
    out.push({ name: entry.name, dir, description, tag, thumbnail: await thumbnailUrl(dir) });
  }
  return out;
}

/** Copy a template into `<location>/<name>`, stamp the manifest name, return the new root. */
export async function createFromTemplate(templateDir: string, location: string, name: string): Promise<string> {
  const dest = path.join(location, name);
  if (existsSync(dest)) throw new Error(`a folder already exists at ${dest}`);
  await cp(templateDir, dest, { recursive: true });
  const manifestPath = path.join(dest, PROJECT_MANIFEST_FILE);
  const m = parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  m.name = name;
  await writeFile(manifestPath, JSON.stringify(m, null, 2) + '\n');
  return dest;
}
