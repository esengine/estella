// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  bootCode.ts — the code a web page downloads before the game's own boot
 *        can report anything, and so what the start screen measures on its own.
 */
import { readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

/** `import … from "x"`, `import "x"`, `export … from "x"` — not `import("x")`,
 *  which is fetched when the running game asks for it. */
const STATIC_IMPORT = /(?:^|[;\s}])(?:import|export)\s*(?:[\w*{}\s,$]*?\s*from\s*)?["']([^"'\n]+)["']/g;

/**
 * The bytes of `entry` and every module it statically imports, resolved through
 * the page's import map. Unresolved or missing specifiers are left out: they are
 * not this page's to download.
 */
export function bootCodeBytes(root: string, entry: string, importMap: Record<string, string>): number {
  const seen = new Set<string>();
  const pending = [path.resolve(root, entry)];
  let bytes = 0;
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    bytes += statSync(file).size;
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(STATIC_IMPORT)) {
      const spec = match[1];
      const mapped = importMap[spec];
      const target = mapped !== undefined ? path.resolve(root, mapped)
        : spec.startsWith('.') ? path.resolve(path.dirname(file), spec) : null;
      if (target) pending.push(target);
    }
  }
  return bytes;
}
