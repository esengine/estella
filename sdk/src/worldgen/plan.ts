// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    plan.ts
 * @brief   Where everything in a world stands: biomes from the fields, groups from the recipes, layer by layer, the same whatever is
 *          asked first.
 *
 * @details Every answer is a function of the world position, the seed and the rules, so a chunk placed before its neighbour and one
 *          placed after it agree, and a server and a client agree.
 *
 *            - Each layer has one candidate a cell of a grid `spacing` apart, jittered, with a priority drawn for it. A candidate takes
 *              a biome by the weights there (so a border mixes), a recipe of that biome by its density, and must have ground, not be
 *              too steep or under water, not be kept out by a zone, and keep clear of the footprints of the layers before it.
 *            - Of two candidates of a layer whose groups would overlap, the one with the higher priority stands. Each candidate looks
 *              only at its neighbours, so nothing depends on the order chunks are made in.
 *            - A group's members are placed round its anchor and checked the same way; a member that cannot stand is left out.
 *            - A group belongs to the chunk its anchor stands in, members and all, so a group across a chunk's edge is neither cut nor
 *              placed twice.
 *            - Ids are made of the layer, the grid cell, the recipe and the member, with their versions: never a position in a list.
 */
import { Environment, fbm, hash01, hashString, type FieldValues } from './fields';
import { bandWeight, type BiomeDef, type PlacementLayer, type Recipe, type RecipeMember, type WorldRules } from './rules';
import type { Zones } from './zones';
import { fitGroundFootprint, type GroundFit } from './grounding';

/** One thing placed. */
export interface Placement {
    /** Stable across loads, load orders and rule additions: what a save records. */
    id: string;
    /** The group it belongs to (its anchor's group). */
    group: string;
    layer: string;
    recipe: string;
    recipeVersion: number;
    member: string;
    biome: string;
    /** The highest-priority zone it stands in, if any. */
    zone: string | null;
    x: number;
    y: number;
    z: number;
    yaw: number;
    scale: number;
    /** The ground's normal under it, which an aligned one leans with. */
    normal: [number, number, number];
    /** Which way is up where it stands, on a round world (where it is not +Y); an upright one stands along it. */
    up?: [number, number, number];
    attach: 'upright' | 'align';
    mesh: number;
    material: number;
    /** The kind of plant it is, by its name in the rules' `plants`, or null for a mesh. */
    plant: string | null;
    interactive: string | null;
    footprint: number;
    canopy: number;
    /** Full-footprint measurements when the recipe asks for ground fitting. */
    grounding?: GroundFit;
    /** The far version it is drawn as past its layer's lodDistance, when its recipe gives one. */
    far: RecipeMember['far'] | null;
}

/** Why a candidate or a member did not stand. */
export type Rejection = 'noBiome' | 'density' | 'noGround' | 'slope' | 'water' | 'relief' | 'zone' | 'occupied' | 'conflict';

export interface Group {
    id: string;
    layer: string;
    x: number;
    z: number;
    /** How far its members reach from its anchor, footprints included. */
    radius: number;
    priority: number;
    anchor: Placement;
    members: Placement[];
}

interface Candidate {
    gx: number;
    gz: number;
    x: number;
    z: number;
    priority: number;
    biome: string;
    recipe: Recipe;
    radius: number;
    anchor: Placement;
}

type Viable = { ok: true; candidate: Candidate } | { ok: false; reason: Rejection; detail?: string };

/** Entries a cache holds before it is emptied: a source walking for ever does not grow it without end. */
const CACHE_LIMIT = 40000;

function groupRadius(recipe: Recipe): number {
    let r = footprintOf(recipe.anchor, recipe.anchor.scale?.[1] ?? 1);
    for (const m of recipe.members ?? []) r = Math.max(r, (m.ring?.[1] ?? 0) + footprintOf(m, m.scale?.[1] ?? 1));
    return r;
}

/** A fitted base cannot reach beyond its reservation, even if the authored radius is smaller. */
function footprintOf(m: RecipeMember, scale: number): number {
    return Math.max(m.footprint * (m.scaleFootprint ? Math.abs(scale) : 1),
        m.grounding ? Math.hypot(...m.grounding.size) * Math.abs(scale) / 2 : 0);
}

