// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rainDrops.ts
 * @brief   The 3D rain's falling drops: streaks in the world, drawn on the GPU from nothing but their number and the time.
 *
 * @details A drop has no state to step. Its place is a hash of its number spread over a box round the eye, moved by how far rain has
 *          fallen (and the wind carried it) since the start, wrapped into the box: so the drops stay where they are in the world as the
 *          eye moves through them, and every frame's are known at once in the vertex stage, the same on every backend, with nothing for
 *          the CPU to do but say the time. Each is a quad stretched along its velocity by how far it falls while the shutter is open,
 *          turned to face the eye; seen along its fall (looking straight up or down) it is a dot, not a line. They are drawn in the
 *          scene with its depth, so what stands nearer hides them.
 *
 *          Where the frame has the map of what stands over each place (the rain effect draws one, for keeping ground under a roof dry),
 *          a drop ends at the highest surface under it: rain stops on a roof, on the ground, on a leaf, and none falls under an awning.
 *
 *          The rain effect (the 'rain' volume effect, or the weather's) says how much falls (u_intensity), how fast (u_speed), how far
 *          the wind leans it (u_wind, toward where the sky's clouds go), how long the streaks are (u_streakLength) and their colour.
 *          The effect itself draws the wet ground, the puddles and the splashes; the drops are drawn here.
 */
import type { App } from '../app/app';
import type { Entity } from '../types';
import { defineSystem } from '../ecs/system';
import { MeshRenderer, RuntimeOnly, Transform, type MeshRendererData } from '../ecs/component';
import { Time } from '../ecs/resource';
import { worldUnitsPerMeter } from '../ecs/worldUnits';
import { Assets } from '../asset/AssetPlugin';
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../asset/meshFormat';
import { Material, type MaterialHandle, type ShaderHandle } from '../render/material';
import { BlendMode } from '../render/blend';
import { deviceGeneration } from '../render/renderer';
import { getResourceManager } from '../wasm/resourceManager';
import type { ESEngineModule } from '../wasm';
import { EditorView } from '../camera/EditorView';
import { PostProcess } from './PostProcessAPI';
import { resolvedRain, type ViewRain } from './volumeSystem';
import { log } from '../util/logger';

/** How many drops the box holds at most: the share that falls is the rain's intensity. */
export const RAIN_DROP_COUNT = 32768;
/** A raindrop's terminal velocity, metres a second; the effect's u_speed scales it about its default. */
const TERMINAL_SPEED = 9;
const DEFAULT_EFFECT_SPEED = 1.6;
/** The box round the eye the drops fall in, metres: half its width, its height, and how much of that is below the eye (an eye up a
 *  tower looks down at rain falling on the ground). */
const BOX_HALF = 15, BOX_HEIGHT = 40, BOX_BELOW = 0.75;
/** How long the shutter is open at the effect's default streak length (0.3), seconds: the streak is the fall in that time. */
const SHUTTER_PER_LENGTH = 0.1;

export const RAIN_DROPS_SHADER = `#pragma shader "Rain Drops"
#pragma version 300 es
#pragma domain Unlit
// The eye (xyz) and half the box's width (w); how far the drops have moved since the start, within the box (xyz), and its height (w);
// how far the box reaches below the eye.
#pragma param u_rainEye vec4 default(0,0,0,1500)
#pragma param u_rainShift vec4 default(0,0,0,4000)
#pragma param u_rainBelow float default(3000)
// Their velocity (xyz, world units a second) and the streak's length (w); the share of drops falling (x), a streak's width (y),
// how bright they are (z), and how near the eye they fade out (w).
#pragma param u_rainFall vec4 default(0,-900,0,27)
#pragma param u_rainShape vec4 default(0.5,1.2,0.35,60)
#pragma param u_rainTint color default(0.78,0.82,0.9,1)
// The map of what stands over each place (the frame's rain cover) and the matrix it was drawn through.
#pragma param u_rainCover texture default(white) texel(data)
#pragma param u_rainCoverOn float default(0) range(0,1)
#pragma param u_rainCover0 vec4 default(1,0,0,0)
#pragma param u_rainCover1 vec4 default(0,1,0,0)
#pragma param u_rainCover2 vec4 default(0,0,1,0)
#pragma param u_rainCover3 vec4 default(0,0,0,1)

#pragma vertexoffset
vec3 rainHash3(float n) {
    vec3 p = fract(vec3(n) * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract((p.xxy + p.yzz) * p.zyx);
}
// The height of the highest surface over W, where the cover map knows it; far below everything where it does not.
float rainSurface(vec3 W) {
    if (u_rainCoverOn < 0.5) return -1e9;
    mat4 m = mat4(u_rainCover0, u_rainCover1, u_rainCover2, u_rainCover3);
    vec4 c = m * vec4(W, 1.0);
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return -1e9;
    float stored = dot(textureLod(u_rainCover, uv, 0.0).rgb, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0));
    // Cleared to white: nothing was drawn there.
    if (stored > 0.9999) return -1e9;
    float here = c.z / c.w * 0.5 + 0.5;
    // How the stored depth changes with height: the map looks straight down, so depth and height are one line.
    float perUnit = 0.5 * m[1][2];
    return abs(perUnit) > 1e-12 ? W.y + (stored - here) / perUnit : -1e9;
}
void esMaterialVertex(inout vec3 local, inout vec3 localNormal, in vec2 uv) {
    float id = local.x;
    vec3 eye = u_rainEye.xyz;
    // A drop that does not fall at this intensity is folded to a point: it draws nothing.
    if (rainHash3(id + 7.31).x >= u_rainShape.x) { local = eye; return; }
    vec3 size = vec3(2.0 * u_rainEye.w, u_rainShift.w, 2.0 * u_rainEye.w);
    vec3 low = eye - vec3(u_rainEye.w, u_rainBelow, u_rainEye.w);
    // Where it is in the world: its place, moved as far as rain has gone, put into the box round the eye.
    vec3 head = low + mod(rainHash3(id + 0.5) * size + u_rainShift.xyz - low, size);
    vec3 vel = u_rainFall.xyz;
    vec3 dir = vel / max(length(vel), 1e-3);
    vec3 tail = head - dir * u_rainFall.w;
    float ground = rainSurface(head);
    if (tail.y <= ground) { local = eye; return; }
    // Partway into what it fell on: it ends there.
    if (head.y < ground) head = tail + (head - tail) * ((tail.y - ground) / max(tail.y - head.y, 1e-4));
    vec3 view = normalize((head + tail) * 0.5 - eye);
    vec3 side = cross(dir, view);
    float lean = length(side);
    // Seen along its fall it has no side: any will do, and the quad is the width either way, a dot.
    side = lean > 1e-3 ? side / lean : normalize(cross(view, abs(view.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 up = normalize(cross(view, side));
    // Thinned to nothing toward the box's sides and its top, where a drop wraps round, and right at the eye: the box is never seen
    // and no streak crosses the lens.
    vec2 off = abs(head.xz - eye.xz) / u_rainEye.w;
    float edge = (1.0 - smoothstep(0.6, 0.95, max(off.x, off.y))) * smoothstep(0.0, 0.1, (low.y + size.y - tail.y) / size.y);
    float w = u_rainShape.y * edge * smoothstep(u_rainShape.w * 0.5, u_rainShape.w, length((head + tail) * 0.5 - eye));
    if (w <= 0.0) { local = eye; return; }
    local = mix(tail, head, uv.y) + side * ((uv.x - 0.5) * w) + up * ((uv.y - 0.5) * w);
    localNormal = -view;
}
#pragma end

#pragma fragment
precision highp float;

in vec4 v_color;
in vec2 v_texCoord;

out vec4 fragColor;

void main() {
    // Bright down its middle and at its head, faint at its tail: the drop is at the head, and the streak is where it was.
    float across = 1.0 - abs(v_texCoord.x * 2.0 - 1.0);
    float along = smoothstep(0.0, 0.3, v_texCoord.y) * (0.5 + 0.5 * v_texCoord.y);
    float a = across * across * along * u_rainShape.z;
    if (a < 0.002) discard;
    fragColor = vec4(u_rainTint.rgb, a);
}
#pragma end
`;

/** The drops' mesh: one quad a drop, its number in each corner's x (the vertex stage puts it in the world). */
export function buildRainDrops(count: number): MeshData {
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
    ]);
    const at = (semantic: number): number => channels.find((c) => c.semantic === semantic)!.offset;
    const posAt = at(MeshChannel.Position), uvAt = at(MeshChannel.TexCoord0), normalAt = at(MeshChannel.Normal);
    const vertices = new Uint8Array(count * 4 * vertexStride);
    const view = new DataView(vertices.buffer);
    const indices = new Uint32Array(count * 6);
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]] as const;
    for (let d = 0; d < count; d++) {
        for (let k = 0; k < 4; k++) {
            const o = (d * 4 + k) * vertexStride;
            view.setFloat32(o + posAt, d, true);
            view.setFloat32(o + uvAt, corners[k]![0], true);
            view.setFloat32(o + uvAt + 4, corners[k]![1], true);
            view.setFloat32(o + normalAt + 4, 1, true);
        }
        indices.set([d * 4, d * 4 + 1, d * 4 + 2, d * 4, d * 4 + 2, d * 4 + 3], d * 6);
    }
    // The drops go wherever the eye is: bounds that hold the world, so the mesh is never culled.
    return { vertices, vertexStride, vertexCount: count * 4, channels, indices, aabbMin: [-1e9, -1e9, -1e9], aabbMax: [1e9, 1e9, 1e9] };
}

