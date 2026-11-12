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
import { PostProcess } from '../postprocess/PostProcessAPI';
import { analyticBox, instanceBounds, packGPUScene, type GIInstance, type GILight, type GPUScene } from './gpuScene';
import { GlobalSdf } from './globalSdf';
import { buildInstances, instanceKey, type GIEntry, type GISidecars } from './giInstances';
import type { PointLight } from './surfaceCache';
import { worldUnitsPerMeter } from '../ecs/worldUnits';
import type { MeshSdf } from './meshSdfFormat';
import type { MeshCards } from './cardFormat';

export { buildInstances, instanceKey, type GIEntry, type GISidecars } from './giInstances';

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

/**
 * Gives the engine a packed scene, and records what the rebuild behind it cost (for tools/gi/measure-camera-move.mjs): the milliseconds of the
 * boxes, of the field and of the pack, then the hand-over's own. Said to the device log every 8 rebuilds, where that is the only place to read it.
 *
 * The first time, and after a scene change, the whole of it goes. After a camera move only the levels that were rebuilt do (10 MB a level, and the
 * finest is nearly all there is to send), by the range of the field they fill: the engine leaves the cards and the light on them alone.
 */
function sendScene(m: NonNullable<ReturnType<typeof marshallingCore>>, field: { sdf: GlobalSdf; sent: number[] | null }, scene: GPUScene,
    full: boolean, [instancesMs, fieldMs, packMs]: [number, number, number]): void {
    const t = performance.now();
    const levels = field.sdf.levels.slice(0, 3);
    withScratch(m, (alloc) => {
        const put = (data: ArrayBufferView): number => {
            const ptr = alloc(data.byteLength);
            m.HEAPU8.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), ptr);
            return ptr;
        };
        if (full || !field.sent || !m.postprocess_updateGIField) {
            m.postprocess_setGIScene!(put(scene.header), scene.header.length, put(scene.sdf), scene.sdf.length,
                put(scene.instances), scene.instances.length, put(scene.pixels), scene.pixels.length);
            return;
        }
        let at = 0, sent = 0;
        const headerPtr = put(scene.header);
        levels.forEach((l, k) => {
            if (field.sent![k] !== l.version) {
                m.postprocess_updateGIField!(headerPtr, scene.header.length, put(scene.sdf.subarray(at, at + l.storage.length)), at, l.storage.length);
                sent++;
            }
            at += l.storage.length;
        });
        // Nothing of the field changed (the light did): the header alone.
        if (sent === 0) m.postprocess_updateGIField!(headerPtr, scene.header.length, headerPtr, 0, 0);
    });
    field.sent = levels.map((l) => l.version);
    const record = ((globalThis as { __estellaGIBuild?: { ms: number[][] } }).__estellaGIBuild ??= { ms: [] });
    record.ms.push([instancesMs, fieldMs, packMs, performance.now() - t, scene.sdf.byteLength / 1048576]);
    if (record.ms.length > 256) record.ms.shift();
    if (record.ms.length % 8 === 0) {
        const totals = record.ms.slice(-8).map((r) => r[0]! + r[1]! + r[2]! + r[3]!).sort((x, y) => x - y);
        console.log(`[gi] last 8 rebuilds: median ${totals[4]!.toFixed(1)} ms, worst ${totals[7]!.toFixed(1)} ms (${scene.sdf.byteLength >> 20} MB of field)`);
    }
}

