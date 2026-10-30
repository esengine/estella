// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A script's MeshRenderer: its material is the engine's, a shared one is shared and an instance is this renderer's own, and a
 *        property set on either reaches the engine material.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { World } from '../../src/ecs/world';
import { MeshRenderer as EngineMeshRenderer, Transform, ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { AppContext, setDefaultContext } from '../../src/ecs/context';
import { Material as EngineMaterial } from '../../src/render/material';
import { Color, MeshRenderer, Node, UIMeshRenderer, setCurrentWorld } from '../../src/cocos';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';

describe.skipIf(!HAS_WASM)('MeshRenderer on the engine', () => {
    let module: ESEngineModule;
    let registry: InstanceType<ESEngineModule['Registry']> | undefined;
    let world: World | undefined;
    const W = (): World => world!;

    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });

    function connect(): void {
        setDefaultContext(new AppContext());
        ensureBuiltinComponentsRegistered();
        registry = new module.Registry();
        world = new World();
        world.connectCpp(registry, module);
        setCurrentWorld(world);
    }
    afterEach(() => {
        setCurrentWorld(null);
        world?.disconnectCpp();
        registry?.delete();
        registry = undefined;
        world = undefined;
    });

    const node = (name: string): Node => { const n = new Node(name); W().insert(n._entity, Transform); return n; };

    it('is the engine renderer on its node, the same view each time', () => {
        connect();
        const n = node('m');
        expect(n.getComponent(MeshRenderer)).toBeNull();
        const r = n.addComponent(MeshRenderer)!;
        expect(W().has(n._entity, EngineMeshRenderer)).toBe(true);
        expect(n.getComponent(MeshRenderer)).toBe(r);
        expect(n.getComponent('cc.MeshRenderer')).toBe(r);
        r.enabled = false;
        expect(W().get(n._entity, EngineMeshRenderer).enabled).toBe(false);
    });

    it('shares a material until an instance is asked for, then has one of its own', () => {
        connect();
        const shared = EngineMaterial.create({ shader: 7, uniforms: { u_tint: { x: 1, y: 1, z: 1, w: 1 } } });
        const a = node('a'), b = node('b');
        for (const n of [a, b]) { n.addComponent(MeshRenderer); W().set(n._entity, EngineMeshRenderer, { ...W().get(n._entity, EngineMeshRenderer), material: shared }); }
        const ra = a.getComponent(MeshRenderer)!, rb = b.getComponent(MeshRenderer)!;

        expect(ra.getSharedMaterial(0)).toBe(rb.getSharedMaterial(0));
        expect(ra.material!._handle).toBe(shared);

        const mine = ra.getMaterialInstance(0)!;
        expect(mine._handle).not.toBe(shared);
        expect(W().get(a._entity, EngineMeshRenderer).material).toBe(mine._handle);
        expect(ra.getMaterialInstance(0)).toBe(mine);            // made once
        expect(ra.getSharedMaterial(0)!._handle).toBe(shared);    // the shared one is still the shared one
        expect(rb.material!._handle).toBe(shared);                // and the other renderer is untouched
    });

    it('writes a property through to the engine material, colours in 0..1, and remembers it', () => {
        connect();
        const shared = EngineMaterial.create({ shader: 7, uniforms: { u_tint: { x: 1, y: 1, z: 1, w: 1 }, u_level: 0 } });
        const n = node('p');
        const r = n.addComponent(MeshRenderer)!;
        W().set(n._entity, EngineMeshRenderer, { ...W().get(n._entity, EngineMeshRenderer), material: shared });
        const m = r.getMaterialInstance(0)!;
        m.setProperty('u_level', 0.5);
        m.setProperty('u_tint', new Color(255, 0, 128, 255));
        expect(EngineMaterial.getUniform(m._handle, 'u_level')).toBe(0.5);
        const tint = EngineMaterial.getUniform(m._handle, 'u_tint') as { x: number; y: number; z: number; w: number };
        expect([tint.x, tint.y, tint.z, tint.w].map((v) => Math.round(v * 100) / 100)).toEqual([1, 0, 0.5, 1]);
        expect(m.getProperty('u_level')).toBe(0.5);
        expect(EngineMaterial.getUniform(shared, 'u_level')).toBe(0);   // the shared one did not change
    });

    it('lets UIMeshRenderer be added without anything behind it', () => {
        connect();
        const n = node('ui');
        expect(n.addComponent(UIMeshRenderer)).toBeInstanceOf(UIMeshRenderer);
    });
});
