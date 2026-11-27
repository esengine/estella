// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

export interface ProjectSceneEntry {
  name: string;
  path: string;
}

export function normalizeScenePath(path: string): string {
  return path.split(/[/\\]/).filter(segment => segment !== '' && segment !== '.').join('/');
}

/** Reserve the export names before registering additional scenes for Play. */
export function projectSceneEntries(paths: Iterable<string>, scenesDir: string, entryScene?: string): ProjectSceneEntry[] {
  const dir = normalizeScenePath(scenesDir);
  const startup = entryScene === undefined ? undefined : normalizeScenePath(entryScene);
  const seenPaths = new Set<string>();
  const entries: ProjectSceneEntry[] = [];
  const inside: ProjectSceneEntry[] = [];
  const outside: ProjectSceneEntry[] = [];
  for (const raw of paths) {
    const path = normalizeScenePath(raw);
    if (seenPaths.has(path)) continue;
    seenPaths.add(path);
    const inDirectory = !dir || path.startsWith(`${dir}/`);
    const relative = inDirectory && dir ? path.slice(dir.length + 1) : path;
    const entry = { path, name: relative.replace(/\.esscene$/i, '') };
    entries.push(entry);
    (inDirectory ? inside : outside).push(entry);
  }

  // Use the same in-directory ordering even when Play starts at a different scene.
  inside.sort((a, b) => {
    const priority = Number(b.path === startup) - Number(a.path === startup);
    if (priority) return priority;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  const outsideEntry = outside.find(entry => entry.path === startup);
  const published = outsideEntry ? [...inside, outsideEntry] : inside;
  const occupied = new Set<string>();
  reserveSceneNames(published, occupied);
  reserveSceneNames(outside.filter(entry => entry !== outsideEntry), occupied);
  return entries;
}

function reserveSceneNames(entries: ProjectSceneEntry[], occupied: Set<string>): void {
  const collisions: ProjectSceneEntry[] = [];
  for (const entry of entries) {
    if (occupied.has(entry.name)) collisions.push(entry);
    else occupied.add(entry.name);
  }
  for (const entry of collisions) {
    let name = `@project/${entry.path.replace(/\.esscene$/i, '')}`;
    while (occupied.has(name)) name = `@project/${name}`;
    entry.name = name;
    occupied.add(name);
  }
}
