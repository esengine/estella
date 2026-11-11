// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    dynamicGISystem.ts
 * @brief   Feeds the dynamic GI the scene (docs/GI_LUMEN_DESIGN.md): the instances in the world, composed and handed to the engine when they change.
 *
 * @details Runs only while a PostProcessVolume carries an enabled `dynamicGI` effect. A MeshRenderer whose mesh is the built-in cube is a box of
 *          its world scale, with its colour and the emissive colour of its material, and needs no baked file (analyticBox). Any other mesh is the
 *          `.esmeshsdf` and `.esmeshcards` the import wrote beside it (the `dynamicGI` import setting), placed with the entity's transform; a
 *          mesh without them is not in the GI's scene. The sun is the first enabled directional light.
 *
 *          Composition is JavaScript work on the cells the instances touch and runs when the scene changes (a key of the instances'
 *          transforms, colours and emission, and the sun), not every frame.
 */
import type { App } from '../app/app';
import { defineSystem } from '../ecs/system';
import { Query } from '../ecs/query';
import { MeshRenderer, Transform, Light, Camera, PostProcessVolume, type MeshRendererData, type TransformData, type LightData, type CameraData, type PostProcessVolumeData } from '../ecs/component';
import { LightType } from '../wasm/wasm.generated';
import { Assets } from '../asset/AssetPlugin';
import type { Entity } from '../types';
import { withScratch } from '../wasm/wasmScratch';
import { marshallingCore } from '../asset/loaders/engineCore';
import { nativeEngineApi } from '../ecs/bridge/engineApi';
import { Material } from '../render/material';
import { analyticBox, packGPUScene, type GIInstance, type GILight } from './gpuScene';
import { GlobalSdf } from './globalSdf';
import type { PointLight } from './surfaceCache';
import { worldUnitsPerMeter } from '../ecs/worldUnits';
import type { MeshSdf } from './meshSdfFormat';
import type { MeshCards } from './cardFormat';

const CUBE = 100;  // the built-in cube is 100 units across

function matrixOf(t: TransformData, scale = 1): number[] {
    const { x, y, z, w } = t.worldRotation, p = t.worldPosition;
    return [
        (1 - 2 * (y * y + z * z)) * scale, 2 * (x * y + z * w) * scale, 2 * (x * z - y * w) * scale, 0,
        2 * (x * y - z * w) * scale, (1 - 2 * (x * x + z * z)) * scale, 2 * (y * z + x * w) * scale, 0,
        2 * (x * z + y * w) * scale, 2 * (y * z - x * w) * scale, (1 - 2 * (x * x + y * y)) * scale, 0,
        p.x, p.y, p.z, 1,
    ];
}

/** What the system reads of one MeshRenderer: enough to place it in the GI scene. */
export interface GIEntry {
    mesh: number;
    transform: TransformData;
    colour: readonly [number, number, number];
    emissive: readonly [number, number, number];
    /** The asset path of the mesh, where it has one (a built-in cube has none the GI needs). */
    path: string | null;
}

export interface GISidecars { sdf: MeshSdf; cards: MeshCards }

/**
 * The instances of the GI scene from the renderers: a built-in cube is a box of its world scale (with its colour and emission); any other
 * mesh is the baked `.esmeshsdf` and `.esmeshcards` beside it, when it has them and is scaled the same along every axis (a distance field
 * does not survive a stretch). Everything else is not in the GI scene.
 */
export function buildInstances(entries: readonly GIEntry[], cube: number, sidecars: (path: string) => GISidecars | null): { instances: GIInstance[]; key: string } {
    const instances: GIInstance[] = [];
    let key = '';
    const extent = Math.max(1, ...entries.filter((e) => e.mesh === cube).flatMap((e) => [e.transform.worldScale.x, e.transform.worldScale.y, e.transform.worldScale.z].map((v) => v * CUBE)));
    for (const e of entries) {
        const s = e.transform.worldScale, p = e.transform.worldPosition, q = e.transform.worldRotation;
        const pose = `${[p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z].map((v) => v.toFixed(3)).join(',')};${e.colour.join(',')};${e.emissive.join(',')}`;
        if (e.mesh === cube) {
            const size: [number, number, number] = [s.x * CUBE, s.y * CUBE, s.z * CUBE];
            // A box with a cell fine enough that a wall a tenth of a metre thick is still more than one.
            const { cards, ...sdf } = analyticBox(size, e.colour, Math.max(extent / 60, 1e-3), extent / 20, 24, e.emissive);
            instances.push({ sdf, cards, worldFromLocal: matrixOf({ ...e.transform, worldScale: { x: 1, y: 1, z: 1 } }) });
            key += `|c${pose}`;
        } else if (e.path) {
            const found = sidecars(e.path);
            if (!found) continue;
            const lo = Math.min(s.x, s.y, s.z), hi = Math.max(s.x, s.y, s.z);
            if (lo <= 0 || hi / lo > 1.05) continue;
            instances.push({ sdf: found.sdf, cards: found.cards, worldFromLocal: matrixOf(e.transform, (s.x + s.y + s.z) / 3) });
            key += `|m${e.path};${pose}`;
        }
    }
    return { instances, key };
}

