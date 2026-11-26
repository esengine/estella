// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

export interface ProjectSceneEntry {
  name: string;
  path: string;
}

export function normalizeScenePath(path: string): string {
  return path.split(/[/\\]/).filter(segment => segment !== '' && segment !== '.').join('/');
}

/** The runtime name is relative to the scenes directory, or to the project for a scene outside it. */
export function projectSceneEntry(projectPath: string, scenesDir: string): ProjectSceneEntry {
  const path = normalizeScenePath(projectPath);
  const dir = normalizeScenePath(scenesDir);
  const relative = dir && path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : path;
  return { path, name: relative.replace(/\.esscene$/i, '') };
}
