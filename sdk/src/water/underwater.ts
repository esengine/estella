// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    underwater.ts
 * @brief   Seeing from under the water: the effect that fogs the world by how much water the light crossed, lights it with the sun through the waves, and the system that says when.
 *
 * @details The effect is the water's own: its definition and shader are registered here, with the rest of the water module, so a build with no water carries
 *          none of it. For each pixel it asks whether the pixel's place on the camera's near plane is under the surface (so a lens half in the water
 *          has a waterline across it, soft by `u_band`), and for those that are:
 *            - the light has crossed the distance from the eye to what it came from (the longest the water is seen through for the sky), and
 *              the water takes it out colour by colour (red first: the same absorption and density the surface's material draws with) and gives back
 *              its own colour, which dims with the camera's depth;
 *            - what the camera sees is lit by the sun through the waves: a web of bright threads on what faces the sun and is not in shadow, from the
 *              pattern the surface draws (render/waterCaustics.ts), less the further the sun's light went through the water to reach it;
 *            - and the water between the camera and what it sees scatters the sun toward it: the same pattern marched along the ray, 24 steps, each
 *              step in light where the shadow map says the sun reaches it, which is what makes shafts.
 *          The system reads the camera's place in the water from {@link Waters.sample} each frame and tells the post-process volume system (see
 *          postprocess/underwater.ts), which adds the effect for as long as the camera is under.
 */
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { Camera, Transform, type CameraData, type TransformData } from '../ecs/component';
import type { Entity } from '../types';
import { worldUnitScale } from '../ecs/worldUnits';
import { Material } from '../render/material';
import { CAUSTICS_GLSL, CAUSTIC_PARAMS, CAUSTIC_FIELD_PARAMS, WATER_ZONE_LAYER_GLSL, WATER_CAUSTICS } from '../render/waterCaustics';
import { registerEffect } from '../postprocess/effects';
import { setUnderwaterState, lensReach } from '../postprocess/underwater';
import { UnderwaterLook, WaterBody, WatersRes, type WaterBodyData } from './waterPlugin';
import { IGN_GLSL, PHASE_HG_GLSL } from '../render/shaderLib';
import { RAY_START_GLSL } from '../postprocess/sources/shared';
import { MOST_WATER_CAUSTIC_LAYERS, MOST_WATER_SHAFT_STEPS } from '../render/qualitySettings/water';

