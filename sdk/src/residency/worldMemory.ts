// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    worldMemory.ts
 * @brief   What a streamed world remembers of a cell once it has gone: the state of what asked to be remembered, and what was
 *          destroyed.
 *
 * @details A cell that unloads loses its runtime state and comes back as authored. An entity carrying `RememberState` does
 *          not: as it is taken out with its cell, its game components (and its Transform) are written down under the id it was
 *          authored with, and when the cell is next brought in its document is changed before anything spawns, so it arrives as
 *          it was left, not as it was authored, and never for a frame as authored. One destroyed while its cell is in (a chest
 *          looted, a boss killed, an ore mined) is written down as gone, and its cell never brings it back.
 *
 *          Only game components are kept, the ones a project defines: the engine's own hold asset handles and runtime state a
 *          cell rebuilds on its own. Entity fields are written as authored ids, the form a document holds. `toJSON` and `read`
 *          carry the memory through a save.
 */

import type { App } from '../app/app';
import type { Entity } from '../types';
import { defineComponent, SceneOwner, type ComponentDef } from '../ecs/component';
import { mapEntityRefField } from '../ecs/entityRefField';
import { visitSerializedComponents, type SceneComponentData, type SceneData, type SceneEntityData } from '../scene/scene';
import { requireUnambiguousSceneHierarchy } from '../scene/sceneFormat';
import { SceneManager } from '../scene/sceneManager';
import { sceneOriginOf } from '../scene/sceneOrigins';
import { defineResource } from '../ecs/resource';
import { cloneJsonValue } from '../util/cloneJsonValue';
import type { WorldManifest } from './cells';

/** The fields of the `RememberState` component. @experimental */
export interface RememberStateData {
    /** Whether where it stood is kept too, so something moved or carried is found where it was left. */
    keepTransform: boolean;
}

/**
 * Asks a streamed world to remember this entity across its cell unloading: its game components (and, unless told not to, its
 * Transform) come back as they were left, and if it is destroyed it stays destroyed.
 *
 * @experimental
 */
export const RememberState: ComponentDef<RememberStateData> = defineComponent<RememberStateData>(
    'RememberState', { keepTransform: true },
    { fields: { keepTransform: { tooltip: 'Keep where it stood as well, so something moved is found where it was left.' } } },
);

/** One remembered entity: what it was left as, or that it is gone. */
interface Remembered {
    gone?: true;
    components?: SceneComponentData[];
}

/** A world's memory as a save holds it. @experimental */
export interface WorldMemoryData {
    version: 1;
    /** The persistent scene the memory is of: a save of another world is not applied to this one. */
    world: string;
    /** `cell:id` (the cell's name and the id the entity was authored with) to what is remembered of it. */
    entries: Record<string, Remembered>;
}

/** What a streamed world remembers of its cells. @experimental */
export class WorldMemory {
    private readonly saved_ = new Map<string, Map<string, Remembered>>();
    /** Authored row ids are local to the current world. */
    private readonly cellsOf_ = new Map<number, Set<string>>();
    private world_ = '';
    private indexed_: WorldManifest | null = null;

    constructor(private readonly app_: App, private readonly manifest_: () => WorldManifest | null) {}

    private entries_(): Map<string, Remembered> {
        const manifest = this.manifest_();
        if (manifest !== this.indexed_) {
            this.indexed_ = manifest;
            this.cellsOf_.clear();
        }
        if (manifest) this.world_ = manifest.scene;
        let entries = this.saved_.get(this.world_);
        if (!entries) this.saved_.set(this.world_, entries = new Map());
        return entries;
    }

    /** How many entities are remembered, gone ones included. */
    get size(): number { return this.entries_().size; }

    /** Whether the entity authored as `id` in `cell` was destroyed and stays so. */
    isGone(cell: string, id: number): boolean {
        return this.entries_().get(`${cell}:${id}`)?.gone === true;
    }

    /** Forget everything: a new game. */
    clear(): void {
        this.saved_.clear();
    }

    /** The memory as a save holds it. */
    toJSON(): WorldMemoryData {
        const entries = this.entries_();
        return { version: 1, world: this.world_, entries: cloneJsonValue(Object.fromEntries(entries)) };
    }

    /** Take a save's memory in place of this one. Cells already in keep what they are; the next one brought in reads it. */
    read(data: WorldMemoryData): void {
        if (data?.version !== 1) throw new Error('WorldMemory: not a world memory this version reads');
        this.saved_.set(data.world, new Map(Object.entries(cloneJsonValue(data.entries ?? {}))));
        if (!this.manifest_()) this.world_ = data.world;
    }

