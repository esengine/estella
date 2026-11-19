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
import { Material } from '../render/material';
import { CAUSTICS_GLSL } from '../render/waterCaustics';
import { registerEffect } from '../postprocess/effects';
import { setUnderwaterState, lensReach } from '../postprocess/underwater';
import { WatersRes } from './waterPlugin';
import { IGN_GLSL, PHASE_HG_GLSL } from '../render/shaderLib';
import { RAY_START_GLSL } from '../postprocess/sources/shared';
import { MOST_WATER_CAUSTIC_LAYERS, MOST_WATER_SHAFT_STEPS } from '../render/qualitySettings/water';

const SOURCE = `#pragma shader "PP Underwater"
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
#pragma param u_causticStrength float default(0.6) range(0,3)
#pragma param u_causticScale float default(2) range(0.05,2000)
#pragma param u_causticSpeed float default(0.35) range(0,4)
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
    float wet = smoothstep(-u_band, u_band, u_planeD - dot(up, entry));
    if (wet <= 0.0 || u_amount <= 0.0) { fragColor = src; return; }

    vec3 dir = normalize(target - entry);
    float len = sky ? u_range : min(length(target - entry), u_range);
    vec3 transmit = exp(-u_absorption.rgb * (u_density * len));
    float extinction = max(dot(u_absorption.rgb, vec3(1.0 / 3.0)) * u_density, 1e-5);

    vec4 sunDir, sunColor;
    ivec2 tiles;
    findSun(sunDir, sunColor, tiles);
    float cosUp = dot(sunDir.xyz, up);
    bool sunny = sunDir.w > 0.5 && cosUp > 0.05;
    float slant = max(cosUp, 0.15);
    float clock = u_time.x * u_causticSpeed;

    // What the camera sees, lit by the sun through the waves: a web of bright threads on what faces the sun, where the sun reaches it.
    vec3 colour = src.rgb;
    if (!sky && sunny && u_causticStrength > 0.0) {
        vec3 normal = normalize(facing);
        if (dot(normal, dir) > 0.0) normal = -normal;
        float below = max(u_planeD - dot(up, target), 0.0);
        vec3 onSurface = target + sunDir.xyz * (below / slant);
        float web = causticPattern(onSurface.xz / u_causticScale, clock, u_causticLayers);
        float reach = exp(-extinction * below / slant);
        colour *= 1.0 + u_causticStrength * web * max(dot(normal, sunDir.xyz), 0.0) * sunVisibility(target, tiles.x, tiles.y) * reach * min(sunColor.a, 2.0) * 0.5;
    }

    // The water gives back its own colour, less of it the deeper the camera is: the light it scatters is what reached it from above.
    vec3 scatter = u_scatterColor.rgb;
#ifdef ES_LINEAR
    scatter = srgbToLinear(scatter);
#endif
    scatter *= exp(-u_lightFalloff * u_cameraDepth);
    vec3 col = colour * transmit + scatter * (1.0 - dot(transmit, vec3(1.0 / 3.0)));

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
            float below = u_planeD - dot(up, p);
            if (below > 0.0) {
                vec3 onSurface = p + sunDir.xyz * (below / slant);
                float shaft = mix(1.0, min(causticPattern(onSurface.xz / u_causticScale, clock, u_causticLayers) * 1.6, 1.0), 0.7);
                lit += through * ds * sunVisibility(p, tiles.x, tiles.y) * exp(-extinction * below / slant) * shaft;
            }
            through *= exp(-extinction * ds);
        }
        vec3 sunTint = sunColor.rgb / max(max(sunColor.r, sunColor.g), max(sunColor.b, 1e-3));
        col += sunTint * lit * extinction * 0.5 * phaseHG(dot(dir, sunDir.xyz)) * u_shaftStrength * clamp(sunColor.a, 0.0, 8.0) * 8.0;
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
        factory: () => Material.compileShader(SOURCE),
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
            { name: 'u_causticStrength', label: 'Caustics', min: 0, max: 3, step: 0.01, defaultValue: 0.6, neutralValue: 0 },
            { name: 'u_causticScale', label: 'Caustic Scale', min: 0.05, max: 2000, step: 0.05, defaultValue: 2 },
            { name: 'u_causticSpeed', label: 'Caustic Speed', min: 0, max: 4, step: 0.01, defaultValue: 0.35 },
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

/** The plugin that keeps the post-process volume system told whether the camera is under water. */
export class UnderwaterPlugin implements Plugin {
    name = 'underwater';
    build(app: App): void {
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            if (!app.hasResource(WatersRes)) return;
            const waters = app.getResource(WatersRes);
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
            if (!sample || !(sample.depth < lensReach(near))) { setUnderwaterState(null); return; }
            const instance = waters.instance_;
            const depth = Math.max(-sample.depth, 0);
            const density = single(instance, 'u_density', 0.12);
            const shallow = triple(instance, 'u_shallowColor', [0.10, 0.42, 0.46]);
            const deep = triple(instance, 'u_deepColor', [0.01, 0.08, 0.15]);
            // Deeper, the water gives back more of its deep colour: the same blend the surface draws.
            const toDeep = 1 - Math.exp(-depth * density * 0.5);
            const n = sample.normal;
            setUnderwaterState({
                amount: 1,
                depth,
                absorption: triple(instance, 'u_absorption', [0.45, 0.09, 0.05]),
                density,
                scatter: [shallow[0] + (deep[0] - shallow[0]) * toDeep, shallow[1] + (deep[1] - shallow[1]) * toDeep, shallow[2] + (deep[2] - shallow[2]) * toDeep],
                plane: [n[0], n[1], n[2], n[0] * sample.surface[0] + n[1] * sample.surface[1] + n[2] * sample.surface[2]],
                band: Math.max(near * 0.08, 0.05),
                causticStrength: single(instance, 'u_causticStrength', 0.6),
                causticScale: single(instance, 'u_causticScale', 2),
                causticSpeed: single(instance, 'u_causticSpeed', 0.35),
                light: waters.quality.caustics });
        }, { name: 'UnderwaterSystem' }));
    }

    cleanup(): void {
        setUnderwaterState(null);
    }
}
