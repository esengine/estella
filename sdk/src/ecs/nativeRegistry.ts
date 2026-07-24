// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The native component registry — the embedded-Dawn sibling of the embind-bound
// C++ Registry. It presents the exact surface BuiltinBridge.getBuiltinMethods
// consumes (add<Name> / get<Name> / has<Name> / remove<Name> per component), so
// the real SDK component API runs on the native core unchanged.
//
// It is composed, not a second marshaller: field IO reuses the generated
// ptrAccessors (the one marshalling path, proven on device) over the host's
// zero-copy es_<Component>_buffer binding; lifecycle reuses the generated
// es_<Component>_has / _remove bindings. The only shape bridge is color naming —
// embind marshals colors as {x,y,z,w}, ptrAccessors as {r,g,b,a} — handled by the
// same convertForWasm/convertFromWasm the web methods path uses, keyed off
// COMPONENT_META.colorFields.

import type { CppRegistry } from '../wasm';
import type { Entity } from '../types';
import { PTR_ACCESSORS } from './ptrAccessors.generated';
import { COMPONENT_META } from '../component.generated';
import { convertForWasm, convertFromWasm } from './BuiltinBridge';

/** A host-injected entity->ArrayBuffer accessor over one native ECS component. */
type BufferFn = (entity: number) => ArrayBuffer | null | undefined;
type HasFn = (entity: number) => boolean;
type RemoveFn = (entity: number) => void;

function views(buf: ArrayBuffer): [Float32Array, Uint32Array, Uint8Array] {
    return [new Float32Array(buf), new Uint32Array(buf), new Uint8Array(buf)];
}

/** Invoke a host-provided global by name (throws a clear error if the host did not
 *  bind it — these are part of the native registry contract, not optional). */
function hostCall(scope: Record<string, unknown>, name: string, args: unknown[]): unknown {
    const fn = scope[name];
    if (typeof fn !== 'function') {
        throw new Error(`native host binding "${name}" is missing`);
    }
    return (fn as (...a: unknown[]) => unknown)(...args);
}

/** Present a JS array as the embind VectorEntity interface World.getChildren
 *  returns (size()/get(i)/delete()), so despawn iterates it the same on both
 *  backends. Native memory is JS-owned here, so delete() is a no-op. */
function vectorEntity(arr: readonly Entity[]): { size(): number; get(i: number): Entity; delete(): void } {
    return { size: () => arr.length, get: (i: number) => arr[i], delete: () => { /* nothing to free */ } };
}

/**
 * Build the full CppRegistry over the host's native bindings — entity lifecycle +
 * hierarchy (es_createEntity / es_destroyEntity / es_setParent / …) plus, per
 * component, the generated es_<Component>_buffer / _has / _remove. `scope` holds
 * those globals (the QuickJS global object on a device; a plain object in tests).
 * Only components whose three bindings are present get component methods, so a host
 * that binds a subset still connects.
 */
export function createNativeRegistry(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): CppRegistry {
    const reg: Record<string, unknown> = {};

    // Entity lifecycle + hierarchy — the base Registry surface World drives (spawn,
    // despawn, parent/child). These are not per-component; the host binds them by
    // hand (the native siblings of the embind Registry's entity ops).
    reg.create = (): Entity => hostCall(scope, 'es_createEntity', []) as Entity;
    reg.destroy = (e: Entity): void => { hostCall(scope, 'es_destroyEntity', [e]); };
    reg.hasParent = (e: Entity): boolean => !!hostCall(scope, 'es_hasParent', [e]);
    reg.setParent = (child: Entity, parent: Entity): void => {
        hostCall(scope, 'es_setParent', [child, parent]);
    };
    reg.removeParent = (e: Entity): void => { hostCall(scope, 'es_removeParent', [e]); };
    reg.hasChildren = (e: Entity): boolean => !!hostCall(scope, 'es_hasChildren', [e]);
    reg.getChildren = (e: Entity) => ({
        entities: vectorEntity((hostCall(scope, 'es_getChildren', [e]) as Entity[] | undefined) ?? []),
    });
    reg.delete = (): void => {};

    for (const cppName of Object.keys(PTR_ACCESSORS)) {
        const accessor = PTR_ACCESSORS[cppName];
        const bufFn = scope[`es_${cppName}_buffer`] as BufferFn | undefined;   // getOrEmplace = add
        const hasFn = scope[`es_${cppName}_has`] as HasFn | undefined;
        const removeFn = scope[`es_${cppName}_remove`] as RemoveFn | undefined;
        if (typeof bufFn !== 'function' || typeof hasFn !== 'function'
            || typeof removeFn !== 'function') {
            continue;
        }
        const colorFields = (COMPONENT_META[cppName]?.colorFields ?? []) as readonly string[];

        // add: emplace (the buffer binding getOrEmplaces) + write every field. The
        // SDK hands embind-shape data ({x,y,z,w} colors); ptrAccessors want
        // {r,g,b,a}, so bridge colors back before writing.
        reg[`add${cppName}`] = (entity: Entity, data: Record<string, unknown>): void => {
            const buf = bufFn(entity);
            if (!buf) return;
            const ptrData = colorFields.length ? convertFromWasm(data, colorFields) : data;
            const [f32, u32, u8] = views(buf);
            accessor.write(f32, u32, u8, 0, ptrData);
        };

        // get: read into a fresh object (embind returns fresh, so callers may
        // retain it), then present colors in embind {x,y,z,w} shape for the SDK,
        // which converts them back. Never creates: checks has first.
        reg[`get${cppName}`] = (entity: Entity): unknown => {
            const out = accessor.create() as Record<string, unknown>;
            if (hasFn(entity)) {
                const buf = bufFn(entity);
                if (buf) {
                    const [f32, u32, u8] = views(buf);
                    accessor.fill(f32, u32, u8, 0, out);
                }
            }
            return colorFields.length ? convertForWasm(out, colorFields) : out;
        };

        reg[`has${cppName}`] = (entity: Entity): boolean => hasFn(entity);
        reg[`remove${cppName}`] = (entity: Entity): void => { removeFn(entity); };
    }

    return reg as unknown as CppRegistry;
}
