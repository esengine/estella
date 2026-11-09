// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    voxelPlugin.ts
 * @brief   `VoxelTerrain`: ground that is a volume, so it can hold caves and overhangs, and that can be carved while the game runs.
 *
 * @details Beside the height-field Terrain, not instead of it. Columns of chunks are made round the eye to be drawn and round what moves to be
 *          collided with, by the same owner of chunks the terrain and the plants use. A chunk's skin is an entity of its own holding a
 *          mesh, so only the chunks an edit reached are made again, with the old one kept until the new one is ready. What was changed is
 *          kept by chunk and saved by chunk.
 */
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import { defineComponent, MeshRenderer, RuntimeOnly, Transform, type ComponentDef, type MeshRendererData, type TransformData } from '../ecs/component';
import { Assets } from '../asset/AssetPlugin';
import type { MaterialShaderSource } from '../asset/loaders/MaterialShaderAssetLoader';
import { Material, MATERIAL_FORMAT_VERSION } from '../render/material';
import { BlendMode } from '../render/blend';
import { collisionGeometryOf } from '../runtime/collisionGeometry';
import { chunksOf, ProceduralChunksRes, streamingSourcesOf, type ChunkSource } from '../residency/chunks';
import { EditorView, editorViewEye } from '../camera/EditorView';
import { movers } from '../terrain/movers';
import { log } from '../util/logger';
import type { Color, Entity } from '../types';
import { chunkKey, VoxelField, type VoxelChunk, type VoxelEditOptions, type VoxelEditResult, type VoxelFieldData, type VoxelHit, type VoxelOp, type VoxelPoint, type VoxelShape, type VoxelSource } from './field';
import { noiseVoxelSource } from './source';
import { surfaceNets, voxelMesh, type VoxelSurface } from './surfaceNets';

/** The fields of the `VoxelTerrain` component. @experimental */
export interface VoxelTerrainData {
    /** The side of a cell, in world units: the finest thing the ground can show. */
    cellSize: number;
    /** How many cells a chunk has a side: what one edit makes again at the least. */
    chunkCells: number;
    /** How far down and up the volume goes from the entity. It is closed at both ends. */
    minY: number;
    maxY: number;
    seed: number;
    surfaceHeight: number;
    hillHeight: number;
    hillScale: number;
    caveWidth: number;
    caveScale: number;
    soilDepth: number;
    oreAmount: number;
    /** How far from the eye it is drawn, in world units. */
    drawDistance: number;
    castShadows: boolean;
    /** Whether 3D bodies and characters collide with it. */
    collision: boolean;
    /** How far round each moving body and character it is built for collision. */
    collisionDistance: number;
    collisionLayer: number;
    friction: number;
    /** A material on the Voxel Ground shader, or 0 for the stock one with the colours and pictures below. */
    material: number;
    color0: Color;
    color1: Color;
    color2: Color;
    color3: Color;
    map0: number;
    map1: number;
    map2: number;
    map3: number;
    /** How long one repeat of the pictures is in the world. */
    tile: number;
}

const rgb = (r: number, g: number, b: number): Color => ({ r, g, b, a: 1 });

/**
 * Ground that is a volume. Presence is the opt-in; the entity's position places it, and its rotation and scale do not apply.
 *
 * @experimental
 */
