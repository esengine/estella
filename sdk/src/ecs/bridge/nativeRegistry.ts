// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The native component registry — the embedded-Dawn sibling of the embind-bound
// C++ Registry. It presents the exact surface BuiltinBridge.getBuiltinMethods
// consumes (add<Name> / get<Name> / has<Name> / remove<Name> per component), so
// the real SDK component API runs on the native core unchanged.
//
// The host exposes a zero-copy buffer only for trivially copyable components
// whose actual compiler offsets match the generated wasm32 accessors. Other
// components cross through generated C++ member getters/setters, preserving
// native string/vector ownership and layout. The color shape bridge remains —
// embind marshals colors as {x,y,z,w}, ptrAccessors as {r,g,b,a} — handled by the
// same convertForWasm/convertFromWasm the web methods path uses, keyed off
// COMPONENT_META.colorFields.

import type { CppRegistry } from '../../wasm';
import type { Entity } from '../../types';
import { PTR_ACCESSORS } from './ptrAccessors.generated';
import { REGISTRY_BINDINGS, REGISTRY_OPS, SCENE_QUERY_BINDINGS, INSPECTION_BINDINGS } from './nativeBindings';
import { COMPONENT_META } from '../component.generated';
import { convertForWasm, convertFromWasm } from './BuiltinBridge';

/** A host-injected entity->ArrayBuffer accessor over one native ECS component. */
type BufferFn = (entity: number) => ArrayBuffer | null | undefined;
type HasFn = (entity: number) => boolean;
type RemoveFn = (entity: number) => void;
/** The generated pair a list field crosses by — see COMPONENT_META.listFields. */
interface ListFieldBinding {
    field: string;
    get: (entity: number) => unknown;
    set: (entity: number, value: unknown) => void;
}

