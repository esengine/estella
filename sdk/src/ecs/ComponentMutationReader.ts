// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../types';
import type { World } from './world';
import type { CppRegistry } from '../wasm';
import { Children, Transform, isBuiltinComponent, type AnyComponentDef } from './component';
import { worldEngineApi, type EngineApi } from './bridge/engineApi';
import { withMalloc } from '../wasm/wasmScratch';
import { ENTITY_CHANGE_CAPACITY, ENTITY_CHANGE_WORDS, ENTITY_CHANGE_SUBTREE,
    ENTITY_CHANGE_RESET, ENTITY_CHANGE_REPLACED, ENTITY_CHANGE_NO_COMPONENT } from '../wasm/constants.generated';

export interface ComponentMutationBatch {
    readonly full: boolean;
    readonly reset: boolean;
    readonly refreshPoses: boolean;
    readonly entities: Set<Entity>;
    readonly changed: Map<AnyComponentDef, Set<Entity>>;
    readonly nativeSequence: number;
    readonly resetEpoch: number;
    readonly writeSequence: number;
    readonly topologySequence: number;
    readonly checkpoint: readonly number[];
}

/** Projects SDK and native mutation cursors onto World-owned entities. Readers
 * acknowledge only successful runs and release history while their consumer stops. */
export class ComponentMutationReader {
    private api: EngineApi | null = null;
    private registry: CppRegistry | null = null;
    private lease: number | null = null;
    private cursor = 0;
    private first = true;
    private bindingReset = false;
    private disposed = false;
    private checkpoint: readonly number[] | null = null;
    private resetEpoch: number | null = null;
    private lastRegistry: CppRegistry | null = null;
    private readonly nativeTypes = new Map<number, AnyComponentDef>();
    private readonly writes = new Map<AnyComponentDef, number>();
    private readonly topology = new Map<AnyComponentDef, number>();
    private readonly offDisconnect: () => void;
    private readonly members: Set<AnyComponentDef>;
    private readonly values: Set<AnyComponentDef>;

    constructor(private readonly world: World, components: readonly AnyComponentDef[],
                topologyOnly: readonly AnyComponentDef[], private readonly subtree: readonly AnyComponentDef[]) {
        this.values = new Set([...components, ...subtree]);
        this.members = new Set([...this.values, ...topologyOnly]);
        this.offDisconnect = world.onCoreDisconnect(() => {
            try { this.pause(); } finally {
                this.bindingReset = true; this.lastRegistry = null; this.resetEpoch = null;
            }
        });
    }

    private open(): boolean {
        if (this.disposed) return false;
        if (this.lease !== null) return true;
        const api = worldEngineApi(this.world), registry = this.world.getCppRegistry();
        if (!registry?.componentTypeId || !api?.registry_watchEntityChanges || !api.registry_unwatchEntityChanges
            || !api.registry_entityChangeSequence || !api.registry_entityChangeResetEpoch || !api.registry_componentMutationRevision
            || !api.registry_readEntityChanges
            || !api._malloc || !api._free || !api.HEAPU32) return false;
        for (const component of this.members) {
            if (!isBuiltinComponent(component)) continue;
            const id = registry.componentTypeId(component._cppName);
            if (!Number.isInteger(id) || id < 0) { this.nativeTypes.clear(); return false; }
            this.nativeTypes.set(id, component);
        }
        this.api = api; this.registry = registry;
        if (this.lastRegistry !== registry) {
            this.lastRegistry = registry;
            this.resetEpoch = api.registry_entityChangeResetEpoch(registry);
        }
        this.lease = api.registry_watchEntityChanges(registry);
        for (const component of this.values) this.writes.set(component, this.world.registerMutationCursor(component, 'write'));
        for (const component of this.members) this.topology.set(component, this.world.registerMutationCursor(component, 'topology'));
        return true;
    }

