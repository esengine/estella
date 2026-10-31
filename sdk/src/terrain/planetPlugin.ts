// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    planetPlugin.ts
 * @brief   The `Planet` component: ground on a sphere, drawn as six quadtrees round the eye, from a provider a game names.
 *
 * @details The same machinery as flat ground (terrainPlugin.ts) with a sphere under it: the tree is cut by the eye's distance to each node (sphere.ts), a
 *          node is the one shared patch drawn as an instance, its page (heights, normals, paint) is made from the provider by direction (planetPages.ts) into
 *          the one atlas, and the Planet shader (planetShader.ts) puts every vertex of the patch on the sphere. From the ground the finest nodes are under the
 *          eye; from space the whole planet is a handful of coarse ones, so a planet seen from far off and from underfoot is one thing.
 *
 *          The planet entity is its centre and stands unrotated and unscaled: its children are the nodes, placed in its space. The first slice draws the ground;
 *          collision, the layers' textures, the sea and the sky of a round world are the next ones.
 */
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import {
    defineComponent, Camera, MeshRenderer, RuntimeOnly, Transform,
    type ComponentDef, type CameraData, type MeshRendererData, type TransformData,
} from '../ecs/component';
import { Assets } from '../asset/AssetPlugin';
import type { MaterialShaderSource } from '../asset/loaders/MaterialShaderAssetLoader';
import { CullMode, Material, MATERIAL_FORMAT_VERSION } from '../render/material';
import { BlendMode } from '../render/blend';
import { updateTextureSubregion } from '../runtime/runtimeAssets';
import { getResourceManager, withdrawTextureContent } from '../wasm/resourceManager';
import { EditorView, editorViewEye } from '../camera/EditorView';
import { log } from '../util/logger';
import { renderOrigin } from '../render/renderOrigin';
import { bakesOf } from '../runtime/bakes';
import type { Color, Entity } from '../types';
import { PageTable, PAGE_SIDE, PAGE_TEXELS, PATCH_CELLS, type PageImage } from './pages';
import { buildPatchMesh } from './patch';
import { loadLayerArrays, releaseLayerArrays } from './layerArrays';
import { createPageAtlases } from './atlases';
import { PlanetRegistry, PlanetRegistryRes } from './planetQuery';
import { buildSphereMesh } from './planetSea';
import { removePlanetCollision, updatePlanetCollision } from './planetCollision';
import { planetProvider, planetProvidersRevision, type PlanetProvider } from './planetProvider';
import { makePlanetPage, type PlanetPageSource } from './planetPages';
import { firstSend, forgetSent, planPool } from '../runtime/planPool';
import type { PageRequest } from '../worldgen/planWorker';
import type { PlanetSamples } from './planetProvider';
import { levelsFor, nodePoint, selectSphereNodes, sphereNodeKey, type SphereNode, type SphereTreeParams } from './sphere';

/** The fields of the `Planet` component. @experimental */
export interface PlanetData {
    /** The planet's radius in metres. */
    radius: number;
    /** The generator the ground is made by (registerPlanetProvider), the world it belongs to as the game names it, its version and its seed. */
    provider: string;
    world: string;
    generatorVersion: number;
    seed: number;
    /** The finest cell of the ground's mesh, in metres, and how far out the finest cells reach before the ground coarsens (above 1 is further). */
    cellSize: number;
    detail: number;
    /** The four layers' colours: grass, dirt, snow, rock. */
    layerColor0: Color;
    layerColor1: Color;
    layerColor2: Color;
    layerColor3: Color;
    /** The size, in metres, of the ground's own wander in brightness, and how strong it is (0 to 1). */
    macroScale: number;
    macroVariation: number;
    /** Whether bodies and characters collide with the ground; how far round each thing that moves it is built for collision; its layer and friction. */
    collision: boolean;
    collisionDistance: number;
    collisionLayer: number;
    friction: number;
    /** Whether the planet has a sea: a sphere at `seaLevel` above the radius, which the ground that dips below it stands in. */
    sea: boolean;
    seaLevel: number;
    /** The sea's colour and how much of it there is over what is under it (0 to 1). */
    seaColor: Color;
    seaOpacity: number;
    /** How hard the planet pulls what is on it, in metres a second squared at the surface; 0 pulls nothing. Bodies are pulled toward the centre of the nearest planet that pulls (physics3d/planetGravity.ts). */
    gravity: number;
    /** The terrain layers (`.esterrainlayer` files, up to four) the ground is drawn with, in the order the paint weighs them. Empty draws the four layer colours. */
    layers: string[];
}

