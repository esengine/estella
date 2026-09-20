// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A stand-in for `sdk/dist` that an export can be pointed at.
 *
 * The export reads the chunk manifest the SDK build writes and refuses a dist
 * without one, so a fixture is now a shape rather than a file or two — and nine
 * tests had each written their own.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const TRIVIAL = { 'index.js': 'export const x = 1;\n' };

/**
 * Write a minimal dist at `dir`: `files` maps a dist-relative path to its
 * source. Anything under `shared/` is a chunk every entry reaches; everything
 * else is an entry. Returns `dir`, so it reads as the argument it becomes.
 */
export function writeFakeSdkDist(dir: string, files: Readonly<Record<string, string>> = TRIVIAL): string {
  mkdirSync(dir, { recursive: true });
  for (const [rel, source] of Object.entries(files)) {
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  const names = Object.keys(files).filter((f) => f.endsWith('.js'));
  const chunks = names.filter((f) => f.startsWith('shared/'));
  const manifest = Object.fromEntries(names.filter((f) => !chunks.includes(f)).map((f) => [f, chunks]));
  writeFileSync(path.join(dir, 'chunks.json'), JSON.stringify(manifest, null, 2));
  return dir;
}
