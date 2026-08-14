// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Contributed importers: what runs, for which file, and what a failing one
 *        costs the rest.
 *
 * An importer is the one contribution the editor calls on its own — the others
 * wait for a click. So the claims that matter are about the CALL: it reaches
 * exactly the importers that claim the extension, a throw or a rejection is
 * reported against its plugin rather than escaping into the watcher, and a
 * retracted importer stops being called.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildPluginContext } from '@/plugins/context';
import { hasImporter, runImporters } from '@/plugins/importers';
import type { PluginManifest } from '@/plugins/manifest';

const MANIFEST: PluginManifest = {
  id: 'acme.tools',
  name: 'Acme Tools',
  version: '1.0.0',
  main: { editor: 'src/editor.ts' },
};

let built: ReturnType<typeof buildPluginContext> | null = null;
let failures: string[] = [];

/** PluginHost's policy, as far as a contribution can tell: a throw is recorded
 *  and the caller gets the fallback. */
const guard = <T,>(what: string, fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch (e) {
    failures.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    return fallback;
  }
};

const build = () => {
  failures = [];
  built = buildPluginContext(MANIFEST, '/tmp/acme.tools', 'plugin:acme.tools', guard);
  return built;
};

afterEach(() => {
  built?.dispose();
  built = null;
});

describe('a contributed importer', () => {
  it('is called for the extensions it claims, and for nothing else', () => {
    const seen: string[] = [];
    const { ctx } = build();
    ctx.assets.registerImporter({ id: 'ldtk', extensions: ['ldtk'], import: (p) => void seen.push(p) });

    expect(hasImporter('levels/world.ldtk')).toBe(true);
    expect(hasImporter('levels/world.tmj')).toBe(false);
    expect(hasImporter('levels/ldtk')).toBe(false); // an extensionless file named like one
  });

  it('matches the extension whatever it is spelled like on disk', async () => {
    const seen: string[] = [];
    const { ctx } = build();
    ctx.assets.registerImporter({ id: 'ldtk', extensions: ['LDtk'], import: (p) => void seen.push(p) });
    await runImporters(['levels/World.LDTK']);
    expect(seen).toEqual(['levels/World.LDTK']);
  });

  it('runs every importer that claims the file', async () => {
    const seen: string[] = [];
    const { ctx } = build();
    ctx.assets.registerImporter({ id: 'a', extensions: ['ldtk'], import: () => void seen.push('a') });
    ctx.assets.registerImporter({ id: 'b', extensions: ['ldtk'], import: () => void seen.push('b') });
    await runImporters(['w.ldtk']);
    expect(seen).toEqual(['a', 'b']);
  });

  it('reports a failure against its plugin and still runs the others', async () => {
    const seen: string[] = [];
    const { ctx } = build();
    ctx.assets.registerImporter({ id: 'boom', extensions: ['ldtk'], import: () => { throw new Error('bad json'); } });
    ctx.assets.registerImporter({ id: 'ok', extensions: ['ldtk'], import: () => void seen.push('ok') });
    await runImporters(['w.ldtk']);
    expect(failures.join(' ')).toMatch(/import w\.ldtk: bad json/);
    expect(seen).toEqual(['ok']);
  });

  it('reports a REJECTION the same way — an importer is allowed to be async', async () => {
    const { ctx } = build();
    ctx.assets.registerImporter({
      id: 'boom',
      extensions: ['ldtk'],
      import: () => Promise.reject(new Error('write failed')),
    });
    await runImporters(['w.ldtk']);
    expect(failures.join(' ')).toMatch(/write failed/);
  });

  it('waits for an async import before the next change re-enters it', async () => {
    // An import writes, and those writes come back through the watcher. Re-entering
    // while the first run is still writing would convert half-written output.
    let running = 0;
    let overlapped = false;
    let release = () => {};
    const { ctx } = build();
    ctx.assets.registerImporter({
      id: 'slow',
      extensions: ['ldtk'],
      import: async () => {
        if (running > 0) overlapped = true;
        running++;
        await new Promise<void>((r) => { release = r; });
        running--;
      },
    });
    const first = runImporters(['w.ldtk']);
    const second = runImporters(['w.ldtk']); // the same file changed again
    release();
    await Promise.all([first, second]);
    expect(overlapped).toBe(false);
  });

  it('stops being called once it is retracted', async () => {
    const seen: string[] = [];
    const { ctx } = build();
    const handle = ctx.assets.registerImporter({ id: 'ldtk', extensions: ['ldtk'], import: () => void seen.push('ran') });
    await runImporters(['w.ldtk']);
    handle.dispose();
    await runImporters(['w.ldtk']);
    expect(seen).toEqual(['ran']);
    expect(hasImporter('w.ldtk')).toBe(false);
  });

  it('reimport through the API is the same call the editor makes', async () => {
    const seen: string[] = [];
    const { ctx } = build();
    ctx.assets.registerImporter({ id: 'ldtk', extensions: ['ldtk'], import: (p) => void seen.push(p) });
    await ctx.assets.reimport('levels/w.ldtk');
    expect(seen).toEqual(['levels/w.ldtk']);
  });
});
