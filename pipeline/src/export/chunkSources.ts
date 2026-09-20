// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What an SDK chunk is made of, read off the source map beside it.
 *
 * A bundler groups modules into a chunk by what reaches them, not by what they
 * do, so a chunk's name is one of its modules and says nothing about the other
 * forty: `shared/physics.js` is the whole physics directory, and deleting spine
 * once renamed a 47KB chunk without changing a byte of it. A size report built
 * on chunk names therefore reads as an answer while being a coincidence.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

interface RawMap {
  sources: string[];
  mappings: string;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGIT = new Map([...B64].map((c, i) => [c, i] as const));

/** Generated positions and the source each came from, in emitted order. */
function segments(mappings: string): Array<[line: number, column: number, source: number]> {
  const out: Array<[number, number, number]> = [];
  let source = 0;
  const lines = mappings.split(';');
  for (let line = 0; line < lines.length; line++) {
    let column = 0;
    if (lines[line] === '') continue;
    for (const segment of lines[line].split(',')) {
      if (segment === '') continue;
      const fields: number[] = [];
      let i = 0;
      while (i < segment.length) {
        let shift = 0;
        let value = 0;
        let more = 1;
        while (more !== 0) {
          const digit = DIGIT.get(segment[i]);
          i += 1;
          if (digit === undefined) return out; // Not a map we can read; keep what we have.
          more = digit & 32;
          value += (digit & 31) << shift;
          shift += 5;
        }
        fields.push((value & 1) !== 0 ? -(value >> 1) : value >> 1);
      }
      column += fields[0];
      if (fields.length >= 4) source += fields[1];
      out.push([line, column, fields.length >= 4 ? source : -1]);
    }
  }
  return out;
}

/**
 * Bytes of `chunk` that came from each original source, keyed by the path the
 * map names resolved against the chunk. A span runs to the next mapping on its
 * line, which is how a minified file — one long line — divides up at all.
 *
 * Undefined when there is no map: a dist built without them is still a dist.
 */
export function sourceBytesOf(chunk: string): Map<string, number> | undefined {
  if (!existsSync(`${chunk}.map`)) return undefined;
  let map: RawMap;
  try {
    map = JSON.parse(readFileSync(`${chunk}.map`, 'utf8')) as RawMap;
  } catch {
    return undefined;
  }
  if (!Array.isArray(map.sources) || typeof map.mappings !== 'string') return undefined;
  const lineLengths = readFileSync(chunk, 'utf8').split('\n').map((l) => l.length + 1);
  const segs = segments(map.mappings);
  const bytes = new Map<string, number>();
  for (let i = 0; i < segs.length; i++) {
    const [line, column, source] = segs[i];
    if (source < 0) continue;
    const next = segs[i + 1];
    const end = next !== undefined && next[0] === line ? next[1] : lineLengths[line] ?? column;
    const span = Math.max(0, end - column);
    if (span === 0) continue;
    const name = path.resolve(path.dirname(chunk), map.sources[source] ?? '');
    bytes.set(name, (bytes.get(name) ?? 0) + span);
  }
  return bytes.size > 0 ? bytes : undefined;
}