const rgb = (r: number, g: number, b: number): Color => ({ r, g, b, a: 1 });

/**
 * Ground on a sphere. Presence is the opt-in; its children are the quadtree's nodes.
 *
 * @experimental
 */
export const Planet: ComponentDef<PlanetData> = defineComponent<PlanetData>('Planet', {
    radius: 4000, provider: '', world: '', generatorVersion: 1, seed: 1, cellSize: 1.5, detail: 1.5,
    layerColor0: rgb(0.28, 0.46, 0.2), layerColor1: rgb(0.45, 0.36, 0.24), layerColor2: rgb(0.93, 0.95, 0.98), layerColor3: rgb(0.4, 0.38, 0.36),
    macroScale: 90, macroVariation: 0.35, collision: true, collisionDistance: 64, collisionLayer: 0, friction: 0.6, gravity: 0, sea: false, seaLevel: 0, seaColor: rgb(0.06, 0.28, 0.42), seaOpacity: 0.82, layers: [] as string[],
}, {
    fields: {
        radius: { min: 1, category: 'Shape', tooltip: 'The planet\'s radius in metres. The planet stands at its entity, unrotated and unscaled.' },
        provider: { category: 'Shape', tooltip: 'The generator the ground is made by, registered with registerPlanetProvider. The same provider, world, seed and version are the same ground everywhere.' },
        world: { category: 'Shape', tooltip: 'The world (a planet) the ground belongs to, as the game names it; handed to the provider.' },
        generatorVersion: { min: 1, step: 1, category: 'Shape', tooltip: 'The generator version the planet was made with. A version the provider no longer has fails the planet rather than growing other ground under what was built on it.' },
        seed: { step: 1, category: 'Shape', tooltip: 'Another seed is another planet.' },
        cellSize: { min: 0.01, category: 'Detail', tooltip: 'The finest cell of the ground\'s mesh, in metres: what it is drawn at near the eye. Further off the cells double, level by level.' },
        detail: { min: 0.25, max: 8, step: 0.05, category: 'Detail', tooltip: 'Above 1 the finest cells reach further out before the ground coarsens.' },
        layerColor0: { label: 'Grass', category: 'Layers' },
        layerColor1: { label: 'Dirt', category: 'Layers' },
        layerColor2: { label: 'Snow', category: 'Layers' },
        layerColor3: { label: 'Rock', category: 'Layers' },
        macroScale: { min: 1, category: 'Layers', tooltip: 'The size, in metres, of the ground\'s own wander in brightness.' },
        macroVariation: { min: 0, max: 1, step: 0.01, category: 'Layers', tooltip: 'How strongly the ground\'s brightness wanders.' },
        sea: { category: 'Sea', tooltip: 'Whether the planet has a sea: a sphere at the sea level, in which the ground that dips below it stands.' },
        seaLevel: { category: 'Sea', tooltip: 'The height of the sea above the planet\'s radius, in metres.' },
        seaColor: { category: 'Sea' },
        seaOpacity: { min: 0, max: 1, step: 0.01, category: 'Sea', tooltip: 'How much of the sea there is over what is under it.' },
        gravity: { min: 0, category: 'Physics', tooltip: 'How hard the planet pulls bodies toward its centre, in metres a second squared at the surface (9.81 is the Earth\'s). Needs 3D physics; the world\'s own gravity is taken off the bodies it pulls.' },
        layers: { category: 'Layers', tooltip: 'The terrain layers (.esterrainlayer, up to four) the ground is drawn with, in the order the paint weighs them, each read on the planes of the world\'s axes. Empty draws the four layer colours.' },
        collision: { category: 'Collision', tooltip: 'Whether 3D bodies and characters collide with the ground: the finest tiles round each of them are built as collision geometry.' },
        collisionDistance: { min: 1, category: 'Collision', tooltip: 'How far round each moving body and character the ground is built for collision, in metres.' },
        collisionLayer: { min: 0, max: 15, step: 1, category: 'Collision', advanced: true, tooltip: 'The collision layer the ground is in (0 to 15).' },
        friction: { min: 0, category: 'Collision', advanced: true, tooltip: 'The ground\'s friction.' },
    },
});