export const UNDERWATER_SHADER = `#pragma shader "PP Underwater"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_absorption color default(0.45,0.09,0.05,1)
#pragma param u_scatterColor color default(0.03,0.2,0.28,1)
#pragma param u_density float default(0.12) range(0,4)
#pragma param u_amount float default(1) range(0,1)
#pragma param u_cameraDepth float default(0) range(0,100000)
#pragma param u_lightFalloff float default(0.004) range(0,1)
#pragma param u_range float default(4000) range(10,100000)
#pragma param u_planeNx float default(0) range(-1,1)
#pragma param u_planeNy float default(1) range(-1,1)
#pragma param u_planeNz float default(0) range(-1,1)
#pragma param u_planeD float default(0) range(-1000000,1000000)
#pragma param u_band float default(0.25) range(0,1000)
${CAUSTIC_PARAMS}
${CAUSTIC_FIELD_PARAMS}
#pragma param u_zoneSurfaceData texture default(white) texel(data)
#pragma param u_causticLevel float default(0)
#pragma param u_lensSurface texture default(black) texel(data)
#pragma param u_managedSurface float default(0)
#pragma param u_shaftStrength float default(0.5) range(0,4)
#pragma param u_shaftRange float default(2000) range(10,100000)
#pragma param u_shaftSteps float default(${MOST_WATER_SHAFT_STEPS}) range(1,${MOST_WATER_SHAFT_STEPS})
#pragma param u_causticLayers float default(${MOST_WATER_CAUSTIC_LAYERS}) range(1,${MOST_WATER_CAUSTIC_LAYERS})
#pragma lights

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

const int SHAFT_STEPS = ${MOST_WATER_SHAFT_STEPS};

${WATER_ZONE_LAYER_GLSL}
${CAUSTICS_GLSL}
/// Where a view ray starts: the near plane of a perspective eye. An orthographic eye's depth range runs from far BEHIND the camera to far ahead of it
/// (the projection is built with near = -far), so depth 0 is that far-behind plane, above the water for a camera under it; mid-depth is the plane
/// the camera stands in.
${RAY_START_GLSL}
${IGN_GLSL}
/// How much of a ray's light a particle scatters toward the viewer: forward, the way water glows around the sun.
${PHASE_HG_GLSL}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    ivec2 size = textureSize(u_sceneDepth, 0);
    float depth = texelFetch(u_sceneDepth, clamp(ivec2(v_texCoord * vec2(size)), ivec2(0), size - ivec2(1)), 0).r;
    bool sky = depth >= 1.0;
    vec3 entry = rayStart(v_texCoord);
    vec3 target = worldFromDepth(v_texCoord, sky ? 1.0 : depth);
    // The face of what is seen, from how the picture's own world positions change from one pixel to the next (taken here, before any branch).
    vec3 facing = cross(dFdx(target), dFdy(target));

    // The waterline: this pixel is under water where its place on the camera's near plane is below the surface at the camera.
    vec3 up = normalize(vec3(u_planeNx, u_planeNy, u_planeNz));
    vec3 atLens = entry + u_renderOrigin.xyz;
    float immersion = u_planeD - dot(up, atLens);
    if (u_managedSurface > 0.5 && u_causticRect.z > 0.0) {
        vec2 lensUv = (atLens.xz - u_causticRect.xy) / u_causticRect.z;
        if (all(greaterThanEqual(lensUv, vec2(0.0))) && all(lessThanEqual(lensUv, vec2(1.0)))) {
            vec4 sampleAtLens = textureLod(u_lensSurface, lensUv, 0.0);
            vec2 horizontal = (sampleAtLens.rg * 255.0 - 128.0) / 127.0;
            if (dot(horizontal, horizontal) <= 1.001) {
                float elevation = u_causticElevation.x + dot(sampleAtLens.ba, vec2(256.0, 1.0) / 257.0) * u_causticElevation.y;
                immersion = elevation - atLens.y;
            }
        }
    }
    float wet = smoothstep(-u_band, u_band, immersion);
    if (wet <= 0.0 || u_amount <= 0.0) { fragColor = src; return; }

    vec3 dir = normalize(target - entry);
    float len = sky ? u_range : min(length(target - entry), u_range);
    vec3 transmit = exp(-u_absorption.rgb * (u_density * len));
    float extinction = max(dot(u_absorption.rgb, vec3(1.0 / 3.0)) * u_density, 1e-5);

    vec4 sunDir, sunColor;
    ivec2 tiles;
    findSun(sunDir, sunColor, tiles);
    vec3 lightUp = u_managedSurface > 0.5 ? vec3(0.0, 1.0, 0.0) : up;
    float cosUp = dot(sunDir.xyz, lightUp);
    bool sunny = sunDir.w > 0.5 && cosUp > 0.0;
    vec3 sunWater = waterSunRay(sunDir.xyz, lightUp);
    float slant = max(dot(sunWater, lightUp), 0.08);

    // What the camera sees, lit by the sun through the waves: a web of bright threads on what faces the sun, where the sun reaches it.
    vec3 colour = src.rgb;
    if (!sky && sunny && (u_causticStrength > 0.0 || u_causticBodyOcean.w > 0.5)) {
        vec3 normal = dot(facing, facing) > 1e-12 ? normalize(facing) : up;
        if (dot(normal, dir) > 0.0) normal = -normal;
        vec3 absolute = target + u_renderOrigin.xyz;
        float below = u_managedSurface > 0.5 ? u_causticLevel - absolute.y : u_planeD - dot(up, absolute);
        vec3 light = waterReceiverLight(absolute, normal, lightUp, below, sunDir.xyz, sunColor, u_absorption.rgb * u_density, u_causticStrength, u_time.x);
        if (any(greaterThan(light, vec3(0.0)))) colour *= 1.0 + light * sunVisibility(target, tiles.x, tiles.y);
    }

    // The water gives back its own colour, less of it the deeper the camera is: the light it scatters is what reached it from above.
    vec3 scatter = u_scatterColor.rgb;
#ifdef ES_LINEAR
    scatter = srgbToLinear(scatter);
#endif
    // A medium scatters incident radiance. In an unlit scene it contributes no light
    // of its own. The environment's DC coefficient is its mean incident radiance.
    vec3 skyLight = max(u_ambient.rgb + 0.282095 * u_envIrradiance[0].rgb * u_envTint.rgb, vec3(0.0));
    vec3 direct = sunny ? sunColor.rgb * sunColor.a * max(cosUp,0.0) : vec3(0.0);
    scatter *= (skyLight + direct) * exp(-u_lightFalloff * u_cameraDepth);
    vec3 col = colour * transmit + scatter * (1.0 - transmit);

    // Shafts: the sun scattered toward the eye by the water along the ray, wherever the shadow map says it gets in and in the pattern the waves throw.
    if (sunny && u_shaftStrength > 0.0) {
        float span = min(len, u_shaftRange);
        float steps = clamp(floor(u_shaftSteps + 0.5), 1.0, float(SHAFT_STEPS));
        float ds = span / steps;
        float jitter = ign(gl_FragCoord.xy);
        float through = 1.0;
        float lit = 0.0;
        for (int i = 0; i < SHAFT_STEPS; ++i) {
            if (float(i) >= steps) break;
            vec3 p = entry + dir * ((float(i) + jitter) * ds);
            vec3 absolute = p + u_renderOrigin.xyz;
            float below = u_managedSurface > 0.5 ? u_causticLevel - absolute.y : u_planeD - dot(up, absolute);
            if (below > 0.0) {
                vec3 beam;
                float travel, focus;
                bool visible = waterSunBundle(absolute, below, lightUp, sunWater, u_time.x, false, beam, travel, focus);
                float shaft = 0.3 + min(focus, 3.0) * 0.7;
                if (visible) lit += through * ds * sunVisibility(p, tiles.x, tiles.y) * exp(-extinction * travel)
                     * shaft * phaseHG(dot(dir, beam));
            }
            through *= exp(-extinction * ds);
        }
        vec3 sunTint = sunColor.rgb / max(max(sunColor.r, sunColor.g), max(sunColor.b, 1e-3));
        col += sunTint * lit * extinction * 0.5 * waterSunFlux(max(cosUp, 0.0), slant) * u_shaftStrength * clamp(sunColor.a, 0.0, 8.0) * 8.0;
    }
    fragColor = vec4(mix(src.rgb, col, u_amount * wet), src.a);
}
#pragma end

`;

