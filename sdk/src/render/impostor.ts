// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    impostor.ts
 * @brief   Takes the pictures an Impostor draws from: one atlas per kind of mesh, by cameras of the engine's own.
 *
 * @details The renderer draws an impostor's card (MeshPlugin); this takes its pictures. A copy of the mesh is set up out of the way on
 *          a layer nothing else is on, and `frames` x `frames` orthographic cameras look at it from the directions of a hemi-octahedral
 *          grid, each drawing into its own cell of one render target. They are ordinary cameras, so the pictures are the mesh as the
 *          scene's lights show it, with its material and textures, on every backend the engine draws with. One frame later the
 *          cameras and the copy go and the atlas is handed to every entity of that kind.
 *
 *          The directions are the renderer's own (src/esengine/renderer/draw/ImpostorFrames.hpp); a test on each side holds the two to
 *          the same numbers.
 */
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import { Camera, MeshRenderer, RuntimeOnly, Transform, getComponent, type MeshRendererData } from '../ecs/component';
import { ClearFlags, ProjectionType } from '../wasm/wasm.generated';
import { playModeOnly } from '../ecs/env';
import { Assets } from '../asset/AssetPlugin';
import { engineApi } from '../ecs/bridge/engineApi';
import { RenderTexture, type RenderTextureHandle } from './renderTexture';
import { setCameraClearColor } from '../camera/cameraClear';
import type { Entity } from '../types';
import type { ImpostorData } from '../ecs/component.generated';

type Vec3 = [number, number, number];

/** Where on the unit square a direction of the upper hemisphere folds to. Below the horizon is taken as on it. @experimental */
export function impostorEncode(d: Vec3): [number, number] {
    const y = Math.max(d[1], 0);
    const s = Math.abs(d[0]) + y + Math.abs(d[2]);
    if (s < 1e-12) return [0.5, 0.5];
    const px = d[0] / s, pz = d[2] / s;
    return [(px + pz) * 0.5 + 0.5, (px - pz) * 0.5 + 0.5];
}

/** The direction a point of the unit square unfolds to. @experimental */
export function impostorDecode(u: number, v: number): Vec3 {
    const qx = u * 2 - 1, qy = v * 2 - 1;
    const px = (qx + qy) * 0.5, pz = (qx - qy) * 0.5;
    const y = Math.max(1 - Math.abs(px) - Math.abs(pz), 0);
    const l = Math.hypot(px, y, pz);
    return [px / l, y / l, pz / l];
}

/** The direction, from the object toward the camera, that frame (i, j) of a `frames`-wide atlas is taken from. @experimental */
export function impostorFrameDirection(i: number, j: number, frames: number): Vec3 {
    const last = Math.max(frames, 2) - 1;
    return impostorDecode(i / last, j / last);
}

/** The up a picture is taken with from `d`: world up laid flat across the view, and -Z straight overhead. @experimental */
export function impostorPictureUp(d: Vec3): Vec3 {
    const up: Vec3 = [-d[0] * d[1], 1 - d[1] * d[1], -d[2] * d[1]];
    const l = Math.hypot(up[0], up[1], up[2]);
    return l < 1e-4 ? [0, 0, -1] : [up[0] / l, up[1] / l, up[2] / l];
}

/** A rotation whose -Z looks along `-back` and whose +Y is `up`: how a camera looking back along `back` is turned. */
export function lookRotation(back: Vec3, up: Vec3): { x: number; y: number; z: number; w: number } {
    const right: Vec3 = [up[1] * back[2] - up[2] * back[1], up[2] * back[0] - up[0] * back[2], up[0] * back[1] - up[1] * back[0]];
    // Columns right, up, back; the trace method.
    const m00 = right[0], m01 = up[0], m02 = back[0];
    const m10 = right[1], m11 = up[1], m12 = back[1];
    const m20 = right[2], m21 = up[2], m22 = back[2];
    const trace = m00 + m11 + m22;
    if (trace > 0) {
        const s = Math.sqrt(trace + 1) * 2;
        return { w: s / 4, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s };
    }
    if (m00 > m11 && m00 > m22) {
        const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
        return { w: (m21 - m12) / s, x: s / 4, y: (m01 + m10) / s, z: (m02 + m20) / s };
    }
    if (m11 > m22) {
        const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
        return { w: (m02 - m20) / s, x: (m01 + m10) / s, y: s / 4, z: (m12 + m21) / s };
    }
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    return { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: s / 4 };
}

