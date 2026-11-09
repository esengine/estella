// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    placedFoliage.ts
 * @brief   Everything an artist placed by hand, in one entity: a table of kinds and a list of records, grown a cell at a time near the eye.
 *
 * @details A region the artist composed is tens of thousands of placements: trees, shrubs, stones, tufts of grass. As entities that is a
 *          Transform, a MeshRenderer and a draw for each, which no frame holds. Here they are DATA: `kinds` says what each is made of
 *          (its parts: a mesh, its cheaper mesh, a material, a texture, a tint, and how far it is worth drawing), `records` says where
 *          each stands, six numbers a plant. The ground is cut into cells; the cells round the streaming sources (or the eye) are grown,
 *          each as one MeshInstances set per part and kind. Geometry is shared across cells, each plant is culled and selects its own
 *          LOD, and matching parts batch across cells. Cells retain their generation's assets until replacement or unloading.
 *
 *          The shared mesh keeps every channel the artist made, so a normal map, a second uv or a vertex colour survives;
 *          nothing is painted over it. A plant stands upright, turned about the vertical, and uniformly scaled.
 */
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import { defineComponent, getComponent, RuntimeOnly, Transform, type ComponentDef, type TransformData } from '../ecs/component';
import { Assets } from '../asset/AssetPlugin';
import { log } from '../util/logger';
import { chunksOf, ProceduralChunksRes } from '../residency/chunks';
import type { Entity } from '../types';
import type { Plant } from './builder';
import { PLACED_STRIDE, type PlacedKind, type PlacedPart } from './plantKind';
import { plantGrowthOf, prepareKinds, releaseKinds, type GrownCell, type ReadyKinds } from './plantGrowth';
import { plantInteractionOf } from './plantInteraction';

export { PLACED_STRIDE, type PlacedKind, type PlacedPart };

/** The fields of the `PlacedFoliage` component. @experimental */
export interface PlacedFoliageData {
    sizeX: number;
    sizeZ: number;
    cellSize: number;
    kinds: PlacedKind[];
    records: number[];
    /** The name a save keeps what became of these plants under. Empty takes the entity's name. */
    stateKey: string;
}

/**
 * Plants placed by hand. Presence is the opt-in; its children are the cells near the eye.
 *
 * @experimental
 */
export const PlacedFoliage: ComponentDef<PlacedFoliageData> = defineComponent<PlacedFoliageData>('PlacedFoliage', {
    sizeX: 256, sizeZ: 256, cellSize: 32, kinds: [] as PlacedKind[], records: [] as number[], stateKey: '',
}, {
    // The kinds name meshes, materials and textures inside a list, which the component's own fields cannot declare; they are listed here
    // so a package carries them, and loaded by path when a cell is grown.
    discoverAssets: (data) => {
        const refs: { type: 'mesh' | 'material' | 'texture'; path: string }[] = [];
        for (const kind of (data.kinds as PlacedKind[] | undefined) ?? []) {
            for (const p of kind.parts ?? []) {
                if (p.mesh) refs.push({ type: 'mesh', path: p.mesh });
                if (p.lod1Mesh) refs.push({ type: 'mesh', path: p.lod1Mesh });
                if (p.lod2Mesh) refs.push({ type: 'mesh', path: p.lod2Mesh });
                if (p.material) refs.push({ type: 'material', path: p.material });
                if (p.texture) refs.push({ type: 'texture', path: p.texture });
            }
            for (const p of kind.far ?? []) {
                if (p.mesh) refs.push({ type: 'mesh', path: p.mesh });
                if (p.material) refs.push({ type: 'material', path: p.material });
                if (p.texture) refs.push({ type: 'texture', path: p.texture });
            }
        }
        return refs;
    },
    fields: {
        sizeX: { min: 1, category: 'Area', tooltip: 'World size along x, centred on this entity.' },
        sizeZ: { min: 1, category: 'Area', tooltip: 'World size along z, centred on this entity.' },
        cellSize: { min: 4, category: 'Area', tooltip: 'Side of the cells the area is cut into. Each kind in a cell is one mesh a part, culled whole.' },
        kinds: { category: 'Plants', tooltip: 'What each kind of plant is made of: its parts (mesh, cheaper mesh, material, texture, tint) and how far it is drawn.' },
        records: { category: 'Plants', tooltip: 'Where each plant stands: kind index, x, y, z, turn about the vertical in radians and scale, six numbers a plant, in this entity\'s space.' },
        stateKey: { category: 'Plants', tooltip: 'The name a save keeps what became of these plants under. Empty takes the entity\'s name.' },
    },
});