const lerp = (range: readonly [number, number] | undefined, t: number, fallback: number): number =>
    range ? range[0] + (range[1] - range[0]) * t : fallback;

/** One world's plan. */
export class WorldPlan {
    private readonly worldHash_: number;
    private readonly recipes_ = new Map<string, Recipe>();
    private readonly layers_: { def: PlacementLayer; hash: number; maxRadius: number; recipes: Set<string> }[] = [];
    private readonly viable_ = new Map<string, Viable>();
    private readonly groups_ = new Map<string, Group | Rejection>();

    constructor(readonly rules: WorldRules, readonly env: Environment, readonly zones: Zones, readonly seed: number, readonly world: string) {
        this.worldHash_ = hashString(world) ^ seed;
        for (const r of rules.recipes) this.recipes_.set(r.id, r);
        for (const def of rules.layers) {
            const recipes = new Set<string>();
            for (const b of rules.biomes) for (const br of b.recipes) if (br.layer === def.id) recipes.add(br.recipe);
            let maxRadius = 0;
            for (const id of recipes) { const r = this.recipes_.get(id); if (r) maxRadius = Math.max(maxRadius, groupRadius(r)); }
            this.layers_.push({ def, hash: hashString(def.id), maxRadius, recipes });
        }
    }

    /** Forgets what was worked out: the ground, the water or the zones changed. */
    invalidate(): void {
        this.viable_.clear();
        this.groups_.clear();
    }

    /** The layer's index by id, or -1. */
    layerIndex(id: string): number {
        return this.layers_.findIndex((l) => l.def.id === id);
    }

    /** The weight of every biome that holds at (x, z), summing to 1 (empty where none does), heaviest first. */
    biomeWeights(x: number, z: number): { biome: string; weight: number }[] {
        const out: { biome: string; weight: number }[] = [];
        let sum = 0;
        for (const b of this.rules.biomes) {
            const w = this.biomeWeight(b, x, z);
            if (w > 0) { out.push({ biome: b.id, weight: w }); sum += w; }
        }
        // A zone that holds a biome takes the place over by its weight.
        for (const { zone, weight } of this.zones.at(x, z)) {
            if (!zone.biome) continue;
            for (const o of out) o.weight *= 1 - weight;
            sum = sum * (1 - weight) + weight;
            const had = out.find((o) => o.biome === zone.biome);
            if (had) had.weight += weight; else out.push({ biome: zone.biome, weight });
            break;
        }
        if (sum <= 0) return [];
        for (const o of out) o.weight /= sum;
        return out.filter((o) => o.weight > 0).sort((a, b) => b.weight - a.weight || (a.biome < b.biome ? -1 : 1));
    }

    /** The biome that holds most at (x, z), or null. */
    biomeAt(x: number, z: number): string | null {
        return this.biomeWeights(x, z)[0]?.biome ?? null;
    }

    /** The ground's paint at (x, z): `base` (grass, dirt, snow, rock) pulled toward each biome's paint by its weight and strength. */
    paint(x: number, z: number, base: readonly number[]): number[] {
        // As many layers as the ground or any biome here names (four or eight); one a biome does not name it paints nothing of.
        let n = base.length;
        const here = this.biomeWeights(x, z);
        for (const { biome } of here) n = Math.max(n, this.rules.biomes.find((d) => d.id === biome)?.paint?.length ?? 0);
        const out = Array.from({ length: n }, (_, c) => base[c] ?? 0);
        for (const { biome, weight } of here) {
            const b = this.rules.biomes.find((d) => d.id === biome);
            if (!b?.paint) continue;
            const k = weight * Math.min(Math.max(b.paintStrength ?? 1, 0), 1);
            for (let c = 0; c < n; c++) out[c] = out[c]! + ((b.paint[c] ?? 0) - (base[c] ?? 0)) * k;
        }
        const sum = out.reduce((a, b) => a + b, 0) || 1;
        return out.map((v) => v / sum);
    }