/** What the effect's values make of the drops this frame, in world units. */
export interface RainFall {
    /** Share of the drops falling, 0 to 1. */
    share: number;
    velocity: [number, number, number];
    streak: number;
}

/** The drops' fall from the rain effect's values: terminal velocity at the default speed, leaned by the wind toward `windDirection` degrees. */
export function rainFall(effect: Pick<ViewRain['effect'], 'uniforms'>, windDirection: number, unitsPerMetre: number): RainFall {
    const get = (name: string, fallback: number): number => effect.uniforms.get(name) ?? fallback;
    const down = TERMINAL_SPEED * unitsPerMetre * (get('u_speed', DEFAULT_EFFECT_SPEED) / DEFAULT_EFFECT_SPEED);
    const lean = get('u_wind', 0.15) * down;
    const a = (windDirection * Math.PI) / 180;
    const speed = Math.hypot(down, lean);
    return {
        share: Math.min(Math.max(get('u_intensity', 1) * 0.5, 0), 1),
        velocity: [Math.sin(a) * lean, -down, Math.cos(a) * lean],
        streak: speed * SHUTTER_PER_LENGTH * (get('u_streakLength', 0.3) / 0.3),
    };
}

/** `v` into [0, span): the drops' shift is taken round the box in double precision, so a long session keeps the GPU's float exact. */
const wrap = (v: number, span: number): number => ((v % span) + span) % span;

