// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The one answer to "is this path inside that root?".
 *
 * Every door that takes a caller-named path and turns it into an fs call needs
 * this, and each one that spells it out itself gets a different amount of it
 * right. `check-path-sandbox.mjs` keeps the idiom from being written a seventh
 * time; a use that is NOT a boundary opts out by saying so in a comment.
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';

/** Lexical containment: `abs` is `base`, or sits under it. */
export function containsPath(base: string, abs: string): boolean {
  const rel = path.relative(base, abs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// A root is resolved once per open; the candidate side is always resolved live.
const realRootCache = new Map<string, string>();

/** `root` with links resolved — a root may itself live under one (/tmp on macOS). */
export function realRootOf(root: string): string {
  const key = path.resolve(root);
  const hit = realRootCache.get(key);
  if (hit !== undefined) return hit;
  let real = key;
  try {
    real = realpathSync.native(key);
  } catch {
    // Not created yet (a project being made) — the lexical form is all there is.
  }
  realRootCache.set(key, real);
  return real;
}

/**
 * `abs` with links resolved. The leaf often does not exist yet (a write, a mkdir,
 * a rename target), so resolve the deepest ancestor that does and re-attach the
 * rest — that is the part someone can have made a link.
 */
export function realPathOf(abs: string): string {
  const tail: string[] = [];
  let head = path.resolve(abs);
  for (;;) {
    try {
      return path.join(realpathSync.native(head), ...tail);
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return path.resolve(abs);
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
}

/**
 * Whether `abs` is really inside `root`. Lexical containment is not containment:
 * a link inside the root holds no `..` and points wherever it likes, so both
 * sides are compared with links resolved as well.
 *
 * Racing a link swapped between this and the call that follows needs O_NOFOLLOW,
 * which node does not expose portably — this raises the bar, it is not a seal.
 */
export function isInsideRoot(root: string, abs: string): boolean {
  const resolved = path.resolve(abs);
  return containsPath(path.resolve(root), resolved)
    && containsPath(realRootOf(root), realPathOf(resolved));
}

/** {@link isInsideRoot} for a relative path, throwing rather than returning false.
 *  `label` names the root in the message ("project root", "build output"). */
export function resolveInside(root: string, relPath: string, label: string): string {
  const resolved = path.resolve(root, relPath);
  if (!containsPath(path.resolve(root), resolved)) {
    throw new Error(`path "${relPath}" escapes the ${label}`);
  }
  if (!containsPath(realRootOf(root), realPathOf(resolved))) {
    throw new Error(`path "${relPath}" escapes the ${label} through a link`);
  }
  return resolved;
}