/** The side of the atlases the pages are kept in, in texels. */
const ATLAS_SIZE = 2048;
/** Most levels a planet's tree may have: a node's place on its face is packed in a float, ix * 2048 + iz, which holds eleven levels' worth. */
const MAX_LEVELS = 12;
/** Pages asked at once of a provider that answers later. */
const PAGES_IN_FLIGHT = 16;
/** The most layers a planet draws: one paint atlas of four weights. */
const MAX_LAYERS = 4;

interface Built {
    signature: string;
    data: PlanetData;
    provider: PlanetProvider | null;
    /** What the planet is made against, and how its tree is cut. */
    source: PlanetPageSource | null;
    tree: SphereTreeParams | null;
    epoch: number;
    table: PageTable;
    heights: number;
    paint: number;
    mesh: number;
    instance: number;
    nodes: Map<string, Entity>;
    spare: Entity[];
    wanted: Map<string, SphereNode>;
    asked: Set<string>;
    pending: boolean;
    failure: string | null;
    /** The layers' texture arrays, what they were packed from, and whether a packing is in hand. */
    arrays: number[];
    packed: string;
    packing: boolean;
    /** The registry's revision when the provider was last looked for, so a late registration is noticed. */
    providers: number;
    /** The painters' revision the pages were last painted at. */
    painted: number;
    /** The sea's entity, mesh and material instance, when the planet has one. */
    sea: { entity: Entity; mesh: number; material: number; base: number } | null;
}

/** Where a planet stands: still being made, ready, or failed (with why). */
export interface PlanetStatus { state: 'loading' | 'ready' | 'failed'; reason?: string }

/** The planets of an app, for what asks about them. @experimental */
export class Planets {
    readonly built_ = new Map<Entity, Built>();

    /** How a planet stands, or null for an entity that is not one. */
    status(entity: Entity): PlanetStatus | null {
        const b = this.built_.get(entity);
        if (!b) return null;
        return b.failure ? { state: 'failed', reason: b.failure } : { state: b.instance && b.source ? 'ready' : 'loading' };
    }
}

export class PlanetPlugin implements Plugin {
    name = 'planet';

    private stock_ = 0;
    private planets_: Planets | null = null;

