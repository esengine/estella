// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The instances of the dynamic GI's scene, from what a scene's renderers are. Apart from the system that feeds the engine (dynamicGISystem.ts)
 * so that it stands on nothing but the GI's own data: the pipeline's tests build a scene with it, and they are compiled without the App.
 */
import { analyticBox, type GIInstance } from './gpuScene';
import type { MeshSdf } from './meshSdfFormat';
import type { MeshCards } from './cardFormat';

/** Where a renderer stands: the world pose of its Transform, by shape (a `TransformData` is one). */
export interface GIPose {
    worldPosition: { x: number; y: number; z: number };
    worldRotation: { x: number; y: number; z: number; w: number };
    worldScale: { x: number; y: number; z: number };
}

const CUBE = 100;  // the built-in cube is 100 units across

function matrixOf(t: GIPose, scale = 1): number[] {
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
    transform: GIPose;
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
function poseKey(e: GIEntry): string {
    const s = e.transform.worldScale, p = e.transform.worldPosition, q = e.transform.worldRotation;
    return `${[p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z].map((v) => v.toFixed(3)).join(',')};${e.colour.join(',')};${e.emissive.join(',')}`;
}

/**
 * What `buildInstances` would make of the entries, as a string, without making it. The system asks this every frame and builds only when it
 * changes: building is the distance fields and cards of every box, which is milliseconds on a desktop and tens on a phone, and a scene that
 * has not moved should cost a string compare and not that.
 */
export function instanceKey(entries: readonly GIEntry[], cube: number, sidecars: (path: string) => GISidecars | null): string {
    let key = '';
    for (const e of entries) {
        const s = e.transform.worldScale;
        if (e.mesh === cube) key += `|c${poseKey(e)}`;
        else if (e.path) {
            if (!sidecars(e.path)) continue;
            const lo = Math.min(s.x, s.y, s.z), hi = Math.max(s.x, s.y, s.z);
            if (lo <= 0 || hi / lo > 1.05) continue;
            key += `|m${e.path};${poseKey(e)}`;
        }
    }
    return key;
}

export function buildInstances(entries: readonly GIEntry[], cube: number, sidecars: (path: string) => GISidecars | null): { instances: GIInstance[]; key: string } {
    const instances: GIInstance[] = [];
    let key = '';
    const extent = Math.max(1, ...entries.filter((e) => e.mesh === cube).flatMap((e) => [e.transform.worldScale.x, e.transform.worldScale.y, e.transform.worldScale.z].map((v) => v * CUBE)));
    for (const e of entries) {
        const s = e.transform.worldScale;
        const pose = poseKey(e);
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
