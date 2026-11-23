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
import { worldGravity, worldUnitsPerMeter } from '../ecs/worldUnits';
import { Assets } from '../asset/AssetPlugin';
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../asset/meshFormat';
import { Material, type MaterialHandle, type ShaderHandle } from '../render/material';
import { BlendMode } from '../render/blend';
import { deviceGeneration } from '../render/renderer';
import { getResourceManager } from '../wasm/resourceManager';
import type { ESEngineModule } from '../wasm';
import { EditorView } from '../camera/EditorView';
import { PostProcess } from './PostProcessAPI';
import { resolveVolumeTexture, resolvedRain, type ViewRain } from './volumeSystem';
import { log } from '../util/logger';
import {
    PRECIPITATION_CELL_METRES, PRECIPITATION_GLSL, PRECIPITATION_LAYERS, precipitationDensity, precipitationRing, setPrecipitation,
} from '../render/precipitation';

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
// What is drawn: 0 rain (a streak along its fall), 1 snow (a soft round flake that sways as it falls, u_rainSway: how far, in world
// units, how many times a second, and the time it is reckoned from: seconds within a thousand, so a long session keeps it smooth),
// 2 the splashes rain throws up where it lands.
#pragma param u_rainMode float default(0) range(0,2)
#pragma param u_rainSway vec4 default(0,0,0,0)
// The splashes' lattice (render/precipitation.ts, where the rings open too): cell side (world units), density, cells each way round
// the eye, and points a splash draws (its bright point and the droplets it throws). Then metre and gravity (world units), how long a
// splash lasts, and how fast it throws its droplets (1 is a raindrop's).
#pragma param u_rainLattice vec4 default(35,0.6,17,5)
#pragma param u_rainWorld vec4 default(100,981,0.3,1)
// The author's texture for what this layer draws, in place of the soft streak or dot: alpha is the shape, colour tints it.
#pragma param u_rainSprite texture default(white)
#pragma param u_rainSpriteOn float default(0) range(0,1)
// The map of what stands over each place (the frame's rain cover) and the matrix it was drawn through.
#pragma param u_rainCover texture default(white) texel(data)
#pragma depthinput u_rainCover
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
${PRECIPITATION_GLSL}
// A splash's drop of the lattice: which cell round the eye's, which layer. False where the cell's last fall did not fall (the density
// leaves it out); else where it landed (world) and how long ago.
bool latticeSplash(float id, vec3 eye, out vec3 land, out float age, out vec2 key) {
    float reach = u_rainLattice.z, span = 2.0 * reach + 1.0;
    float cellIndex = floor(id / ${PRECIPITATION_LAYERS}.0);
    if (cellIndex >= span * span) return false;
    float layer = id - cellIndex * ${PRECIPITATION_LAYERS}.0;
    float cell = u_rainLattice.x;
    vec2 corner = floor(precipLattice(eye.xz, cell, layer)) + vec2(mod(cellIndex, span), floor(cellIndex / span)) - reach;
    key = precipKey(corner, layer);
    float n = floor(precipCycle(key, u_time.x));
    if (!precipFalls(key, n, u_rainLattice.y)) return false;
    age = u_time.x - precipLanding(key, n);
    vec2 xz = precipWorld(precipPlace(corner, key, n), cell, layer);
    land = vec3(xz.x, 0.0, xz.y);
    land.y = rainSurface(vec3(xz.x, eye.y, xz.y));
    return true;
}
void esMaterialVertex(inout vec3 local, inout vec3 localNormal, in vec2 uv) {
    float id = local.x;
    vec3 eye = u_rainEye.xyz;
    vec3 size = vec3(2.0 * u_rainEye.w, u_rainShift.w, 2.0 * u_rainEye.w);
    vec3 low = eye - vec3(u_rainEye.w, u_rainBelow, u_rainEye.w);
    vec3 head, dir;
    float len, w = u_rainShape.y;
    if (u_rainMode > 1.5) {
        // A splash, where a drop of the lattice landed a moment ago (where the water's and the puddles' rings open): a bright point and
        // droplets thrown out and up from it, falling back as the project's gravity pulls. Only on a surface the cover map knows.
        float droplets = u_rainLattice.w;
        vec3 land; float age; vec2 key;
        float drop = floor(id / droplets), j = id - drop * droplets;
        if (!latticeSplash(drop, eye, land, age, key) || land.y < -1e8) { local = eye; return; }
        if (age < 0.0 || age > u_rainWorld.z) { local = eye; return; }
        float metre = u_rainWorld.x, g = u_rainWorld.y;
        if (j < 0.5) {
            head = land + vec3(0.0, 0.01 * metre, 0.0);
            dir = vec3(0.0, 1.0, 0.0);
            len = 0.0;
            w *= 1.5 * (1.0 - age / u_rainWorld.z);
        } else {
            vec3 own = rainHash3(dot(key, vec2(1.0, 57.0)) + j * 7.0);
            float a = 6.2831853 * (j / droplets + 0.3 * own.x);
            vec2 thrown = vec2(cos(a), sin(a)) * (0.4 + 0.5 * own.y) * metre * u_rainWorld.w;
            float rise = (0.6 + 0.6 * own.z) * metre * u_rainWorld.w;
            vec3 vel = vec3(thrown.x, rise - g * age, thrown.y);
            head = land + vec3(thrown.x * age, rise * age - 0.5 * g * age * age, thrown.y * age);
            if (head.y < land.y) { local = eye; return; }
            dir = vel / max(length(vel), 1e-3);
            len = length(vel) * 0.015;
        }
    } else {
        // A drop or a flake: in a box round the eye, moved as far as the rain or the snow has gone, wrapped into the box, so it stays
        // where it is in the world as the eye moves through it. A flake drifts from side to side as it falls. Either ends on the surface
        // the cover map has under it (the ground, a roof, water): none falls under an awning.
        if (rainHash3(id + 7.31).x >= u_rainShape.x) { local = eye; return; }
        head = low + mod(rainHash3(id + 0.5) * size + u_rainShift.xyz - low, size);
        if (u_rainSway.x > 0.0) {
            vec3 own = rainHash3(id + 3.17);
            float pace = u_rainSway.y * (0.7 + 0.6 * own.x) * 6.2831853 * u_rainSway.z + own.y * 6.2831853;
            head.xz += vec2(sin(pace), cos(pace * 0.83 + own.z * 3.0)) * (u_rainSway.x * (0.5 + 0.5 * own.z));
        }
        dir = u_rainFall.xyz / max(length(u_rainFall.xyz), 1e-3);
        len = u_rainFall.w;
        vec3 top = head - dir * len;
        float ground = rainSurface(head);
        if (top.y <= ground) { local = eye; return; }
        // Partway into what it fell on: it ends there.
        if (head.y < ground) head = top + (head - top) * ((top.y - ground) / max(top.y - head.y, 1e-4));
    }
    vec3 tail = head - dir * len;
    vec3 view = normalize((head + tail) * 0.5 - eye);
    vec3 side = cross(dir, view);
    float lean = length(side);
    // Seen along its fall it has no side: any will do, and the quad is the width either way, a dot.
    side = lean > 1e-3 ? side / lean : normalize(cross(view, abs(view.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 up = normalize(cross(view, side));
    // Thinned to nothing toward the box's sides and its top, where what falls comes and goes, and right at the eye: the box is never
    // seen and no streak crosses the lens.
    vec2 off = abs(head.xz - eye.xz) / u_rainEye.w;
    float edge = (1.0 - smoothstep(0.6, 0.95, max(off.x, off.y))) * smoothstep(0.0, 0.1, (low.y + size.y - tail.y) / size.y);
    w *= edge * smoothstep(u_rainShape.w * 0.5, u_rainShape.w, length((head + tail) * 0.5 - eye));
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
    vec4 sprite = vec4(1.0);
    if (u_rainSpriteOn > 0.5) {
        sprite = texture(u_rainSprite, v_texCoord);
        a = sprite.a * u_rainShape.z;
    } else if (u_rainMode > 0.5) {
        // A flake or a splash's droplet: soft and round.
        float r = length(v_texCoord * 2.0 - 1.0);
        a = (1.0 - smoothstep(0.35, 1.0, r)) * u_rainShape.z;
    } else {
        // A drop: bright down its middle and at its head, faint at its tail; the drop is at the head, the streak is where it was.
        float across = 1.0 - abs(v_texCoord.x * 2.0 - 1.0);
        float along = smoothstep(0.0, 0.3, v_texCoord.y) * (0.5 + 0.5 * v_texCoord.y);
        a = across * across * along * u_rainShape.z;
    }
    if (a < 0.002) discard;
    fragColor = vec4(u_rainTint.rgb * sprite.rgb, a);
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
    /** The effect's intensity (rain's u_intensity, snow's u_snowfall), 0 to 2. */
    intensity: number;
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
    /** The effect's colour and texture params it is drawn with. */
    color: string;
    texture: string;
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
        intensity: Math.max(get('u_intensity', 1), 0),
        share: Math.min(Math.max(get('u_intensity', 1) * 0.5, 0), 1),
        velocity: leanToward(windDirection, lean, down),
        streak: Math.hypot(down, lean) * SHUTTER_PER_LENGTH * (get('u_streakLength', 0.3) / 0.3),
        sway: [0, 0],
        width: get('u_streakWidth', 0.012) * unitsPerMetre,
        brightness: get('u_streakBrightness', 0.35),
        color: 'u_streakColor',
        texture: 'u_streakTexture',
    };
}

/** A snowflake's fall, metres a second, and how far it sways and how often. */
const SNOW_SPEED = 1, SNOW_SWAY = 0.3, SNOW_SWAY_RATE = 0.5;

/** The flakes' fall from the effect's snowfall: a metre a second, swaying, and carried twice as far by the wind as rain is, being light. */
export function snowFall(effect: Pick<ViewRain['effect'], 'uniforms'>, windDirection: number, unitsPerMetre: number): RainFall {
    const get = (name: string, fallback: number): number => effect.uniforms.get(name) ?? fallback;
    const down = SNOW_SPEED * unitsPerMetre;
    return {
        mode: 1,
        intensity: Math.max(get('u_snowfall', 0), 0),
        share: Math.min(Math.max(get('u_snowfall', 0), 0), 1),
        velocity: leanToward(windDirection, 2 * get('u_wind', 0.15) * down, down),
        streak: 0,
        sway: [SNOW_SWAY * unitsPerMetre, SNOW_SWAY_RATE],
        width: get('u_flakeSize', 0.04) * unitsPerMetre,
        brightness: get('u_flakeBrightness', 0.9),
        color: 'u_flakeColor',
        texture: 'u_flakeTexture',
    };
}

/** What a splash is drawn as, from the effect's values: how many droplets it throws, how fast, how long it lasts. */
export interface Splash { droplets: number; speed: number; life: number }

/** The splashes rain throws up: drawn where the lattice lands while `drops` fall, sized and lit by the effect's splash values. */
export function splashFall(effect: Pick<ViewRain['effect'], 'uniforms'>, drops: RainFall, unitsPerMetre: number): RainFall & { splash: Splash } {
    const get = (name: string, fallback: number): number => effect.uniforms.get(name) ?? fallback;
    const width = Math.max(get('u_splashSize', 0.03), 0) * unitsPerMetre;
    return {
        ...drops,
        mode: 2,
        share: width > 0 ? drops.share : 0,
        width,
        brightness: get('u_splashBrightness', 0.9),
        color: 'u_splashColor',
        texture: 'u_splashTexture',
        splash: {
            droplets: Math.min(Math.max(Math.round(get('u_splashDroplets', 4)), 0), SPLASH_MOST_DROPLETS),
            speed: Math.max(get('u_splashSpeed', 1), 0),
            life: Math.max(get('u_splashLife', 0.3), 0.01),
        },
    };
}

/** `v` into [0, span): the drops' shift is taken round the box in double precision, so a long session keeps the GPU's float exact. */
const wrap = (v: number, span: number): number => ((v % span) + span) % span;

/** Splashes are drawn out to SPLASH_REACH metres round the eye (a droplet's few centimetres are under a pixel further off), each
 *  throwing at most SPLASH_MOST_DROPLETS: the mesh is shared out among the cells round the eye. */
const SPLASH_REACH = 6, SPLASH_MOST_DROPLETS = 8;

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
    const layers: Layer[] = [
        { name: 'Rain', material: 0, entity: 0 as Entity },
        { name: 'Snow', material: 0, entity: 0 as Entity },
        { name: 'Rain Splashes', material: 0, entity: 0 as Entity },
    ];
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
        const drops = rain ? rainFall(rain.effect, rain.windDirection, unit) : null;
        // The splashes are a system of their own, as the falling drops are (real rain is too dense to tell which drop threw a splash):
        // they are thrown where the precipitation lattice lands, where the water's and the puddles' rings open.
        const splashes = rain && drops ? splashFall(rain.effect, drops, unit) : null;
        const falls = rain && drops && splashes ? [drops, snowFall(rain.effect, rain.windDirection, unit), splashes] : [];
        setPrecipitation(drops && drops.share > 0
            ? { intensity: drops.intensity, velocity: drops.velocity, ring: precipitationRing((name) => rain!.effect.uniforms.get(name)) }
            : null);
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
        // The splashes' lattice round the eye: SPLASH_REACH metres each way (a splash's droplets are lost past it), its cells held to
        // what the mesh has room for.
        const cell = PRECIPITATION_CELL_METRES * unit;
        const points = splashes!.splash.droplets + 1;
        const reach = Math.min(Math.ceil(SPLASH_REACH / PRECIPITATION_CELL_METRES),
            Math.floor((Math.sqrt(RAIN_DROP_COUNT / (PRECIPITATION_LAYERS * points)) - 1) / 2));
        const density = precipitationDensity(drops!.intensity);
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
            Material.setUniform(material, 'u_rainEye', { x: rain.eye.x, y: rain.eye.y, z: rain.eye.z, w: fall.mode === 2 ? SPLASH_REACH * unit : half });
            Material.setUniform(material, 'u_rainBelow', height * BOX_BELOW);
            Material.setUniform(material, 'u_rainShift', { x: wrap(vx * t, 2 * half), y: wrap(vy * t, height), z: wrap(vz * t, 2 * half), w: height });
            Material.setUniform(material, 'u_rainFall', { x: vx, y: vy, z: vz, w: fall.streak });
            Material.setUniform(material, 'u_rainShape', { x: fall.share, y: fall.width, z: fall.brightness, w: 0.6 * unit });
            Material.setUniform(material, 'u_rainSway', { x: fall.sway[0], y: fall.sway[1], z: t % 1000, w: 0 });
            Material.setUniform(material, 'u_rainLattice', { x: cell, y: density, z: reach, w: points });
            const { life, speed } = splashes!.splash;
            Material.setUniform(material, 'u_rainWorld', { x: unit, y: worldGravity() * unit, z: life, w: speed });
            const tint = rain.effect.colors.get(fall.color) ?? rain.effect.colors.get('u_streakColor');
            if (tint) Material.setUniform(material, 'u_rainTint', { x: tint.r, y: tint.g, z: tint.b, w: tint.a });
            const sprite = resolveVolumeTexture(rain.effect.textures.get(fall.texture));
            Material.setUniform(material, 'u_rainSpriteOn', sprite ? 1 : 0);
            if (sprite) Material.setUniform(material, 'u_rainSprite', { __textureRef: true, textureId: sprite });
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
