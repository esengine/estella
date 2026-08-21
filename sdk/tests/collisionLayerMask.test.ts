// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

// The project's layer table decides what a collider may touch, and arrives from
// settings at whatever length the project saved. What a collider on a layer past
// its end gets is the contract here.
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { createMockModule } from './mocks/wasm';
import { BoxCollider } from '../src/physics/PhysicsComponents';
import { addShapeForEntity } from '../src/physics/PhysicsSystem';
import type { PhysicsWasmModule } from '../src/physics/PhysicsModuleLoader';

function testWorld(): World {
    const mod = createMockModule();
    const world = new World();
    world.connectCpp(mod.getRegistry(), mod);
    return world;
}

/** Records the (category, mask) a box shape was attached with. */
function maskRecorder(): { filters: Array<[number, number]>; module: PhysicsWasmModule } {
    const filters: Array<[number, number]> = [];
    const module = {
        _malloc: () => 0,
        _free: () => {},
        HEAPF32: new Float32Array(64),
        _physics_addBoxShape: (...args: number[]) => {
            filters.push([args[10], args[11]]);
        },
    } as unknown as PhysicsWasmModule;
    return { filters, module };
}

function boxOnLayer(layer: number, maskBits: number, layerMasks?: number[]) {
    const world = testWorld();
    const { filters, module } = maskRecorder();
    const e = world.spawn();
    world.insert(e, BoxCollider, { categoryBits: 1 << layer, maskBits } as never);
    addShapeForEntity(world, module, e, layerMasks);
    return filters[0];
}

describe('collision layer masks', () => {
    it('takes the layer table over the collider when the table names the layer', () => {
        expect(boxOnLayer(2, 0xFFFF, [0x0001, 0x0002, 0x0004, 0x0008])).toEqual([1 << 2, 0x0004]);
    });

    it('keeps the collider\'s own mask when no table is configured', () => {
        expect(boxOnLayer(2, 0x00F0)).toEqual([1 << 2, 0x00F0]);
    });

    // A table of four says nothing about layer five, and reading past its end
    // yields undefined — which reaches wasm as a filter matching nothing, so the
    // collider silently stops colliding with no error anywhere.
    it('keeps the collider\'s own mask for a layer the table does not reach', () => {
        expect(boxOnLayer(5, 0x00F0, [0x0001, 0x0002, 0x0004, 0x0008])).toEqual([1 << 5, 0x00F0]);
    });

    it('keeps the collider\'s own mask when the table is empty', () => {
        expect(boxOnLayer(0, 0x00F0, [])).toEqual([1 << 0, 0x00F0]);
    });
});
