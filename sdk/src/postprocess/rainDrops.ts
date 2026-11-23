// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rainDrops.ts
 * @brief   The 3D rain's falling drops and snow's flakes: in the world, drawn on the GPU from nothing but their number and the time.
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
 *          Its snowfall (u_snowfall) falls the same way as flakes: soft round ones a metre a second, swaying, the wind carrying them
 *          further. The effect itself draws the wet ground, the puddles and the splashes; what falls is drawn here.
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
// What falls: 0 rain (a streak along its fall), 1 snow (a soft round flake that sways as it falls, u_rainSway: how far, in world
// units, how many times a second, and the time it is reckoned from: seconds within a thousand, so a long session keeps it smooth).
#pragma param u_rainMode float default(0) range(0,1)
#pragma param u_rainSway vec4 default(0,0,0,0)
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
    // A flake drifts from side to side as it falls, each at its own pace and on its own path round the line it falls on.
    if (u_rainSway.x > 0.0) {
        vec3 own = rainHash3(id + 3.17);
        float pace = u_rainSway.y * (0.7 + 0.6 * own.x) * 6.2831853 * u_rainSway.z + own.y * 6.2831853;
        head.xz += vec2(sin(pace), cos(pace * 0.83 + own.z * 3.0)) * (u_rainSway.x * (0.5 + 0.5 * own.z));
    }
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
    float a;
    if (u_rainMode > 0.5) {
        // A flake: soft and round.
        float r = length(v_texCoord * 2.0 - 1.0);
        a = (1.0 - smoothstep(0.35, 1.0, r)) * u_rainShape.z;
    } else {
        // A drop: bright down its middle and at its head, faint at its tail; the drop is at the head, the streak is where it was.
        float across = 1.0 - abs(v_texCoord.x * 2.0 - 1.0);
        float along = smoothstep(0.0, 0.3, v_texCoord.y) * (0.5 + 0.5 * v_texCoord.y);
        a = across * across * along * u_rainShape.z;
    }
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

/** What the effect's values make of one kind of precipitation this frame, in world units. */
export interface RainFall {
    /** 0 rain, 1 snow (see the shader's u_rainMode). */
    mode: number;
    /** Share of the drops (or flakes) falling, 0 to 1. */
    share: number;
    velocity: [number, number, number];
    /** How long a drop's streak is; 0 for a flake. */
    streak: number;
    /** How far a flake sways from its line and how many times a second; 0 for rain. */
    sway: [number, number];
    /** How wide a drop or a flake is drawn, and how bright. */
    width: number;
    brightness: number;
}

const leanToward = (windDirection: number, lean: number, down: number): [number, number, number] => {
    const a = (windDirection * Math.PI) / 180;
    return [Math.sin(a) * lean, -down, Math.cos(a) * lean];
};

/** The drops' fall from the rain effect's values: terminal velocity at the default speed, leaned by the wind toward `windDirection` degrees. */
export function rainFall(effect: Pick<ViewRain['effect'], 'uniforms'>, windDirection: number, unitsPerMetre: number): RainFall {
    const get = (name: string, fallback: number): number => effect.uniforms.get(name) ?? fallback;
    const down = TERMINAL_SPEED * unitsPerMetre * (get('u_speed', DEFAULT_EFFECT_SPEED) / DEFAULT_EFFECT_SPEED);
    const lean = get('u_wind', 0.15) * down;
    return {
        mode: 0,
        share: Math.min(Math.max(get('u_intensity', 1) * 0.5, 0), 1),
        velocity: leanToward(windDirection, lean, down),
        streak: Math.hypot(down, lean) * SHUTTER_PER_LENGTH * (get('u_streakLength', 0.3) / 0.3),
        sway: [0, 0],
        width: 0.012 * unitsPerMetre,
        brightness: 0.35,
    };
}

/** A snowflake's fall, metres a second, how far it sways and how often, and its size, metres. */
const SNOW_SPEED = 1, SNOW_SWAY = 0.3, SNOW_SWAY_RATE = 0.5, SNOW_SIZE = 0.04;

/** The flakes' fall from the effect's snowfall: a metre a second, swaying, and carried twice as far by the wind as rain is, being light. */
export function snowFall(effect: Pick<ViewRain['effect'], 'uniforms'>, windDirection: number, unitsPerMetre: number): RainFall {
    const get = (name: string, fallback: number): number => effect.uniforms.get(name) ?? fallback;
    const down = SNOW_SPEED * unitsPerMetre;
    return {
        mode: 1,
        share: Math.min(Math.max(get('u_snowfall', 0), 0), 1),
        velocity: leanToward(windDirection, 2 * get('u_wind', 0.15) * down, down),
        streak: 0,
        sway: [SNOW_SWAY * unitsPerMetre, SNOW_SWAY_RATE],
        width: SNOW_SIZE * unitsPerMetre,
        brightness: 0.9,
    };
}

