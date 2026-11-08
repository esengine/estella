// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rules.ts
 * @brief   What a game says its worlds are made of: biomes, the recipes that stand in them, and the layers they are placed in.
 *
 * @details The engine places; the game rules; the artists make the recipes. A rule set is registered under an id and named by a
 *          `WorldGen` component with its version, as a terrain names its provider, and a saved world keeps the version it was made
 *          with.
 *
 *            - A biome is a weight over the fields: each condition a band of one field with soft edges, multiplied. Where several hold
 *              their weights are mixed, its edge wanders by `transition` world units of noise so no border is ruled, and it says how
 *              the ground is painted and which recipes stand in it, in which layer and how densely.
 *            - A recipe is a group an artist composed: an anchor (a big tree, a main rock) and members placed round it within ranges
 *              (a ring of distances, an arc of angles, a count, a scale), each with its footprint (what it takes on the ground: a
 *              trunk) apart from its canopy, how it stands on the ground and how steep it may stand, and whether it may be left out.
 *            - A layer is a pass of placement: big things first. Each takes its candidates on a jittered grid `spacing` apart, keeps
 *              clear of the footprints of the layers before it, and is published in chunks out to `drawDistance`.
 */
import type { FieldFn, NoiseField } from './fields';
import type { PlantKind } from '../foliage/plantKind';
import type { GroundingOptions } from './grounding';

/** A band of one field with soft edges: full weight between `min` and `max`, fading to none over `blend` past each. */
export interface BiomeCondition { field: string; min?: number; max?: number; blend?: number }

/** What stands in a biome: a recipe, the layer it is placed in, and the share of that layer's candidates it takes (0 to 1). */
export interface BiomeRecipe { recipe: string; layer: string; density: number }

export interface BiomeDef {
    id: string;
    conditions: readonly BiomeCondition[];
    /** A multiplier on its weight, to favour it where it ties. */
    weight?: number;
    /** How far its edge wanders, in world units. */
    transition?: number;
    /** How the ground is painted where it holds: the weight of each of the terrain's layers (four, or up to eight), and how much of the ground's own paint it replaces. */
    paint?: readonly number[];
    paintStrength?: number;
    recipes: readonly BiomeRecipe[];
}

/** One kind of thing in a recipe. */
export interface RecipeMember {
    /** Stable within the recipe: part of every placement's id. */
    id: string;
    /** The mesh it is drawn with, and the material: an asset path (as a recipe file names them) or a handle already loaded. Absent for a member that is a `plant`. */
    mesh?: number | string;
    /**
     * Or the kind of plant it is, by its name in the rules' `plants`: several parts (a trunk and its crown), a cheaper mesh and a far version each,
     * and the colourings the art gives it. It is grown a cell at a time like a `PlacedFoliage`, in place of the mesh and material above.
     */
    plant?: string;
    material?: number | string;
    /** What a game interacts with it as (ore, tree to fell); absent, it is decoration and drawn merged with its chunk. */
    interactive?: string;
    /** How many of it (the anchor is always one). */
    count?: readonly [number, number];
    /** How far from the anchor and at what angles (degrees, from +x toward +z), for a member. */
    ring?: readonly [number, number];
    arc?: readonly [number, number];
    scale?: readonly [number, number];
    /** Radius it takes on the ground: world units by default, model units with scaleFootprint. */
    footprint: number;
    /** Scale footprint and canopy with the model. Omitted preserves existing world-unit rules. */
    scaleFootprint?: boolean;
    /** Fit an upright building over its whole base; also reserves at least the scaled base's circumcircle. */
    grounding?: GroundingOptions;
    /** How far it spreads overhead (a crown), for what is kept clear of view; the footprint when absent. */
    canopy?: number;
    /** Upright, or leaning with the ground. */
    attach?: 'upright' | 'align';
    /** The least the ground may face up for it to stand (0 to 1). */
    minUp?: number;
    /** How deep in water it may stand (reeds); 0 keeps it on dry ground. */
    waterDepth?: number;
    /** The chance it is placed at all, for a member that may be left out. */
    chance?: number;
    /** Tags a zone may keep it out by, beside its recipe's. */
    tags?: readonly string[];
    /**
     * Decoration's far version past its layer's `lodDistance`: two crossed cards (or a tent, for a conifer) showing this rectangle of its
     * texture. Absent, it is drawn whole out to `drawDistance`.
     */
    far?: { u0: number; v0: number; u1: number; v1: number; tent?: boolean };
}

export interface Recipe {
    id: string;
    /** Bumped when the recipe changes what it places: part of every placement's id. */
    version: number;
    tags?: readonly string[];
    anchor: RecipeMember;
    members?: readonly RecipeMember[];
}

export interface PlacementLayer {
    id: string;
    /** Bumped when the layer's placement changes: part of every placement's id. */
    version?: number;
    /** The distance between candidates: about the distance between groups where the layer is full. */
    spacing: number;
    /** How far from the streaming sources the layer is published, and the side of its chunks. */
    drawDistance: number;
    /** Past this, decoration that has a far version is drawn as it; the layer's draw distance when absent. */
    lodDistance?: number;
    chunkSize?: number;
    /**
     * How much further apart the far versions of this layer's plants are planned than the layer's `spacing` (default 1): a plant kind that keeps a quarter
     * of its plants far off is planned at 2, which is a quarter of the candidates to work out instead of all of them and three in four thrown away.
     */
    farSpacing?: number;
    /** Whether later layers keep clear of its footprints (default true). */
    occupies?: boolean;
}

/** A game's rules for laying out a world. */
export interface WorldRules {
    id: string;
    /** The versions it can still make; a world names one. */
    versions: readonly number[];
    biomes: readonly BiomeDef[];
    recipes: readonly Recipe[];
    /** The kinds of plant the recipes' members name. */
    plants?: Readonly<Record<string, PlantKind>>;
    /** In order: each keeps clear of the layers before it. */
    layers: readonly PlacementLayer[];
    noise?: Partial<Record<string, NoiseField>>;
    fields?: Record<string, FieldFn>;
}

const rules_ = new Map<string, WorldRules>();
let revision_ = 0;

/**
 * Makes `rules` available to every WorldGen that names them; a second set under the same id replaces the first. A WorldGen waiting
 * for its rules (a script registers them after the scene loaded) is laid out once they are here.
 */
export function registerWorldRules(rules: WorldRules): void {
    rules_.set(rules.id, rules);
    revision_++;
}

/** @internal Bumped on every registration, so what named rules that were missing asks again. */
export function worldRulesRevision(): number {
    return revision_;
}

export function worldRules(id: string): WorldRules | undefined {
    return rules_.get(id);
}

/** The weight of a soft band at `v`. */
export function bandWeight(c: BiomeCondition, v: number): number {
    if (!Number.isFinite(v)) return 0;
    const blend = Math.max(c.blend ?? 0, 1e-9);
    const edge = (d: number): number => {
        if (d <= 0) return 1;
        if (d >= blend) return 0;
        const t = 1 - d / blend;
        return t * t * (3 - 2 * t);
    };
    return edge(c.min !== undefined ? c.min - v : -1) * edge(c.max !== undefined ? v - c.max : -1);
}