/** The settings of the first enabled `dynamicGI` effect of the volumes, or null when there is none. */
function dynamicGIEffect(volumes: Iterable<[Entity, PostProcessVolumeData]>): { cellSize: number } | null {
    for (const [, v] of volumes) {
        for (const e of v.effects as Array<{ type: string; enabled?: boolean; uniforms?: Record<string, number> }>) {
            if (e.type === 'dynamicGI' && e.enabled !== false) return { cellSize: Number(e.uniforms?.u_cellSize ?? 0) || 0 };
        }
    }
    return null;
}

/** A point or spot light of the scene, as the GI lights with it. */
export function pointLightOf(l: LightData, t: TransformData): PointLight | null {
    if (!l.enabled || l.intensity <= 0 || (l.type !== LightType.Point && l.type !== LightType.Spot) || l.radius <= 0) return null;
    const q = t.worldRotation, p = t.worldPosition;
    const radiance: [number, number, number] = [l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity];
    const light: PointLight = { position: [p.x, p.y, p.z], radiance, reach: l.radius, innerRadius: l.innerRadius, falloff: l.falloff, ...(l.inverseSquare ? { metre: worldUnitsPerMeter() } : {}) };
    if (l.type === LightType.Spot) {
        // The aim is the rotation's -Z, as the sun's is.
        const ax = -(2 * (q.x * q.z + q.w * q.y)), ay = -(2 * (q.y * q.z - q.w * q.x)), az = -(1 - 2 * (q.x * q.x + q.y * q.y));
        light.spot = { axis: [ax, ay, az], innerCos: Math.cos((l.innerAngle * Math.PI) / 360), outerCos: Math.cos((l.outerAngle * Math.PI) / 360) };
    }
    return light;
}

/** The emissive colour of a material, black where it has none. */
export function emissiveOf(material: number): [number, number, number] {
    if (material === 0) return [0, 0, 0];
    const v = Material.getUniform(material as never, 'u_emissive') as unknown;
    if (Array.isArray(v)) return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
    const o = v as { x?: number; y?: number; z?: number; r?: number; g?: number; b?: number } | undefined;
    if (!o || typeof o !== 'object') return [0, 0, 0];
    return [o.x ?? o.r ?? 0, o.y ?? o.g ?? 0, o.z ?? o.b ?? 0];
}

type Loader = {
    loadTyped?(type: string, ref: string): Promise<unknown>;
    pathForHandle?(kind: string, handle: number): string | null;
    catalog?: { addressOf?(path: string): string | null };
};