let registered = false;

/** Registers the effect with the post-process registry, once. */
export function registerUnderwaterEffect(): void {
    if (registered) return;
    registered = true;
    registerEffect({
        type: 'underwater',
        label: 'Underwater',
        labelZh: '水下',
        category: 'atmosphere',
        qualityGroup: 'water',
        factory: () => Material.compileShader(UNDERWATER_SHADER),
        uniforms: [
            // Per WORLD unit of water: how much of the light a unit takes out (times each colour's absorption).
            { name: 'u_density', label: 'Density', min: 0, max: 4, step: 0.005, defaultValue: 0.12, neutralValue: 0 },
            { name: 'u_amount', label: 'Amount', min: 0, max: 1, step: 0.01, defaultValue: 1, neutralValue: 0 },
            // How far under the surface the camera is; the water module sets it.
            { name: 'u_cameraDepth', label: 'Camera Depth', min: 0, max: 100000, step: 1, defaultValue: 0 },
            // How fast the water's own light dims with the camera's depth, per world unit.
            { name: 'u_lightFalloff', label: 'Light Falloff', min: 0, max: 1, step: 0.0005, defaultValue: 0.004 },
            // The longest the water is seen through: what the sky, which has no surface, is fogged by.
            { name: 'u_range', label: 'Range', min: 10, max: 100000, step: 10, defaultValue: 4000 },
            // The surface at the camera, which the water module sets: its normal and offset, and how soft the line it makes across the lens is.
            { name: 'u_planeNx', label: 'Surface Normal X', min: -1, max: 1, step: 0.01, defaultValue: 0 },
            { name: 'u_planeNy', label: 'Surface Normal Y', min: -1, max: 1, step: 0.01, defaultValue: 1 },
            { name: 'u_planeNz', label: 'Surface Normal Z', min: -1, max: 1, step: 0.01, defaultValue: 0 },
            { name: 'u_planeD', label: 'Surface Offset', min: -1000000, max: 1000000, step: 1, defaultValue: 0 },
            { name: 'u_band', label: 'Waterline Softness', min: 0, max: 1000, step: 0.05, defaultValue: 0.25 },
            // The web of light on what faces the sun, as the Water material draws it from above: how strong, how large a cell (world units), how fast it swims.
            { name: 'u_causticStrength', label: 'Caustics', min: 0, max: WATER_CAUSTICS.strength.max, step: 0.01, defaultValue: WATER_CAUSTICS.strength.value, neutralValue: 0 },
            { name: 'u_causticScale', label: 'Caustic Scale', min: WATER_CAUSTICS.scale.min, max: WATER_CAUSTICS.scale.max, step: 5, defaultValue: WATER_CAUSTICS.scale.value, worldUnits: 1 },
            { name: 'u_causticSpeed', label: 'Fine Caustic Speed', min: 0, max: WATER_CAUSTICS.speed.max, step: 0.01, defaultValue: WATER_CAUSTICS.speed.value },
            // The sun scattered toward the camera by the water along each ray: how strong the shafts are, and how far from the camera they are walked.
            { name: 'u_shaftStrength', label: 'Light Shafts', min: 0, max: 4, step: 0.01, defaultValue: 0.5, neutralValue: 0 },
            { name: 'u_shaftRange', label: 'Shaft Range', min: 10, max: 100000, step: 10, defaultValue: 2000 },
        ],
        colors: [
            { name: 'u_absorption', label: 'Absorption', defaultValue: { r: 0.45, g: 0.09, b: 0.05, a: 1 } },
            { name: 'u_scatterColor', label: 'Colour', defaultValue: { r: 0.03, g: 0.2, b: 0.28, a: 1 } },
        ] });
}

