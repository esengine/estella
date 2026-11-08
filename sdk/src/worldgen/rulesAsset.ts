// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rulesAsset.ts
 * @brief   World rules as a project file (`.esworld`): biomes, recipes and layers as data, which artists and designers edit and a
 *          package carries with every mesh and material they name.
 *
 * @details The file is the rules' JSON: what `registerWorldRules` takes, less the fields made by code (a game's own fields stay in
 *          code). Meshes and materials are named by their project paths, so the cook follows them from the file as it follows a
 *          material's textures. A file that does not say what rules need is refused with where it went wrong, rather than laying out
 *          a world from half of it.
 */
import type { AssetLoader, LoadContext } from '../asset/AssetLoader';
import type { PlantKind } from '../foliage/plantKind';
import type { BiomeDef, PlacementLayer, Recipe, RecipeMember, WorldRules } from './rules';
import { validateGrounding, type GroundingOptions } from './grounding';

/** Whether a WorldGen's `rules` names a file rather than rules registered by code. */
export function isRulesFile(ref: string): boolean {
    return ref.endsWith('.esworld') || ref.startsWith('@uuid:');
}

const fail = (where: string, what: string): never => { throw new Error(`${where}: ${what}`); };

function num(v: unknown, where: string, min = -Infinity): number {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min) fail(where, `a number${min > -Infinity ? ` of at least ${min}` : ''}, not ${JSON.stringify(v)}`);
    return v as number;
}

function str(v: unknown, where: string): string {
    if (typeof v !== 'string' || v.length === 0) fail(where, `a name, not ${JSON.stringify(v)}`);
    return v as string;
}

function range(v: unknown, where: string): [number, number] | undefined {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.length !== 2) fail(where, 'two numbers, [least, most]');
    const a = num((v as unknown[])[0], where), b = num((v as unknown[])[1], where);
    if (b < a) fail(where, 'the least is more than the most');
    return [a, b];
}

function member(v: unknown, where: string): RecipeMember {
    if (!v || typeof v !== 'object') fail(where, 'a member, an object');
    const m = v as Record<string, unknown>;
    const mesh = m.mesh;
    if (m.scaleFootprint !== undefined && typeof m.scaleFootprint !== 'boolean') fail(`${where}.scaleFootprint`, 'a boolean');
    if (m.grounding !== undefined) {
        try { validateGrounding(m.grounding as GroundingOptions); }
        catch (error) { fail(where, error instanceof Error ? error.message : String(error)); }
        if (m.attach === 'align') fail(`${where}.grounding`, 'footprint fitting requires an upright member');
    }
    const scale = range(m.scale, `${where}.scale`);
    if ((m.grounding || m.scaleFootprint) && scale && scale[0] <= 0) fail(`${where}.scale`, 'positive scales for fitted or scaled footprints');
    if (m.plant !== undefined) str(m.plant, `${where}.plant`);
    else if (typeof mesh !== 'string' && typeof mesh !== 'number') fail(`${where}.mesh`, 'a mesh path, or a plant');
    return {
        ...(m as object),
        id: str(m.id, `${where}.id`),
        ...(mesh === undefined ? {} : { mesh: mesh as string | number }),
        footprint: num(m.footprint, `${where}.footprint`, 0),
        count: range(m.count, `${where}.count`),
        ring: range(m.ring, `${where}.ring`),
        arc: range(m.arc, `${where}.arc`),
        scale,
    } as RecipeMember;
}

function part(v: unknown, where: string): PlantKind['parts'][number] {
    if (!v || typeof v !== 'object') fail(where, 'a part, an object');
    const p = v as Record<string, unknown>;
    const tint = p.tint ?? [1, 1, 1, 1];
    if (!Array.isArray(tint) || tint.length !== 4) fail(`${where}.tint`, 'four numbers, red, green, blue and alpha');
    return {
        mesh: str(p.mesh, `${where}.mesh`), lod1Mesh: typeof p.lod1Mesh === 'string' ? p.lod1Mesh : '',
        ...(typeof p.lod2Mesh === 'string' && p.lod2Mesh !== '' ? { lod2Mesh: p.lod2Mesh } : {}), material: typeof p.material === 'string' ? p.material : '',
        texture: typeof p.texture === 'string' ? p.texture : '', tint: (tint as unknown[]).map((c, i) => num(c, `${where}.tint[${i}]`)) as [number, number, number, number],
        opaque: p.opaque !== false,
        ...(p.soft === undefined ? {} : { soft: Math.min(Math.max(num(p.soft, `${where}.soft`), 0), 1) }),
        ...(p.castShadows === false ? { castShadows: false } : {}),
    };
}

