// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import path from 'node:path';
import { parseArgs } from 'node:util';

export class ToolArgsError extends Error {}

function shape(name, entry) {
  if (entry === false) return { type: 'boolean', fallback: false };
  if (entry === null) return { type: 'string', fallback: null };
  if (typeof entry === 'string') return { type: 'string', fallback: entry };
  if (Array.isArray(entry)) return { type: 'string', fallback: entry[0], oneOf: entry };
  if (entry && Array.isArray(entry.oneOf)) return { type: 'string', fallback: entry.value ?? null, oneOf: entry.oneOf };
  throw new TypeError(`toolArgs: --${name} has no usable spec`);
}

export function readToolArgs(spec, argv, { positionals = false } = {}) {
  const shapes = Object.fromEntries(Object.entries(spec).map(([name, entry]) => [name, shape(name, entry)]));
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: Object.fromEntries(Object.entries(shapes).map(([name, s]) => [name, { type: s.type }])),
      strict: true,
      allowPositionals: positionals,
    });
  } catch (err) {
    throw new ToolArgsError(err.message);
  }
  const out = { _: parsed.positionals };
  for (const [name, s] of Object.entries(shapes)) {
    const given = parsed.values[name];
    if (given !== undefined && s.oneOf && !s.oneOf.includes(given)) {
      throw new ToolArgsError(`--${name} "${given}" is not one of: ${s.oneOf.join(', ')}`);
    }
    out[name] = given ?? s.fallback;
  }
  return out;
}

export function toolArgs(spec, { argv = process.argv.slice(2), positionals = false } = {}) {
  try {
    return readToolArgs(spec, argv, { positionals });
  } catch (err) {
    if (!(err instanceof ToolArgsError)) throw err;
    const tool = path.basename(process.argv[1] ?? 'tool');
    console.error(`${tool}: ${err.message}`);
    console.error(`${tool}: takes ${Object.keys(spec).map((n) => `--${n}`).join(' ') || 'no flags'}`);
    process.exit(2);
  }
}
