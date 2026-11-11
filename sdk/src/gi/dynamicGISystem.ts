// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    dynamicGISystem.ts
 * @brief   Feeds the dynamic GI the scene (docs/GI_LUMEN_DESIGN.md): the instances in the world, composed and handed to the engine when they change.
 *
 * @details Runs only while a PostProcessVolume carries an enabled `dynamicGI` effect. What it sees of the scene is the MeshRenderers whose mesh
 *          is the built-in cube: each is a box of its world scale, with its colour, and a box needs no baked file (analyticBox). A mesh
 *          with a baked `.esmeshsdf` / `.esmeshcards` beside it is the next step; until then it is not in the GI's scene.
 *          The sun is the first enabled directional light.
 *
 *          Composition is JavaScript work on the cells the instances touch and runs when the scene changes (a key of the instances'
 *          transforms and colours and the sun), not every frame.
 */
import type { App } from '../app/app';
import { defineSystem } from '../ecs/system';
import { Query } from '../ecs/query';
import { MeshRenderer, Transform, Light, PostProcessVolume, type MeshRendererData, type TransformData, type LightData, type PostProcessVolumeData } from '../ecs/component';
import { LightType } from '../wasm/wasm.generated';
import { Assets } from '../asset/AssetPlugin';
import type { Entity } from '../types';
import { withScratch } from '../wasm/wasmScratch';
import { analyticBox, packGPUScene, type GIInstance, type GILight } from './gpuScene';

const CUBE = 100;  // the built-in cube is 100 units across

function matrixOf(t: TransformData): number[] {
    const { x, y, z, w } = t.worldRotation, p = t.worldPosition;
    return [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
        p.x, p.y, p.z, 1,
    ];
}

function wantsDynamicGI(volumes: Iterable<[Entity, PostProcessVolumeData]>): boolean {
    for (const [, v] of volumes) {
        for (const e of v.effects as Array<{ type: string; enabled?: boolean }>) if (e.type === 'dynamicGI' && e.enabled !== false) return true;
    }
    return false;
}

export function dynamicGISystem(app: App) {
    let cube = 0, loading = false, lastKey = '';
    return defineSystem(
        [Query(MeshRenderer, Transform), Query(Light, Transform), Query(PostProcessVolume)],
        (meshes: Iterable<[Entity, MeshRendererData, TransformData]>, lights: Iterable<[Entity, LightData, TransformData]>,
         volumes: Iterable<[Entity, PostProcessVolumeData]>) => {
            if (!wantsDynamicGI(volumes)) { lastKey = ''; return; }
            const m = app.wasmModule;
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
            const boxes: Array<{ matrix: number[]; size: [number, number, number]; colour: [number, number, number] }> = [];
            let key = light ? `${light.toLight.join(',')}|${light.radiance.join(',')}` : 'dark';
            for (const [, r, t] of meshes) {
                if (!r.enabled || r.mesh !== cube) continue;
                const s = t.worldScale, matrix = matrixOf(t);
                const size: [number, number, number] = [s.x * CUBE, s.y * CUBE, s.z * CUBE];
                const colour: [number, number, number] = [r.color.r, r.color.g, r.color.b];
                boxes.push({ matrix, size, colour });
                key += `|${matrix.slice(0, 3).concat(matrix.slice(12, 15)).map((v) => v.toFixed(3)).join(',')};${size.join(',')};${colour.join(',')}`;
            }
            if (key === lastKey || boxes.length === 0) return;
            lastKey = key;
            const extent = Math.max(...boxes.flatMap((b) => b.size));
            const instances: GIInstance[] = boxes.map((b) => {
                // A box of the field's own cell size: fine enough that a wall a tenth of a metre thick is still more than a cell.
                const cell = Math.max(extent / 60, 1e-3);
                const { cards, ...sdf } = analyticBox(b.size, b.colour, cell, extent / 20);
                return { sdf, cards, worldFromLocal: b.matrix };
            });
            const scene = packGPUScene(instances, light);
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