    read(): ComponentMutationBatch | null {
        if (!this.open()) return null;
        const world = this.world, api = this.api!, registry = this.registry!;
        const nativeSequence = api.registry_entityChangeSequence!(registry);
        const resetEpoch = api.registry_entityChangeResetEpoch!(registry);
        const checkpoint = [api.registry_componentMutationRevision!(registry, ENTITY_CHANGE_NO_COMPONENT, false)];
        for (const component of this.values) checkpoint.push(world.mutationRevision(component, 'write'));
        for (const component of this.members) checkpoint.push(world.mutationRevision(component, 'topology'));
        for (const [id, component] of this.nativeTypes) {
            checkpoint.push(api.registry_componentMutationRevision!(registry, id, !this.values.has(component)));
        }
        const writeSequence = world.mutationSequence('write'), topologySequence = world.mutationSequence('topology');
        const entities = new Set<Entity>(), roots = new Set<Entity>();
        const changed = new Map<AnyComponentDef, Set<Entity>>();
        const note = (component: AnyComponentDef, entity: Entity, membership: boolean) => {
            let ids = changed.get(component);
            if (!ids) { ids = new Set(); changed.set(component, ids); }
            ids.add(entity);
            if (membership || this.values.has(component)) entities.add(entity);
            if (this.subtree.includes(component)) roots.add(entity);
        };
        for (const [component, reader] of this.writes) {
            for (const entity of world.mutationsForCursor(component, 'write', reader)) note(component, entity, false);
        }
        for (const [component, reader] of this.topology) {
            for (const entity of world.mutationsForCursor(component, 'topology', reader)) note(component, entity, true);
        }
        let reset = this.bindingReset || resetEpoch < 0 || resetEpoch !== this.resetEpoch;
        const unchanged = this.checkpoint !== null && checkpoint.every((value, index) => value >= 0 && value === this.checkpoint![index]);
        let full = reset || this.first && !unchanged;
        let refreshPoses = false;
        // A component-only consumer needs no descendant expansion. Its revisions
        // can also rule out an entire window of unrelated native writes.
        const tracksSubtrees = this.subtree.length > 0;
        if (nativeSequence !== this.cursor && !(unchanged && !reset && (this.first || !tracksSubtrees))) {
            withMalloc({ _malloc: api._malloc!.bind(api), _free: api._free!.bind(api) },
                ENTITY_CHANGE_CAPACITY * ENTITY_CHANGE_WORDS * 4, ptr => {
                    if (!ptr) { full ||= !unchanged; refreshPoses = true; return; }
                    const count = api.registry_readEntityChanges!(registry, this.cursor, ptr, ENTITY_CHANGE_CAPACITY);
                    if (count < 0) { full ||= !unchanged; refreshPoses = true; return; }
                    if (!Number.isInteger(count) || count > ENTITY_CHANGE_CAPACITY) throw new Error('Invalid native mutation batch length');
                    const heap = api.HEAPU32!;
                    for (let i = 0; i < count; ++i) {
                        const at = (ptr >>> 2) + i * ENTITY_CHANGE_WORDS;
                        const entity = heap[at] as Entity, flags = heap[at + 1], type = heap[at + 2];
                        if (flags & ENTITY_CHANGE_RESET) { full = true; refreshPoses = true; continue; }
                        if (tracksSubtrees && (flags & ENTITY_CHANGE_SUBTREE)) roots.add(entity);
                        if (type === ENTITY_CHANGE_NO_COMPONENT) {
                            entities.add(entity);
                            if (!(flags & ENTITY_CHANGE_SUBTREE)) {
                                for (const component of this.nativeTypes.values()) {
                                    note(component, entity, true);
                                    world.refreshBuiltinMembership(entity, component);
                                }
                            }
                        }
                        const component = this.nativeTypes.get(type);
                        if (!component) continue;
                        const membership = !(flags & ENTITY_CHANGE_REPLACED);
                        note(component, entity, membership);
                        world.refreshBuiltinMembership(entity, component);
                    }
                });
        }
        if (full) {
            for (const entity of world.getAllEntities()) {
                entities.add(entity);
                for (const component of this.nativeTypes.values()) world.refreshBuiltinMembership(entity, component);
            }
        } else if (roots.size) {
            const hasChildren = world.resolveHas(Children);
            const pending = [...roots], visited = new Set<Entity>();
            while (pending.length) {
                const entity = pending.pop()!;
                if (visited.has(entity) || !world.valid(entity) && !registry.valid(entity)) continue;
                visited.add(entity); entities.add(entity);
                if (hasChildren?.(entity)) for (const child of world.get(entity, Children).entities) pending.push(child);
            }
        }
        if (full || refreshPoses || roots.size || changed.has(Transform)) world.invalidateTransformComposition();
        return { full, reset, refreshPoses, entities, changed, nativeSequence, resetEpoch, writeSequence, topologySequence, checkpoint };
    }

    commit(batch: ComponentMutationBatch): void {
        this.cursor = batch.nativeSequence; this.first = false;
        this.bindingReset = false;
        this.resetEpoch = batch.resetEpoch;
        this.checkpoint = batch.checkpoint;
        for (const [component, reader] of this.writes) this.world.advanceMutationCursor(component, 'write', reader, batch.writeSequence);
        for (const [component, reader] of this.topology) this.world.advanceMutationCursor(component, 'topology', reader, batch.topologySequence);
    }

    pause(): void {
        for (const [component, reader] of this.writes) this.world.disposeMutationCursor(component, 'write', reader);
        for (const [component, reader] of this.topology) this.world.disposeMutationCursor(component, 'topology', reader);
        this.writes.clear(); this.topology.clear(); this.nativeTypes.clear();
        try {
            if (this.lease !== null) this.api!.registry_unwatchEntityChanges!(this.registry, this.lease);
        } finally {
            this.lease = null; this.registry = null; this.api = null; this.cursor = 0; this.first = true;
        }
    }

    dispose(): void {
        this.disposed = true;
        try { this.pause(); } finally { this.lastRegistry = null; this.offDisconnect(); }
    }
}