export const VoxelTerrain: ComponentDef<VoxelTerrainData> = /* @__PURE__ */ defineComponent<VoxelTerrainData>('VoxelTerrain', {
    cellSize: 1, chunkCells: 24, minY: -48, maxY: 48,
    seed: 1, surfaceHeight: 8, hillHeight: 14, hillScale: 60, caveWidth: 2.5, caveScale: 36, soilDepth: 5, oreAmount: 0.06,
    drawDistance: 96, castShadows: true,
    collision: true, collisionDistance: 32, collisionLayer: 0, friction: 0.6,
    material: 0,
    color0: rgb(0.3, 0.42, 0.2), color1: rgb(0.36, 0.27, 0.18), color2: rgb(0.42, 0.41, 0.4), color3: rgb(0.72, 0.55, 0.25),
    map0: 0, map1: 0, map2: 0, map3: 0, tile: 8,
}, {
    assetFields: [{ field: 'material', type: 'material' }, { field: 'map0', type: 'texture' }, { field: 'map1', type: 'texture' }, { field: 'map2', type: 'texture' }, { field: 'map3', type: 'texture' }],
    fields: {
        cellSize: { min: 0.05, unit: 'wu', category: 'Shape', tooltip: 'The side of a cell: the finest thing the ground can show. Half the size is eight times the cells.' },
        chunkCells: { min: 8, max: 64, step: 1, category: 'Shape', advanced: true, tooltip: 'How many cells a chunk has a side. Smaller makes less again for each edit and draws more meshes.' },
        minY: { unit: 'wu', category: 'Shape', tooltip: 'How far down the volume goes from the entity. Nothing digs through its floor.' },
        maxY: { unit: 'wu', category: 'Shape', tooltip: 'How far up the volume goes from the entity. Nothing is built past it.' },
        seed: { step: 1, category: 'Ground', tooltip: 'Another seed is another ground. A save holds what was changed in the ground this seed makes.' },
        surfaceHeight: { unit: 'wu', category: 'Ground', tooltip: 'Where the ground lies on average, from the entity.' },
        hillHeight: { min: 0, unit: 'wu', category: 'Ground', tooltip: 'How far the hills rise and fall from it.' },
        hillScale: { min: 1, unit: 'wu', category: 'Ground', tooltip: 'How wide the hills are.' },
        caveWidth: { min: 0, unit: 'wu', category: 'Ground', tooltip: 'How wide the tunnels through the ground are. 0 has none.' },
        caveScale: { min: 1, unit: 'wu', category: 'Ground', tooltip: 'How far apart the tunnels are.' },
        soilDepth: { min: 0, unit: 'wu', category: 'Ground', tooltip: 'How deep the soil goes before rock.' },
        oreAmount: { min: 0, max: 1, step: 0.01, category: 'Ground', tooltip: 'How much of the rock is ore.' },
        drawDistance: { min: 1, unit: 'wu', category: 'Detail', tooltip: 'How far from the eye the ground is drawn.' },
        castShadows: { category: 'Detail', tooltip: 'Whether the ground casts shadows.' },
        collision: { category: 'Collision', tooltip: 'Whether 3D bodies and characters collide with the ground.' },
        collisionDistance: { min: 1, unit: 'wu', category: 'Collision', tooltip: 'How far round each moving body and character the ground is built for collision.' },
        collisionLayer: { min: 0, max: 15, step: 1, category: 'Collision', advanced: true, tooltip: 'The collision layer the ground is in (0 to 15).' },
        friction: { min: 0, category: 'Collision', advanced: true, tooltip: 'How much the ground holds what slides on it.' },
        material: { category: 'Look', tooltip: 'A material on the Voxel Ground shader. Empty uses the stock one, with the colours and pictures below.' },
        color0: { label: 'Topsoil', category: 'Look' },
        color1: { label: 'Soil', category: 'Look' },
        color2: { label: 'Rock', category: 'Look' },
        color3: { label: 'Ore', category: 'Look' },
        map0: { label: 'Topsoil Picture', category: 'Look', tooltip: 'Laid from the three sides by world position.' },
        map1: { label: 'Soil Picture', category: 'Look', tooltip: 'Laid from the three sides by world position.' },
        map2: { label: 'Rock Picture', category: 'Look', tooltip: 'Laid from the three sides by world position.' },
        map3: { label: 'Ore Picture', category: 'Look', tooltip: 'Laid from the three sides by world position.' },
        tile: { min: 0.01, unit: 'wu', category: 'Look', tooltip: 'How long one repeat of the pictures is in the world.' },
    },
});

/** What a volume is doing. @experimental */
export interface VoxelTerrainStatus {
    /** Chunks drawn, the triangles they hold, and the chunks with collision. */
    drawnChunks: number;
    triangles: number;
    collidingChunks: number;
    /** Chunks held with their samples, those edited (what a save holds), and those waiting to be made again. */
    heldChunks: number;
    editedChunks: number;
    waitingChunks: number;
    /** The milliseconds the last chunk took to make again. */
    lastRebuildMs: number;
}

/** What an edit changed, relative to the world. @experimental */
export interface VoxelEditEvent {
    entity: Entity;
    shape: VoxelShape;
    op: VoxelOp;
    result: VoxelEditResult;
}

interface DrawnChunk { entity: Entity; mesh: number; triangles: number }

