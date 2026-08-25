// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    aot-engine-component-address.test.ts
 * @brief   Where an ENGINE component's bytes are, for compiled code.
 *
 * @details A `defineComponent` component is a row in a pool this SDK owns, and
 *          that path is tested by the dispatch differential. An engine component
 *          is in the C++ pools, and the only thing that knows where is the
 *          backend's {@link MemoryProvider} — the same seam the fast accessors
 *          go through, because an address resolved a second way is an address
 *          that can disagree.
 *
 *          The provider is injectable, so this asks the real question without a
 *          built engine: given a backend that serves flat memory, does the world
 *          hand out the address that backend reports?
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { defineComponent, Transform } from '../src/ecs/component';
import type { AnyComponentDef } from '../src/ecs/component';
import type { ComponentHeap, MemoryProvider } from '../src/ecs/bridge/memoryProvider';
import type { CppRegistry } from '../src/wasm';
import type { Entity } from '../src/types';

/** A backend that serves one component out of one flat block. */
function providerFor(cppName: string, base: number, stride: number, live: Set<number>): MemoryProvider {
    const bytes = new ArrayBuffer(1 << 16);
    return {
        resolveComponentHeap: (name: string) => (name === cppName
            ? (entity: Entity, out: ComponentHeap): boolean => {
                const id = entity as unknown as number;
                if (!live.has(id)) return false;
                out.f32 = new Float32Array(bytes);
                out.u32 = new Uint32Array(bytes);
                out.u8 = new Uint8Array(bytes);
                out.ptr = base + id * stride;
                return true;
            }
            : null),
    };
}

/** Enough of a CppRegistry for `connect` to accept it; nothing here calls it. */
const REGISTRY = {} as unknown as CppRegistry;

describe('an engine component has an address too', () => {
    it('is the one the backend reports, not one this SDK computed', () => {
        const live = new Set([3, 7]);
        const world = new World();
        world.connectCpp(REGISTRY, undefined, {
            memory: providerFor('Transform', 4096, 64, live),
        });

        const at = (id: number): number | undefined =>
            world.addressOfComponent(Transform as unknown as AnyComponentDef, id as unknown as Entity);
        expect(at(3)).toBe(4096 + 3 * 64);
        expect(at(7)).toBe(4096 + 7 * 64);
        // Not live: a compiled system must skip the row rather than read zero,
        // which is a real address and would be somebody else's bytes.
        expect(at(4)).toBeUndefined();
    });

    it('a backend with no flat memory has no address, and says so', () => {
        const world = new World();
        // No module and no override: the native fast path is absent, and this is
        // exactly the case where a project cannot compile against Transform.
        world.connectCpp(REGISTRY);
        expect(world.addressOfComponent(Transform as unknown as AnyComponentDef, 1 as unknown as Entity))
            .toBeUndefined();
    });

    it('the resolver is not re-found per entity, and not kept across a reconnect', () => {
        let asked = 0;
        const live = new Set([1, 2]);
        const base = providerFor('Transform', 512, 32, live);
        const counting: MemoryProvider = {
            resolveComponentHeap: (name) => { asked++; return base.resolveComponentHeap(name); },
        };
        const world = new World();
        world.connectCpp(REGISTRY, undefined, { memory: counting });

        const comp = Transform as unknown as AnyComponentDef;
        for (let i = 0; i < 10; i++) world.addressOfComponent(comp, 1 as unknown as Entity);
        expect(asked, 'the generated table was walked once, not ten times').toBe(1);

        // A reconnect may serve different memory, so the cached answer must go.
        world.connectCpp(REGISTRY, undefined, { memory: counting });
        world.addressOfComponent(comp, 1 as unknown as Entity);
        expect(asked).toBe(2);
    });

    it('a script component still answers from its pool', () => {
        const world = new World();
        const Decay = defineComponent('Decay', { remaining: 1 }) as AnyComponentDef;
        const entity = world.spawn();
        world.insert(entity, Decay, { remaining: 0.5 });
        // One question, two kinds of storage: the runner asks the world, not the
        // storage, which is what lets a system name both in one query.
        expect(world.addressOfComponent(Decay, entity)).toBeTypeOf('number');
    });
});