    /** The groups of layer `layer` whose anchors stand in [x0, x1) by [z0, z1). */
    groupsIn(layer: string, x0: number, z0: number, x1: number, z1: number): Group[] {
        const li = this.layerIndex(layer);
        if (li < 0) return [];
        const s = this.layers_[li]!.def.spacing;
        const out: Group[] = [];
        for (let gz = Math.floor(z0 / s); gz <= Math.floor(z1 / s); gz++) for (let gx = Math.floor(x0 / s); gx <= Math.floor(x1 / s); gx++) {
            const g = this.group(li, gx, gz);
            if (typeof g !== 'string' && g.x >= x0 && g.x < x1 && g.z >= z0 && g.z < z1) out.push(g);
        }
        return out;
    }

    /** Every placement of the given layers (all, by default) whose group's anchor stands in the square. */
    placementsIn(x0: number, z0: number, x1: number, z1: number, layers?: readonly string[]): Placement[] {
        const out: Placement[] = [];
        for (const l of this.layers_) {
            if (layers && !layers.includes(l.def.id)) continue;
            for (const g of this.groupsIn(l.def.id, x0, z0, x1, z1)) out.push(g.anchor, ...g.members);
        }
        return out;
    }

    /** How many candidates of a layer in the square stood, and why the rest did not. */
    stats(layer: string, x0: number, z0: number, x1: number, z1: number): Record<'placed' | Rejection, number> {
        const counts = { placed: 0, noBiome: 0, density: 0, noGround: 0, slope: 0, water: 0, relief: 0, zone: 0, occupied: 0, conflict: 0 };
        const li = this.layerIndex(layer);
        if (li < 0) return counts;
        const s = this.layers_[li]!.def.spacing;
        for (let gz = Math.floor(z0 / s); gz < Math.ceil(z1 / s); gz++) for (let gx = Math.floor(x0 / s); gx < Math.ceil(x1 / s); gx++) {
            const g = this.group(li, gx, gz);
            if (typeof g === 'string') counts[g]++; else counts.placed++;
        }
        return counts;
    }

    /** Everything that decided what stands at (x, z): the fields, the biomes, the zones, and each layer's candidate in that cell. */
    explain(x: number, z: number): {
        fields: FieldValues; biomes: { biome: string; weight: number }[]; zones: { id: string; kind: string; weight: number }[];
        layers: { layer: string; cell: [number, number]; group: string | null; rejected: Rejection | null; detail?: string }[];
    } {
        const layers = this.layers_.map((l, li) => {
            const gx = Math.floor(x / l.def.spacing), gz = Math.floor(z / l.def.spacing);
            const g = this.group(li, gx, gz);
            const v = this.viable(li, gx, gz);
            return {
                layer: l.def.id, cell: [gx, gz] as [number, number], group: typeof g === 'string' ? null : g.id,
                rejected: typeof g === 'string' ? g : null, detail: v.ok ? undefined : v.detail,
            };
        });
        return {
            fields: this.env.sample(x, z), biomes: this.biomeWeights(x, z),
            zones: this.zones.at(x, z).map(({ zone, weight }) => ({ id: zone.id, kind: zone.kind, weight })), layers,
        };
    }

    /** The group of layer `li` in grid cell (gx, gz), or why there is none. */
    group(li: number, gx: number, gz: number): Group | Rejection {
        const key = `${li}:${gx},${gz}`;
        const had = this.groups_.get(key);
        if (had !== undefined) return had;
        if (this.groups_.size > CACHE_LIMIT) this.groups_.clear();
        const made = this.makeGroup(li, gx, gz);
        this.groups_.set(key, made);
        return made;
    }

