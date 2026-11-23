// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it, vi } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { HttpBackend } from '../src/asset/Backend';
import { builtinMeshTemplate } from '../src/asset/builtinMeshes';
import { MeshAssetLoader } from '../src/asset/loaders/MeshAssetLoader';
import type { MeshResult } from '../src/asset/loaders/MeshAssetLoader';
import type { CppResourceManager } from '../src/wasm';
import { initResourceManager, shutdownResourceManager } from '../src/wasm/resourceManager';

afterEach(() => { shutdownResourceManager(); vi.restoreAllMocks(); });

function realm(baseUrl: string) {
    const assets = Assets.create({ module: null, backend: new HttpBackend({ baseUrl }) });
    return { assets, loader: assets.getLoader('mesh') as MeshAssetLoader };
}

it('rebuilds files and runtime geometry from their owner when another loader drives recovery', async () => {
    const owed = [11, 12, 13];
    initResourceManager({ meshesAwaitingRemat: () => owed.join(',') } as CppResourceManager);
    const a = realm('/a'), b = realm('/b'), driver = realm('/driver');
    const mesh = builtinMeshTemplate('builtin:cube')!.build();
    vi.spyOn(a.loader, 'load').mockResolvedValue({ handle: 11 });
    vi.spyOn(b.loader, 'load').mockResolvedValue({ handle: 12 });
    const aRead = vi.spyOn(a.loader, 'readSource').mockResolvedValue(mesh);
    const bRead = vi.spyOn(b.loader, 'readSource').mockResolvedValue(mesh);
    const aUpload = vi.spyOn(a.loader, 'uploadData').mockImplementation((_mesh, target) => target || 13);
    const bUpload = vi.spyOn(b.loader, 'uploadData').mockImplementation((_mesh, target) => target || 0);
    const first = await a.assets.acquireTyped<MeshResult>('mesh', 'shared.esmesh');
    const second = await b.assets.acquireTyped<MeshResult>('mesh', 'shared.esmesh');
    const built = a.assets.createMesh(mesh);
    expect(built).toBe(13);
    try {
        expect(await driver.assets.rematerializeMeshesAfterDeviceLoss()).toBe(3);
        expect(aRead.mock.calls.map(([path,ctx]) => ctx.backend.resolveUrl(path))).toEqual(['/a/shared.esmesh']);
        expect(bRead.mock.calls.map(([path,ctx]) => ctx.backend.resolveUrl(path))).toEqual(['/b/shared.esmesh']);
        expect(aUpload).toHaveBeenCalledWith(mesh, first.value.handle);
        expect(bUpload).toHaveBeenCalledWith(mesh, second.value.handle);
        expect(aUpload).toHaveBeenCalledWith(mesh, built);
        first.release();
        a.assets.releaseBuiltMesh(built);
        b.assets.releaseAll();
        expect(await driver.assets.rematerializeMeshesAfterDeviceLoss()).toBe(0);
        expect(aRead).toHaveBeenCalledTimes(1);
        expect(bRead).toHaveBeenCalledTimes(1);
    } finally { a.assets.releaseAll(); b.assets.releaseAll(); driver.assets.releaseAll(); }
});