export function dynamicGISystem(app: App) {
    let cube = 0, loading = false, lastKey = '';
    // The field that follows the camera, kept between frames so that a camera that moves rebuilds only the slabs that came into view.
    let field: { sdf: GlobalSdf; sceneKey: string; cell: number; sent: number[] | null } | null = null;
    let built: { sceneKey: string; instances: GIInstance[] } | null = null;
    // A camera that moved while the field is still being rebuilt for the last move: what is waiting to be packed and sent when it is done.
    let waiting: { instances: GIInstance[]; light: GILight | null; lights: PointLight[]; work: number; full: boolean; build: number } | null = null;
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
            // A quality level that leaves the effect out (the low one does: a device that cannot afford the passes) builds no field either.
            const allowed = !app.hasResource(PostProcess) || app.getResource(PostProcess).effectAllowed('dynamicGI');
            if (!effect || !allowed) { lastKey = ''; field = null; waiting = null; return; }
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
            const sceneKey = instanceKey(entries, cube, (p) => sidecars.get(p) ?? null);
            // A cell size asks for the field that follows the eye: three levels, each four times the last, around the camera. Without one the
            // field is a single window that holds the whole scene.
            const following = effect.cellSize > 0 && eye !== null;
            const snap = following ? effect.cellSize * 8 : 1;
            const eyeKey = following ? eye!.map((v) => Math.floor(v / snap)).join(',') : '';
            const key = (light ? `${light.toLight.join(',')}|${light.radiance.join(',')}` : 'dark') + sceneKey + '#' + lightKey + '#' + effect.cellSize + eyeKey;
            // The rebuild a camera move asked for goes on a few milliseconds a frame, and is handed to the engine when it is whole: until then
            // the engine traces the field as it was, which is a window a little behind the eye and nothing worse.
            if (field && waiting) {
                const ts = performance.now();
                // A scene with no GI yet is worth a few slow frames (about 2 s on a phone instead of 10); a camera that moves is not.
                const finished = field.sdf.step(waiting.full ? 12 : 3);
                waiting.work += performance.now() - ts;
                if (finished) {
                    const w = waiting;
                    waiting = null;
                    const tPack = performance.now();
                    const done = packGPUScene(w.instances, w.light, { sdf: field.sdf, lights: w.lights });
                    if (done) sendScene(m, field, done, w.full, [w.build, w.work, performance.now() - tPack]);
                }
            }
            if (key === lastKey || sceneKey === '') return;
            lastKey = key;
            const t0 = performance.now();
            // The boxes are built when the scene changes, not when only the eye did: a camera that walks changes the key every few steps.
            if (!built || built.sceneKey !== sceneKey) built = { sceneKey, instances: buildInstances(entries, cube, (p) => sidecars.get(p) ?? null).instances };
            const instances = built.instances;
            if (instances.length === 0) return;
            const cell = following ? effect.cellSize : 0;
            if (!field || field.sceneKey !== sceneKey || field.cell !== cell) {
                // A scene the field has not seen: a new field, over the frames that follow, and the whole of it sent when it is done.
                let sdf: GlobalSdf;
                if (following) {
                    sdf = new GlobalSdf([{ dim: 128, cell }, { dim: 128, cell: cell * 4 }, { dim: 128, cell: cell * 16 }]);
                    sdf.setCenter(eye!);
                } else {
                    const { min, max } = instanceBounds(instances);
                    const extent = Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!);
                    sdf = new GlobalSdf([{ dim: 128, cell: (extent * 1.15) / 124 }]);
                    sdf.setCenter([(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2]);
                }
                instances.forEach((inst, id) => sdf.update({ id, sdf: inst.sdf, worldFromLocal: inst.worldFromLocal }, true));
                sdf.queueAll();
                field = { sdf, sceneKey, cell, sent: null };
                waiting = { instances, light, lights: point.slice(0, 8), work: 0, full: true, build: performance.now() - t0 };
                return;
            }
            // The same scene: the eye moved (queue the slabs that came into view), or only the light did (nothing to queue). Either way it is sent when whole.
            if (following) field.sdf.setCenter(eye!, true);
            waiting = { instances, light, lights: point.slice(0, 8), work: waiting?.work ?? 0, full: waiting?.full ?? false, build: 0 };
        },
        { name: 'DynamicGISystem', runWhenPaused: true },
    );
}
