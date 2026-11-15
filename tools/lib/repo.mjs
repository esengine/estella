// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

export const repoRelative = (file) => path.relative(ROOT, file).split(path.sep).join('/');

export function walkFiles(dir, { match = null, skip = null, hidden = true, missing = false } = {}, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (missing && err.code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    if (!hidden && entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    const folder = entry.isDirectory();
    if (skip && skip(entry.name, full, folder)) continue;
    if (folder) walkFiles(full, { match, skip, hidden, missing }, out);
    else if (!match || (typeof match === 'function' ? match(entry.name, full) : match.test(entry.name))) out.push(full);
  }
  return out;
}

export function stripComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  const blank = (from, to) => text.slice(from, to).replace(/[^\n]/g, ' ');
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && text[j] !== c) {
        if (text[j] === '\\') j++;
        else if (text[j] === '\n' && c !== '`') break;
        j++;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      out += blank(i, stop);
      i = stop;
    } else if (c === '/' && next === '/' && text[i - 1] !== '\\') {
      let stop = text.indexOf('\n', i);
      if (stop < 0) stop = n;
      out += blank(i, stop);
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