/** The sorting layer the pictures are taken on: nothing else is drawn by their cameras, and nothing else is put there. */
export const IMPOSTOR_BAKE_LAYER = 31;
/** Where the copy stands while its pictures are taken: up out of the way of what the scene's cameras look at. */
const BAKE_ORIGIN: Vec3 = [0, 20000, 0];

/** One kind of mesh's pictures: being taken, or taken. */
interface ImpostorKind {
    target: RenderTextureHandle | null;
    frames: number;
    /** While being taken: the cameras and the copy, and the frame they were set up on. */
    cameras: Entity[];
    copy: Entity | null;
    since: number;
    ready: boolean;
}

/** What the plugin has taken, by kind. @experimental */
export class ImpostorAtlases {
    readonly kinds = new Map<string, ImpostorKind>();
    /** The entities handed an atlas, and by which kind. */
    readonly given = new Map<Entity, string>();

    /** How many kinds have their pictures. */
    get ready(): number { let n = 0; for (const k of this.kinds.values()) if (k.ready) n++; return n; }
}

/** @experimental */
export const ImpostorAtlasesRes = defineResource<ImpostorAtlases>(new ImpostorAtlases(), 'ImpostorAtlases');

/** What makes two impostors share pictures: everything that decides how the mesh looks, and how the atlas is cut. */
export function impostorKindKey(mr: MeshRendererData, imp: ImpostorData): string {
    const c = mr.color;
    return [mr.mesh, mr.material, mr.texture, mr.normalMap, c.r, c.g, c.b, c.a, mr.lit ? 1 : 0, imp.frames, imp.resolution].join('|');
}

/** @experimental */
export class ImpostorPlugin implements Plugin {
    name = 'impostor';

