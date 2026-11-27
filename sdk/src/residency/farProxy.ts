// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    farProxy.ts
 * @brief   What a cell's far proxy is made from, and where it ships.
 *
 * @details A far proxy stands in for a cell that is not resident: the cell's static, opaque meshes merged, and simplified where
 *          the host can, into one draw per material. Everything but the simplifier is here, so a build and the editor's Play
 *          assemble the same proxy: which surfaces of a cell document qualify, where each sits, how they group, and the
 *          document that draws them. A host brings the bytes (how a mesh reference is read) and the simplifier, if it has one.
 */

import { expandScenePrefabs, migrateSceneData, parseSceneFormatVersion, SCENE_FORMAT_VERSION,
    type PrefabAssetResolver, type SceneData, type SceneEntityData } from '../scene/scene';
import { needsComponentUpgrade } from '../scene/legacyComponents';
import { composeTRS, IDENTITY, multiplyAffine } from '../math/mat4';
import { MeshChannel, MeshChannelType, type MeshData } from '../asset/meshFormat';
import { channelSignature, mergeMeshes, planStaticBatches, staticBatchKey, type StaticBatchState } from '../render/staticBatch';
import { builtinMeshTemplate } from '../asset/builtinMeshes';
import { worldFileStem, type CutWorld } from './cutWorld';
import { streamedWorldData } from './partitionWorld';
import type { WorldCell } from './cells';

/** How a world's far proxies are baked and how far they are shown, from its `StreamedWorld`. @experimental */
export interface FarProxySettings {
    /** Cells whose box is within this distance of a source and are not resident show their proxy. */
    farDistance: number;
    /** Target share of triangles kept, in (0, 1]; the error limit can keep more. */
    ratio: number;
    /** Largest distance, world units, a simplified surface may move from the original. */
    maxWorldError: number;
}

/** One surface a far proxy is made of, as the cell document places it. @experimental */
export interface FarProxySurface {
    /** The surface's entity id in the cell document. */
    entity: number;
    /** The MeshRenderer's `mesh` reference: `builtin:*`, a path, or `@uuid:`. */
    mesh: string;
    /** Column-major world matrix, its whole parent chain composed. */
    world: number[];
    /** The MeshRenderer's data as the document writes it (asset references are strings). */
    renderer: Record<string, unknown>;
}

/** Why a MeshRenderer in a cell is left out of its proxy. @experimental */
export type FarProxySkip = 'disabled' | 'blended' | 'moves' | 'skinned' | 'billboard' | 'no-mesh' | 'excluded';

type Vec3 = { x: number; y: number; z: number };
type Quat = Vec3 & { w: number };

/** Package-relative path of a cell's far proxy document. @experimental */
export function farProxyPath(cellName: string): string {
    return `${worldFileStem(cellName)}.far.json`;
}

/** Package-relative path of one baked mesh of a cell's far proxy. @experimental */
export function farProxyMeshPath(cellName: string, index: number): string {
    return `${worldFileStem(cellName)}.far.${index}.esmesh`;
}

/** The scene name a cell's far proxy is registered under. @experimental */
export function farProxySceneName(cellName: string): string {
    return `${cellName}#far`;
}

function componentOf(entity: SceneEntityData, type: string): Record<string, unknown> | null {
    const found = entity.components?.find((c) => c.type === type);
    return found ? (found.data ?? {}) as Record<string, unknown> : null;
}

