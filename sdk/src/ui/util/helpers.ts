// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Parent } from '../../ecs/component';
import type { ParentData, AnyComponentDef } from '../../ecs/component';
import type { Entity } from '../../types';
import type { World } from '../../ecs/world';
import { UIVisual, UIVisualType } from '../core/ui-visual';
import type { CppRegistry } from '../../wasm';
import type { EngineApi } from '../../ecs/bridge/engineApi';
import { WasmBridge } from '../../wasm/WasmBridge';

/** The helpers' view of the engine, guarded: after a wasm abort a call throws
 *  {@link WasmModuleAborted} instead of reaching a dead module. A native host's
 *  bindings pass through the same channel and simply never abort. */
class UIHelpersBridge extends WasmBridge<NonNullable<EngineApi>> {
    protected readonly label = 'uiHelpers';
}

const bridge = new UIHelpersBridge();
let engine_: EngineApi | null = null;
let nativeRegistry_: CppRegistry | null = null;

/** Bind the helpers to this app's engine core (the wasm module on the web, the
 *  native host's bindings on a device) — see ecs/engineApi.ts. */
export function initUIHelpers(engine: EngineApi | null, registry: CppRegistry): void {
    if (engine) {
        bridge.connect(engine);
        engine_ = bridge.module;
    } else {
        engine_ = null;
    }
    nativeRegistry_ = registry;
}


export function isWordChar(code: number): boolean {
    return (code >= 0x41 && code <= 0x5A)
        || (code >= 0x61 && code <= 0x7A)
        || (code >= 0x30 && code <= 0x39)
        || code === 0x5F;
}

export function nextPowerOf2(n: number): number {
    let p = 1;
    while (p < n) p *= 2;
    return p;
}

export function getEntityDepth(world: World, entity: Entity): number {
    let depth = 0;
    let current = entity;
    while (world.has(current, Parent)) {
        const parentData = world.get(current, Parent) as ParentData;
        const parentEntity = parentData.entity;
        if (!world.valid(parentEntity)) break;
        depth++;
        current = parentEntity;
    }
    return depth;
}

/** Resolved px width of a UINode (its Yoga-computed size). 0 if unresolved. */
export function getUINodeWidth(entity: Entity): number {
    if (engine_ && nativeRegistry_ && engine_.getUINodeComputedWidth) {
        return engine_.getUINodeComputedWidth(nativeRegistry_, entity);
    }
    return 0;
}

/** Resolved px height of a UINode. 0 if unresolved. */
export function getUINodeHeight(entity: Entity): number {
    if (engine_ && nativeRegistry_ && engine_.getUINodeComputedHeight) {
        return engine_.getUINodeComputedHeight(nativeRegistry_, entity);
    }
    return 0;
}


export function walkParentChain(
    world: World, entity: Entity,
    callback: (ancestor: Entity) => boolean,
): void {
    let current = entity;
    while (world.has(current, Parent)) {
        const parentData = world.get(current, Parent) as ParentData;
        const parentEntity = parentData.entity;
        if (!world.valid(parentEntity)) break;
        if (callback(parentEntity)) return;
        current = parentEntity;
    }
}

export function ensureComponent(
    world: World, entity: Entity,
    component: AnyComponentDef, defaults?: Record<string, unknown>,
): void {
    if (!world.has(entity, component)) {
        world.insert(entity, component, defaults);
    }
}

export function ensureUIVisual(world: World, entity: Entity): void {
    if (!world.has(entity, UIVisual)) {
        world.insert(entity, UIVisual, {
            visualType: UIVisualType.None,
            texture: 0,
            color: { r: 1, g: 1, b: 1, a: 1 },
            uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 },
            sliceBorder: { x: 0, y: 0, z: 0, w: 0 },
            tileSize: { x: 32, y: 32 },
            fillMethod: 0,
            fillOrigin: 0,
            fillAmount: 1,
            material: 0,
            enabled: true,
        });
    }
}

export class EntityStateMap<T> {
    private map_ = new Map<Entity, T>();

    get(entity: Entity): T | undefined { return this.map_.get(entity); }
    set(entity: Entity, state: T): void { this.map_.set(entity, state); }
    delete(entity: Entity): void { this.map_.delete(entity); }
    has(entity: Entity): boolean { return this.map_.has(entity); }

    cleanup(world: World): void {
        for (const [e] of this.map_) {
            if (!world.valid(e)) this.map_.delete(e);
        }
    }

    ensureInit(entity: Entity, init: () => T): T {
        let state = this.map_.get(entity);
        if (!state) {
            state = init();
            this.map_.set(entity, state);
        }
        return state;
    }

    clear(): void { this.map_.clear(); }

    [Symbol.iterator]() { return this.map_[Symbol.iterator](); }
}