    private makeGroup(li: number, gx: number, gz: number): Group | Rejection {
        const v = this.viable(li, gx, gz);
        if (!v.ok) return v.reason;
        const c = v.candidate;
        const layer = this.layers_[li]!;
        const s = layer.def.spacing;
        // Of overlapping groups the higher priority stands; ties go to the lower cell, so every pair is settled one way.
        const reach = Math.ceil((c.radius + layer.maxRadius) / s);
        for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
            if (dx === 0 && dz === 0) continue;
            const n = this.viable(li, gx + dx, gz + dz);
            if (!n.ok) continue;
            const o = n.candidate;
            const wins = o.priority > c.priority || (o.priority === c.priority && (o.gz < gz || (o.gz === gz && o.gx < gx)));
            if (wins && Math.hypot(o.x - c.x, o.z - c.z) < c.radius + o.radius) return 'conflict';
        }
        const groupId = `${layer.def.id}@${layer.def.version ?? 1}:${gx},${gz}`;
        const r = c.recipe;
        const anchor = c.anchor;
        const members: Placement[] = [];
        const taken: Placement[] = [anchor];
        for (const [mi, m] of (r.members ?? []).entries()) {
            const h = (salt: number, k: number) => hash01(this.worldHash_, layer.hash, gx, gz, 1000 + mi * 37 + salt, k);
            const count = m.count ? m.count[0] + Math.floor(h(0, 0) * (m.count[1] - m.count[0] + 1)) : 1;
            for (let k = 0; k < count; k++) {
                if (m.chance !== undefined && h(1, k) >= m.chance) continue;
                const angle = lerp(m.arc, h(2, k), h(2, k) * 360) * Math.PI / 180;
                const dist = lerp(m.ring, h(3, k), 0);
                const x = c.x + Math.cos(angle) * dist, z = c.z + Math.sin(angle) * dist;
                const f = this.env.sample(x, z);
                const p = this.place(groupId, layer.def, r, m, k, x, z, c.biome, f, h(4, k));
                if (typeof p === 'string') continue;
                if (this.zones.excluding(x, z, p.footprint, this.tagsOf(layer.def, r, m), this.seed) !== null) continue;
                if (this.occupied(li, x, z, p.footprint) !== null) continue;
                if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < t.footprint + p.footprint)) continue;
                members.push(p);
                taken.push(p);
            }
        }
        return { id: groupId, layer: layer.def.id, x: c.x, z: c.z, radius: c.radius, priority: c.priority, anchor, members };
    }

    private place(group: string, layer: PlacementLayer, r: Recipe, m: RecipeMember, k: number, x: number, z: number,
                  biome: string, f: FieldValues, turn: number): Placement | Rejection {
        const why = this.standing(f, m);
        if (why) return why;
        const h = hash01(this.worldHash_, hashString(group), hashString(m.id), k, 7);
        const yaw = (turn || h) * Math.PI * 2, scale = lerp(m.scale, hash01(this.worldHash_, hashString(group), k, 11), 1);
        let grounding: GroundFit | undefined;
        if (m.grounding) {
            const result = fitGroundFootprint(this.env.inputs, x, z, yaw, scale, m.grounding, m);
            if (!result.ok) return result.reason;
            grounding = result.fit;
        }
        const g = this.env.inputs.ground(x, z);
        const up = g?.up ?? 1;
        const n = g?.normal ?? [0, up, Math.sqrt(Math.max(0, 1 - up * up))];
        return {
            id: `${group}/${r.id}@${r.version}/${m.id}.${k}`, group, layer: layer.id, recipe: r.id, recipeVersion: r.version, member: m.id,
            biome, zone: this.zones.at(x, z)[0]?.zone.id ?? null,
            x, y: grounding?.y ?? f.height!, z, yaw, scale,
            normal: n, attach: m.attach ?? 'upright', mesh: typeof m.mesh === 'number' ? m.mesh : 0,
            material: typeof m.material === 'number' ? m.material : 0, plant: m.plant ?? null, interactive: m.interactive ?? null,
            footprint: footprintOf(m, scale), canopy: (m.canopy ?? m.footprint) * (m.scaleFootprint ? Math.abs(scale) : 1), far: m.far ?? null,
            ...(grounding ? { grounding } : {}),
        };
    }

    /** Why a member cannot stand on the place whose fields are `f`, or null if it can. */
    private standing(f: FieldValues, m: RecipeMember): Rejection | null {
        if (!Number.isFinite(f.height!)) return 'noGround';
        if (f.up! < (m.minUp ?? 0)) return 'slope';
        if (f.waterDepth! > (m.waterDepth ?? 0)) return 'water';
        return null;
    }

    private tagsOf(layer: PlacementLayer, r: Recipe, m: RecipeMember): string[] {
        return [layer.id, r.id, m.interactive ? 'interactive' : 'decor', ...(r.tags ?? []), ...(m.tags ?? [])];
    }

    /** The candidate of layer `li` in cell (gx, gz) if it may stand before its own layer's overlaps are settled, or why not. */
    private viable(li: number, gx: number, gz: number): Viable {
        const key = `${li}:${gx},${gz}`;
        const had = this.viable_.get(key);
        if (had) return had;
        if (this.viable_.size > CACHE_LIMIT) this.viable_.clear();
        const made = this.makeViable(li, gx, gz);
        this.viable_.set(key, made);
        return made;
    }

    private makeViable(li: number, gx: number, gz: number): Viable {
        const layer = this.layers_[li]!;
        const s = layer.def.spacing;
        const h = (salt: number) => hash01(this.worldHash_, layer.hash, gx, gz, salt);
        const x = (gx + h(1)) * s, z = (gz + h(2)) * s;
        const weights = this.biomeWeights(x, z);
        if (weights.length === 0) return { ok: false, reason: 'noBiome' };
        // A biome by its weight here, so where two meet their recipes mix rather than stopping on a line.
        let u = h(3), biome = weights[weights.length - 1]!.biome;
        for (const w of weights) { if (u < w.weight) { biome = w.biome; break; } u -= w.weight; }
        const def = this.rules.biomes.find((b) => b.id === biome);
        const choices = (def?.recipes ?? []).filter((br) => br.layer === layer.def.id && this.recipes_.has(br.recipe));
        let v = h(4), recipe: Recipe | null = null;
        for (const br of choices) { if (v < br.density) { recipe = this.recipes_.get(br.recipe)!; break; } v -= br.density; }
        if (!recipe) return { ok: false, reason: 'density' };
        const f = this.env.sample(x, z);
        const groupId = `${layer.def.id}@${layer.def.version ?? 1}:${gx},${gz}`;
        const anchor = this.place(groupId, layer.def, recipe, recipe.anchor, 0, x, z, biome, f, 0);
        if (typeof anchor === 'string') return { ok: false, reason: anchor };
        const zone = this.zones.excluding(x, z, anchor.footprint, this.tagsOf(layer.def, recipe, recipe.anchor), this.seed);
        if (zone) return { ok: false, reason: 'zone', detail: zone.id };
        const blocker = this.occupied(li, x, z, anchor.footprint);
        if (blocker) return { ok: false, reason: 'occupied', detail: blocker };
        return { ok: true, candidate: { gx, gz, x, z, priority: h(5), biome, recipe, radius: groupRadius(recipe), anchor } };
    }

    /** The id of a placement of an earlier layer whose footprint a footprint of `radius` at (x, z) would overlap, or null. */
    private occupied(li: number, x: number, z: number, radius: number): string | null {
        for (let lj = 0; lj < li; lj++) {
            const l = this.layers_[lj]!;
            if (l.def.occupies === false) continue;
            const s = l.def.spacing, reach = radius + l.maxRadius;
            for (let gz = Math.floor((z - reach) / s); gz <= Math.floor((z + reach) / s); gz++) {
                for (let gx = Math.floor((x - reach) / s); gx <= Math.floor((x + reach) / s); gx++) {
                    const g = this.group(lj, gx, gz);
                    if (typeof g === 'string') continue;
                    for (const p of [g.anchor, ...g.members]) if (Math.hypot(p.x - x, p.z - z) < p.footprint + radius) return p.id;
                }
            }
        }
        return null;
    }

    private biomeWeight(b: BiomeDef, x: number, z: number): number {
        // The edge wanders: the fields are read a little way off, by noise of the biome's own.
        const t = b.transition ?? 0;
        let sx = x, sz = z;
        if (t > 0) {
            const k = hashString(b.id) ^ this.worldHash_;
            sx += (fbm(x / t, z / t, k, 2) - 0.5) * 2 * t;
            sz += (fbm(x / t, z / t, k + 1, 2) - 0.5) * 2 * t;
        }
        const f = this.env.sample(sx, sz);
        let w = b.weight ?? 1;
        for (const c of b.conditions) {
            w *= bandWeight(c, f[c.field] ?? NaN);
            if (w <= 0) return 0;
        }
        return w;
    }
}
