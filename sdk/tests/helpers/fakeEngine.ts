// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    fakeEngine.ts
 * @brief   The C++ side of a World, modelled rather than stubbed.
 *
 * @details Component storage that add/get/has/remove really move, and a parent
 *          link both halves of which stay consistent — because the behaviour
 *          under test is what happens to entities and their children, and a
 *          stub that answers "no children" makes every subtree question pass.
 */
import { World } from '../../src/ecs/world';
import { COMPONENT_META } from '../../src/ecs/component.generated';
import type { CppRegistry } from '../../src/wasm';

/** What embind hands back for a `std::vector<Entity>`; the caller frees it. */
function entityVector(entities: number[]) {
    return { size: () => entities.length, get: (i: number) => entities[i], delete: () => {} };
}

export function connectFakeCpp(world: World): void {
    let nextEntity = 1;
    const parentOf = new Map<number, number>();
    const childrenOf = new Map<number, Set<number>>();
    const rows = new Map<string, Map<number, Record<string, unknown>>>();

    const unlink = (child: number): void => {
        const parent = parentOf.get(child);
        if (parent === undefined) return;
        parentOf.delete(child);
        childrenOf.get(parent)?.delete(child);
    };

    const registry: Record<string, unknown> = {};
    for (const name of Object.keys(COMPONENT_META)) {
        const store = new Map<number, Record<string, unknown>>();
        rows.set(name, store);
        registry[`add${name}`] = (e: number, data: Record<string, unknown>) => { store.set(e, { ...data }); };
        registry[`get${name}`] = (e: number) => store.get(e);
        registry[`has${name}`] = (e: number) => store.has(e);
        registry[`remove${name}`] = (e: number) => { store.delete(e); };
    }
    // AFTER the generic pass: Parent and Children are not rows, they are two
    // halves of one link, and the accessors named for them answer from it.
    Object.assign(registry, {
        create: () => nextEntity++,
        destroy: (e: number) => {
            unlink(e);
            childrenOf.delete(e);
            for (const store of rows.values()) store.delete(e);
        },
        hasParent: (e: number) => parentOf.has(e),
        getParent: (e: number) => ({ entity: parentOf.get(e) ?? 0 }),
        setParent: (child: number, parent: number) => {
            unlink(child);
            if (!parent) return;
            parentOf.set(child, parent);
            let set = childrenOf.get(parent);
            if (!set) { set = new Set(); childrenOf.set(parent, set); }
            set.add(child);
        },
        removeParent: (e: number) => { unlink(e); },
        addParent: (e: number, data: { entity?: number }) => {
            if (data?.entity) (registry.setParent as (c: number, p: number) => void)(e, data.entity);
        },
        hasChildren: (e: number) => (childrenOf.get(e)?.size ?? 0) > 0,
        getChildren: (e: number) => ({ entities: entityVector([...(childrenOf.get(e) ?? [])]) }),
        addChildren: (e: number, data: { entities?: number[] }) => {
            for (const child of data?.entities ?? []) {
                (registry.setParent as (c: number, p: number) => void)(child, e);
            }
        },
        removeChildren: (e: number) => {
            for (const child of [...(childrenOf.get(e) ?? [])]) unlink(child);
        },
    });
    world.connectCpp(registry as unknown as CppRegistry);
}
