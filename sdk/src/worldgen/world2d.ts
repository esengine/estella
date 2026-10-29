// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    world2d.ts
 * @brief   A generated world on the screen plane: the rules a 3D world is laid out by, read flat over x and y, and published in chunks round the camera.
 *
 * @details The plan (plan.ts) is a function of position, seed and rules and asks nothing of the ground but a height, so a world with no
 *          terrain is a flat plan, and a 2D world is that plan with its second axis read as world y. Nothing is drawn here: what the plan
 *          places is a list of things standing at points (a recipe, a member of it, a biome, a footprint), and what a thing looks like
 *          (a sprite, a prefab, a tile of the ground) is the game's, said in `publish`.
 *
 *            - A chunk is a square of the world, `chunkSize` a side. Each frame the ones near a streaming source (or the camera) are made,
 *              nearest first within the frame's budget, and the ones left behind are released with whatever `publish` handed back to undo them.
 *            - What `publish` is given: the placements of the chunk, and the biome of each cell of a grid across it, for painting the ground.
 *            - What a player changed (a tree felled) is a {@link PlacementDiffs}: laid over the plan before a chunk is shown, so it stays felled
 *              when its chunk is let go and made again, and after a save is read back. Only the chunk the thing stood in is made again.
 *            - A group (an anchor and the members placed round it) belongs to the chunk its anchor stands in, so one across a chunk's edge is neither
 *              cut nor placed twice.
 *
 *          The rules are the 3D ones: a recipe's `mesh`, `material`, `attach` and `minUp` mean nothing here and are not read, and its `ring` is in world
 *          units with `arc` in degrees from +x toward +y.
 */
import type { App } from '../app/app';
import { chunksOf, streamingSourcesOf, type ChunkSource } from '../residency/chunks';
import { makePlanePlan } from './planePlan';
import { worldRules, type WorldRules } from './rules';
import { Zones, type ZoneDef } from './zones';
import { PlacementDiffs } from './diffs';
import type { Placement, WorldPlan } from './plan';

/** One thing the plan placed, on the screen plane. */
export interface Placement2D {
    /** Stable across loads and load orders: what a save records and `remove` takes. */
    id: string;
    group: string;
    layer: string;
    recipe: string;
    member: string;
    biome: string;
    /** The zone it stands in, if any. */
    zone: string | null;
    x: number;
    y: number;
    /** Turn, in radians, and size. */
    yaw: number;
    scale: number;
    /** What a game interacts with it as (a tree to fell); null for scenery. */
    interactive: string | null;
    /** The kind of plant the rules name, or null. */
    plant: string | null;
    /** What it takes on the ground, and how far it spreads overhead, in world units. */
    footprint: number;
    canopy: number;
}

/** One chunk, as `publish` is given it. */
export interface World2DChunk {
    /** The chunk's place on the grid of chunks, and the world corner (lowest x and y) it starts at. */
    cx: number;
    cy: number;
    x0: number;
    y0: number;
    size: number;
    /** The things standing in it, with what a player changed laid over them. */
    placements: Placement2D[];
    /** The ground: `cells` by `cells` squares across the chunk, row 0 at the lowest y, each the index into `biomes` of the biome that holds most there (255: none). */
    cells: number;
    cellSize: number;
    biomeGrid: Uint8Array;
    /** The rules' biome ids, in the order the grid indexes them. */
    biomes: readonly string[];
}

export interface World2DOptions {
    /** The rules, or the id of rules the game registered with `registerWorldRules`. */
    rules: WorldRules | string;
    seed?: number;
    /** The world as the game names it: another name lays out another world by the same rules and seed. */
    world?: string;
    /** The side of a chunk, in world units (default 512). */
    chunkSize?: number;
    /** The side of one cell of the ground grid, in world units (default 32). */
    cellSize?: number;
    /** Chunks within this of a source are made, and one is released past `unloadRadius`. Defaults: a chunk and a half, and two and a half. */
    loadRadius?: number;
    unloadRadius?: number;
    /** Where the world is wanted round, in world x and y; absent, the streaming sources, or else the camera. */
    sources?: () => Iterable<{ x: number; y: number }>;
    /** Areas planned by hand: kept clear, or held to a biome. A zone's `z` is world y. */
    zones?: readonly ZoneDef[];
    /** What players changed; absent, the world keeps its own. */
    diffs?: PlacementDiffs;
    /** Shows one chunk. Returns how to take what it showed away (despawn what it spawned); `release` calls it. */
    publish(chunk: World2DChunk): (() => void) | void;
}

/** A generated 2D world: ask it, change it, let it go. */
export interface World2D {
    /** The plan, for the questions a game asks about the world itself. */
    readonly plan: WorldPlan;
    /** What players changed. Remove a felled tree's id here and its chunk is made again without it. */
    readonly diffs: PlacementDiffs;
    /** The biome that holds most at a world point, or null. */
    biomeAt(x: number, y: number): string | null;
    /** The chunks counted: ready, pending, failed. */
    status(): { ready: number; pending: number; failed: number };
    /** Takes the world away, releasing every chunk. */
    dispose(): void;
}

/** A placement as a 2D game reads it: the plan's second axis is world y. */
export function placement2D(p: Placement): Placement2D {
    return {
        id: p.id, group: p.group, layer: p.layer, recipe: p.recipe, member: p.member, biome: p.biome, zone: p.zone,
        x: p.x, y: p.z, yaw: p.yaw, scale: p.scale, interactive: p.interactive, plant: p.plant, footprint: p.footprint, canopy: p.canopy,
    };
}