    build(app: App): void {
        const planets = new Planets();
        this.planets_ = planets;
        const registry = new PlanetRegistry();
        app.insertResource(PlanetRegistryRes, registry);
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            if (!app.hasResource(Assets)) return;
            // A planet whose entity has gone is let go.
            for (const [entity, built] of planets.built_) {
                if (app.world.valid(entity) && app.world.has(entity, Planet)) continue;
                this.destroy(app, built);
                removePlanetCollision(app, entity);
                planets.built_.delete(entity);
                registry.planets.delete(entity);
            }
            for (const entity of app.world.getEntitiesWithComponents([Planet, Transform])) {
                const data = app.world.get(entity, Planet) as PlanetData;
                const signature = signatureOf(data);
                let built = planets.built_.get(entity);
                if (!built || built.signature !== signature || (built.failure && built.providers !== planetProvidersRevision())) {
                    if (built) { this.destroy(app, built); removePlanetCollision(app, entity); }
                    built = this.make(signature, data, (built?.epoch ?? 0) + 1);
                    planets.built_.set(entity, built);
                }
                built.data = { ...data };
                if (built.failure || !built.source || !built.tree) continue;
                const at = (app.world.get(entity, Transform) as TransformData).worldPosition;
                const source = built.source;
                source.paint = () => registry.paintOf(entity);
                // A painter set, changed or taken away paints every page again.
                if (built.painted !== registry.paintRevision) { built.painted = registry.paintRevision; built.table.clear(); }
                registry.planets.set(entity, {
                    centre: [at.x, at.y, at.z], radius: built.data.radius, gravity: built.data.gravity,
                    height: (dx, dy, dz) => sampleAt(source, dx, dy, dz)?.heights[0] ?? null,
                    paint: (dx, dy, dz) => { const got = sampleAt(source, dx, dy, dz); return got?.paint ? Array.from(got.paint.subarray(0, 4)) : null; },
                    sampleMany: (directions, count) => {
                        const got = source.provider.sample({ world: source.world, seed: source.seed, version: source.version, radius: source.radius, directions, count });
                        return got instanceof Promise ? null : got;
                    },
                    worker: source.provider.workerSource ? { source: source.provider.workerSource, seed: source.seed, version: source.version, world: source.world } : null,
                    fieldNames: source.provider.fields ?? [],
                    fieldsAt: source.provider.fields ? (dx, dy, dz) => { const got = sampleAt(source, dx, dy, dz); return got?.fields ? Array.from(got.fields) : null; } : null,
                    layers: built.data.layers.map((ref, i) => (ref.split('/').pop() ?? '').replace(/\.[^.]*$/, '') || `layer${i}`),
                });
                this.keepSea(app, entity, built);
                updatePlanetCollision(app, entity, built.source, built.epoch, built.data);
                if (!built.instance) {
                    if (!built.pending) void this.prepare(app, built);
                    continue;
                }
                this.draw(app, entity, built);
            }
        }, { name: 'PlanetSystem' }));
    }

    cleanup(app?: App): void {
        const planets = this.planets_;
        if (app && planets) for (const [entity, built] of planets.built_) { this.destroy(app, built); removePlanetCollision(app, entity); }
        planets?.built_.clear();
        if (this.stock_) Material.release(this.stock_);
        this.stock_ = 0;
    }

    /** What a planet is made against, from its fields: its provider, and the cut its tree is made with. */
    private make(signature: string, data: PlanetData, epoch: number): Built {
        const built: Built = {
            signature, data: { ...data }, provider: null, source: null, tree: null, epoch, table: new PageTable(ATLAS_SIZE),
            heights: 0, paint: 0, mesh: 0, instance: 0, nodes: new Map(), spare: [], wanted: new Map(), asked: new Set(), pending: false, failure: null, arrays: [], packed: '', packing: false,
            providers: planetProvidersRevision(), painted: 0, sea: null,
        };
        const provider = planetProvider(data.provider);
        if (!provider) {
            built.failure = data.provider ? `the planet provider "${data.provider}" is not registered` : 'the planet names no provider';
            return built;
        }
        if (!provider.versions.includes(data.generatorVersion)) {
            built.failure = `the planet provider ${provider.id} has no version ${data.generatorVersion} (it has ${provider.versions.join(', ') || 'none'})`;
            return built;
        }
        const [minHeight, maxHeight] = provider.range(data.seed, data.generatorVersion, data.radius);
        const leafSize = PATCH_CELLS * Math.max(data.cellSize, 1e-3);
        const levels = levelsFor(data.radius, leafSize);
        if (levels > MAX_LEVELS) {
            built.failure = `a planet of radius ${data.radius} m with ${data.cellSize} m cells needs ${levels} levels of tree; ${MAX_LEVELS} is the most (raise cellSize)`;
            return built;
        }
        built.provider = provider;
        built.tree = { radius: data.radius, minHeight, maxHeight, leafSize, range0: leafSize * 2.5 * Math.max(data.detail, 0.25) };
        built.source = { provider, world: data.world, seed: data.seed, version: data.generatorVersion, radius: data.radius, levels, minHeight, maxHeight };
        return built;
    }

    /** The stock material: the Planet shader, compiled once. */
    private async stock(app: App): Promise<number> {
        if (this.stock_) return this.stock_;
        const source = await app.getResource(Assets).load<MaterialShaderSource>('material-shader', 'builtin:planet');
        const shader = source.compile([]);
        if (this.stock_) return this.stock_;
        this.stock_ = Material.createFromAsset({
            version: MATERIAL_FORMAT_VERSION, type: 'material', shader: 'builtin:planet', blendMode: BlendMode.None,
            depthTest: true, depthWrite: true, cull: CullMode.Back, properties: {},
        }, shader);
        return this.stock_;
    }

    private async prepare(app: App, built: Built): Promise<void> {
        built.pending = true;
        const epoch = built.epoch;
        try {
            const material = await this.stock(app);
            if (built.epoch !== epoch) return;
            const assets = app.getResource(Assets);
            built.mesh = assets.createMesh(buildPatchMesh(PATCH_CELLS, true));
            [built.heights = 0, built.paint = 0] = createPageAtlases(app, 2, ATLAS_SIZE, () => built.table.clear());
            built.instance = Material.createInstance(material);
            if (!built.mesh || !built.heights || !built.paint || !built.instance) {
                built.failure = 'the engine refused the planet\'s mesh, atlases or material';
                log.warn('planet', built.failure);
                return;
            }
            const set = (name: string, value: Parameters<typeof Material.setUniform>[2]): void => { Material.setUniform(built.instance, name, value); };
            set('u_heightPages', Material.tex(built.heights));
            set('u_paintPages', Material.tex(built.paint));
            set('u_planetPages', 1);
            set('u_atlasTexels', ATLAS_SIZE);
            set('u_pageTexels', PAGE_TEXELS);
            set('u_patchCells', PATCH_CELLS);
            set('u_planetRadius', built.data.radius);
            set('u_planetLevels', built.source!.levels);
            set('u_heightRange', { x: built.tree!.minHeight, y: Math.max(built.tree!.maxHeight - built.tree!.minHeight, 1e-6) });
            set('u_lodRange0', built.tree!.range0);
        } catch (e) {
            built.failure = e instanceof Error ? e.message : String(e);
            log.error('planet', 'preparing the planet failed', e);
        } finally {
            built.pending = false;
        }
    }

    /** Where the eye is, in the planet's space: the editor's, while it looks at the scene in 3D, else the active camera's. */
    private eye(app: App, t: TransformData): [number, number, number] | null {
        if (app.hasResource(EditorView)) {
            const view = app.getResource(EditorView);
            if (view.active && view.perspective) {
                const e = editorViewEye(view);
                return [e.x - t.worldPosition.x, e.y - t.worldPosition.y, e.z - t.worldPosition.z];
            }
        }
        for (const entity of app.world.getEntitiesWithComponents([Camera, Transform])) {
            if (!(app.world.get(entity, Camera) as CameraData).isActive) continue;
            const c = app.world.get(entity, Transform) as TransformData;
            return [c.worldPosition.x - t.worldPosition.x, c.worldPosition.y - t.worldPosition.y, c.worldPosition.z - t.worldPosition.z];
        }
        return null;
    }

    /** Chooses the nodes for the eye, makes the pages they want within the budget, and places the nodes. */
    private draw(app: App, entity: Entity, built: Built): void {
        const tree = built.tree!, src = built.source!;
        const t = app.world.get(entity, Transform) as TransformData;
        const eye = this.eye(app, t) ?? [0, tree.radius + tree.maxHeight * 2, 0];
        const chosen = selectSphereNodes(tree, eye[0], eye[1], eye[2], src.levels);
        const table = built.table;
        table.tick();

        // Each node is drawn by its own page, or by its nearest ancestor that has one; a node under an ancestor drawn instead is not.
        built.wanted.clear();
        const drawn = new Map<string, SphereNode>();
        const covered = new Set<string>();
        const parent = (n: SphereNode): SphereNode => ({ face: n.face, level: n.level + 1, ix: n.ix >> 1, iz: n.iz >> 1 });
        for (const node of chosen) {
            let n: SphereNode | null = node;
            const own = sphereNodeKey(node);
            if (!table.get(own)) built.wanted.set(own, node);
            while (n && !table.get(sphereNodeKey(n))) {
                n = n.level + 1 < src.levels ? parent(n) : null;
                if (n && !table.get(sphereNodeKey(n))) built.wanted.set(sphereNodeKey(n), n);
            }
            if (!n) continue;
            const key = sphereNodeKey(n);
            if (n !== node) covered.add(key);
            drawn.set(key, n);
        }
        for (const [key, n] of drawn) {
            for (let up = n; up.level + 1 < src.levels;) {
                up = parent(up);
                if (covered.has(sphereNodeKey(up))) { drawn.delete(key); break; }
            }
        }
        this.makePages(app, entity, built, eye);
        this.pack(app, built);

        const set = (name: string, value: Parameters<typeof Material.setUniform>[2]): void => { Material.setUniform(built.instance, name, value); };
        // From the render origin, as the nodes' boxes are: the vertex stage puts its points in them.
        const o = renderOrigin();
        set('u_planetCenter', { x: t.worldPosition.x - o.x, y: t.worldPosition.y - o.y, z: t.worldPosition.z - o.z, w: 0 });
        // Not the pass's camera: a shadow is drawn from the light, and its ground must be the one the eye sees.
        set('u_terrainEye', { x: eye[0], y: eye[1], z: eye[2], w: 1 });
        const d = built.data;
        for (const [i, c] of [d.layerColor0, d.layerColor1, d.layerColor2, d.layerColor3].entries()) set(`u_tint${i}`, { x: c.r, y: c.g, z: c.b, w: c.a });
        set('u_macroScale', d.macroScale);
        set('u_macroVariation', d.macroVariation);
        this.place(app, entity, built, drawn);
    }

    /** The sea: a sphere at the sea level standing at the planet, made when the planet has one and let go when it has not. */
    private keepSea(app: App, entity: Entity, built: Built): void {
        const d = built.data, world = app.world;
        if (!d.sea || !app.hasResource(Assets)) { this.dropSea(app, built); return; }
        if (!built.sea) {
            if (this.seaPending_) return;
            this.seaPending_ = true;
            void this.makeSea(app, entity, built).finally(() => { this.seaPending_ = false; });
            return;
        }
        const sea = built.sea;
        const r = d.radius + d.seaLevel;
        const t = world.get(sea.entity, Transform) as TransformData;
        if (t.scale.x !== r) world.insert(sea.entity, Transform, { ...t, scale: { x: r, y: r, z: r } });
        const c = d.seaColor;
        Material.setUniform(sea.material, 'u_seaColor', { x: c.r, y: c.g, z: c.b, w: 1 });
        Material.setUniform(sea.material, 'u_seaOpacity', d.seaOpacity);
    }

    private seaPending_ = false;

    /** Makes the sea: the sphere, a material on the Planet Sea shader that blends over what is under it and is hidden by what is nearer, and the entity. */
    private async makeSea(app: App, entity: Entity, built: Built): Promise<void> {
        const world = app.world, assets = app.getResource(Assets);
        const source = await assets.load<MaterialShaderSource>('material-shader', 'builtin:planet-sea');
        const shader = source.compile([]);
        const base = Material.createFromAsset({
            version: MATERIAL_FORMAT_VERSION, type: 'material', shader: 'builtin:planet-sea', blendMode: BlendMode.Normal,
            depthTest: true, depthWrite: false, cull: CullMode.Back, properties: {},
        }, shader);
        const material = Material.createInstance(base);
        const mesh = assets.createMesh(buildSphereMesh(96, 192));
        if (!material || !mesh || !world.valid(entity) || !built.data.sea || built.sea) {
            if (material) Material.release(material);
            Material.release(base);
            if (mesh) assets.releaseBuiltMesh(mesh);
            return;
        }
        const e = world.spawn('PlanetSea');
        world.insert(e, RuntimeOnly);
        world.insert(e, Transform, {});
        world.insert(e, MeshRenderer, { mesh, material, lit: true, opaque: false, cullBackfaces: true, castShadows: false, color: { r: 1, g: 1, b: 1, a: 1 } } as Partial<MeshRendererData>);
        world.setParent(e, entity);
        built.sea = { entity: e, mesh, material, base };
    }

    private dropSea(app: App, built: Built): void {
        if (!built.sea) return;
        if (app.world.valid(built.sea.entity)) app.world.despawn(built.sea.entity);
        if (app.hasResource(Assets)) app.getResource(Assets).releaseBuiltMesh(built.sea.mesh);
        Material.release(built.sea.material);
        Material.release(built.sea.base);
        built.sea = null;
    }

    /** Packs the layers into the arrays the material reads, when what they name changed: the ground keeps the arrays it has until the new ones are made. */
    private pack(app: App, built: Built): void {
        const refs = built.data.layers ?? [];
        if (refs.length === 0) {
            // Layers taken away: the colours draw the ground again.
            if (built.arrays.length > 0 && built.instance) Material.setUniform(built.instance, 'u_layerCount', 0);
            releaseLayerArrays(built.arrays);
            built.arrays = [];
            built.packed = '';
            return;
        }
        if (built.packing) return;
        const wanted = JSON.stringify(refs);
        if (wanted === built.packed) return;
        built.packing = true;
        const epoch = built.epoch;
        void (async () => {
            try {
                const got = await loadLayerArrays(app, refs, MAX_LAYERS);
                if (built.epoch !== epoch || !built.instance) { if (got) releaseLayerArrays([got.albedo, got.normal]); return; }
                if (!got) { log.warn('planet', 'the engine refused the planet layers\' texture arrays'); return; }
                releaseLayerArrays(built.arrays);
                built.arrays = [got.albedo, got.normal];
                const set = (name: string, value: Parameters<typeof Material.setUniform>[2]): void => { Material.setUniform(built.instance, name, value); };
                set('u_albedoLayers', Material.tex(got.albedo));
                set('u_normalLayers', Material.tex(got.normal));
                set('u_layerCount', got.tiles.length);
                const t = (i: number): number => got.tiles[i] ?? 4;
                set('u_tiles', { x: t(0), y: t(1), z: t(2), w: t(3) });
            } catch (e) {
                log.error('planet', 'packing the planet layers failed', e);
            } finally {
                built.packed = wanted;
                built.packing = false;
            }
        })();
    }

    /** Makes the wanted pages, coarse and near first, for as long as the frame can spare. */
    /** One node's page: made by a worker when the planet's provider can be loaded in one, here when it cannot. */
    private pageOf(app: App, entity: Entity, src: PlanetPageSource, node: SphereNode): PageImage | Promise<PageImage> {
        const pool = planPool();
        const provider = src.provider;
        if (!pool || !provider.workerSource) return makePlanetPage(src, node);
        const registry = app.hasResource(PlanetRegistryRes) ? app.getResource(PlanetRegistryRes) : null;
        const remote = registry?.remotePaintOf(entity) ?? null;
        // A painter that only the main thread can run (a world with no plan a worker could make) keeps its pages here.
        if (registry?.paintOf(entity) && !remote) return makePlanetPage(src, node);
        const worker = node.face % pool.size;
        const keys = remote ? [...remote.keys] : null;
        const request: PageRequest = {
            id: 0, type: 'page', node, levels: src.levels, radius: src.radius, minHeight: src.minHeight, maxHeight: src.maxHeight,
            provider: { source: provider.workerSource, seed: src.seed, version: src.version, world: src.world },
            paintKeys: keys, specs: keys ? keys.map((k, f) => (firstSend(worker, k) ? remote!.spec(f) as PageRequest['specs'][number] : null)) : [],
        };
        return pool.run<PageImage>(node.face, request as unknown as Record<string, unknown>).catch((e: unknown) => {
            if (keys) for (const k of keys) forgetSent(worker, k);
            throw e;
        });
    }

    private makePages(app: App, entity: Entity, built: Built, eye: [number, number, number]): void {
        const bakes = bakesOf(app);
        if (built.wanted.size === 0) { bakes.mark(built, 'Building the planet', 1); return; }
        const src = built.source!;
        const centre = (n: SphereNode): number => {
            const p = nodePoint(built.tree!, src.levels, n, 0.5, 0.5, 0);
            return Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
        };
        const order = [...built.wanted.values()].sort((a, b) => b.level - a.level || centre(a) - centre(b));
        let made = 0;
        const store = (key: string, image: PageImage): boolean => {
            const page = built.table.claim(key, image.min, image.max);
            if (!page) return false;
            const [ox, oy] = built.table.origin(page.slot);
            updateTextureSubregion(app.wasmModule, built.heights, ox, oy, PAGE_SIDE, PAGE_SIDE, image.heights);
            updateTextureSubregion(app.wasmModule, built.paint, ox, oy, PAGE_SIDE, PAGE_SIDE, image.paint);
            return true;
        };
        const epoch = built.epoch;
        for (const node of order) {
            const key = sphereNodeKey(node);
            if (built.asked.has(key)) continue;
            const image = this.pageOf(app, entity, src, node);
            if (image instanceof Promise) {
                if (built.asked.size >= PAGES_IN_FLIGHT) break;
                built.asked.add(key);
                void image.then((img) => {
                    built.asked.delete(key);
                    if (built.epoch === epoch && built.heights) store(key, img);
                }, (e) => {
                    built.asked.delete(key);
                    log.warn('planet', `the provider failed a page (${key})`, e);
                });
                continue;
            }
            if (!store(key, image)) break;
            built.wanted.delete(key);
            made++;
            // The frame's one budget, shared with the bakes and the chunks of the world; at least one page a frame.
            if (!bakes.hasTime()) break;
        }
        bakes.mark(built, 'Building the planet', made === 0 ? 0 : 1 - built.wanted.size / (built.wanted.size + made));
    }

    /** Puts a node entity on each node drawn (reusing the ones it had), and takes the rest away. */
    private place(app: App, entity: Entity, built: Built, drawn: Map<string, SphereNode>): void {
        const world = app.world, tree = built.tree!, levels = built.source!.levels;
        for (const [key, e] of built.nodes) {
            if (drawn.has(key)) continue;
            built.nodes.delete(key);
            if (!world.valid(e)) continue;
            const mr = world.get(e, MeshRenderer) as MeshRendererData;
            if (mr.enabled) world.insert(e, MeshRenderer, { ...mr, enabled: false });
            built.spare.push(e);
        }
        const p: [number, number, number] = [0, 0, 0];
        for (const [key, n] of drawn) {
            const page = built.table.get(key)!;
            built.table.touch(key);
            let e = built.nodes.get(key);
            if (e === undefined || !world.valid(e)) {
                e = built.spare.pop();
                if (e === undefined || !world.valid(e)) {
                    e = world.spawn('PlanetNode');
                    world.insert(e, Transform, {});
                    world.setParent(e, entity);
                }
                built.nodes.set(key, e);
            }
            const [ox, oy] = built.table.origin(page.slot);
            // The tint names the page, the level and the face, and the node's place on its face (see the Planet shader's hook).
            const color = { r: (ox + 0.5) / ATLAS_SIZE, g: (oy + 0.5) / ATLAS_SIZE, b: n.level + 1 + 16 * n.face, a: n.ix * 2048 + n.iz + 1 };
            // The node's box in the planet's space, which is all culling reads: the corners, the edges' middles and the middle, at its least and most height.
            const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
            for (let j = 0; j <= 4; j++) for (let i = 0; i <= 4; i++) for (const h of [page.min, page.max]) {
                nodePoint(tree, levels, n, i / 4, j / 4, h, p);
                for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, p[k]!); hi[k] = Math.max(hi[k]!, p[k]!); }
            }
            const position = { x: lo[0]!, y: lo[1]!, z: lo[2]! };
            const scale = { x: Math.max(hi[0]! - lo[0]!, 1e-3), y: Math.max(hi[1]! - lo[1]!, 1e-3), z: Math.max(hi[2]! - lo[2]!, 1e-3) };
            const t = world.get(e, Transform) as TransformData;
            if (t.position.x !== position.x || t.position.y !== position.y || t.position.z !== position.z || t.scale.x !== scale.x || t.scale.y !== scale.y || t.scale.z !== scale.z) {
                world.insert(e, Transform, { ...t, position, scale });
            }
            const mr = world.tryGet(e, MeshRenderer) as MeshRendererData | null;
            if (!mr || !mr.enabled || mr.color.r !== color.r || mr.color.g !== color.g || mr.color.b !== color.b || mr.color.a !== color.a || mr.material !== built.instance) {
                world.insert(e, MeshRenderer, {
                    ...(mr ?? {}), mesh: built.mesh, material: built.instance, lit: true, opaque: true, cullBackfaces: true, color, enabled: true,
                } as Partial<MeshRendererData>);
            }
        }
    }

    private destroy(app: App, built: Built): void {
        built.epoch++;
        this.dropSea(app, built);
        bakesOf(app).clear(built);
        const world = app.world;
        for (const e of [...built.nodes.values(), ...built.spare]) if (world.valid(e)) world.despawn(e);
        built.nodes.clear();
        built.spare.length = 0;
        built.wanted.clear();
        const rm = getResourceManager();
        for (const handle of [built.heights, built.paint]) {
            if (!handle) continue;
            withdrawTextureContent(handle);
            rm?.releaseTexture(handle);
        }
        if (built.instance) Material.release(built.instance);
        if (built.mesh && app.hasResource(Assets)) app.getResource(Assets).releaseBuiltMesh(built.mesh);
        releaseLayerArrays(built.arrays);
        built.arrays = [];
        built.packed = '';
        built.instance = built.mesh = built.heights = built.paint = 0;
        built.table.clear();
    }
}

/** The last place asked of a provider, and what it said: a generated world reads the height, the paint and each field of one point in turn. */
let lastAsked: { source: PlanetPageSource; key: string; got: PlanetSamples } | null = null;

/** The provider's answer for one direction, from its last answer where it is the same place; null while it answers later. */
function sampleAt(source: PlanetPageSource, dx: number, dy: number, dz: number): PlanetSamples | null {
    const key = `${dx},${dy},${dz}`;
    if (lastAsked && lastAsked.source === source && lastAsked.key === key) return lastAsked.got;
    const got = source.provider.sample({ world: source.world, seed: source.seed, version: source.version, radius: source.radius, directions: Float32Array.of(dx, dy, dz), count: 1 });
    if (got instanceof Promise) return null;
    lastAsked = { source, key, got };
    return got;
}

/** What, changed, makes the planet again: everything but the colours and the wander, which are read each frame. */
function signatureOf(d: PlanetData): string {
    return JSON.stringify([d.radius, d.provider, d.world, d.generatorVersion, d.seed, d.cellSize, d.detail]);
}

export const planetPlugin = new PlanetPlugin();
