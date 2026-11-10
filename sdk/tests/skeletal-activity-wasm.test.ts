// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** @brief Skeletal side modules obey hierarchy activity without losing their instances. */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Disabled, Transform, SpineAnimation, DragonBonesAnimation } from '../src/ecs/component';
import { SpineManager } from '../src/spine/SpineManager';
import { SpinePlugin, SpineEvents } from '../src/spine/SpinePlugin';
import type { SpineWasmModule } from '../src/spine/SpineModuleLoader';
import { DragonBonesManager } from '../src/dragonbones/DragonBonesManager';
import { DragonBonesPlugin } from '../src/dragonbones/DragonBonesPlugin';
import { DragonBonesModuleController } from '../src/dragonbones/DragonBonesController';
import { wrapDragonBonesModule, type DragonBonesWasmModule } from '../src/dragonbones/DragonBonesModuleLoader';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import type { RenderPipeline } from '../src/render/renderPipeline';
import { HAS_WASM, hasSideModule, loadSideModule, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM || !hasSideModule('spine38') || !hasSideModule('dragonbones'))('real skeletal hierarchy activity', () => {
    let engine: ESEngineModule;
    beforeAll(async () => { engine = await loadWasmModule(); });

    it.each(['spine-authored', 'spine-native', 'dragonbones-authored', 'dragonbones-native'])('%s freezes updates and mesh extraction independently of manual enable', async (scenario) => {
        setDefaultContext(new AppContext());
        const registry = new engine.Registry() as unknown as CppRegistry;
        let submissions = 0;
        const core = Object.create(engine) as ESEngineModule;
        core.renderer_submitSkeletalBatchByEntity = () => { submissions++; };
        core.renderer_submitSkeletalBatchByEntityEx = core.renderer_submitSkeletalBatchByEntity;
        const app = App.new(); app.connectCpp(registry, core);
        const callbacks: Array<(r: { _cpp: CppRegistry }) => void> = [];
        // The cameras' pass only: the screen overlay's submits nothing in a world with no Canvas.
        app.setPipeline({ addPreFlushCallback: (cb: (r: { _cpp: CppRegistry }) => void) => callbacks.push(cb),
            addScreenOverlayCallback: () => {} } as unknown as RenderPipeline);
        const world = app.world;
        const parent = world.spawn('parent'); world.insert(parent, Transform, {});
        const child = world.spawn('skeleton'); world.insert(child, Transform, {}); world.setParent(child, parent);
        let manager: SpineManager | DragonBonesManager;
        let cleanup: () => void;
        if (scenario.startsWith('spine')) {
            const raw = await loadSideModule<SpineWasmModule>('spine38');
            manager = new SpineManager(core, new Map([['3.8', async () => raw]]));
            const plugin = new SpinePlugin(manager); plugin.build(app); cleanup = () => plugin.cleanup();
            world.insert(child, SpineAnimation, {});
            const assets = resolve(__dirname, '../benchmarks/fixtures/spine/spineboy-38');
            expect(await manager.loadEntity(child, {
                id: 'activity-spineboy', culling: { kind: 'unknown' },
                pair: { skeleton: 'spineboy.skel', atlas: 'spineboy.atlas' },
                value: {
                    skelData: new Uint8Array(readFileSync(resolve(assets, 'spineboy-pro.skel'))),
                    atlasText: readFileSync(resolve(assets, 'spineboy.atlas'), 'utf8'), isBinary: true,
                    textures: new Map([['spineboy.png', { glId: 3, w: 1024, h: 1024 }]]),
                }, retain: () => ({ release: () => {} }),
            }, registry)).toBe('3.8');
            manager.setAnimation(child, 'walk', true);
        } else {
            const raw = await loadSideModule<DragonBonesWasmModule>('dragonbones');
            manager = new DragonBonesManager(new DragonBonesModuleController(raw, wrapDragonBonesModule(raw)));
            const plugin = new DragonBonesPlugin(manager); plugin.build(app); cleanup = () => plugin.cleanup();
            world.insert(child, DragonBonesAnimation, {});
            const assets = resolve(__dirname, 'assets/dragonbones');
            const handle = manager.loadSkeleton(new Uint8Array(readFileSync(resolve(assets, 'DragonBoy_ske.json'))), readFileSync(resolve(assets, 'DragonBoy_tex.json'), 'utf8'), 'activity-dragon');
            manager.setAtlasTexture(handle, 3);
            expect(manager.addEntity(child, handle, { armature: 'Dragon', animation: 'walk', assetKey: 'activity-dragon' })).toBe(true);
        }
        try {
            const frame = async () => { await app.tick(1 / 60); for (const cb of callbacks) cb({ _cpp: registry }); };
            const enable = (on: boolean) => {
                if (scenario.endsWith('native')) registry.setEntityEnabled!(parent, on);
                else if (on) world.remove(parent, Disabled);
                else world.insert(parent, Disabled, {});
            };
            await frame(); expect(submissions).toBeGreaterThan(0);
            const frozen = manager.getBounds(child); expect(frozen).not.toBeNull();
            enable(false); expect(world.isEntityActive(child)).toBe(false);
            submissions = 0;
            for (let i = 0; i < 20; i++) await frame();
            expect(manager.getBounds(child), 'inactive hierarchy advanced the pose').toEqual(frozen);
            expect(submissions, 'inactive hierarchy extracted meshes').toBe(0);
            expect([...manager.boundEntities()]).toContain(child);
            enable(true); await frame();
            expect(submissions).toBeGreaterThan(0);
            expect(manager.getBounds(child)).not.toEqual(frozen);
            manager.setEnabled(child, false);
            const manualFrozen = manager.getBounds(child);
            enable(false); await frame(); enable(true); submissions = 0;
            for (let i = 0; i < 5; i++) await frame();
            expect(manager.getBounds(child), 'hierarchy resume overwrote manual disable').toEqual(manualFrozen);
            expect(submissions).toBe(0);
            manager.setEnabled(child, true); await frame(); expect(submissions).toBeGreaterThan(0);
            if (manager instanceof SpineManager) {
                manager.enableEvents(child); enable(false);
                manager.setAnimation(child, 'walk', true); await frame();
                expect(app.getResource(SpineEvents).events).toEqual([]);
                enable(true); await frame();
                expect(app.getResource(SpineEvents).events.some(e => e.entity === child && e.type === 'start')).toBe(true);
            }
        } finally { cleanup!(); registry.delete(); }
    });
});