type Triple = [number, number, number];

/** A colour or vector uniform of a material as three numbers, or the fallback where it says nothing readable. */
function triple(instance: number, name: string, fallback: Triple): Triple {
    if (!instance) return fallback;
    const v = Material.getUniform(instance, name) as unknown;
    if (Array.isArray(v) && v.length >= 3) return [Number(v[0]), Number(v[1]), Number(v[2])];
    if (v && typeof v === 'object') {
        const o = v as Record<string, number>;
        if ('r' in o) return [o.r!, o.g!, o.b!];
        if ('x' in o) return [o.x!, o.y!, o.z!];
    }
    return fallback;
}

function single(instance: number, name: string, fallback: number): number {
    if (!instance) return fallback;
    const v = Material.getUniform(instance, name);
    return typeof v === 'number' ? v : fallback;
}

/** What the world looks like from under one body's water. */
interface UnderLook { absorption: [number, number, number]; density: number; shallow: [number, number, number]; deep: [number, number, number]; caustics: number }

/** A body's look from under its water: its own, or the zone material's, as its surface is drawn. */
function lookOf(body: WaterBodyData | null, instance: number): UnderLook {
    instance = body?.waterMaterial || instance;
    const own = body && body.underwaterLook === UnderwaterLook.Own ? body : null;
    if (!own) {
        return { absorption: triple(instance, 'u_absorption', [0.45, 0.09, 0.05]), density: single(instance, 'u_density', 0.12),
            shallow: triple(instance, 'u_shallowColor', [0.10, 0.42, 0.46]), deep: triple(instance, 'u_deepColor', [0.01, 0.08, 0.15]),
            caustics: single(instance, 'u_causticStrength', WATER_CAUSTICS.strength.value) };
    }
    const shallow: [number, number, number] = [own.underwaterColor.r, own.underwaterColor.g, own.underwaterColor.b];
    return { absorption: [own.underwaterAbsorption.r, own.underwaterAbsorption.g, own.underwaterAbsorption.b], density: own.underwaterDensity,
        shallow, deep: [shallow[0] * 0.15, shallow[1] * 0.3, shallow[2] * 0.45], caustics: own.underwaterCaustics };
}

/** One look laid over another by `t`. */
function mixLook(a: UnderLook, b: UnderLook, t: number): UnderLook {
    const m = (p: number, q: number): number => p + (q - p) * t;
    const m3 = (p: [number, number, number], q: [number, number, number]): [number, number, number] => [m(p[0], q[0]), m(p[1], q[1]), m(p[2], q[2])];
    return { absorption: m3(a.absorption, b.absorption), density: m(a.density, b.density), shallow: m3(a.shallow, b.shallow), deep: m3(a.deep, b.deep), caustics: m(a.caustics, b.caustics) };
}

function smoothstep(t: number): number {
    const c = Math.min(Math.max(t, 0), 1);
    return c * c * (3 - 2 * c);
}