function views(buf: ArrayBuffer): [Float32Array, Uint32Array, Uint8Array] {
    // Float32Array/Uint32Array require a byteLength that is a multiple of 4, but a
    // component's native struct can be any size (Interactable is 3 bytes, UIMask 2).
    // Cover the 4-aligned prefix for the word views — every f32/u32 field is
    // naturally aligned and fits within it — and the whole buffer for the byte view.
    const words = Math.floor(buf.byteLength / 4);
    return [new Float32Array(buf, 0, words), new Uint32Array(buf, 0, words), new Uint8Array(buf)];
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

/** Optional host global — undefined (and no call) when unbound, for the queries a
 *  minimal host may not answer yet. */
function hostCallOpt(scope: Record<string, unknown>, name: string, args: unknown[]): unknown {
    const fn = scope[name];
    if (typeof fn !== 'function') return undefined;
    return (fn as (...a: unknown[]) => unknown)(...args);
}

/** Present a JS array as the embind VectorEntity interface World.getChildren
 *  returns (size()/get(i)/delete()), so despawn iterates it the same on both
 *  backends. Native memory is JS-owned here, so delete() is a no-op. Also iterable
 *  (`for...of`): consumers like the timeline/animator child-path resolver walk the
 *  children with a for-of and type the field as `Entity[]`, so the shim must
 *  answer Symbol.iterator too, not only the vector methods. */
function vectorEntity(
    arr: readonly Entity[],
): { size(): number; get(i: number): Entity; delete(): void; [Symbol.iterator](): Iterator<Entity> } {
    return {
        size: () => arr.length,
        get: (i: number) => arr[i],
        delete: () => { /* nothing to free */ },
        [Symbol.iterator]: () => arr[Symbol.iterator](),
    };
}

/**
 * Build the full CppRegistry over the host's native bindings — entity lifecycle +
 * hierarchy (the generated REGISTRY_OPS, es_getChildren / …) plus, per
 * component, the generated es_<Component>_buffer / _has / _remove. `scope` holds
 * those globals (the QuickJS global object on a device; a plain object in tests).
 * Only components whose three bindings are present get component methods, so a host
 * that binds a subset still connects.
 */
export function createNativeRegistry(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): CppRegistry {
    const reg: Record<string, unknown> = {};
    for (const [method, binding] of Object.entries(INSPECTION_BINDINGS)) {
        if (typeof scope[binding] === 'function') reg[method] = (...args: unknown[]) => hostCall(scope, binding, args);
    }
    // The Registry's entity ops, every one the web has: the list is generated
    // from the table embind is generated from, and `assertNativeBindings`
    // requires each at boot, so a missing op is a boot error rather than a
    // TypeError in whichever system first calls it (#114 was `valid`).
    for (const [method, binding] of Object.entries(REGISTRY_OPS)) {
        reg[method] = (...args: unknown[]) => hostCall(scope, binding, args);
    }

    // Entity hierarchy reads and the module-level epochs — the native siblings of
    // what embind answers through the Parent/Children components and free functions.
    // Required like the rest of the set, and `assertNativeBindings` says so at
    // boot: a host that cannot date its world makes every holder of an address
    // re-resolve it every frame, silently.
    reg.layoutEpoch = (): number => hostCall(scope, REGISTRY_BINDINGS.layoutEpoch, []) as number;
    reg.hasParent = (e: Entity): boolean => !!hostCall(scope, REGISTRY_BINDINGS.hasParent, [e]);
    reg.removeParent = (e: Entity): void => { hostCall(scope, REGISTRY_BINDINGS.removeParent, [e]); };
    reg.hasChildren = (e: Entity): boolean => !!hostCall(scope, REGISTRY_BINDINGS.hasChildren, [e]);
    reg.getChildren = (e: Entity) => ({
        entities: vectorEntity((hostCall(scope, REGISTRY_BINDINGS.getChildren, [e]) as Entity[] | undefined) ?? []),
    });

    // Parent/Children are hierarchy components, not POD ptr components, so they are
    // not in PTR_ACCESSORS. The embind Registry still exposes them the component way
    // (add/get/has/remove), and readers like the physics and hierarchy systems reach
    // them through BuiltinBridge.getBuiltinMethods, which needs all four to exist.
    // Present that surface here over the native entity-ops so both backends match.
    reg.getParent = (e: Entity): { entity: Entity } => ({
        entity: (hostCall(scope, REGISTRY_BINDINGS.getParent, [e]) as Entity),
    });
    reg.addParent = (child: Entity, data: { entity: Entity }): void => {
        hostCall(scope, REGISTRY_OPS.setParent, [child, data.entity]);
    };
    // Children is the reverse index of Parent; write it by re-parenting each listed
    // child. Rarely called (scenes rebuild the tree with setParent), but a complete
    // surface keeps the two registries interchangeable.
    reg.addChildren = (parent: Entity, data: { entities: Iterable<Entity> }): void => {
        for (const child of data.entities ?? []) {
            hostCall(scope, REGISTRY_OPS.setParent, [child, parent]);
        }
    };
    reg.removeChildren = (parent: Entity): void => {
        const kids = (hostCall(scope, REGISTRY_BINDINGS.getChildren, [parent]) as Entity[] | undefined) ?? [];
        for (const child of kids) hostCall(scope, REGISTRY_BINDINGS.removeParent, [child]);
    };
    // MeshSkin, the third component with no POD layout: its joints are a variable
    // -length entity list, so it has no ptr accessor and the loop below never
    // reaches it. Without these, every rigged glTF dies at `insertBuiltin(MeshSkin)`.
    reg.hasMeshSkin = (e: Entity): boolean =>
        !!hostCallOpt(scope, `es_MeshSkin_has`, [e]);
    reg.removeMeshSkin = (e: Entity): void => { hostCallOpt(scope, `es_MeshSkin_remove`, [e]); };
    reg.getMeshSkin = (e: Entity): { joints: Entity[] } => ({
        joints: (hostCall(scope, REGISTRY_BINDINGS.getMeshSkinJoints, [e]) as Entity[] | undefined) ?? [],
    });
    reg.addMeshSkin = (e: Entity, data: { joints?: Iterable<Entity> }): void => {
        hostCall(scope, REGISTRY_BINDINGS.setMeshSkinJoints, [e, [...(data.joints ?? [])]]);
    };

    // The rest of the components a variable-length field keeps out of the buffer
    // loop below. Driven by the metadata rather than named one at a time: their
    // accessors are GENERATED, so a new number list needs no edit here.
    for (const [cppName, meta] of Object.entries(COMPONENT_META)) {
        const fields = (meta?.numberListFields ?? []) as readonly string[];
        if (!fields.length || PTR_ACCESSORS[cppName]) continue;
        reg[`has${cppName}`] = (e: Entity): boolean =>
            !!hostCallOpt(scope, `es_${cppName}_has`, [e]);
        reg[`remove${cppName}`] = (e: Entity): void => {
            hostCallOpt(scope, `es_${cppName}_remove`, [e]);
        };
        reg[`get${cppName}`] = (e: Entity): Record<string, unknown> => {
            const out: Record<string, unknown> = {};
            for (const f of fields) {
                out[f] = hostCallOpt(scope, `es_${cppName}_${f}_get`, [e]) ?? [];
            }
            return out;
        };
        reg[`add${cppName}`] = (e: Entity, data: Record<string, unknown>): void => {
            for (const f of fields) {
                hostCallOpt(scope, `es_${cppName}_${f}_set`,
                            [e, [...((data[f] as Iterable<number>) ?? [])]]);
            }
        };
    }

    reg.delete = (): void => {};

    // A native std::string/std::vector (and even POD with different alignment)
    // cannot be addressed with wasm32 offsets. The host deliberately withholds
    // its buffer; use actual C++ members instead. Lists retain their own bindings.
    for (const [cppName, meta] of Object.entries(COMPONENT_META)) {
        if (cppName === 'Parent' || cppName === 'Children' || cppName === 'MeshSkin') continue;
        if (typeof scope[`es_${cppName}_buffer`] === 'function') continue;
        const get = scope[`es_get_${cppName}`] as ((e: Entity) => Record<string, unknown>) | undefined;
        const set = scope[`es_set_${cppName}`] as ((e: Entity, data: unknown) => void) | undefined;
        const has = scope[`es_${cppName}_has`] as HasFn | undefined;
        const remove = scope[`es_${cppName}_remove`] as RemoveFn | undefined;
        if (typeof get !== 'function' || typeof set !== 'function'
            || typeof has !== 'function' || typeof remove !== 'function') continue;
        const fields = [...new Set([...(meta.listFields ?? []), ...(meta.numberListFields ?? [])])];
        reg[`add${cppName}`] = (e: Entity, data: Record<string, unknown>): void => {
            set(e, data);
            for (const field of fields) {
                if (field in data) hostCall(scope, `es_${cppName}_${field}_set`, [e, data[field]]);
            }
        };
        reg[`get${cppName}`] = (e: Entity): Record<string, unknown> => {
            const out = has(e) ? get(e) : {};
            for (const field of fields) out[field] = has(e)
                ? hostCall(scope, `es_${cppName}_${field}_get`, [e]) : [];
            return out;
        };
        reg[`has${cppName}`] = has;
        reg[`remove${cppName}`] = remove;
    }

    // The scene queries the wasm module answers as module-level functions. There is
    // no module here, so the registry answers them — the camera plugin asks the
    // registry first and falls through to the module on web (see canvasEntityOf).
    // Optional on the host: a host that binds neither simply has no cameras, which
    // the plugin already treats as "nothing to render".
    reg.getCanvasEntity = (): number =>
        (hostCallOpt(scope, SCENE_QUERY_BINDINGS.canvasEntity, []) as number | undefined) ?? -1;
    reg.getCameraEntities = (): number[] =>
        (hostCallOpt(scope, SCENE_QUERY_BINDINGS.cameraEntities, []) as number[] | undefined) ?? [];
    reg.getCanvasEntities = (): number[] =>
        (hostCallOpt(scope, SCENE_QUERY_BINDINGS.canvasEntities, []) as number[] | undefined) ?? [];

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
        // A list field's storage is a pointer, so it is absent from the buffer the
        // accessors write through: it crosses as its own generated pair, and a host
        // without them keeps none of the field rather than half of it.
        const listFields = ((COMPONENT_META[cppName]?.listFields ?? []) as readonly string[])
            .map((field) => ({
                field,
                get: scope[`es_${cppName}_${field}_get`] as ((e: Entity) => unknown) | undefined,
                set: scope[`es_${cppName}_${field}_set`] as
                    ((e: Entity, v: unknown) => void) | undefined,
            }))
            .filter((l): l is ListFieldBinding =>
                typeof l.get === 'function' && typeof l.set === 'function');

        // add: emplace (the buffer binding getOrEmplaces) + write every field. The
        // SDK hands embind-shape data ({x,y,z,w} colors); ptrAccessors want
        // {r,g,b,a}, so bridge colors back before writing.
        reg[`add${cppName}`] = (entity: Entity, data: Record<string, unknown>): void => {
            const buf = bufFn(entity);
            if (!buf) return;
            const ptrData = colorFields.length ? convertFromWasm(data, colorFields) : data;
            const [f32, u32, u8] = views(buf);
            accessor.write(f32, u32, u8, 0, ptrData);
            for (const l of listFields) l.set(entity, (data as Record<string, unknown>)[l.field] ?? []);
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
            for (const l of listFields) out[l.field] = l.get(entity);
            return colorFields.length ? convertForWasm(out, colorFields) : out;
        };

        reg[`has${cppName}`] = (entity: Entity): boolean => hasFn(entity);
        reg[`remove${cppName}`] = (entity: Entity): void => { removeFn(entity); };
    }

    return reg as unknown as CppRegistry;
}
