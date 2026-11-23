// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { corePlugin } from '../src/app/corePlugin';
import { Physics2D } from '../src/physics/Physics2D';
import { setupPhysics2DDebugDraw } from '../src/physics/Physics2DDebugDraw';
import { Physics2DPlugin, Physics2DEvents } from '../src/physics/Physics2DPlugin';
import { Physics2DRuntime } from '../src/physics/Physics2DRuntime';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';
import { setupPhysics3DDebugDraw } from '../src/physics3d/Physics3DDebugDraw';
import { Physics3DPlugin, Physics3DRuntime } from '../src/physics3d/Physics3DPlugin';
import type { Physics3DWasmModule } from '../src/physics3d/Physics3DModule';
import { clearDrawCallbacks, getDrawCallbacks, registerDrawCallback } from '../src/render/customDraw';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, hasSideModule, loadSideModule, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('physics debug overlays in simultaneous previews', () => {
    let engine: ESEngineModule;
    const apps: App[] = [];
    beforeAll(async () => { engine = await loadWasmModule(); });
    afterEach(() => {
        for (const app of apps.splice(0)) app.quit();
        clearDrawCallbacks();
    });
    function preview() {
        const app = App.new();
        apps.push(app);
        return app;
    }
    function owners() { return [...getDrawCallbacks().values()].map(entry => entry.registry); }

    it('follows a registry connected after setup and only releases the installation being replaced', () => {
        const a = preview(), b = preview();
        const old = setupPhysics2DDebugDraw(a, Physics2D, Physics2DEvents);
        setupPhysics2DDebugDraw(b, Physics2D, Physics2DEvents);
        setupPhysics3DDebugDraw(a, () => []);
        setupPhysics3DDebugDraw(b, () => []);
        const first = new engine.Registry(), second = new engine.Registry();
        a.connectCpp(first, engine, { ownedRegistry: true });
        b.connectCpp(second, engine, { ownedRegistry: true });
        expect(owners().filter(registry => registry === first)).toHaveLength(2);
        expect(owners().filter(registry => registry === second)).toHaveLength(2);

        setupPhysics2DDebugDraw(a, Physics2D, Physics2DEvents);
        old();
        expect(owners()).toHaveLength(4);
        expect(owners().filter(registry => registry === first)).toHaveLength(2);
        registerDrawCallback('game-overlay', () => {});
        corePlugin.cleanup?.(a);
        expect(owners()).toHaveLength(2);
        expect(owners().every(registry => registry === second)).toBe(true);
    });

    it.skipIf(!hasSideModule('physics') || !hasSideModule('physics3d'))('withdraws both solver overlays when their app quits', async () => {
        const a = preview(), b = preview();
        const box2d = new Physics2DPlugin('', {}, () => loadSideModule<PhysicsWasmModule>('physics'));
        const jolt = new Physics3DPlugin('', {}, () => loadSideModule<Physics3DWasmModule>('physics3d'));
        for (const app of [a, b]) {
            app.connectCpp(new engine.Registry(), engine, { ownedRegistry: true });
            app.addPlugin(box2d).addPlugin(jolt);
            await Promise.all([app.getResource(Physics2DRuntime).initPromise, app.getResource(Physics3DRuntime).initPromise]);
        }
        expect(owners()).toHaveLength(4);
        a.quit();
        expect(owners()).toHaveLength(2);
        expect(owners().every(registry => registry === b.world.getCppRegistry())).toBe(true);
        b.quit();
        expect(owners()).toEqual([]);
    });
});
