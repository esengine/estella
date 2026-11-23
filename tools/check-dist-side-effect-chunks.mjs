#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/repo.mjs';

/**
 * The text with every string, template literal and comment blanked (newlines kept): a shader's source in a template
 * literal has lines that look like top-level calls, and is not code that runs.
 */
function codeOnly(text) {
  let out = '';
  const templates = []; // brace depth at each open `${`, innermost last
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const blank = (ch) => (ch === '\n' ? '\n' : ' ');
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') { out += ' '; i++; } out += text[i] ?? ''; continue; }
    if (c === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); const stop = end < 0 ? text.length : end + 2; for (; i < stop; i++) out += blank(text[i]); i--; continue; }
    if (c === '"' || c === "'") {
      out += c; i++;
      while (i < text.length && text[i] !== c) { if (text[i] === '\\') { out += ' '; i++; } out += blank(text[i]); i++; }
      out += c; continue;
    }
    if (c === '`' || (c === '}' && templates.length && templates[templates.length - 1] === depth)) {
      if (c === '}') templates.pop();
      out += c; i++;
      while (i < text.length && text[i] !== '`' && !(text[i] === '$' && text[i + 1] === '{')) {
        if (text[i] === '\\') { out += ' '; i++; }
        out += blank(text[i]); i++;
      }
      if (text[i] === '$') { templates.push(depth); out += '${'; i++; } else out += text[i] ?? '';
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') depth--;
    out += c;
  }
  return out;
}

const SDK = path.join(ROOT, 'sdk');
const pkg = JSON.parse(readFileSync(path.join(SDK, 'package.json'), 'utf8'));
const declared = new Set((pkg.sideEffects ?? []).map((p) => path.resolve(SDK, p)));

if (declared.size === 0) {
  console.error('check-dist-side-effect-chunks: sdk/package.json declares no side-effectful file.');
  process.exit(1);
}

const problems = [];
let checked = 0;
for (const file of declared) {
  if (!existsSync(file)) {
    problems.push(`${path.relative(ROOT, file)} is declared in sideEffects and was not built (run the SDK build first)`);
    continue;
  }
  checked++;
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^import\s+["']([^"']+)["'];?\s*$/gm)) {
    const target = path.resolve(path.dirname(file), m[1]);
    if (declared.has(target) || !existsSync(target)) continue;
    if (readFileSync(target, 'utf8').trim() === '') continue;
    problems.push(`${path.relative(ROOT, file)} runs ${path.relative(ROOT, target)} only by importing it bare, `
      + 'and that file is not in sideEffects: a consumer bundler drops it, and whatever it registers never runs');
  }
  // A chunk it imports NAMES from runs too, and a top-level call there (an entry's register call, which rolldown may move into a
  // shared chunk) is lost the same way when nothing uses the names: water's registration was, and no water drew in a package.
  for (const m of src.matchAll(/^import\s+\{[^}]*\}\s+from\s+["']([^"']+)["'];?\s*$/gm)) {
    const target = path.resolve(path.dirname(file), m[1]);
    if (declared.has(target) || !existsSync(target)) continue;
    // A call to a function the chunk imports reaches state outside it (a registry the core keeps); one to its own function
    // only fills what the chunk itself holds, which is unread when the chunk is dropped for having no name in use.
    const code = codeOnly(readFileSync(target, 'utf8'));
    const imported = new Set([...code.matchAll(/^import\s+\{([^}]*)\}/gm)]
      .flatMap((im) => im[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean)));
    const call = [...code.matchAll(/^([A-Za-z_$][\w$]*)\([^\n]*\);\s*$/gm)].find((c) => imported.has(c[1]));
    if (!call) continue;
    problems.push(`${path.relative(ROOT, file)} imports ${path.relative(ROOT, target)}, whose top level calls \`${call[0].trim()}\`, `
      + 'and that file is not in sideEffects: a consumer bundler that uses none of its names drops it, and the call never runs');
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`  ${p}`);
  console.error(`check-dist-side-effect-chunks: ${problems.length} published entr(y/ies) lose code to the bundler.`);
  process.exit(1);
}
console.log(`check-dist-side-effect-chunks: ${checked} side-effectful file(s), none runs code through an undeclared chunk.`);