interface Built {
    entity: Entity;
    signature: string;
    field: VoxelField;
    origin: VoxelPoint;
    data: VoxelTerrainData;
    drawn: Map<string, DrawnChunk>;
    /** The columns made to be drawn and to be collided with. */
    drawnColumns: Set<string>;
    collidedColumns: Set<string>;
    collided: Set<string>;
    waiting: Map<string, VoxelChunk>;
    instance: number;
    pending: boolean;
    epoch: number;
    lastRebuildMs: number;
}

/** What, changed, makes the ground again: not how it looks, or how far it reaches. */
function signatureOf(d: VoxelTerrainData, at: VoxelPoint, source: VoxelSource | undefined, sources: Map<VoxelSource, number>): string {
    if (source && !sources.has(source)) sources.set(source, sources.size + 1);
    return JSON.stringify([d.cellSize, d.chunkCells, d.minY, d.maxY, d.seed, d.surfaceHeight, d.hillHeight, d.hillScale, d.caveWidth, d.caveScale, d.soilDepth, d.oreAmount, d.material, d.map0, at.x, at.y, at.z, source ? sources.get(source) : 0]);
}

/**
 * Where a volume is wanted drawn. The game's own eye while it runs; while it is laid out, both the view's eye and what it looks at, since an
 * editor's eye often stands far back from the ground it is looking at, past any distance worth drawing round it.
 */
function drawSources(app: App): ChunkSource[] {
    if (app.hasResource(EditorView)) {
        const view = app.getResource(EditorView);
        if (view.active) {
            const eye = editorViewEye(view);
            return [{ x: eye.x, y: eye.y, z: eye.z }, { x: view.x, y: view.y, z: view.z ?? 0 }];
        }
    }
    return streamingSourcesOf(app);
}

const drawLayerOf = (entity: Entity): string => `voxel-draw:${entity}`;
const collideLayerOf = (entity: Entity): string => `voxel-collide:${entity}`;
const pieceKey = (entity: Entity, key: string): string => `voxel:${entity}:${key}`;
const columnKey = (cx: number, cz: number): string => `${cx},${cz}`;

/** The most time edits may take of a frame, in milliseconds. At least one chunk is always made, so a dig is never left waiting. */
const REBUILD_BUDGET_MS = 4;

/** What a game asks of its volumes. Places are in the world. @experimental */
export class VoxelTerrains {
    /** @internal */ app_: App | null = null;
    /** @internal */ readonly built_ = new Map<Entity, Built>();
    /** @internal */ readonly sources_ = new Map<Entity, VoxelSource>();
    /** @internal */ readonly sourceIds_ = new Map<VoxelSource, number>();
    private readonly listeners_ = new Set<(event: VoxelEditEvent) => void>();

    /** Sets what the volume is before anyone digs in it, in place of the stock hills. The same place must always get the same answer. */
    setSource(entity: Entity, source: VoxelSource | null): void {
        if (source) this.sources_.set(entity, source);
        else this.sources_.delete(entity);
    }

    /** The volume's own field: made here if the system has not yet got to it, so a game can edit in the frame it spawned it. */
    private fieldOf_(entity: Entity): Built | null {
        return this.ensure_?.(entity) ?? this.built_.get(entity) ?? null;
    }

    /** @internal */ ensure_: ((entity: Entity) => Built | null) | null = null;

    /** Changes the volume with a shape. Every chunk the shape reaches is made again, and the collision with it. */
    edit(entity: Entity, shape: VoxelShape, op: VoxelOp, options?: VoxelEditOptions): VoxelEditResult | null {
        const built = this.fieldOf_(entity);
        if (!built) return null;
        const local = localShape(shape, built.origin);
        const result = built.field.apply(local, op, options);
        for (const chunk of built.field.takeDirty()) built.waiting.set(chunk.key, chunk);
        if (result.chunks > 0) for (const listener of this.listeners_) listener({ entity, shape, op, result });
        return result;
    }

    /** Carves a shape out of the volume. What it answers is how much of each material came out. */
    carve(entity: Entity, shape: VoxelShape, options?: VoxelEditOptions): VoxelEditResult | null {
        return this.edit(entity, shape, 'subtract', options);
    }