function finite(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The world's far-proxy settings, or null when its `StreamedWorld` does not ask for far proxies. @experimental */
export function farProxySettings(scene: SceneData, cut?: CutWorld): FarProxySettings | null {
    const declaration = cut?.streamedWorld ?? streamedWorldData(scene);
    if (declaration?.farProxies !== true) return null;
    return {
        farDistance: Math.max(0, finite(declaration.farDistance, 8000)),
        ratio: Math.min(1, Math.max(0.001, finite(declaration.proxyRatio, 0.01))),
        maxWorldError: Math.max(0, finite(declaration.proxyError, 1)),
    };
}

function localMatrix(transform: Record<string, unknown>): number[] {
    const p = (transform.position ?? {}) as Partial<Vec3>;
    const q = (transform.rotation ?? {}) as Partial<Quat>;
    const s = (transform.scale ?? {}) as Partial<Vec3>;
    return composeTRS(
        { x: finite(p.x, 0), y: finite(p.y, 0), z: finite(p.z, 0) },
        { x: finite(q.x, 0), y: finite(q.y, 0), z: finite(q.z, 0), w: finite(q.w, 1) },
        { x: finite(s.x, 1), y: finite(s.y, 1), z: finite(s.z, 1) },
    );
}

/** Whether an entity moves on its own: a character, a body that is not static, or an animated rig. */
function moves(entity: SceneEntityData): boolean {
    if (componentOf(entity, 'CharacterController2D') || componentOf(entity, 'CharacterController3D')
        || componentOf(entity, 'Animator')) return true;
    for (const type of ['RigidBody3D', 'RigidBody2D']) {
        const body = componentOf(entity, type);
        // A body that does not say is the component's default, which is dynamic.
        if (body && finite(body.bodyType, 2) !== 0) return true;
    }
    return false;
}

interface ProxyHierarchy {
    disabled: boolean;
    excluded: boolean;
    moving: boolean;
    matrix?: number[];
}

/** Memoize the inherited state of the requested surfaces, visiting ancestors without recursion. */
function proxyHierarchy(entities: readonly SceneEntityData[], scene: string): (id: number) => ProxyHierarchy {
    const byId = new Map<number, SceneEntityData>();
    // The scene loader does not spawn these rows. Their children can still be
    // present, in which case their parent link stops here.
    for (const entity of entities) if (entity.visible !== false) byId.set(entity.id, entity);
    const memo = new Map<number, ProxyHierarchy>();
    return (id: number) => {
        const path: SceneEntityData[] = [];
        const seen = new Set<number>();
        let inherited: ProxyHierarchy | undefined;
        for (let row = byId.get(id); row; row = row.parent == null ? undefined : byId.get(row.parent)) {
            inherited = memo.get(row.id);
            if (inherited) break;
            if (seen.has(row.id)) throw new Error(`Scene "${scene}" has a parent cycle at entity ${row.id}`);
            seen.add(row.id);
            path.push(row);
        }
        for (let i = path.length - 1; i >= 0; i--) {
            const row = path[i]!;
            const disabled = inherited?.disabled || componentOf(row, 'Disabled') !== null;
            const excluded = inherited?.excluded || componentOf(row, 'ExcludeFromFarProxy') !== null;
            const moving = inherited?.moving || moves(row);
            let matrix: number[] | undefined;
            if (!disabled && !excluded && !moving) {
                matrix = inherited?.matrix;
                const transform = componentOf(row, 'Transform');
                if (transform) {
                    const local = localMatrix(transform);
                    matrix = matrix ? multiplyAffine(matrix, local) : local;
                }
            }
            inherited = { disabled, excluded, moving, matrix };
            memo.set(row.id, inherited);
        }
        return inherited!;
    };
}

/**
 * The surfaces of `cell` a far proxy is made of, with the ones left out and why.
 *
 * Prefab instances are expanded first, so a building placed as a prefab contributes its meshes. A surface qualifies when it is
 * enabled, opaque, drawn from a mesh reference, not skinned, not a billboard, and neither it nor any ancestor moves on its own or
 * carries `ExcludeFromFarProxy`.
 *
 * @experimental
 */
export async function farProxySurfaces(
    cell: SceneData, loadPrefab: PrefabAssetResolver,
): Promise<{ surfaces: FarProxySurface[]; skipped: Array<{ entity: number; reason: FarProxySkip }> }> {
    // A document may leave an instance's empty edit lists out; the expansion reads all three.
    const entries = (cell.entities ?? []).map((entry) => {
        const instance = entry as unknown as { prefab?: unknown; overrides?: unknown[]; added?: unknown[]; removed?: unknown[] };
        return typeof instance.prefab === 'string'
            ? { ...instance, overrides: instance.overrides ?? [], added: instance.added ?? [], removed: instance.removed ?? [] }
            : entry;
    }) as SceneData['entities'];
    const expanded = await expandScenePrefabs({ ...cell, entities: entries }, loadPrefab, { expandVirtual: true });
    const normalized = parseSceneFormatVersion(expanded.version) > SCENE_FORMAT_VERSION
        || expanded.entities.some(needsComponentUpgrade) ? migrateSceneData(expanded).data : expanded;
    const hierarchyOf = proxyHierarchy(normalized.entities, cell.name);

    const surfaces: FarProxySurface[] = [];
    const skipped: Array<{ entity: number; reason: FarProxySkip }> = [];
    for (const entity of normalized.entities) {
        const renderer = componentOf(entity, 'MeshRenderer');
        if (!renderer) continue;
        const skip = (reason: FarProxySkip): void => { skipped.push({ entity: entity.id, reason }); };
        if (renderer.enabled === false || entity.visible === false) { skip('disabled'); continue; }
        if (renderer.opaque !== true) { skip('blended'); continue; }
        if (typeof renderer.mesh !== 'string' || renderer.mesh === '') { skip('no-mesh'); continue; }
        if (componentOf(entity, 'MeshSkin')) { skip('skinned'); continue; }
        const billboard = componentOf(entity, 'Billboard');
        if (billboard && billboard.enabled !== false) { skip('billboard'); continue; }
        const { disabled, excluded, moving, matrix } = hierarchyOf(entity.id);
        if (disabled) { skip('disabled'); continue; }
        if (excluded) { skip('excluded'); continue; }
        if (moving) { skip('moves'); continue; }
        surfaces.push({ entity: entity.id, mesh: renderer.mesh, world: matrix?.slice() ?? Array.from(IDENTITY), renderer: { ...renderer } });
    }
    return { surfaces, skipped };
}

/** One surface with its geometry, ready to group. @experimental */
export interface FarProxyPart {
    entity: number;
    mesh: MeshData;
    world: ArrayLike<number>;
    state: StaticBatchState;
}

/** Surfaces that draw with one state, merged into one mesh placed at the proxy's origin. @experimental */
export interface FarProxyGroup {
    sources: number[];
    state: StaticBatchState;
    mesh: MeshData;
}

/**
 * Group `parts` by draw state and merge each group into one mesh local to `origin`. A group past `maxVertices` splits, and one
 * surface larger than that stays a group of its own.
 *
 * @experimental
 */
export function groupFarProxy(parts: readonly FarProxyPart[], origin: readonly [number, number, number],
                              maxVertices = 262144): FarProxyGroup[] {
    const byEntity = new Map<number, FarProxyPart>();
    for (const part of parts) byEntity.set(part.entity, part);
    const plan = planStaticBatches(parts.map((part) => ({
        entity: part.entity, key: staticBatchKey(part.state, channelSignature(part.mesh.channels, part.mesh.vertexStride)),
        center: [0, 0, 0] as [number, number, number], vertices: part.mesh.vertexCount,
    })), { cellSize: 1, maxVertices });
    const groups = [...plan.batches.map((batch) => batch.entities), ...plan.alone.map((entity) => [entity])]
        .sort((a, b) => a[0]! - b[0]!);
    return groups.map((ids) => {
        const members = ids.map((entity) => byEntity.get(entity)!);
        const mesh = mergeMeshes(members.map((part) => {
            const world = Array.from(part.world);
            for (let axis = 0; axis < 3; axis++) world[12 + axis]! -= origin[axis]!;
            return { mesh: part.mesh, world };
        }));
        return { sources: ids, state: structuredClone(members[0]!.state), mesh };
    });
}

/** What a host lends {@link assembleFarProxies}. @experimental */
export interface FarProxyHost {
    loadPrefab: PrefabAssetResolver;
    /** The geometry a non-builtin mesh reference names, or null when it cannot be read. */
    readMesh(ref: string): Promise<MeshData | null>;
    /** Simplify a merged group within the settings' error; a host without one ships the merge as it is. */
    simplify?(mesh: MeshData, ratio: number, maxWorldError: number): Promise<MeshData>;
}

/** One cell's proxy: its document and the meshes it names, by package path. @experimental */
export interface AssembledFarProxy {
    cell: string;
    path: string;
    document: SceneData;
    meshes: Array<{ path: string; mesh: MeshData }>;
    surfaces: number;
    trianglesBefore: number;
    trianglesAfter: number;
    /** Surfaces whose mesh reference could not be read. */
    unread: number;
}

/** `mesh` without the channel `semantic`, its vertices repacked; the same mesh when it has no such channel. */
function withoutChannel(mesh: MeshData, semantic: number): MeshData {
    const sorted = [...mesh.channels].sort((a, b) => a.offset - b.offset);
    if (!sorted.some((c) => c.semantic === semantic)) return mesh;
    const sizes = sorted.map((c, i) => (sorted[i + 1]?.offset ?? mesh.vertexStride) - c.offset);
    const kept = sorted.map((c, i) => ({ c, size: sizes[i]! })).filter(({ c }) => c.semantic !== semantic);
    let stride = 0;
    const placed = kept.map(({ c, size }) => { const at = stride; stride += size; return { from: c.offset, at, size, channel: { ...c, offset: at } }; });
    const vertices = new Uint8Array(mesh.vertexCount * stride);
    for (let v = 0; v < mesh.vertexCount; v++) {
        const source = v * mesh.vertexStride, target = v * stride;
        for (const p of placed) vertices.set(mesh.vertices.subarray(source + p.from, source + p.from + p.size), target + p.at);
    }
    return { ...mesh, channels: placed.map((p) => p.channel), vertexStride: stride, vertices };
}

/**
 * `mesh` with `tint` multiplied into its vertex colours, or null when it cannot carry it: no four-byte colour channel, or a tint of
 * plain white, which needs no carrying.
 */
function tintVertices(mesh: MeshData, tint: Colour): MeshData | null {
    if (tint.r === 1 && tint.g === 1 && tint.b === 1 && tint.a === 1) return null;
    const colour = mesh.channels.find((c) => c.semantic === MeshChannel.Color);
    if (!colour || colour.type !== MeshChannelType.UNorm8 || colour.components !== 4) return null;
    const vertices = mesh.vertices.slice();
    const k = [tint.r, tint.g, tint.b, tint.a];
    for (let v = 0; v < mesh.vertexCount; v++) {
        const at = v * mesh.vertexStride + colour.offset;
        for (let c = 0; c < 4; c++) vertices[at + c] = Math.max(0, Math.min(255, Math.round(vertices[at + c]! * k[c]!)));
    }
    return { ...mesh, vertices };
}

/** Interns a document's asset references to the integers a draw-state key compares. */
function refTable(): (value: unknown) => number {
    const ids = new Map<string, number>();
    return (value) => {
        if (typeof value !== 'string' || value === '') return 0;
        let id = ids.get(value);
        if (id === undefined) { id = ids.size + 1; ids.set(value, id); }
        return id;
    };
}

type Colour = { r: number; g: number; b: number; a: number };

/** Reads a mesh reference once however many surfaces name it: built-ins here, everything else through the host. */
function meshCache(host: FarProxyHost): (reference: string) => Promise<MeshData | null> {
    const meshes = new Map<string, Promise<MeshData | null>>();
    return (reference) => {
        let pending = meshes.get(reference);
        if (!pending) {
            pending = reference.startsWith('builtin:')
                ? Promise.resolve(builtinMeshTemplate(reference)?.build() ?? null)
                : host.readMesh(reference).catch(() => null);
            meshes.set(reference, pending);
        }
        return pending;
    };
}

/** One cell's proxy, or null when nothing in it is a surface a proxy can be made of. */
async function assembleCell(
    cell: WorldCell, document: SceneData, plane: 'xz' | 'xy', settings: FarProxySettings, host: FarProxyHost,
    readMesh: (reference: string) => Promise<MeshData | null>,
): Promise<AssembledFarProxy | null> {
    const { surfaces } = await farProxySurfaces(document, host.loadPrefab);
    const intern = refTable();
    const parts: FarProxyPart[] = [];
    const renderers = new Map<number, Record<string, unknown>>();
    let unread = 0;
    for (const surface of surfaces) {
        const mesh = await readMesh(surface.mesh);
        if (!mesh || mesh.vertexCount === 0 || mesh.indices.length === 0) { unread++; continue; }
        const r = surface.renderer;
        renderers.set(surface.entity, r);
        // A tint is the vertex colour times the renderer's colour, so it can be carried by the vertices instead: then surfaces
        // that differ only in tint share one draw.
        const tint = (r.color ?? { r: 1, g: 1, b: 1, a: 1 }) as Colour;
        const tinted = tintVertices(mesh, tint);
        parts.push({
            entity: surface.entity, mesh: tinted ?? mesh, world: surface.world,
            state: {
                material: intern(r.material), texture: intern(r.texture), normalMap: intern(r.normalMap),
                color: tinted ? { r: 1, g: 1, b: 1, a: 1 } : tint,
                layer: typeof r.layer === 'number' ? r.layer : 0,
                cullBackfaces: r.cullBackfaces === true, lit: r.lit === true, castShadows: r.castShadows !== false,
                parallax: (r.parallax ?? { x: 1, y: 1 }) as { x: number; y: number }, group: '',
            },
        });
    }
    if (parts.length === 0) return null;
    const centre = [(cell.minX + cell.maxX) / 2, (cell.minZ + cell.maxZ) / 2] as const;
    const origin: [number, number, number] = plane === 'xy' ? [centre[0], centre[1], 0] : [centre[0], 0, centre[1]];
    const proxy: AssembledFarProxy = {
        cell: cell.name, path: farProxyPath(cell.name),
        document: { version: document.version, name: farProxySceneName(cell.name), entities: [] },
        meshes: [], surfaces: parts.length, trianglesBefore: 0, trianglesAfter: 0, unread,
    };
    for (const [i, group] of groupFarProxy(parts, origin).entries()) {
        // A second UV set is a lightmap's, which no shader reads; carried, it costs bytes and holds seams the simplifier keeps.
        const merged = withoutChannel(group.mesh, MeshChannel.TexCoord1);
        const mesh = host.simplify ? await host.simplify(merged, settings.ratio, settings.maxWorldError) : merged;
        const meshPath = farProxyMeshPath(cell.name, i);
        proxy.meshes.push({ path: meshPath, mesh });
        proxy.trianglesBefore += group.mesh.indices.length / 3;
        proxy.trianglesAfter += mesh.indices.length / 3;
        // The first source's renderer carries the group's material, textures and switches, as the strings the runtime resolves.
        proxy.document.entities.push({
            id: i + 1, name: 'Far proxy ' + i, parent: null, children: [], visible: true,
            components: [
                { type: 'Transform', data: { position: { x: origin[0], y: origin[1], z: origin[2] } } },
                // The group's colour, not the first source's: a tint the vertices carry is not applied twice.
                { type: 'MeshRenderer', data: { ...renderers.get(group.sources[0]!)!, color: group.state.color, mesh: meshPath, enabled: true } },
            ],
        });
    }
    return proxy;
}

/**
 * Assemble every cell of `cut` its far proxy, and name each one on the cut's manifest. A cell with nothing a proxy can be made
 * of gets none, so the manifest names a proxy only where there is one to show.
 *
 * @experimental
 */
export async function assembleFarProxies(
    cut: CutWorld, settings: FarProxySettings, host: FarProxyHost,
): Promise<AssembledFarProxy[]> {
    const out: AssembledFarProxy[] = [];
    const readMesh = meshCache(host);
    for (const cell of cut.manifest.cells) {
        const document = cut.documents.get(cell.name);
        if (!document) continue;
        const proxy = await assembleCell(cell, document, cut.manifest.plane ?? 'xz', settings, host, readMesh);
        if (!proxy) continue;
        cell.proxy = proxy.path;
        out.push(proxy);
    }
    if (out.length > 0) cut.manifest.farDistance = settings.farDistance;
    return out;
}

/** Build requested cells on demand, sharing mesh reads and leaving the manifest untouched. @experimental */
export function createFarProxyBuilder(
    cut: CutWorld, settings: FarProxySettings, host: FarProxyHost,
): (cellName: string) => Promise<AssembledFarProxy | null> {
    const cells = new Map(cut.manifest.cells.map(cell => [cell.name, cell]));
    return buildFarProxyCells(cut, settings, host, cells);
}

function buildFarProxyCells(
    cut: CutWorld, settings: FarProxySettings, host: FarProxyHost, cells: ReadonlyMap<string, WorldCell>,
): (cellName: string) => Promise<AssembledFarProxy | null> {
    const readMesh = meshCache(host);
    const made = new Map<string, Promise<AssembledFarProxy | null>>();
    return (cellName) => {
        const cell = cells.get(cellName);
        const document = cut.documents.get(cellName);
        if (!cell || !document) return Promise.resolve(null);
        let pending = made.get(cellName);
        if (!pending) {
            pending = assembleCell(cell, document, cut.manifest.plane ?? 'xz', settings, host, readMesh);
            made.set(cellName, pending);
        }
        return pending;
    };
}

/**
 * Name on `cut`'s manifest a proxy for every cell with a surface one could be made of, and answer how to make each when it is
 * first wanted, instead of making them all now: what a host that cannot wait for every cell to simplify (the editor's Play)
 * does. A cell named whose meshes all fail to read is made as an empty proxy.
 *
 * @experimental
 */
export async function deferFarProxies(
    cut: CutWorld, settings: FarProxySettings, host: FarProxyHost,
): Promise<(cellName: string) => Promise<AssembledFarProxy | null>> {
    const named = new Map<string, WorldCell>();
    for (const cell of cut.manifest.cells) {
        const document = cut.documents.get(cell.name);
        if (!document || (await farProxySurfaces(document, host.loadPrefab)).surfaces.length === 0) continue;
        cell.proxy = farProxyPath(cell.name);
        named.set(cell.name, cell);
    }
    if (named.size > 0) cut.manifest.farDistance = settings.farDistance;
    return buildFarProxyCells(cut, settings, host, named);
}
