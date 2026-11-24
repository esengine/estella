// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CFLAGS } from '../../../compiler/src/codegen';
import { AOT_MANIFEST } from './aotArtifacts';
import { runSystemCompiler } from './emccPath';

const CACHE = '.esengine/cache/aot';
const BUILDS = 'builds';
const CURRENT = 'current';

export function cachedManifestPath(root: string): string {
  const cache = path.resolve(root, CACHE);
  const current = path.join(cache, CURRENT);
  if (!existsSync(current)) return path.join(cache, AOT_MANIFEST);
  const key = readFileSync(current, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error(`Invalid compiled systems cache entry in ${current}`);
  return path.join(cache, BUILDS, key, AOT_MANIFEST);
}

export interface CompiledLinkJob {
  id: string;
  cc: string;
  flags: readonly string[];
  module: string;
  /** Cross-compiled libraries keep their ABI directory. */
  directory?: string;
}

function moduleFile({ module, directory }: CompiledLinkJob): string {
  const parts = directory === undefined ? [module] : [directory, module];
  const names = parts.map(part => path.posix.normalize(part.replaceAll('\\', '/')));
  if (names.some(name => name === '.' || name === '..' || name.startsWith('../') || path.win32.parse(name).root)) {
    throw new Error(`Invalid compiled module path: ${parts.join('/')}`);
  }
  return names.join('/');
}

/** The ABI can stay the same across a body edit. Identify the set by every published name and byte. */
function publishArtifactSet(work: string, builds: string, files: string[]): string {
  const ready = path.join(work, '.publish');
  const hash = createHash('sha256');
  for (const name of files.sort()) {
    const source = path.join(work, name);
    const dest = path.join(ready, name);
    mkdirSync(path.dirname(dest), { recursive: true });
    const digest = createHash('sha256').update(readFileSync(source)).digest('hex');
    hash.update(JSON.stringify([name, digest]) + '\n');
    renameSync(source, dest);
  }
  const key = hash.digest('hex');
  try {
    renameSync(ready, path.join(builds, key));
  } catch (err) {
    // Concurrent identical builds can reuse the directory the first publisher renamed into place.
    if (!existsSync(path.join(builds, key, AOT_MANIFEST))) throw err;
  }
  return key;
}

/** Link in private and keep the complete set available while any exporter may still be copying it. */
export async function linkCompiledModules(
  root: string, sources: Readonly<Record<string, string>>, manifest: string,
  jobs: readonly CompiledLinkJob[], run = runSystemCompiler,
): Promise<Record<string, string>> {
  const cache = path.resolve(root, CACHE);
  const builds = path.join(cache, BUILDS);
  const outputs = jobs.map(moduleFile);
  const files = [...Object.keys(sources), AOT_MANIFEST, ...outputs];
  if (new Set(files).size !== files.length || new Set(jobs.map(job => job.id)).size !== jobs.length) {
    throw new Error('Duplicate compiled module name or output path');
  }
  mkdirSync(builds, { recursive: true });
  const work = mkdtempSync(path.join(cache, '.build-'));
  let key: string;
  try {
    for (const [name, contents] of Object.entries(sources)) writeFileSync(path.join(work, name), contents);
    const units = Object.keys(sources).filter(name => name.endsWith('.c'));
    for (const [index, job] of jobs.entries()) {
      const file = outputs[index]!;
      const out = path.join(work, file);
      mkdirSync(path.dirname(out), { recursive: true });
      if (existsSync(out)) throw new Error(`Compiled output path already exists: ${file}`);
      const linked = await run(job.cc, [...CFLAGS, '-Wall', '-Wextra', ...job.flags, '-o', file, ...units], work);
      if (linked.code !== 0 || !existsSync(out)) {
        throw new Error(`${job.id}: ${linked.stderr.trim() || `linker exited with code ${linked.code} without a usable module`}`);
      }
    }
    writeFileSync(path.join(work, AOT_MANIFEST), manifest);
    key = publishArtifactSet(work, builds, files);
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
  const next = path.join(cache, `.current-${randomUUID()}`);
  try {
    writeFileSync(next, key + '\n');
    renameSync(next, path.join(cache, CURRENT));
  } catch (err) {
    rmSync(next, { force: true });
    throw err;
  }
  return Object.fromEntries(jobs.map(({ id }, i) => [id, path.join(builds, key, outputs[i]!)]));
}