    /** Fills a shape with a material. */
    fill(entity: Entity, shape: VoxelShape, material = 0, options?: VoxelEditOptions): VoxelEditResult | null {
        return this.edit(entity, shape, 'add', { ...options, material });
    }

    /** Hears every edit that changed something: what a game keeps a navmesh or a quest in step by. Returns how to stop. */
    onEdit(listener: (event: VoxelEditEvent) => void): () => void {
        this.listeners_.add(listener);
        return () => { this.listeners_.delete(listener); };
    }

    /** Where a ray first meets any volume, within `maxDistance`. */
    raycast(origin: VoxelPoint, direction: VoxelPoint, maxDistance = 1000): (VoxelHit & { entity: Entity }) | null {
        let best: (VoxelHit & { entity: Entity }) | null = null;
        for (const entity of [...this.built_.keys()]) {
            const built = this.built_.get(entity)!;
            const hit = built.field.raycast(sub(origin, built.origin), direction, best ? best.distance : maxDistance);
            if (hit && (!best || hit.distance < best.distance)) best = { ...hit, point: add(hit.point, built.origin), entity };
        }
        return best;
    }

    /** The signed distance at a place: below zero is inside something solid. Null with no such volume. */
    distanceAt(entity: Entity, at: VoxelPoint): number | null {
        const built = this.fieldOf_(entity);
        if (!built) return null;
        const p = sub(at, built.origin);
        return built.field.distanceAt(p.x, p.y, p.z);
    }

    /** The material at a place, or -1 in the open. Null with no such volume. */
    materialAt(entity: Entity, at: VoxelPoint): number | null {
        const built = this.fieldOf_(entity);
        if (!built) return null;
        const p = sub(at, built.origin);
        return built.field.materialAt(p.x, p.y, p.z);
    }

    /** What a save holds: only chunks that were edited, and with `changedOnly` only those changed since the last such call. Plain JSON. */
    serialize(entity: Entity, changedOnly = false): VoxelFieldData | null {
        return this.fieldOf_(entity)?.field.serialize(changedOnly) ?? null;
    }

    /** Puts a save back; with `merge`, over what is there rather than instead of it. False when it was cut from another grid and nothing changed. */
    restore(entity: Entity, data: VoxelFieldData, merge = false): boolean {
        const built = this.fieldOf_(entity);
        if (!built) return false;
        const skipped: string[] = [];
        const ok = built.field.restore(data, merge, skipped);
        if (skipped.length) log.warn('voxel', `a save's chunks could not be read and were left as they were: ${skipped.slice(0, 8).join(' ')}`);
        for (const chunk of built.field.takeDirty()) built.waiting.set(chunk.key, chunk);
        return ok;
    }

    /** Whether the volume round (x, z) is built for collision: what a game waits on before it drops something there. */
    collisionReadyAt(entity: Entity, x: number, z: number): boolean {
        const built = this.built_.get(entity);
        if (!built) return false;
        const span = built.field.cellSize * built.field.chunkCells;
        return built.collidedColumns.has(columnKey(Math.floor((x - built.origin.x) / span), Math.floor((z - built.origin.z) / span)));
    }

    status(entity: Entity): VoxelTerrainStatus | null {
        const built = this.built_.get(entity);
        if (!built) return null;
        let triangles = 0;
        for (const d of built.drawn.values()) triangles += d.triangles;
        const held = built.field.held;
        return {
            drawnChunks: built.drawn.size, triangles, collidingChunks: built.collided.size, heldChunks: held.chunks, editedChunks: held.edited,
            waitingChunks: built.waiting.size, lastRebuildMs: built.lastRebuildMs,
        };
    }
}

const add = (a: VoxelPoint, b: VoxelPoint): VoxelPoint => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: VoxelPoint, b: VoxelPoint): VoxelPoint => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

function localShape(shape: VoxelShape, origin: VoxelPoint): VoxelShape {
    if (shape.kind === 'capsule') return { ...shape, from: sub(shape.from, origin), to: sub(shape.to, origin) };
    return { ...shape, center: sub(shape.center, origin) };
}

/** @experimental */
export const VoxelTerrainsRes = defineResource<VoxelTerrains>(new VoxelTerrains(), 'VoxelTerrains');

/** Makes and keeps every `VoxelTerrain`. @experimental */
export class VoxelPlugin implements Plugin {
    name = 'voxel';
    readonly activeWhen = [VoxelTerrain];
    private stock_ = 0;