it.each(['release', 'invalidate', 'teardown'])('discards a pending mesh replay after %s', async change => {
    initResourceManager({ meshesAwaitingRemat: () => '7' } as CppResourceManager);
    const a = realm('/a'), driver = realm('/driver');
    const mesh = builtinMeshTemplate('builtin:cube')!.build();
    vi.spyOn(a.loader, 'load').mockResolvedValue({ handle: 7 });
    const lease = await a.assets.acquireTyped('mesh', 'held.esmesh');
    let resume!: (value: typeof mesh) => void;
    const pending = new Promise<typeof mesh>(resolve => { resume = resolve; });
    const read = vi.spyOn(a.loader, 'readSource').mockReturnValue(pending);
    const upload = vi.spyOn(a.loader, 'uploadData');
    const recovering = driver.assets.rematerializeMeshesAfterDeviceLoss();
    const concurrent = a.assets.rematerializeMeshesAfterDeviceLoss();
    try {
        await Promise.resolve();
        expect(read).toHaveBeenCalledOnce();
        if (change === 'invalidate') a.assets.invalidate('held.esmesh');
        else if (change === 'teardown') a.assets.releaseAll();
        else lease.release();
        resume(mesh);
        expect(await Promise.all([recovering, concurrent])).toEqual([0, 0]);
        expect(upload).not.toHaveBeenCalled();
    } finally { resume(mesh); await Promise.all([recovering, concurrent]); a.assets.releaseAll(); driver.assets.releaseAll(); }
});

it('shares a reentrant restore and retries the source after a failed read', async () => {
    initResourceManager({ meshesAwaitingRemat: () => '7' } as CppResourceManager);
    const a = realm('/a'), driver = realm('/driver');
    const mesh = builtinMeshTemplate('builtin:cube')!.build();
    vi.spyOn(a.loader, 'load').mockResolvedValue({ handle: 7 });
    const lease = await a.assets.acquireTyped('mesh', 'retry.esmesh');
    let nested: Promise<number> | undefined;
    const read = vi.spyOn(a.loader, 'readSource').mockResolvedValue(mesh).mockImplementationOnce(async () => {
        nested = driver.assets.rematerializeMeshesAfterDeviceLoss();
        throw new Error('offline');
    });
    const upload = vi.spyOn(a.loader, 'uploadData').mockReturnValue(7);
    try {
        expect(await driver.assets.rematerializeMeshesAfterDeviceLoss()).toBe(0);
        expect(await nested).toBe(0);
        expect(read).toHaveBeenCalledOnce();
        expect(await driver.assets.rematerializeMeshesAfterDeviceLoss()).toBe(1);
        expect(upload).toHaveBeenCalledOnce();
    } finally { lease.release(); a.assets.releaseAll(); }
});

it('finishes releasing the other built meshes when one native release fails', async () => {
    initResourceManager({ meshesAwaitingRemat: () => '1,2' } as CppResourceManager);
    const a = realm('/a');
    const mesh = builtinMeshTemplate('builtin:cube')!.build();
    vi.spyOn(a.loader, 'uploadData').mockReturnValueOnce(1).mockReturnValueOnce(2);
    a.assets.createMesh(mesh); a.assets.createMesh(mesh);
    const release = vi.spyOn(a.loader, 'releaseData').mockImplementationOnce(() => {
        expect(() => a.assets.createMesh(mesh)).toThrow(/released/);
        throw new Error('native release');
    }).mockImplementation(() => {});
    expect(() => a.assets.releaseAll()).toThrow('native release');
    expect(release.mock.calls).toEqual([[1], [2]]);
    expect(await a.assets.rematerializeMeshesAfterDeviceLoss()).toBe(0);
});

it('keeps the same numeric handle isolated between two resource managers', async () => {
    const pool = () => ({ meshesAwaitingRemat: () => '7' }) as CppResourceManager;
    const firstPool = pool(), secondPool = pool();
    const mesh = builtinMeshTemplate('builtin:cube')!.build();
    initResourceManager(firstPool);
    const a = realm('/a');
    vi.spyOn(a.loader, 'uploadData').mockReturnValue(7);
    a.assets.createMesh(mesh);
    initResourceManager(secondPool);
    const b = realm('/b');
    const upload = vi.spyOn(b.loader, 'uploadData').mockReturnValue(7);
    b.assets.createMesh(mesh);
    a.assets.releaseAll();
    try {
        expect(await realm('/driver').assets.rematerializeMeshesAfterDeviceLoss()).toBe(1);
        expect(upload).toHaveBeenCalledWith(mesh, 7);
    } finally { b.assets.releaseAll(); }
});
