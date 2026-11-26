// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

export interface ProjectSceneEntry {
  name: string;
  path: string;
}

export function normalizeScenePath(path: string): string {
  return path.split(/[/\\]/).filter(segment => segment !== '' && segment !== '.').join('/');
}

/** In-directory scenes keep their relative names when an outside scene has the same name. */
export function projectSceneEntries(paths: Iterable<string>, scenesDir: string): ProjectSceneEntry[] {
  const dir = normalizeScenePath(scenesDir);
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

  const occupied = new Set<string>();
  const collisions: ProjectSceneEntry[] = [];
  for (const group of [inside, outside]) {
    for (const entry of group) {
      if (occupied.has(entry.name)) collisions.push(entry);
      else occupied.add(entry.name);
    }
  }
  for (const entry of collisions) {
    let name = `@project/${entry.path.replace(/\.esscene$/i, '')}`;
    while (occupied.has(name)) name = `@project/${name}`;
    entry.name = name;
    occupied.add(name);
  }
  return entries;
}
