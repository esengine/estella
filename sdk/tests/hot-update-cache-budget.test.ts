// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Assets } from '../src/asset/Assets';
import { HttpBackend } from '../src/asset/Backend';
import type { AddressableManifest } from '../src/asset/AddressableManifest';
import { contentHashHex } from '../src/asset/contentHash';
import { setPlatform, platformWriteCacheFile } from '../src/platform/base';
import { nodeAdapter } from '../src/platform/node';
import type { PlatformAdapter } from '../src/platform/types';

const data = (v: number) => new Uint8Array(8).fill(v).buffer;
const root = 'https://cdn.test/game';
const url = (v: number) => `${root}/assets/${contentHashHex(new Uint8Array(data(v)))}.bin`;
const manifest = (v: number): AddressableManifest => ({ version: '2.0', revision: `v${v}`,
    groups: { cdn: { bundleMode: 'remote', labels: [], assets: { a: {
        path: url(v), type: 'json', size: 8, labels: [], contentHash: contentHashHex(new Uint8Array(data(v))),
    } } } } });
let dir: string;
let next = 2;
let offline = false;
let refuseStorage = false;
const storage = new Map<string, string>();
const oldDir = process.env.ESENGINE_CACHE_DIR;
const network = vi.fn(async (path: string) => {
    if (offline) throw Error('offline');
    const value = path.endsWith('manifest.json') ? JSON.stringify(manifest(next)) : '';
    return { ok: true, status: 200, statusText: 'OK', headers: {},
        text: async () => value, json: async () => JSON.parse(value), arrayBuffer: async () => data(next) };
});
function adapter(): PlatformAdapter {
    const p = Object.create(nodeAdapter) as PlatformAdapter;
    Object.assign(p, { fetch: network, getStorageItem: (key: string) => storage.get(key) ?? null,
        setStorageItem: (key: string, value: string) => { if (refuseStorage) throw Error('full'); storage.set(key, value); },
        removeStorageItem: (key: string) => storage.delete(key) });
    return p;
}
function assets() {
    const a = Assets.create({ module: null, backend: new HttpBackend({ baseUrl: '' }), manifest: manifest(1) });
    a.setRemoteRoot(root);
    a.restorePersistedUpdate('game:active');
    return a;
}
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'estella-hotupdate-budget-'));
    process.env.ESENGINE_CACHE_DIR = dir;
    next = 2; offline = false; refuseStorage = false; storage.clear(); network.mockClear();
    setPlatform(adapter());
});
afterEach(async () => {
    try {
        // Windows can briefly report ENOTEMPTY after the last unlink even when
        // readdir is already empty. Retry that host condition, and always reset
        // the cache path so a teardown failure cannot contaminate the next case.
        await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } finally {
        if (oldDir === undefined) delete process.env.ESENGINE_CACHE_DIR; else process.env.ESENGINE_CACHE_DIR = oldDir;
    }
});

it('applies two real updates, cleans v1, restores v3 and reads current/rollback bytes with no network', async () => {
    const a = assets();
    await platformWriteCacheFile(url(1), data(1));
    for (next of [2, 3]) {
        await a.checkForUpdate({ manifestUrl: `${root}/manifest.json` });
        expect((await a.applyUpdate()).stages).toMatchObject({ persisted: true, cached: true });
    }
    const clean = await a.cleanDiskCache(16, true);
    expect(clean.releaseBytes).toBe(8);
    expect(clean.report.versions).toEqual(expect.arrayContaining([
        expect.objectContaining({ revision: 'v3', reason: 'current', missing: 0 }),
        expect.objectContaining({ revision: 'v2', reason: 'rollback', missing: 0 }),
    ]));
    offline = true;
    setPlatform(adapter()); // Fresh coordinator, same durable bytes and active manifest.
    const restored = assets();
    expect(restored.updateStatus().revision).toBe('v3');
    network.mockClear();
    const backend = new HttpBackend({ baseUrl: '' });
    expect(await backend.fetchBinary(url(3))).toEqual(data(3));
    expect(await backend.fetchBinary(url(2))).toEqual(data(2));
    expect(network).not.toHaveBeenCalled();
    expect((await restored.cleanDiskCache(0, true)).removed).toEqual([]);
});