/**
 * One chunk of a plan: what stands in the square [cx * size, (cx + 1) * size) by [cy * size, (cy + 1) * size), with what players changed laid over
 * it, and the biome of each cell of a `cells` by `cells` grid across it. `ids` is every placement the plan made there, removed ones too, which is
 * what a change to one of them is looked up by.
 */
export function world2dChunk(
    plan: WorldPlan, diffs: PlacementDiffs, cx: number, cy: number, size: number, cells: number,
): { chunk: World2DChunk; ids: string[] } {
    const biomes = plan.rules.biomes.map((b) => b.id);
    const biomeIndex = new Map(biomes.map((b, i) => [b, i]));
    const x0 = cx * size, y0 = cy * size;
    const placements: Placement2D[] = [];
    const ids: string[] = [];
    for (const p of plan.placementsIn(x0, y0, x0 + size, y0 + size)) {
        ids.push(p.id);
        if (diffs.isRemoved(p.id)) continue;
        const out = placement2D(p);
        const change = diffs.changeOf(p.id);
        if (change) {
            if (change.x !== undefined) out.x = change.x;
            if (change.z !== undefined) out.y = change.z;
            if (change.yaw !== undefined) out.yaw = change.yaw;
            if (change.scale !== undefined) out.scale = change.scale;
        }
        placements.push(out);
    }
    const biomeGrid = new Uint8Array(cells * cells).fill(255);
    const step = size / cells;
    for (let gy = 0; gy < cells; gy++) {
        for (let gx = 0; gx < cells; gx++) {
            const biome = plan.biomeAt(x0 + (gx + 0.5) * step, y0 + (gy + 0.5) * step);
            const index = biome === null ? undefined : biomeIndex.get(biome);
            if (index !== undefined) biomeGrid[gy * cells + gx] = index;
        }
    }
    return { chunk: { cx, cy, x0, y0, size, placements, cells, cellSize: step, biomeGrid, biomes }, ids };
}

interface Made {
    chunk: World2DChunk;
    ids: string[];
}

interface Published {
    dispose: (() => void) | null;
}

/** Lays out a world by `rules` over the screen plane and publishes it in chunks round the camera, as `id`. */
export function createWorld2D(app: App, id: string, options: World2DOptions): World2D {
    const rules = typeof options.rules === 'string' ? worldRules(options.rules) : options.rules;
    if (!rules) throw new Error(`createWorld2D("${id}"): there are no rules registered as "${String(options.rules)}"`);
    const seed = options.seed ?? 1;
    const world = options.world ?? id;
    const size = Math.max(options.chunkSize ?? 512, 8);
    const cellSize = Math.min(Math.max(options.cellSize ?? 32, 1), size);
    const cells = Math.max(Math.round(size / cellSize), 1);
    const loadRadius = options.loadRadius ?? size * 1.5;
    const unloadRadius = Math.max(options.unloadRadius ?? size * 2.5, loadRadius);
    const diffs = options.diffs ?? new PlacementDiffs();
    const zones = new Zones();
    for (const zone of options.zones ?? []) zones.set(zone);
    const { plan } = makePlanePlan({ rules, farRules: null, seed, world, ground: null, flatY: 0, water: null, layers: [], zones });

    const chunks = chunksOf(app);
    /** The chunk each placement id was last made into, so a change to it makes only that chunk again. */
    const ownerOf = new Map<string, { cx: number; cy: number }>();

    const sources = options.sources
        ? (): Iterable<ChunkSource> => [...options.sources!()].map((s) => ({ x: s.x, z: s.y }))
        : undefined;

    chunks.set<Made & Published>(id, {
        label: `World ${id}`,
        plane: 'xy',
        originX: 0, originZ: 0, sizeX: size, sizeZ: size, extent: null,
        loadRadius, unloadRadius,
        generation: `${rules.id}:${seed}:${world}`,
        ...(sources ? { sources } : {}),
        make: (cx, cy) => ({ ...world2dChunk(plan, diffs, cx, cy, size, cells), dispose: null }),
        publish: (cx, cy, made) => {
            for (const placed of made.ids) ownerOf.set(placed, { cx, cy });
            made.dispose = options.publish(made.chunk) ?? null;
        },
        release: (cx, cy, made) => {
            made.dispose?.();
            made.dispose = null;
            for (const placed of made.ids) {
                const owner = ownerOf.get(placed);
                if (owner && owner.cx === cx && owner.cy === cy) ownerOf.delete(placed);
            }
        },
    });

    // A change to one placement makes only the chunk it stood in again.
    diffs.onChange = (changed) => {
        const owner = ownerOf.get(changed);
        if (!owner) return;
        const x = owner.cx * size, y = owner.cy * size;
        chunks.invalidate(id, x + 1, y + 1, x + size - 1, y + size - 1);
    };

    return {
        plan, diffs,
        biomeAt: (x, y) => plan.biomeAt(x, y),
        status: () => {
            const s = chunks.status(id);
            return s ? { ready: s.ready, pending: s.pending, failed: s.failed } : { ready: 0, pending: 0, failed: 0 };
        },
        dispose: () => {
            diffs.onChange = null;
            chunks.remove(id);
            ownerOf.clear();
        },
    };
}

/** The world's streaming sources as 2D points, for a game that wants to add its own. */
export function streamingPoints2D(app: App): { x: number; y: number }[] {
    return streamingSourcesOf(app).map((s) => ({ x: s.x, y: s.y ?? 0 }));
}