    /**
     * A cell's document, as it should be brought in: what was destroyed taken out, with everything under it, and what was
     * remembered set back to how it was left. Any other scene is handed back as it is.
     */
    adapt(sceneName: string, data: SceneData): SceneData {
        const manifest = this.manifest_();
        if (!manifest || !manifest.cells.some((c) => c.name === sceneName)) return data;
        const entries = this.entries_();
        const entities = data.entities ?? [];
        const doomed = new Set<number>();
        if (entries.size > 0) {
            for (const entity of entities) {
                if (entries.get(`${sceneName}:${entity.id}`)?.gone) doomed.add(entity.id);
            }
        }
        if (doomed.size > 0) {
            // Validate before a deletion can hide an ambiguous authored hierarchy.
            requireUnambiguousSceneHierarchy(data);
            // The runtime attaches by parent. Older files can have stale children lists.
            const byParent = new Map<number, number[]>();
            for (const { id, parent } of entities) {
                if (parent == null) continue;
                const siblings = byParent.get(parent);
                if (siblings) siblings.push(id);
                else byParent.set(parent, [id]);
            }
            // Set iteration visits newly discovered descendants in the same pass.
            for (const id of doomed) {
                const children = byParent.get(id);
                if (children) for (const child of children) doomed.add(child);
            }
        }
        for (const entity of entities) {
            let cells = this.cellsOf_.get(entity.id);
            if (!cells) this.cellsOf_.set(entity.id, cells = new Set());
            cells.add(sceneName);
        }
        if (entries.size === 0) return data;
        const kept: SceneEntityData[] = [];
        for (const entity of entities) {
            if (doomed.has(entity.id)) continue;
            const left = entries.get(`${sceneName}:${entity.id}`)?.components;
            let row = entity;
            if (left) {
                const components = entity.components.filter((c) => !left.some((l) => l.type === c.type));
                row = { ...row, components: [...components, ...cloneJsonValue(left)] };
            }
            if (entity.children?.some(id => doomed.has(id))) row = { ...row, children: entity.children.filter(id => !doomed.has(id)) };
            kept.push(row);
        }
        return { ...data, entities: kept };
    }

    /** Told of every entity the world destroys: a remembered one is written down as left, or as gone. */
    despawned(entity: Entity): void {
        const world = this.app_.world;
        if (!world.has(entity, RememberState)) return;
        const id = sceneOriginOf(this.app_, entity);
        if (id === undefined || !this.manifest_()) return;
        const entries = this.entries_();
        const cell = this.cellOf_(entity, id);
        if (!cell) return;
        const manager = this.app_.hasResource(SceneManager) ? this.app_.getResource(SceneManager) : null;
        const status = manager?.getSceneStatus(cell.name) ?? null;
        const key = `${cell.name}:${id}`;
        // Destroyed while its cell is in: gone for good. Taken out with its cell: remembered as it is now.
        if (status !== null && status !== 'unloading') {
            entries.set(key, { gone: true });
            return;
        }
        entries.set(key, { components: this.snapshot_(entity) });
    }

    /** The cell an entity was brought in with: the one of the cells holding its id whose scene owns it. */
    private cellOf_(entity: Entity, id: number): { name: string } | null {
        const cells = this.cellsOf_.get(id);
        if (!cells) return null;
        const owner = this.app_.world.tryGet(entity, SceneOwner);
        if (owner) return cells.has(owner.scene) ? { name: owner.scene } : null;
        const manager = this.app_.hasResource(SceneManager) ? this.app_.getResource(SceneManager) : null;
        for (const name of cells) {
            if (manager?.getScene(name)?.entities.has(entity)) return { name };
        }
        // A scene already gone from its slot (taken out over several frames): the only candidate is it.
        return cells.size === 1 ? { name: [...cells][0]! } : null;
    }

    /** What is kept of an entity: its game components, its Transform if asked, entity fields as authored ids. */
    private snapshot_(entity: Entity): SceneComponentData[] {
        const world = this.app_.world;
        const keepTransform = (world.get(entity, RememberState) as RememberStateData).keepTransform !== false;
        const out: SceneComponentData[] = [];
        visitSerializedComponents(world, entity, (component, def) => {
            if (component.type === 'Transform') {
                if (!keepTransform) return;
                const t = component.data as { position?: unknown; rotation?: unknown; scale?: unknown };
                out.push({ type: 'Transform', data: { position: t.position, rotation: t.rotation, scale: t.scale } });
                return;
            }
            if (def._builtin) return;
            const data = cloneJsonValue(component.data);
            for (const field of def.entityFields) {
                if (field in data) data[field] = mapEntityRefField(data[field], target =>
                    typeof target === 'number' && target !== 0 ? sceneOriginOf(this.app_, target as Entity) ?? 0 : target);
            }
            out.push({ type: component.type, data });
        });
        return out;
    }
}

/** The streamed world's memory. @experimental */
export const WorldMemoryRes = defineResource<WorldMemory>(null!, 'WorldMemory');