export function dynamicGISystem(app: App) {
    let cube = 0, loading = false, lastKey = '';
    // The field that follows the camera, kept between frames so that a camera that moves rebuilds only the slabs that came into view.
    let follow: { sdf: GlobalSdf; instancesKey: string; cell: number } | null = null;
    // The baked files beside a mesh, by its path: null while loading and for a mesh that has none.
    const sidecars = new Map<string, GISidecars | null>();
    const request = (path: string): void => {
        if (sidecars.has(path) || !app.hasResource(Assets)) return;
        sidecars.set(path, null);
        const assets = app.getResource(Assets) as unknown as Loader;
        // A packaged build renames every asset to its hash; the files beside the mesh are named from where it was authored.
        const authored = assets.catalog?.addressOf?.(path) ?? path;
        const base = authored.replace(/\.esmesh$/, '');
        if (!assets.loadTyped || base === authored) return;
        void Promise.all([assets.loadTyped('meshSdf', `${base}.esmeshsdf`), assets.loadTyped('meshCards', `${base}.esmeshcards`)]).then(
            ([sdf, cards]) => { sidecars.set(path, { sdf: sdf as MeshSdf, cards: cards as MeshCards }); lastKey = ''; },
            () => { /* a mesh with no baked files is simply not in the scene */ });
    };
    return defineSystem(
        [Query(MeshRenderer, Transform), Query(Light, Transform), Query(PostProcessVolume), Query(Camera, Transform)],
        (meshes: Iterable<[Entity, MeshRendererData, TransformData]>, lights: Iterable<[Entity, LightData, TransformData]>,
         volumes: Iterable<[Entity, PostProcessVolumeData]>, cameras: Iterable<[Entity, CameraData, TransformData]>) => {
            // The work counters of the last frame, for a cost gate (tools/gi/check-gi-cost.mjs) and for anyone profiling: where the work is is the engine's,
            // what it costs is the device's.
            (globalThis as { __estellaGIStats?: () => number[] | null }).__estellaGIStats ??= () => {
                const core = marshallingCore(app.wasmModule ?? nativeEngineApi());
                if (!core?.postprocess_giStats) return null;
                return withScratch(core, (alloc) => {
                    const ptr = alloc(64);
                    return core.postprocess_giStats!(ptr, 16) === 16 ? Array.from(core.HEAPF32.subarray(ptr >> 2, (ptr >> 2) + 16)) : null;
                });
            };
            const effect = dynamicGIEffect(volumes);
            if (!effect) { lastKey = ''; follow = null; return; }
            // The web's module, or a device's host (which answers the same heap from its arena): the arrays cross the boundary through it.
            const m = marshallingCore(app.wasmModule ?? nativeEngineApi());
            if (!m?.postprocess_setGIScene) return;
            if (cube === 0) {
                if (!loading && app.hasResource(Assets)) {
                    loading = true;
                    const assets = app.getResource(Assets) as unknown as { loadTyped?(type: string, ref: string): Promise<{ handle: number }> };
                    void assets.loadTyped?.('mesh', 'builtin:cube').then((r) => { cube = r.handle; }, () => { loading = false; });
                }
                return;
            }
            let light: GILight | null = null;
            for (const [, l, t] of lights) {
                if (!l.enabled || l.intensity <= 0 || l.type !== LightType.Directional) continue;
                const q = t.worldRotation;
                const ax = -(2 * (q.x * q.z + q.w * q.y)), ay = -(2 * (q.y * q.z - q.w * q.x)), az = -(1 - 2 * (q.x * q.x + q.y * q.y));
                const n = Math.hypot(ax, ay, az) || 1;
                light = { toLight: [-ax / n, -ay / n, -az / n], radiance: [l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity] };
                break;
            }
            const point: PointLight[] = [];
            for (const [, l, t] of lights) { const p = pointLightOf(l, t); if (p) point.push(p); }
            let eye: [number, number, number] | null = null;
            for (const [, c, t] of cameras) if (c.isActive) { eye = [t.worldPosition.x, t.worldPosition.y, t.worldPosition.z]; break; }
            // The lights that matter are the ones nearest the eye: only a handful fit.
            if (eye && point.length > 8) point.sort((a, b) => Math.hypot(a.position[0] - eye![0], a.position[1] - eye![1], a.position[2] - eye![2]) - Math.hypot(b.position[0] - eye![0], b.position[1] - eye![1], b.position[2] - eye![2]));
            const lightKey = point.slice(0, 8).map((l) => `${l.position.map((v) => v.toFixed(2)).join(',')};${l.radiance.join(',')};${l.reach};${l.innerRadius};${l.falloff};${l.metre ?? 0};${l.spot ? l.spot.axis.map((v) => v.toFixed(3)).join(',') + l.spot.innerCos + l.spot.outerCos : ''}`).join('|');
            const assets = app.hasResource(Assets) ? app.getResource(Assets) as unknown as Loader : null;
            const entries: GIEntry[] = [];
            for (const [, r, t] of meshes) {
                if (!r.enabled) continue;
                let path: string | null = null;
                if (r.mesh !== cube && r.mesh !== 0) {
                    path = assets?.pathForHandle?.('mesh', r.mesh) ?? null;
                    if (path) request(path);
                }
                entries.push({ mesh: r.mesh, transform: t, colour: [r.color.r, r.color.g, r.color.b], emissive: emissiveOf(r.material), path });
            }
            const { instances, key: sceneKey } = buildInstances(entries, cube, (p) => sidecars.get(p) ?? null);
            // A cell size asks for the field that follows the eye: three levels, each four times the last, around the camera. Without one the
            // field is a single window that holds the whole scene.
            const following = effect.cellSize > 0 && eye !== null;
            const snap = following ? effect.cellSize * 8 : 1;
            const eyeKey = following ? eye!.map((v) => Math.floor(v / snap)).join(',') : '';
            const key = (light ? `${light.toLight.join(',')}|${light.radiance.join(',')}` : 'dark') + sceneKey + '#' + lightKey + '#' + effect.cellSize + eyeKey;
            if (key === lastKey || instances.length === 0) return;
            lastKey = key;
            let sdf: GlobalSdf | undefined;
            if (following) {
                const cell = effect.cellSize;
                if (!follow || follow.cell !== cell || follow.instancesKey !== sceneKey) {
                    const fresh = new GlobalSdf([{ dim: 128, cell }, { dim: 128, cell: cell * 4 }, { dim: 128, cell: cell * 16 }]);
                    fresh.setCenter(eye!);
                    instances.forEach((inst, id) => fresh.update({ id, sdf: inst.sdf, worldFromLocal: inst.worldFromLocal }));
                    follow = { sdf: fresh, instancesKey: sceneKey, cell };
                } else {
                    follow.sdf.setCenter(eye!);
                }
                sdf = follow.sdf;
            } else {
                follow = null;
            }
            const scene = packGPUScene(instances, light, { sdf, lights: point.slice(0, 8) });
            if (!scene) return;
            withScratch(m, (alloc) => {
                const put = (data: ArrayBufferView): number => {
                    const ptr = alloc(data.byteLength);
                    m.HEAPU8.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), ptr);
                    return ptr;
                };
                m.postprocess_setGIScene!(put(scene.header), scene.header.length, put(scene.sdf), scene.sdf.length,
                    put(scene.instances), scene.instances.length, put(scene.pixels), scene.pixels.length);
            });
        },
        { name: 'DynamicGISystem', runWhenPaused: true },
    );
}