interface BuiltPlaced {
    signature: string;
    data: PlacedFoliageData;
    /** The kinds' parts once their assets are in hand. */
    ready: ReadyKinds | null;
    /** The records sorted into cells (`cz * 1000 + cx`), by kind, the first time a cell asks. */
    cells: Map<number, Map<number, Plant[]>> | null;
    epoch: number;
    retired: boolean;
}

const layerOf = (entity: Entity): string => `placed:${entity}`;

/** Told by its sizes and a strided sample of the records, so a frame does not hash tens of thousands of numbers. */
function signatureOf(data: PlacedFoliageData): string {
    const { records, kinds, ...rest } = data;
    let sample = 0;
    const n = records.length, step = Math.max(1, Math.floor(n / 127));
    for (let i = 0; i < n; i += step) sample = (Math.imul(sample, 31) + Math.round(records[i]! * 64)) | 0;
    return `${JSON.stringify(rest)}|${JSON.stringify(kinds)}|${n}|${sample}`;
}

/** Run-time facts about the placed foliage. */
export class PlacedFoliageField {
    /** @internal */ readonly built_ = new Map<Entity, BuiltPlaced>();
    /** @internal */ app_: App | null = null;

    /** How many meshes are still waiting to be made, across every plant in the app. */
    get pending(): number { return this.app_ ? plantGrowthOf(this.app_).pending : 0; }

    /** How many cells are grown and standing now, across every entity. */
    get cellCount(): number {
        const app = this.app_;
        if (!app?.hasResource(ProceduralChunksRes)) return 0;
        let n = 0;
        for (const entity of this.built_.keys()) {
            for (const id of [layerOf(entity), `${layerOf(entity)}:far`]) {
                const s = app.getResource(ProceduralChunksRes).status(id);
                if (s) n += s.ready + s.stale;
            }
        }
        return n;
    }
}

export class PlacedFoliagePlugin implements Plugin {
    name = 'placedFoliage';