    build(app: App): void {
        const terrains = new VoxelTerrains();
        terrains.app_ = app;
        terrains.ensure_ = (entity) => this.ensure(app, terrains, entity);
        app.insertResource(VoxelTerrainsRes, terrains);
        app.world.onDespawn((entity) => {
            const built = terrains.built_.get(entity);
            if (built) this.destroy(app, terrains, built);
            terrains.sources_.delete(entity);
        });
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            const rendering = app.hasResource(Assets);
            for (const built of [...terrains.built_.values()]) {
                if (!app.world.valid(built.entity) || !app.world.has(built.entity, VoxelTerrain)) this.destroy(app, terrains, built);
            }
            for (const entity of app.world.getEntitiesWithComponents([VoxelTerrain, Transform])) {
                const built = this.ensure(app, terrains, entity);
                if (!built) continue;
                built.data = { ...(app.world.get(entity, VoxelTerrain) as VoxelTerrainData) };
                this.collide(app, built);
                if (rendering) {
                    if (built.data.material || built.instance) this.draw(app, built);
                    else if (!built.pending) void this.prepare(app, built);
                }
                this.remake(app, built);
                built.field.trim((c) => built.collidedColumns.has(columnKey(c.cx, c.cz)));
            }
        }, { name: 'VoxelTerrainSystem' }));
    }

    cleanup(app?: App): void {
        if (!app?.hasResource(VoxelTerrainsRes)) return;
        const terrains = app.getResource(VoxelTerrainsRes);
        for (const built of [...terrains.built_.values()]) this.destroy(app, terrains, built);
        if (this.stock_) Material.release(this.stock_);
        this.stock_ = 0;
    }

    /** The volume's state: made again when what it is made from has changed. */
    private ensure(app: App, terrains: VoxelTerrains, entity: Entity): Built | null {
        const world = app.world;
        if (!world.valid(entity) || !world.has(entity, VoxelTerrain) || !world.has(entity, Transform)) return null;
        world.ensureTransformsComposed();
        const data = world.get(entity, VoxelTerrain) as VoxelTerrainData;
        const at = (world.get(entity, Transform) as TransformData).worldPosition;
        const source = terrains.sources_.get(entity);
        const signature = signatureOf(data, at, source, terrains.sourceIds_);
        const had = terrains.built_.get(entity);
        if (had?.signature === signature) return had;
        // Moved, it is the same volume elsewhere: what was dug goes with it.
        const save = had ? had.field.serialize() : null;
        if (had) this.destroy(app, terrains, had);
        const field = new VoxelField({
            cellSize: data.cellSize, chunkCells: data.chunkCells, minY: data.minY, maxY: data.maxY,
            source: source ?? noiseVoxelSource(data),
        });
        const built: Built = {
            entity, signature, field, origin: { x: at.x, y: at.y, z: at.z }, data: { ...data }, drawn: new Map(), drawnColumns: new Set(), collidedColumns: new Set(), collided: new Set(),
            waiting: new Map(), instance: 0, pending: false, epoch: (had?.epoch ?? 0) + 1, lastRebuildMs: 0,
        };
        if (save) { field.restore(save); field.takeDirty(); }
        terrains.built_.set(entity, built);
        return built;
    }

    private async prepare(app: App, built: Built): Promise<void> {
        built.pending = true;
        const epoch = built.epoch;
        try {
            const material = await this.stock(app);
            if (built.epoch !== epoch || !material) return;
            built.instance = Material.createInstance(material);
        } catch (e) {
            log.error('voxel', 'preparing the volume failed', e);
        } finally {
            built.pending = false;
        }
    }

    private async stock(app: App): Promise<number> {
        if (this.stock_) return this.stock_;
        const source = await app.getResource(Assets).load<MaterialShaderSource>('material-shader', 'builtin:voxel-ground');
        const shader = source.compile([]);
        if (this.stock_) return this.stock_;
        this.stock_ = Material.createFromAsset({
            version: MATERIAL_FORMAT_VERSION, type: 'material', shader: 'builtin:voxel-ground', blendMode: BlendMode.None,
            depthTest: true, depthWrite: true, cull: 0, properties: {},
        }, shader);
        return this.stock_;
    }

    private rows(built: Built): number[] {
        const out: number[] = [];
        for (let y = built.field.rowMin; y <= built.field.rowMax; y++) out.push(y);
        return out;
    }

    /** One chunk's skin, and its surface data, or null where nothing passes through. */
    private skin(built: Built, chunk: VoxelChunk): VoxelSurface | null {
        return chunk.surfaced ? surfaceNets(chunk.distances!, chunk.materials!, built.field.chunkCells, built.field.cellSize) : null;
    }

    private showChunk(app: App, built: Built, chunk: VoxelChunk, surface: VoxelSurface | null): void {
        const d = built.data, world = app.world, assets = app.getResource(Assets);
        const had = built.drawn.get(chunk.key);
        if (!surface) {
            if (had) {
                if (world.valid(had.entity)) world.despawn(had.entity);
                assets.releaseBuiltMesh(had.mesh);
                built.drawn.delete(chunk.key);
            }
            return;
        }
        const mesh = assets.createMesh(voxelMesh(surface));
        if (!mesh) return;
        const span = built.field.cellSize * built.field.chunkCells;
        const entity = had?.entity ?? world.spawn(`VoxelChunk ${chunk.key}`);
        if (!had) {
            world.insert(entity, RuntimeOnly);
            world.insert(entity, Transform, { position: { x: chunk.cx * span, y: chunk.cy * span, z: chunk.cz * span } });
            world.setParent(entity, built.entity);
        }
        const renderer = had ? world.get(entity, MeshRenderer) as MeshRendererData : null;
        world.insert(entity, MeshRenderer, {
            ...renderer, enabled: true, mesh, material: built.instance || d.material, texture: d.map0, lit: true, opaque: true, cullBackfaces: true, castShadows: d.castShadows,
        } as Partial<MeshRendererData>);
        if (had) assets.releaseBuiltMesh(had.mesh);
        built.drawn.set(chunk.key, { entity, mesh, triangles: surface.indices.length / 3 });
    }

    private colliderOf(app: App, built: Built, chunk: VoxelChunk, surface: VoxelSurface | null): void {
        const geometry = collisionGeometryOf(app), key = pieceKey(built.entity, chunk.key), d = built.data;
        if (!surface) {
            geometry.delete(key);
            built.collided.delete(chunk.key);
            return;
        }
        const span = built.field.cellSize * built.field.chunkCells;
        geometry.set(key, {
            owner: built.entity, origin: [built.origin.x + chunk.cx * span, built.origin.y + chunk.cy * span, built.origin.z + chunk.cz * span],
            positions: surface.positions, indices: surface.indices, friction: d.friction, restitution: 0, layer: d.collisionLayer,
        });
        built.collided.add(chunk.key);
    }

    /** The chunks edits reached, for as long as the frame can spare and at least one, so a dig is always seen. */
    private remake(app: App, built: Built): void {
        if (built.waiting.size === 0) return;
        const started = performance.now();
        const rendering = app.hasResource(Assets) && !!(built.instance || built.data.material);
        for (const [key, chunk] of built.waiting) {
            const column = columnKey(chunk.cx, chunk.cz);
            const drawn = rendering && built.drawnColumns.has(column), collided = built.collidedColumns.has(column);
            if (drawn || collided) {
                const began = performance.now();
                const live = built.field.chunk(chunk.cx, chunk.cy, chunk.cz);
                const surface = this.skin(built, live);
                if (drawn) this.showChunk(app, built, live, surface);
                if (collided && built.data.collision) this.colliderOf(app, built, live, surface);
                built.lastRebuildMs = performance.now() - began;
            }
            built.waiting.delete(key);
            if (performance.now() - started > REBUILD_BUDGET_MS) break;
        }
    }

    private draw(app: App, built: Built): void {
        const d = built.data;
        const instance = built.instance;
        if (instance && !d.material) {
            const set = (name: string, value: Parameters<typeof Material.setUniform>[2]): void => { Material.setUniform(instance, name, value); };
            for (const [i, c] of [d.color0, d.color1, d.color2, d.color3].entries()) set(`u_voxelTint${i}`, { x: c.r, y: c.g, z: c.b, w: c.a });
            set('u_voxelTile', d.tile);
            if (d.map1) set('u_voxelMap1', Material.tex(d.map1));
            if (d.map2) set('u_voxelMap2', Material.tex(d.map2));
            if (d.map3) set('u_voxelMap3', Material.tex(d.map3));
        }
        const span = built.field.cellSize * built.field.chunkCells;
        const chunks = chunksOf(app);
        chunks.set<{ cx: number; cz: number; skins: { chunk: VoxelChunk; surface: VoxelSurface | null }[] }>(drawLayerOf(built.entity), {
            label: 'Building the volume',
            originX: built.origin.x, originZ: built.origin.z, sizeX: span, sizeZ: span, extent: null,
            loadRadius: Math.max(d.drawDistance, 0), unloadRadius: Math.max(d.drawDistance, 0) + span,
            generation: built.epoch,
            sources: () => drawSources(app),
            make: (cx, cz) => ({ cx, cz, skins: this.rows(built).map((cy) => {
                const chunk = built.field.chunk(cx, cy, cz);
                return { chunk, surface: this.skin(built, chunk) };
            }) }),
            publish: (cx, cz, { skins }) => {
                built.drawnColumns.add(columnKey(cx, cz));
                for (const { chunk, surface } of skins) {
                    this.showChunk(app, built, chunk, surface);
                    built.waiting.delete(chunk.key);
                }
            },
            release: (cx, cz) => {
                built.drawnColumns.delete(columnKey(cx, cz));
                for (const cy of this.rows(built)) {
                    const key = chunkKey(cx, cy, cz);
                    const had = built.drawn.get(key);
                    if (!had) continue;
                    if (app.world.valid(had.entity)) app.world.despawn(had.entity);
                    if (app.hasResource(Assets)) app.getResource(Assets).releaseBuiltMesh(had.mesh);
                    built.drawn.delete(key);
                }
            },
        });
    }

    private collide(app: App, built: Built): void {
        const id = collideLayerOf(built.entity), d = built.data;
        if (!d.collision) {
            if (app.hasResource(ProceduralChunksRes)) app.getResource(ProceduralChunksRes).remove(id);
            return;
        }
        const span = built.field.cellSize * built.field.chunkCells;
        chunksOf(app).set<{ skins: { chunk: VoxelChunk; surface: VoxelSurface | null }[] }>(id, {
            label: 'Building the volume\'s collision',
            originX: built.origin.x, originZ: built.origin.z, sizeX: span, sizeZ: span, extent: null,
            loadRadius: Math.max(d.collisionDistance, 0), unloadRadius: Math.max(d.collisionDistance, 0) + span,
            generation: `${built.epoch}:${d.collisionLayer}:${d.friction}`,
            sources: () => movers(app),
            make: (cx, cz) => ({ skins: this.rows(built).map((cy) => {
                const chunk = built.field.chunk(cx, cy, cz);
                return { chunk, surface: this.skin(built, chunk) };
            }) }),
            publish: (cx, cz, { skins }) => {
                built.collidedColumns.add(columnKey(cx, cz));
                for (const { chunk, surface } of skins) this.colliderOf(app, built, chunk, surface);
            },
            release: (cx, cz) => {
                built.collidedColumns.delete(columnKey(cx, cz));
                const geometry = collisionGeometryOf(app);
                for (const cy of this.rows(built)) {
                    const key = chunkKey(cx, cy, cz);
                    geometry.delete(pieceKey(built.entity, key));
                    built.collided.delete(key);
                }
            },
        });
    }

    private destroy(app: App, terrains: VoxelTerrains, built: Built): void {
        terrains.built_.delete(built.entity);
        built.epoch++;
        if (app.hasResource(ProceduralChunksRes)) {
            const chunks = app.getResource(ProceduralChunksRes);
            chunks.remove(drawLayerOf(built.entity));
            chunks.remove(collideLayerOf(built.entity));
        }
        collisionGeometryOf(app).deleteAll(`voxel:${built.entity}:`);
        for (const had of built.drawn.values()) {
            if (app.world.valid(had.entity)) app.world.despawn(had.entity);
            if (app.hasResource(Assets)) app.getResource(Assets).releaseBuiltMesh(had.mesh);
        }
        built.drawn.clear();
        if (built.instance) Material.release(built.instance);
        built.instance = 0;
    }
}

/** @experimental */
export const voxelPlugin: VoxelPlugin = /* @__PURE__ */ new VoxelPlugin();
