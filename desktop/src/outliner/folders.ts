// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  folders.ts — outliner folder-path helpers.
 *
 * A folder is a slash-delimited PATH ("Enemies/Bosses"), not an entity — it
 * organizes the outliner without touching the ECS/transform/gameplay (orthogonal
 * to `parent`). Stored losslessly as a per-entity `folder` field + a scene-level
 * list of explicit (incl. empty) folders. These pure helpers are the one place
 * that knows the path grammar; the empty string is the implicit scene root.
 */

/** The implicit root — an entity with no `folder` (or `""`) sits at the scene root. */
export const ROOT_FOLDER = '';

/** Editor-only per-entity field (not in the engine `SceneEntityData`). */
export interface EntityFolderField {
  /** Slash-delimited folder path; absent/`""` = scene root. */
  folder?: string;
}

/** Editor-only scene-level field carrying explicit (incl. empty) folders. */
export interface SceneFoldersField {
  folders?: string[];
}

/** Collapse `a//b/ /c` → `a/b/c`; drops empty/whitespace segments. */
export function normalizeFolder(path: string | undefined): string {
  if (!path) return ROOT_FOLDER;
  return path
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join('/');
}

/** The last path segment (display name); `""` for the root. */
export function folderName(path: string): string {
  const p = normalizeFolder(path);
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

/** The parent folder path; `""` for a top-level folder or the root. */
export function folderParent(path: string): string {
  const p = normalizeFolder(path);
  const i = p.lastIndexOf('/');
  return i < 0 ? ROOT_FOLDER : p.slice(0, i);
}

/** Join a parent path + a child name (`join("A", "B") === "A/B"`). */
export function joinFolder(parent: string, name: string): string {
  return normalizeFolder(parent ? `${parent}/${name}` : name);
}

/** Every ancestor path including the path itself: `"A/B/C"` → `["A","A/B","A/B/C"]`. */
export function folderPrefixes(path: string): string[] {
  const p = normalizeFolder(path);
  if (!p) return [];
  const segs = p.split('/');
  const out: string[] = [];
  let acc = '';
  for (const s of segs) {
    acc = acc ? `${acc}/${s}` : s;
    out.push(acc);
  }
  return out;
}

/** True if `path` is `ancestor` or nested below it (prefix on a segment boundary). */
export function isFolderUnder(path: string, ancestor: string): boolean {
  const p = normalizeFolder(path);
  const a = normalizeFolder(ancestor);
  if (!a) return true; // everything is under the root
  return p === a || p.startsWith(`${a}/`);
}

/**
 * Re-root `path` from `oldBase` onto `newBase` (folder rename/move). Returns the
 * rewritten path, or null if `path` isn't under `oldBase`.
 */
export function rebaseFolder(path: string, oldBase: string, newBase: string): string | null {
  const p = normalizeFolder(path);
  const o = normalizeFolder(oldBase);
  if (!isFolderUnder(p, o)) return null;
  const tail = o ? p.slice(o.length) : p ? `/${p}` : ''; // includes a leading '/' or ''
  return normalizeFolder(`${newBase}${tail}`);
}
