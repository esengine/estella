// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { World } from '../src/ecs/world';
import { Assets as AssetsClass } from '../src/asset/Assets';
import { AssetRefCounter } from '../src/asset/AssetRefCounter';
import { AssetPlugin, Assets } from '../src/asset/AssetPlugin';
import { bindAssetReferenceTracking } from '../src/asset/assetReferenceTracking';
import { Time } from '../src/ecs/resource';
import type { App } from '../src/app/app';
import type { SystemDef } from '../src/ecs/system';
import type { Backend } from '../src/asset/Backend';
const gpu = vi.hoisted(() => ({ status: 1 }));
vi.mock('../src/render/renderer', async importOriginal => ({
    ...await importOriginal<typeof import('../src/render/renderer')>(),
    getDeviceStatus: () => gpu.status,
}));
const makeAssets = () => AssetsClass.create({ backend: {} as Backend, module: null });
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe('current asset resource binding', () => {
    it('keeps one World callback across resource replacements and targets the active counter', () => {
        const world = new World(), first = makeAssets();
        let current = first;
        for (let i = 0; i < 100; i++) {
            current = makeAssets();
            bindAssetReferenceTracking(world, current, () => current);
            const entity = world.spawn();
            current.getRefCounter()!.addTextureRef('active.png', entity);
            world.despawn(entity);
            expect(current.getRefCounter()!.getTotalRefRows()).toBe(0);
        }
        expect(world.getStorageSizes().despawnCallbacks).toBe(1);
    });

    it('retires rows on the previous and replacement counters when the core disconnects', () => {
        const world = new World(), first = makeAssets();
        let current = first;
        bindAssetReferenceTracking(world, first, () => current);
        const entity = world.spawn();
        first.getRefCounter()!.addTextureRef('original', entity);
        current = makeAssets();
        const replacement = new AssetRefCounter();
        current.setRefCounter(replacement);
        replacement.addTextureRef('replacement', entity);
        world.disconnectCpp();
        expect([first.getRefCounter()!.getTotalRefRows(), replacement.getTotalRefRows()]).toEqual([0, 0]);
        const next = world.spawn();
        replacement.addFontRef('new', next);
        expect(replacement.getFontRefs('new', world)).toEqual([next]);
        world.despawn(next);
        expect(replacement.getTotalRefRows()).toBe(0);
    });

    function pluginHost() {
        const resources = new Map<unknown, unknown>([[Time, { unscaledDelta: 1 }]]);
        const systems: SystemDef[] = [];
        const app = { world: new World(), wasmModule: {},
            hasResource: (key: unknown) => resources.has(key),
            getResource: (key: unknown) => resources.get(key),
            insertResource: (key: unknown, value: unknown) => resources.set(key, value),
            addSystemToSchedule: (_schedule: unknown, system: SystemDef) => systems.push(system),
        } as unknown as App;
        new AssetPlugin().build(app);
        return { app, tick: () => systems[0]._fn() };
    }

    it('recovers through the replacement decoder rather than the plugin build instance', async () => {
        const { app, tick } = pluginHost();
        const old = vi.spyOn(app.getResource(Assets), 'recoverFromDeviceLoss').mockResolvedValue(true);
        const current = makeAssets(), recover = vi.spyOn(current, 'recoverFromDeviceLoss').mockResolvedValue(true);
        app.insertResource(Assets, current);
        tick(); await settle();
        expect(recover).toHaveBeenCalledTimes(1);
        expect(old).not.toHaveBeenCalled();
    });

    it('recovers the new resource when it replaces an in-flight recovery owner', async () => {
        const { app, tick } = pluginHost();
        let finish!: (whole: boolean) => void;
        vi.spyOn(app.getResource(Assets), 'recoverFromDeviceLoss')
            .mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        tick();
        const current = makeAssets(), recover = vi.spyOn(current, 'recoverFromDeviceLoss').mockResolvedValue(true);
        app.insertResource(Assets, current);
        finish(true); await settle();
        expect(recover).toHaveBeenCalledTimes(1);
    });
});
