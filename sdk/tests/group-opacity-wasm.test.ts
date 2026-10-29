// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A GroupOpacity fades the entity it is on and everything under it.
 *
 * What a draw inherits is read through the same query the text renderer asks (`getUINodeAlphaInTree`), which answers with the UI tree's
 * opacity times the group opacity above the entity — so these pin the multiplication, the disabled group, and that a sibling is left alone.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { App, flushPendingRegistrations } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { GroupOpacity, Transform } from '../src/ecs/component';
import type { Entity } from '../src/types';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('GroupOpacity (WASM integration)', () => {
    let module: ESEngineModule;
    let app: App | undefined;
    let registry: InstanceType<ESEngineModule['Registry']> | undefined;

    beforeAll(async () => { module = await loadWasmModule(); });
    afterEach(() => {
        app?.world.disconnectCpp();
        registry?.delete();
        app = undefined;
        registry = undefined;
    });

    function boot(): App {
        setDefaultContext(new AppContext());
        registry = new module.Registry();
        app = App.new();
        app.connectCpp(registry, module);
        flushPendingRegistrations(app);
        return app;
    }

    const alphaOf = (e: Entity): number => (module as unknown as { getUINodeAlphaInTree(r: unknown, e: number): number }).getUINodeAlphaInTree(registry, e as number);

    function spawn(a: App, parent?: Entity, opacity?: number, enabled = true): Entity {
        const e = a.world.spawn('e');
        a.world.insert(e, Transform, {});
        if (opacity !== undefined) a.world.insert(e, GroupOpacity, { opacity, enabled });
        if (parent !== undefined) a.world.setParent(e, parent);
        return e;
    }

    it('leaves everything at full opacity while no group exists', () => {
        const a = boot();
        expect(alphaOf(spawn(a))).toBe(1);
    });

    it('fades the entity it is on and everything under it', () => {
        const a = boot();
        const panel = spawn(a, undefined, 0.5);
        const child = spawn(a, panel);
        const grandchild = spawn(a, child);
        expect(alphaOf(panel)).toBeCloseTo(0.5, 5);
        expect(alphaOf(child)).toBeCloseTo(0.5, 5);
        expect(alphaOf(grandchild)).toBeCloseTo(0.5, 5);
    });

    it('multiplies the groups above an entity, and does not touch a sibling', () => {
        const a = boot();
        const outer = spawn(a, undefined, 0.5);
        const inner = spawn(a, outer, 0.5);
        const leaf = spawn(a, inner);
        const beside = spawn(a, outer);
        const apart = spawn(a);
        expect(alphaOf(leaf)).toBeCloseTo(0.25, 5);
        expect(alphaOf(beside)).toBeCloseTo(0.5, 5);
        expect(alphaOf(apart)).toBe(1);
    });

    it('ignores a disabled group, and follows a change of opacity', () => {
        const a = boot();
        const panel = spawn(a, undefined, 0.2, false);
        const child = spawn(a, panel);
        expect(alphaOf(child)).toBe(1);
        a.world.set(panel, GroupOpacity, { opacity: 0.2, enabled: true });
        expect(alphaOf(child)).toBeCloseTo(0.2, 5);
        a.world.set(panel, GroupOpacity, { opacity: 0, enabled: true });
        expect(alphaOf(child)).toBe(0);
    });
});