    build(app: App): void {
        const state = new ImpostorAtlases();
        app.insertResource(ImpostorAtlasesRes, state);
        const world = app.world;
        let frame = 0;
        // One kind at a time: every copy stands at the same place on the same layer, and two being photographed together would be
        // in each other's pictures. It also spreads the cost of a scene with many kinds over its first frames.
        let busy = false;

        const handOver = (entity: Entity, kind: ImpostorKind | null): void => {
            engineApi(app)?.renderer_setImpostorAtlas?.(entity as number, kind?.target?.textureId ?? 0, kind?.frames ?? 0);
        };

        const startBake = async (key: string, mr: MeshRendererData, imp: ImpostorData): Promise<void> => {
            const kind: ImpostorKind = { target: null, frames: Math.max(2, Math.min(16, Math.round(imp.frames))), cameras: [], copy: null, since: -1, ready: false };
            state.kinds.set(key, kind);
            const mesh = app.hasResource(Assets) ? await app.getResource(Assets).readMeshData(mr.mesh) : null;
            if (!mesh) { state.kinds.delete(key); busy = false; return; }
            const centre: Vec3 = [(mesh.aabbMin[0] + mesh.aabbMax[0]) / 2, (mesh.aabbMin[1] + mesh.aabbMax[1]) / 2, (mesh.aabbMin[2] + mesh.aabbMax[2]) / 2];
            const radius = Math.hypot(mesh.aabbMax[0] - mesh.aabbMin[0], mesh.aabbMax[1] - mesh.aabbMin[1], mesh.aabbMax[2] - mesh.aabbMin[2]) / 2;
            if (!(radius > 0)) { state.kinds.delete(key); busy = false; return; }

            const side = Math.max(128, Math.min(4096, Math.round(imp.resolution)));
            kind.target = RenderTexture.create({ width: side, height: side, depth: true, filter: 'linear' });

            // The copy: the mesh as it looks, alone on the bake layer, unturned and at its own size.
            const copy = world.spawn();
            world.insert(copy, RuntimeOnly);
            world.insert(copy, Transform, { position: { x: BAKE_ORIGIN[0], y: BAKE_ORIGIN[1], z: BAKE_ORIGIN[2] } });
            world.insert(copy, MeshRenderer, { ...mr, layer: IMPOSTOR_BAKE_LAYER, enabled: true });
            kind.copy = copy;

            const n = kind.frames;
            const target: Vec3 = [BAKE_ORIGIN[0] + centre[0], BAKE_ORIGIN[1] + centre[1], BAKE_ORIGIN[2] + centre[2]];
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    const d = impostorFrameDirection(i, j, n);
                    const up = impostorPictureUp(d);
                    const cam = world.spawn();
                    world.insert(cam, RuntimeOnly);
                    world.insert(cam, Transform, {
                        position: { x: target[0] + d[0] * radius * 3, y: target[1] + d[1] * radius * 3, z: target[2] + d[2] * radius * 3 },
                        rotation: lookRotation(d, up),
                    });
                    world.insert(cam, Camera, {
                        projectionType: ProjectionType.Orthographic, orthoSize: radius, nearPlane: radius, farPlane: radius * 5,
                        isActive: true, priority: -100000, renderTarget: kind.target._handle,
                        // A viewport is placed from the top of its target and a texture is read from the bottom: row j of the
                        // atlas is the (n - 1 - j)th from the top.
                        viewport: { x: i / n, y: (n - 1 - j) / n, z: 1 / n, w: 1 / n },
                        cullingMask: (1 << IMPOSTOR_BAKE_LAYER) >>> 0, clearFlags: ClearFlags.ColorAndDepth,
                    });
                    setCameraClearColor(cam, { x: 0, y: 0, z: 0, w: 0 });
                    kind.cameras.push(cam);
                }
            }
            kind.since = frame;
        };

        const finish = (kind: ImpostorKind): void => {
            for (const cam of kind.cameras) { setCameraClearColor(cam, null); if (world.valid(cam)) world.despawn(cam); }
            kind.cameras = [];
            if (kind.copy !== null && world.valid(kind.copy)) world.despawn(kind.copy);
            kind.copy = null;
            kind.ready = true;
            busy = false;
        };

        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem([], () => {
            frame++;
            const def = getComponent('Impostor');
            if (!def) return;
            // Pictures set up two frames ago have been drawn: the cameras go, and the atlas is the kind's.
            for (const kind of state.kinds.values()) {
                if (!kind.ready && kind.since >= 0 && frame - kind.since >= 2) finish(kind);
            }
            const seen = new Set<Entity>();
            for (const e of world.getEntitiesWithComponents([def, MeshRenderer])) {
                const imp = world.get(e, def) as ImpostorData;
                const mr = world.get(e, MeshRenderer) as MeshRendererData;
                if (!imp.enabled || !mr.enabled || mr.mesh === 0 || world.has(e, RuntimeOnly)) continue;
                seen.add(e);
                const key = impostorKindKey(mr, imp);
                const kind = state.kinds.get(key);
                if (!kind) {
                    if (!busy) { busy = true; void startBake(key, mr, imp); }
                    continue;
                }
                if (!kind.ready) continue;
                if (state.given.get(e) !== key) { handOver(e, kind); state.given.set(e, key); }
            }
            for (const [e] of state.given) {
                if (seen.has(e)) continue;
                if (world.valid(e)) handOver(e, null);
                state.given.delete(e);
            }
        }, { name: 'ImpostorBakeSystem' }), { runIf: playModeOnly });
    }
}

/** @experimental */
export const impostorPlugin: Plugin = new ImpostorPlugin();