/** The plugin that keeps the post-process volume system told whether the camera is under water. */
export class UnderwaterPlugin implements Plugin {
    name = 'underwater';
    build(app: App): void {
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            if (!app.hasResource(WatersRes)) return;
            const waters = app.getResource(WatersRes);
            if (waters.meshView > 0) { setUnderwaterState(null); return; }
            let eye: [number, number, number] | null = null;
            let near = 1;
            for (const entity of app.world.getEntitiesWithComponents([Camera, Transform])) {
                const camera = app.world.get(entity, Camera) as CameraData;
                if (!camera.isActive) continue;
                const t = app.world.get(entity, Transform) as TransformData;
                eye = [t.worldPosition.x, t.worldPosition.y, t.worldPosition.z];
                near = camera.nearPlane;
                break;
            }
            const sample = eye ? waters.sample(eye[0], eye[1], eye[2]) : null;
            // Under, or close enough above that part of the lens (the near plane ahead of the camera) can be: the effect decides pixel by pixel.
            if (!eye || !sample || !(sample.depth < lensReach(near))) { setUnderwaterState(null); return; }
            const instance = waters.instance_;
            const depth = Math.max(-sample.depth, 0);
            const bodyOf = (e: Entity): WaterBodyData | null =>
                app.world.valid(e) && app.world.has(e, WaterBody) ? app.world.get(e, WaterBody) as WaterBodyData : null;
            // Every body the camera is under (within its blend radius of its outline), lowest priority first, each laid over the ones
            // before by its blend weight. The body the water there is drawn from goes last among equals, so one body alone is as it was.
            const under = waters.bodiesAt(eye![0], eye![2], (e) => bodyOf(e)?.underwaterBlendRadius ?? 0)
                .filter((b) => eye![1] < b.level + lensReach(near));
            if (!under.some((b) => b.entity === sample.entity)) under.push({ entity: sample.entity, inside: 0, level: sample.surface[1] });
            const layers = under.map((b) => {
                const body = bodyOf(b.entity);
                if (body && body.underwaterEnabled === false) return null;
                const radius = body?.underwaterBlendRadius ?? 0;
                const fade = b.inside >= 0 ? 1 : radius > 0 ? smoothstep(1 + b.inside / radius) : 0;
                return { look: lookOf(body, instance), material: body?.underwaterMaterial ?? 0, weight: Math.min(Math.max(body?.underwaterBlendWeight ?? 1, 0), 1) * fade,
                    priority: body?.underwaterPriority ?? 0, last: b.entity === sample.entity ? 1 : 0 };
            }).filter((l): l is NonNullable<typeof l> => l !== null && l.weight > 0)
                .sort((p, q) => p.priority - q.priority || p.last - q.last);
            if (layers.length === 0) { setUnderwaterState(null); return; }
            let look = layers[0]!.look, amount = layers[0]!.weight;
            for (let i = 1; i < layers.length; i++) {
                look = mixLook(look, layers[i]!.look, layers[i]!.weight);
                amount += (1 - amount) * layers[i]!.weight;
            }
            const { density, shallow, deep } = look;
            // Deeper, the water gives back more of its deep colour: the same blend the surface draws.
            const toDeep = 1 - Math.exp(-depth * density * 0.5);
            const n = sample.normal;
            setUnderwaterState({
                amount,
                depth,
                absorption: look.absorption,
                density,
                scatter: [shallow[0] + (deep[0] - shallow[0]) * toDeep, shallow[1] + (deep[1] - shallow[1]) * toDeep, shallow[2] + (deep[2] - shallow[2]) * toDeep],
                plane: [n[0], n[1], n[2], n[0] * sample.surface[0] + n[1] * sample.surface[1] + n[2] * sample.surface[2]],
                band: Math.max(near * 0.08, 0.05),
                causticStrength: waters.causticBodies_ ? single(instance, 'u_causticStrength', WATER_CAUSTICS.strength.value) : look.caustics,
                causticBodies: waters.causticBodies_,
                causticScale: single(instance, 'u_causticScale', WATER_CAUSTICS.scale.value * worldUnitScale()),
                causticSpeed: single(instance, 'u_causticSpeed', WATER_CAUSTICS.speed.value),
                level: waters.depthAt(eye[0], eye[2], 0) ?? sample.surface[1],
                material: layers[layers.length-1]!.material,
                opticalField: waters.opticalField_,
                waveCaustics: !!waters.quality.causticFieldSize,
                light: waters.quality.caustics });
        }, { name: 'UnderwaterSystem' }));
    }

    cleanup(): void {
        setUnderwaterState(null);
    }
}