it('protects the active and rollback previews with their full image', async () => {
    const version = (v: number): AddressableManifest => {
        const m = manifest(1);
        m.revision = `preview-${v}`;
        m.groups.cdn.assets.a.streamTail = {
            path: url(v), size: 8, contentHash: contentHashHex(new Uint8Array(data(v))),
            width: 1, height: 1, fullWidth: 2, fullHeight: 2,
        };
        return m;
    };
    const a = Assets.create({ module: null, backend: new HttpBackend({ baseUrl: '' }), manifest: version(2) });
    a.setRemoteRoot(root);
    a.restorePersistedUpdate('game:previews');
    await platformWriteCacheFile(url(1), data(1));
    await platformWriteCacheFile(url(2), data(2));
    next = 3;
    network.mockResolvedValueOnce({
        ok: true, status: 200, statusText: 'OK', headers: {}, text: async () => JSON.stringify(version(3)),
        json: async () => version(3), arrayBuffer: async () => data(3),
    });
    await a.checkForUpdate({ manifestUrl: `${root}/manifest.json` });
    expect((await a.applyUpdate()).stages.persisted).toBe(true);
    const clean = await a.cleanDiskCache(0, true);
    expect(clean.removed).toEqual([]);
    expect(clean.report.versions).toEqual(expect.arrayContaining([
        expect.objectContaining({ revision: 'preview-3', reason: 'current', missing: 0 }),
        expect.objectContaining({ revision: 'preview-2', reason: 'rollback', missing: 0 }),
    ]));
    offline = true;
    network.mockClear();
    for (const v of [1, 2, 3]) expect(await a.backend.fetchBinary(url(v))).toEqual(data(v));
    expect(network).not.toHaveBeenCalled();
});

it('keeps the next-launch version and its rollback when two later manifest writes fail', async () => {
    const a = assets();
    await platformWriteCacheFile(url(1), data(1));
    await a.checkForUpdate({ manifestUrl: `${root}/manifest.json` });
    await a.applyUpdate();
    refuseStorage = true;
    for (next of [3, 4]) {
        await a.checkForUpdate({ manifestUrl: `${root}/manifest.json` });
        expect((await a.applyUpdate()).stages.persisted).toBe(false);
    }
    const result = await a.cleanDiskCache(0, true);
    expect(result.removed).toEqual([]);
    offline = true;
    setPlatform(adapter());
    const restored = assets();
    expect(restored.updateStatus().revision).toBe('v2');
    const backend = new HttpBackend({ baseUrl: '' });
    expect(await backend.fetchBinary(url(2))).toEqual(data(2));
    expect(await backend.fetchBinary(url(1))).toEqual(data(1));
});

it('does not misreport a committed update as failed when the final index write hits quota, and can still free old bytes', async () => {
    const p = adapter();
    let indexFull = false;
    const write = p.writeCacheFile!.bind(p);
    p.writeCacheFile = async (key, value) => { if (indexFull) throw Error('disk full'); await write(key, value); };
    p.setStorageItem = (key, value) => { storage.set(key, value); if (next === 3) indexFull = true; };
    setPlatform(p);
    const a = assets();
    await platformWriteCacheFile(url(1), data(1));
    for (next of [2, 3]) {
        await a.checkForUpdate({ manifestUrl: `${root}/manifest.json` });
        expect((await a.applyUpdate()).stages).toMatchObject({ applied: true, persisted: true, cached: true });
    }
    const clean = await a.cleanDiskCache(16, true);
    expect(clean.releaseBytes).toBe(8);
    expect(clean.indexPersisted).toBe(false);
    expect(clean.report.versions).toEqual(expect.arrayContaining([
        expect.objectContaining({ revision: 'v3', missing: 0 }), expect.objectContaining({ revision: 'v2', missing: 0 }),
    ]));
});

it('does not report packaged remote-group assets as missing offline cache files', async () => {
    const shipped = manifest(1);
    shipped.groups.cdn.assets.a.path = 'remote/cdn/a.bin';
    const a = Assets.create({ module: null, backend: new HttpBackend({ baseUrl: '' }), manifest: shipped });
    const report = await a.diskCacheReport();
    expect(report.versions).toEqual([expect.objectContaining({ revision: 'v1', reason: 'current', missing: 0 })]);
});