/** `v` into [0, span): the drops' shift is taken round the box in double precision, so a long session keeps the GPU's float exact. */
const wrap = (v: number, span: number): number => ((v % span) + span) % span;

/** One kind of precipitation drawn: its material (an instance of the one shader) and the entity that draws the shared mesh with it. */
interface Layer { name: string; material: MaterialHandle; entity: Entity }

/**
 * Draws the 3D rain's drops and its snow's flakes for the view being drawn: one entity each, made while it falls and despawned when it
 * stops, sharing one mesh and one shader.
 */
export function rainDropsSystem(app: App) {
    let shader: ShaderHandle = 0, mesh = 0, generation = -1, failed = false;
    let cover = { id: 0, texture: 0 };
    const scratch = { matrix: 0, size: 0 };
    const layers: Layer[] = [{ name: 'Rain', material: 0, entity: 0 as Entity }, { name: 'Snow', material: 0, entity: 0 as Entity }];
    const letGo = (layer: Layer): void => {
        if (layer.entity && app.world.valid(layer.entity)) app.world.despawn(layer.entity);
        layer.entity = 0 as Entity;
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
        const falls = rain ? [rainFall(rain.effect, rain.windDirection, unit), snowFall(rain.effect, rain.windDirection, unit)] : [];
        if (!rain || !falls.some((f) => f.share > 0)) { layers.forEach(letGo); return; }
        if (deviceGeneration() !== generation) {
            // A lost device took the mesh and the cover's wrapper with it.
            generation = deviceGeneration();
            layers.forEach(letGo);
            mesh = 0;
            cover = { id: 0, texture: 0 };
        }
        if (!shader) {
            shader = Material.compileShader(RAIN_DROPS_SHADER);
            for (const layer of layers) {
                layer.material = shader ? Material.create({ shader, blendMode: BlendMode.Additive, depthTest: true, depthWrite: false, cull: 0 }) : 0;
            }
            if (!layers.every((l) => l.material)) { failed = true; log.warn('weather', 'the drops and flakes could not be made: no rain or snow falls'); return; }
        }
        if (!mesh) mesh = app.getResource(Assets).createMesh(buildRainDrops(RAIN_DROP_COUNT));
        if (!mesh) return;
        const matrix = coverOf(app.wasmModule);
        const half = BOX_HALF * unit, height = BOX_HEIGHT * unit;
        const t = app.getResource(Time).elapsed;
        const tint = rain.effect.colors.get('u_streakColor');
        layers.forEach((layer, i) => {
            const fall = falls[i]!;
            if (fall.share <= 0) { letGo(layer); return; }
            const material = layer.material;
            if (!layer.entity || !app.world.valid(layer.entity)) {
                layer.entity = app.world.spawn(layer.name);
                app.world.insert(layer.entity, Transform, { position: { x: 0, y: 0, z: 0 } });
                app.world.insert(layer.entity, RuntimeOnly);
                app.world.insert(layer.entity, MeshRenderer, {
                    mesh, material, lit: false, opaque: false, cullBackfaces: false, castShadows: false, color: { r: 1, g: 1, b: 1, a: 1 },
                } as Partial<MeshRendererData>);
            }
            const [vx, vy, vz] = fall.velocity;
            Material.setUniform(material, 'u_rainMode', fall.mode);
            Material.setUniform(material, 'u_rainEye', { x: rain.eye.x, y: rain.eye.y, z: rain.eye.z, w: half });
            Material.setUniform(material, 'u_rainBelow', height * BOX_BELOW);
            Material.setUniform(material, 'u_rainShift', { x: wrap(vx * t, 2 * half), y: wrap(vy * t, height), z: wrap(vz * t, 2 * half), w: height });
            Material.setUniform(material, 'u_rainFall', { x: vx, y: vy, z: vz, w: fall.streak });
            Material.setUniform(material, 'u_rainShape', { x: fall.share, y: fall.width, z: fall.brightness, w: 0.6 * unit });
            Material.setUniform(material, 'u_rainSway', { x: fall.sway[0], y: fall.sway[1], z: t % 1000, w: 0 });
            if (tint) Material.setUniform(material, 'u_rainTint', { x: tint.r, y: tint.g, z: tint.b, w: tint.a });
            Material.setUniform(material, 'u_rainCoverOn', matrix ? 1 : 0);
            if (matrix) {
                Material.setUniform(material, 'u_rainCover', Material.tex(cover.texture));
                for (let c = 0; c < 4; c++) {
                    Material.setUniform(material, `u_rainCover${c}`, { x: matrix[c * 4]!, y: matrix[c * 4 + 1]!, z: matrix[c * 4 + 2]!, w: matrix[c * 4 + 3]! });
                }
            }
        });
    }, { name: 'RainDropsSystem', runWhenPaused: true });
}
