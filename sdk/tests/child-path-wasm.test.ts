// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { World } from '../src/ecs/world';
import { Children, Name, Parent, Sprite, Transform } from '../src/ecs/component';
import { resolveChildEntity } from '../src/ecs/childPath';
import { sampleTimelineInWorld } from '../src/timeline/TimelineEvaluator';
import { InterpType, TrackType, WrapMode, type TimelineAsset } from '../src/timeline/TimelineTypes';
import type { Entity } from '../src/types';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('named child paths through real WASM', () => {
    let engine: ESEngineModule;
    beforeAll(async () => { engine = await loadWasmModule(); });

    function realm() {
        const registry = new engine.Registry() as unknown as CppRegistry;
        const world = new World();
        world.connectCpp(registry, engine);
        const node = (name: string, parent?: Entity) => {
            const entity = world.spawn();
            world.insert(entity, Name, { value: name });
            world.insert(entity, Transform);
            if (parent !== undefined) world.setParent(entity, parent);
            return entity;
        };
        const dispose = () => {
            for (const entity of [...world.getAllEntities()]) if (world.valid(entity)) world.despawn(entity);
            world.disconnectCpp();
            (registry as unknown as { delete(): void }).delete();
        };
        return { world, registry, node, dispose };
    }

    it('keeps root, missing segments and first matching sibling semantics', () => {
        const { world, node, dispose } = realm();
        try {
            const root = node('Root'), first = node('Arm', root);
            node('Arm', root);
            const leaf = node('__proto__', first);
            expect(resolveChildEntity(world, root, '')).toBe(root);
            expect(resolveChildEntity(world, root, 'Arm')).toBe(first);
            expect(resolveChildEntity(world, root, 'Arm/__proto__')).toBe(leaf);
            expect(resolveChildEntity(world, root, 'Arm/Missing')).toBeNull();
            expect(resolveChildEntity(world, root, 'Missing/Arm')).toBeNull();
        } finally { dispose(); }
    });

    it('reuses shared parents without native reads when only transforms change', () => {
        const { world, node, dispose } = realm();
        try {
            const root = node('Root'), spine = node('Spine', root);
            const head = node('Head', spine), arm = node('Arm', spine);
            const reads = vi.spyOn(world, 'tryGet');
            expect(resolveChildEntity(world, root, 'Spine/Head')).toBe(head);
            const initialReads = reads.mock.calls.length;
            for (let i = 0; i < 20; i++) {
                world.set(head, Transform, { ...world.get(head, Transform), position: { x: i, y: 0, z: 0 } });
                expect(resolveChildEntity(world, root, 'Spine/Arm')).toBe(arm);
                expect(resolveChildEntity(world, spine, 'Head')).toBe(head);
                expect(resolveChildEntity(world, root, 'Spine/Missing')).toBeNull();
            }
            expect(reads.mock.calls.length).toBe(initialReads);
            reads.mockRestore();
        } finally { dispose(); }
    });

    it('sees rename, removal and re-addition within one world tick', () => {
        const { world, node, dispose } = realm();
        try {
            const root = node('Root'), child = node('Old', root);
            const tick = world.getWorldTick();
            expect(resolveChildEntity(world, root, 'Old')).toBe(child);
            expect(resolveChildEntity(world, root, 'New')).toBeNull();
            world.set(child, Name, { value: 'New' });
            expect(resolveChildEntity(world, root, 'Old')).toBeNull();
            expect(resolveChildEntity(world, root, 'New')).toBe(child);
            world.remove(child, Name);
            expect(resolveChildEntity(world, root, 'New')).toBeNull();
            world.insert(child, Name, { value: 'New' });
            expect(resolveChildEntity(world, root, 'New')).toBe(child);
            expect(world.getWorldTick()).toBe(tick);
        } finally { dispose(); }
    });

    it('sees newly attached children after an earlier miss', () => {
        const { world, node, dispose } = realm();
        try {
            const root = node('Root');
            expect(resolveChildEntity(world, root, 'New')).toBeNull();
            const child = node('New', root);
            expect(resolveChildEntity(world, root, 'New')).toBe(child);
            expect(resolveChildEntity(world, root, 'New/Leaf')).toBeNull();
            const leaf = node('Leaf', child);
            expect(resolveChildEntity(world, root, 'New/Leaf')).toBe(leaf);
        } finally { dispose(); }
    });

    it('follows reparenting and detachment without waiting for another frame', () => {
        const { world, node, dispose } = realm();
        try {
            const a = node('A'), b = node('B'), child = node('Child', a);
            expect(resolveChildEntity(world, a, 'Child')).toBe(child);
            expect(resolveChildEntity(world, b, 'Child')).toBeNull();
            world.setParent(child, b);
            expect(resolveChildEntity(world, a, 'Child')).toBeNull();
            expect(resolveChildEntity(world, b, 'Child')).toBe(child);
            world.remove(child, Parent);
            expect(resolveChildEntity(world, b, 'Child')).toBeNull();
            world.setParent(child, a);
            expect(resolveChildEntity(world, a, 'Child')).toBe(child);
        } finally { dispose(); }
    });

    it('follows writes through Children and preserves first matching siblings', () => {
        const { world, node, dispose } = realm();
        try {
            const root = node('Root'), first = node('Same', root), second = node('Same');
            expect(resolveChildEntity(world, root, 'Same')).toBe(first);
            world.set(root, Children, { entities: [second] });
            expect(resolveChildEntity(world, root, 'Same')).toBe(first);
            world.removeParent(first);
            expect(resolveChildEntity(world, root, 'Same')).toBe(second);
            world.remove(root, Children);
            expect(resolveChildEntity(world, root, 'Same')).toBeNull();
        } finally { dispose(); }
    });

    it('never returns a destroyed descendant after its replacement is spawned', () => {
        const { world, node, dispose } = realm();
        try {
            const root = node('Root'), old = node('Child', root);
            expect(resolveChildEntity(world, root, 'Child')).toBe(old);
            world.despawn(old);
            expect(resolveChildEntity(world, root, 'Child')).toBeNull();
            const replacement = node('Child', root);
            expect(replacement).not.toBe(old);
            expect(resolveChildEntity(world, root, 'Child')).toBe(replacement);
        } finally { dispose(); }
    });

    it('isolates worlds with identical entity ids', () => {
        const a = realm(), b = realm();
        try {
            const rootA = a.node('Root'), rootB = b.node('Root');
            const childA = a.node('Left', rootA), childB = b.node('Right', rootB);
            expect(rootA).toBe(rootB);
            expect(childA).toBe(childB);
            expect(resolveChildEntity(a.world, rootA, 'Left')).toBe(childA);
            expect(resolveChildEntity(b.world, rootB, 'Left')).toBeNull();
            expect(resolveChildEntity(b.world, rootB, 'Right')).toBe(childB);
        } finally { a.dispose(); b.dispose(); }
    });

    it('drops native indices when a world disconnects or changes core', () => {
        const a = realm(), b = realm();
        try {
            const root = a.node('Root'), child = a.node('Old', root);
            const otherRoot = b.node('Root'), otherChild = b.node('New');
            expect(root).toBe(otherRoot);
            expect(child).toBe(otherChild);
            expect(resolveChildEntity(a.world, root, 'Old')).toBe(child);
            a.world.disconnectCpp();
            expect(resolveChildEntity(a.world, root, 'Old')).toBeNull();
            a.world.connectCpp(b.registry, engine);
            expect(resolveChildEntity(a.world, root, 'Old')).toBeNull();
            a.world.setParent(otherChild, root);
            expect(resolveChildEntity(a.world, root, 'Old')).toBe(otherChild);
        } finally {
            a.world.connectCpp(a.registry, engine);
            a.dispose(); b.dispose();
        }
    });

    it('keeps minimal preview worlds live without a mutation revision API', () => {
        const { world, node, dispose } = realm();
        try {
            const root = node('Root'), child = node('Old', root);
            const preview = { tryGet: world.tryGet.bind(world) };
            expect(resolveChildEntity(preview, root, 'Old')).toBe(child);
            world.set(child, Name, { value: 'New' });
            expect(resolveChildEntity(preview, root, 'Old')).toBeNull();
            expect(resolveChildEntity(preview, root, 'New')).toBe(child);
        } finally { dispose(); }
    });

    it.each(['2D sprite', '3D joint'])('samples %s timelines after replacing a named target', (kind) => {
        const { world, node, dispose } = realm();
        try {
            const root = node('Root'), group = node('Group', root), original = node('Target', group);
            const component = kind === '2D sprite' ? Sprite : Transform;
            const property = kind === '2D sprite' ? 'color.a' : 'position.x';
            if (component === Sprite) world.insert(original, Sprite);
            const asset: TimelineAsset = {
                version: '1.1', type: 'timeline', duration: 1, wrapMode: WrapMode.Once,
                tracks: [{ type: TrackType.Property, name: 'Move', childPath: 'Group/Target',
                    component: component._name, channels: [{ property, keyframes: [
                        { time: 0, value: 0, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear },
                        { time: 1, value: 1, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear },
                    ] }] }],
            };
            const value = (entity: Entity) => kind === '2D sprite'
                ? world.get(entity, Sprite).color.a : world.get(entity, Transform).position.x;
            sampleTimelineInWorld(asset, 0.25, world, root);
            expect(value(original)).toBeCloseTo(0.25);
            world.set(original, Name, { value: 'Detached' });
            const replacement = node('Target', group);
            if (component === Sprite) world.insert(replacement, Sprite);
            sampleTimelineInWorld(asset, 0.75, world, root);
            expect(value(original)).toBeCloseTo(0.25);
            expect(value(replacement)).toBeCloseTo(0.75);
        } finally { dispose(); }
    });
});