/** Draws the 3D rain's drops for the view being drawn. One entity, made while rain falls and despawned when it stops. */
export function rainDropsSystem(app: App) {
    let shader: ShaderHandle = 0, material: MaterialHandle = 0, mesh = 0, entity = 0 as Entity, generation = -1, failed = false;
    let cover = { id: 0, texture: 0 };
    const scratch = { matrix: 0, size: 0 };
    const letGo = (): void => {
        if (entity && app.world.valid(entity)) app.world.despawn(entity);
        entity = 0 as Entity;
    };
    const coverOf = (module: ESEngineModule | null): Float32Array | null => {
        const m = module as (ESEngineModule & { renderer_rainCover?(a: number, b: number): number; _malloc?(n: number): number }) | null;
        if (!m?.renderer_rainCover || !m._malloc) return null;
        if (!scratch.matrix) { scratch.matrix = m._malloc(64); scratch.size = m._malloc(4); }
        const id = m.renderer_rainCover(scratch.matrix, scratch.size);
        if (!id) return null;
        if (id !== cover.id) {
            if (cover.texture) getResourceManager()?.releaseTexture(cover.texture);
            const side = m.HEAPU32[scratch.size >> 2]!;
            cover = { id, texture: getResourceManager()?.wrapDeviceTexture?.(id, side, side) ?? 0 };
        }
        return cover.texture ? m.HEAPF32.slice(scratch.matrix >> 2, (scratch.matrix >> 2) + 16) : null;
    };
    return defineSystem([], () => {
        if (failed || !app.hasResource(PostProcess) || !app.hasResource(Assets)) return;
        const view = app.hasResource(EditorView) ? app.getResource(EditorView) : null;
        const rain = resolvedRain(app.getResource(PostProcess), !!view?.active);
        const unit = worldUnitsPerMeter();
        const fall = rain ? rainFall(rain.effect, rain.windDirection, unit) : null;
        if (!rain || !fall || fall.share <= 0) { letGo(); return; }
        if (deviceGeneration() !== generation) {
            // A lost device took the mesh and the cover's wrapper with it.
            generation = deviceGeneration();
            letGo();
            mesh = 0;
            cover = { id: 0, texture: 0 };
        }
        if (!shader) {
            shader = Material.compileShader(RAIN_DROPS_SHADER);
            material = shader ? Material.create({ shader, blendMode: BlendMode.Additive, depthTest: true, depthWrite: false, cull: 0 }) : 0;
            if (!material) { failed = true; log.warn('weather', 'the rain\'s drops could not be made: no rain falls'); return; }
        }
        if (!mesh) mesh = app.getResource(Assets).createMesh(buildRainDrops(RAIN_DROP_COUNT));
        if (!mesh) return;
        if (!entity || !app.world.valid(entity)) {
            entity = app.world.spawn('Rain');
            app.world.insert(entity, Transform, { position: { x: 0, y: 0, z: 0 } });
            app.world.insert(entity, RuntimeOnly);
            app.world.insert(entity, MeshRenderer, {
                mesh, material, lit: false, opaque: false, cullBackfaces: false, castShadows: false, color: { r: 1, g: 1, b: 1, a: 1 },
            } as Partial<MeshRendererData>);
        }
        const half = BOX_HALF * unit, height = BOX_HEIGHT * unit;
        const t = app.getResource(Time).elapsed;
        const [vx, vy, vz] = fall.velocity;
        Material.setUniform(material, 'u_rainEye', { x: rain.eye.x, y: rain.eye.y, z: rain.eye.z, w: half });
        Material.setUniform(material, 'u_rainBelow', height * BOX_BELOW);
        Material.setUniform(material, 'u_rainShift', { x: wrap(vx * t, 2 * half), y: wrap(vy * t, height), z: wrap(vz * t, 2 * half), w: height });
        Material.setUniform(material, 'u_rainFall', { x: vx, y: vy, z: vz, w: fall.streak });
        Material.setUniform(material, 'u_rainShape', { x: fall.share, y: 0.012 * unit, z: 0.35, w: 0.6 * unit });
        const tint = rain.effect.colors.get('u_streakColor');
        if (tint) Material.setUniform(material, 'u_rainTint', { x: tint.r, y: tint.g, z: tint.b, w: tint.a });
        const matrix = coverOf(app.wasmModule);
        Material.setUniform(material, 'u_rainCoverOn', matrix ? 1 : 0);
        if (matrix) {
            Material.setUniform(material, 'u_rainCover', Material.tex(cover.texture));
            for (let c = 0; c < 4; c++) {
                Material.setUniform(material, `u_rainCover${c}`, { x: matrix[c * 4]!, y: matrix[c * 4 + 1]!, z: matrix[c * 4 + 2]!, w: matrix[c * 4 + 3]! });
            }
        }
    }, { name: 'RainDropsSystem', runWhenPaused: true });
}