    build(app: App): void {
        const field = new PlacedFoliageField();
        field.app_ = app;
        app.insertResource(PlacedFoliageRes, field);
        plantGrowthOf(app);

        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            if (!app.hasResource(Assets)) return;
            for (const [entity, built] of field.built_) {
                if (app.world.valid(entity) && app.world.has(entity, PlacedFoliage)) continue;
                if (app.hasResource(ProceduralChunksRes)) {
                    app.getResource(ProceduralChunksRes).remove(layerOf(entity));
                    app.getResource(ProceduralChunksRes).remove(`${layerOf(entity)}:far`);
                }
                this.retire(built);
                field.built_.delete(entity);
            }
            for (const entity of app.world.getEntitiesWithComponents([PlacedFoliage, Transform])) {
                const data = app.world.get(entity, PlacedFoliage) as PlacedFoliageData;
                const signature = signatureOf(data);
                let built = field.built_.get(entity);
                if (!built || built.signature !== signature) {
                    if (built) this.retire(built);
                    built = { signature, data: { ...data }, ready: null, cells: null, epoch: (built?.epoch ?? 0) + 1, retired: false };
                    field.built_.set(entity, built);
                    void this.start(app, built);
                }
                this.layers(app, entity, built);
            }
        }, { name: 'PlacedFoliageSystem' }));
    }

    cleanup(app?: App): void {
        if (!app?.hasResource(PlacedFoliageRes)) return;
        const field = app.getResource(PlacedFoliageRes);
        for (const [entity, built] of field.built_) {
            if (app.hasResource(ProceduralChunksRes)) {
                app.getResource(ProceduralChunksRes).remove(layerOf(entity));
                app.getResource(ProceduralChunksRes).remove(`${layerOf(entity)}:far`);
            }
            this.retire(built);
        }
        field.built_.clear();
    }

    private retire(built: BuiltPlaced): void {
        built.retired = true;
        if (built.ready) releaseKinds(built.ready);
    }

    /** Reads the geometry and makes the handles of every part of every kind; the cells wait for it. */
    private async start(app: App, built: BuiltPlaced): Promise<void> {
        const epoch = built.epoch;
        try {
            const ready = await prepareKinds(app.getResource(Assets), built.data.kinds);
            if (!built.retired && built.epoch === epoch) built.ready = ready;
            else releaseKinds(ready);
        } catch (e) {
            log.error('foliage', 'preparing the placed plants failed', e);
        }
    }

    private cellsAcross(data: PlacedFoliageData): { x: number; z: number } {
        const side = Math.max(1, data.cellSize);
        return { x: Math.min(200, Math.max(1, Math.ceil(data.sizeX / side))), z: Math.min(200, Math.max(1, Math.ceil(data.sizeZ / side))) };
    }

    /**
     * The cells as two layers of chunks: the near one, wanted out to the furthest `drawDistance` and grown a few milliseconds a piece, and the far one
     * (the hierarchical level of detail), wanted out to the furthest `farDistance` and cheap enough that the whole area stands at once.
     */
    private layers(app: App, entity: Entity, built: BuiltPlaced): void {
        const data = built.data, t = app.world.get(entity, Transform) as TransformData;
        const cells = this.cellsAcross(data);
        const sx = t.worldScale.x || 1, sz = t.worldScale.z || 1;
        const growth = plantGrowthOf(app), chunks = chunksOf(app);
        const interactive = data.kinds.some((k) => k.interaction);
        const sourceOf = (): string => {
            const name = getComponent('Name');
            const named = name && app.world.has(entity, name) ? (app.world.get(entity, name) as { value?: string }).value : '';
            return `placed:${data.stateKey || named || entity}`;
        };
        let reach = 1, farReach = 0;
        for (const kind of data.kinds) { reach = Math.max(reach, kind.drawDistance); if ((kind.far?.length ?? 0) > 0) farReach = Math.max(farReach, kind.farDistance); }
        const generation = `${built.epoch}:${t.worldPosition.x}:${t.worldPosition.y}:${t.worldPosition.z}:${sx}:${sz}`;
        const area = {
            originX: t.worldPosition.x - data.sizeX / 2 * sx, originZ: t.worldPosition.z - data.sizeZ / 2 * sz,
            sizeX: data.sizeX / cells.x * sx, sizeZ: data.sizeZ / cells.z * sz, extent: [0, 0, cells.x, cells.z] as [number, number, number, number], generation,
        };
        /** A cell's entity at its centre, and where its plants stand relative to it. */
        const spawn = (cx: number, cz: number, name: string): { cell: GrownCell; by: Map<number, Plant[]> | null; at: { x: number; z: number } } | null => {
            const by = this.sort(built, cells).get(cz * 1000 + cx) ?? null;
            if (!by) return { cell: { entity: null, handles: [], dead: false }, by: null, at: { x: 0, z: 0 } };
            const lx = -data.sizeX / 2 + (cx + 0.5) * (data.sizeX / cells.x), lz = -data.sizeZ / 2 + (cz + 0.5) * (data.sizeZ / cells.z);
            const e = app.world.spawn(`${name} ${cx},${cz}`);
            app.world.insert(e, Transform, { position: { x: lx, y: 0, z: lz } });
            app.world.insert(e, RuntimeOnly);
            const relative = new Map<number, Plant[]>();
            for (const [k, list] of by) relative.set(k, list.map((p) => ({ ...p, x: p.x - lx, z: p.z - lz })));
            return { cell: { entity: e, handles: [], dead: false }, by: relative, at: { x: t.worldPosition.x + lx * sx, z: t.worldPosition.z + lz * sz } };
        };
        chunks.set<GrownCell>(layerOf(entity), {
            label: 'Growing the placed plants', ...area, loadRadius: reach, unloadRadius: reach + Math.max(1, data.cellSize) * 1.5,
            make: (cx, cz) => {
                if (!built.ready) return null;
                const made = spawn(cx, cz, 'PlacedCell');
                if (made?.by) {
                    if (interactive) made.cell.sets = [];
                    growth.growCell(app, made.cell, data.kinds, built.ready, made.by);
                    if (interactive) plantInteractionOf(app).addCell(made.cell, sourceOf(), data.kinds, built.ready, made.by, Math.max(data.sizeX / cells.x * sx, data.sizeZ / cells.z * sz) / 2);
                }
                return made?.cell ?? null;
            },
            publish: (_cx, _cz, cell) => { if (cell.entity !== null) app.world.setParent(cell.entity, entity); },
            release: (_cx, _cz, cell) => growth.release(app, cell),
        });
        const farId = `${layerOf(entity)}:far`;
        if (farReach <= 0) { chunks.remove(farId); return; }
        chunks.set<GrownCell>(farId, {
            label: 'Growing the far plants', ...area, loadRadius: farReach, unloadRadius: farReach + Math.max(1, data.cellSize) * 1.5,
            make: (cx, cz) => {
                if (!built.ready) return null;
                const made = spawn(cx, cz, 'FarCell');
                if (made?.by) {
                    if (interactive) made.cell.sets = [];
                    growth.growFar(app, made.cell, data.kinds, built.ready, made.by, made.at);
                    if (interactive) plantInteractionOf(app).addFarCell(made.cell, sourceOf(), data.kinds, built.ready);
                }
                return made?.cell ?? null;
            },
            publish: (_cx, _cz, cell) => { if (cell.entity !== null) app.world.setParent(cell.entity, entity); },
            release: (_cx, _cz, cell) => growth.release(app, cell),
        });
    }

    /** Sorts the records into cells and kinds, once. */
    private sort(built: BuiltPlaced, cells: { x: number; z: number }): Map<number, Map<number, Plant[]>> {
        if (built.cells) return built.cells;
        const data = built.data, a = data.records;
        const keyed = data.kinds.some((k) => k.interaction);
        const w = data.sizeX / cells.x, d = data.sizeZ / cells.z;
        const sorted = new Map<number, Map<number, Plant[]>>();
        for (let i = 0; i + PLACED_STRIDE <= a.length; i += PLACED_STRIDE) {
            const kind = a[i]!, x = a[i + 1]!, z = a[i + 3]!;
            const ix = Math.floor((x + data.sizeX / 2) / w), iz = Math.floor((z + data.sizeZ / 2) / d);
            if (ix < 0 || iz < 0 || ix >= cells.x || iz >= cells.z) continue;
            const key = iz * 1000 + ix;
            let byKind = sorted.get(key);
            if (!byKind) sorted.set(key, byKind = new Map());
            let list = byKind.get(kind);
            if (!list) byKind.set(kind, list = []);
            list.push({ x, y: a[i + 2]!, z, yaw: a[i + 4]!, scale: a[i + 5]!, phase: 0, shade: 1, ...(keyed && data.kinds[kind]?.interaction ? { key: String(i / PLACED_STRIDE) } : {}) });
        }
        built.cells = sorted;
        return sorted;
    }
}

/** The resource the plugin installs. @experimental */
export const PlacedFoliageRes = defineResource<PlacedFoliageField>(new PlacedFoliageField(), 'PlacedFoliage');

export const placedFoliagePlugin: Plugin = new PlacedFoliagePlugin();