function plant(v: unknown, where: string): PlantKind {
    if (!v || typeof v !== 'object') fail(where, 'a plant, an object');
    const o = v as Record<string, unknown>;
    if (!Array.isArray(o.parts) || o.parts.length === 0) fail(`${where}.parts`, 'at least one part');
    const far = Array.isArray(o.far) ? (o.far as unknown[]).map((p, i) => part(p, `${where}.far[${i}]`)) : [];
    let tints: PlantKind['tints'];
    if (o.tints !== undefined) {
        if (!Array.isArray(o.tints) || o.tints.length === 0) fail(`${where}.tints`, 'a list of colourings, each three numbers');
        tints = (o.tints as unknown[]).map((t, i) => {
            if (!Array.isArray(t) || t.length !== 3) fail(`${where}.tints[${i}]`, 'three numbers, red, green and blue');
            return (t as unknown[]).map((c, k) => num(c, `${where}.tints[${i}][${k}]`)) as [number, number, number];
        });
    }
    return {
        parts: (o.parts as unknown[]).map((p, i) => part(p, `${where}.parts[${i}]`)),
        lodDistance: num(o.lodDistance ?? 0, `${where}.lodDistance`, 0),
        ...(o.lod2Distance === undefined ? {} : { lod2Distance: num(o.lod2Distance, `${where}.lod2Distance`, 0) }),
        drawDistance: num(o.drawDistance, `${where}.drawDistance`, 0),
        far, farDistance: far.length > 0 ? num(o.farDistance, `${where}.farDistance`, 0) : 0,
        ...(o.farKeep === undefined ? {} : { farKeep: num(o.farKeep, `${where}.farKeep`, 1e-3) }),
        ...(tints ? { tints, tintScale: num(o.tintScale ?? 1300, `${where}.tintScale`, 1e-6) } : {}),
        ...(o.sink === undefined ? {} : { sink: num(o.sink, `${where}.sink`) }),
        ...(o.unit === undefined ? {} : { unit: num(o.unit, `${where}.unit`, 1e-9) }),
    };
}

/** Rules from a file's JSON, checked; throws naming the first thing a world could not be laid out from. */
export function parseWorldRules(json: unknown, file = 'world rules'): WorldRules {
    if (!json || typeof json !== 'object') fail(file, 'an object');
    const r = json as Record<string, unknown>;
    const id = str(r.id, `${file}.id`);
    if (!Array.isArray(r.versions) || r.versions.length === 0) fail(`${file}.versions`, 'the versions it can make, at least one');
    const versions = (r.versions as unknown[]).map((v, i) => num(v, `${file}.versions[${i}]`, 1));
    if (!Array.isArray(r.recipes)) fail(`${file}.recipes`, 'a list');
    const recipes: Recipe[] = (r.recipes as unknown[]).map((v, i) => {
        const where = `${file}.recipes[${i}]`;
        const o = (v ?? {}) as Record<string, unknown>;
        return {
            ...(o as object),
            id: str(o.id, `${where}.id`), version: num(o.version, `${where}.version`, 1),
            anchor: member(o.anchor, `${where}.anchor`),
            members: Array.isArray(o.members) ? (o.members as unknown[]).map((m, k) => member(m, `${where}.members[${k}]`)) : undefined,
        } as Recipe;
    });
    let plants: Record<string, PlantKind> | undefined;
    if (r.plants !== undefined) {
        if (!r.plants || typeof r.plants !== 'object' || Array.isArray(r.plants)) fail(`${file}.plants`, 'an object of plants by name');
        plants = {};
        for (const [name, v] of Object.entries(r.plants as Record<string, unknown>)) plants[name] = plant(v, `${file}.plants.${name}`);
    }
    for (const [i, rc] of recipes.entries()) {
        for (const m of [rc.anchor, ...(rc.members ?? [])]) {
            if (m.plant !== undefined && !plants?.[m.plant]) fail(`${file}.recipes[${i}].${m.id}.plant`, `no plant ${JSON.stringify(m.plant)} in the file's plants`);
        }
    }
    if (!Array.isArray(r.layers) || r.layers.length === 0) fail(`${file}.layers`, 'at least one layer');
    const layers: PlacementLayer[] = (r.layers as unknown[]).map((v, i) => {
        const where = `${file}.layers[${i}]`;
        const o = (v ?? {}) as Record<string, unknown>;
        return {
            ...(o as object),
            id: str(o.id, `${where}.id`), spacing: num(o.spacing, `${where}.spacing`, 1e-6), drawDistance: num(o.drawDistance, `${where}.drawDistance`, 0),
            ...(o.farSpacing === undefined ? {} : { farSpacing: num(o.farSpacing, `${where}.farSpacing`, 1) }),
        } as PlacementLayer;
    });
    const recipeIds = new Set(recipes.map((x) => x.id)), layerIds = new Set(layers.map((x) => x.id));
    if (!Array.isArray(r.biomes)) fail(`${file}.biomes`, 'a list');
    const biomes: BiomeDef[] = (r.biomes as unknown[]).map((v, i) => {
        const where = `${file}.biomes[${i}]`;
        const o = (v ?? {}) as Record<string, unknown>;
        if (!Array.isArray(o.conditions)) fail(`${where}.conditions`, 'a list (empty holds everywhere)');
        if (!Array.isArray(o.recipes)) fail(`${where}.recipes`, 'a list');
        for (const [k, br] of (o.recipes as Record<string, unknown>[]).entries()) {
            if (!recipeIds.has(br.recipe as string)) fail(`${where}.recipes[${k}].recipe`, `no recipe ${JSON.stringify(br.recipe)} in the file`);
            if (!layerIds.has(br.layer as string)) fail(`${where}.recipes[${k}].layer`, `no layer ${JSON.stringify(br.layer)} in the file`);
            num(br.density, `${where}.recipes[${k}].density`, 0);
        }
        return { ...(o as object), id: str(o.id, `${where}.id`) } as BiomeDef;
    });
    return { id, versions, biomes, recipes, layers, ...(plants ? { plants } : {}), ...(r.noise ? { noise: r.noise as WorldRules['noise'] } : {}) };
}

/** Loads `.esworld` files as checked world rules. */
export class WorldRulesAssetLoader implements AssetLoader<WorldRules> {
    readonly type = 'world-rules';
    readonly extensions = ['.esworld'];

    async load(path: string, ctx: LoadContext): Promise<WorldRules> {
        const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
        return parseWorldRules(JSON.parse(text), path);
    }

    unload(): void {
        // Rules are plain data; the meshes they name are loaded and held by the world that lays them out.
    }
}
