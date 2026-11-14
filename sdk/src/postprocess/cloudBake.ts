// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  cloudBake.ts
 * @brief Sky Atmosphere's Baked Clouds: the cloud layer drawn into a panorama of the dome a strip a frame, and read back by direction.
 *
 * @details The cloud pass marches the layer for every pixel of the half-size picture, about half a million rays a frame at 1080p. With
 *          Baked Clouds on, the same march is run for the texels of a 512 x 512 panorama of the dome above the horizon (stereographic:
 *          `dir.xz / (1 + dir.y)`), one sixteenth of it a frame, and the cloud pass looks each sky pixel up in it: some sixteen thousand rays
 *          a frame, the whole dome new every sixteen. Clouds drift a few metres a second kilometres away, which a refresh of a quarter of a
 *          second does not show. The panorama is eight bits a channel: light as L / (1 + L), the clouds' transmittance in the alpha.
 *          While the panorama is whole the cloud pass draws with a shader that only reads it (effects.ts, the pass's alternate). Measured on
 *          Wilds at 3840 x 2160, ABBA: the cloud pass 3.9-4.4 ms marched, 1.2-2.1 ms baked, and 0.07 ms for the strip.
 *
 *          Until a panorama has been filled the clouds are marched as before, and a sky on a planet always is (its up is the camera's).
 */
import { Renderer, deviceGeneration, type RenderTargetHandle } from '../render/renderer';
import { Material, type MaterialHandle, type ShaderHandle } from '../render/material';
import { getResourceManager } from '../wasm/resourceManager';
import { getEffectDef, postProcessEffects } from './effects';
import type { BlendedEffect } from './volumeBlending';
import { runtimeTextureRef } from './runtimeTextures';
import { skyParamsOf, skySunOf } from './skyEnvironment';

/** The panorama's side, in texels. */
export const CLOUD_PANORAMA_SIZE = 512;
/** Strips the panorama is drawn in, one a frame. */
export const CLOUD_PANORAMA_STRIPS = 16;

/** The panorama texel a direction above the horizon is read from, as the shaders take it (0..1 each way). */
export function cloudPanoramaUv(dir: readonly [number, number, number]): [number, number] {
    const k = 1 / (1 + Math.max(dir[1], 0));
    return [dir[0] * k * 0.5 + 0.5, dir[2] * k * 0.5 + 0.5];
}

/** The direction a panorama texel stands for, as the bake works it out: the inverse of {@link cloudPanoramaUv} on the dome. */
export function cloudPanoramaDir(u: number, v: number): [number, number, number] {
    let px = u * 2 - 1;
    let py = v * 2 - 1;
    let r2 = px * px + py * py;
    if (r2 > 1) { const r = Math.sqrt(r2); px /= r; py /= r; r2 = 1; }
    return [2 * px / (1 + r2), (1 - r2) / (1 + r2), 2 * py / (1 + r2)];
}

interface Baker {
    target: RenderTargetHandle;
    texture: number;
    generation: number;
    material: MaterialHandle;
    shader: ShaderHandle;
    next: number;
    filled: number;
    last: number;
    failed: boolean;
}

let baker: Baker | null = null;
let frame = 0;
let bakedFrame = -1;
let lightSun: [number, number, number] | null = null;

/** Called once a frame with the sun the scene's lights give (the first directional light that shines, toward the sun). */
export function noteCloudBakeFrame(sun: [number, number, number] | null): void {
    lightSun = sun;
    frame++;
}

function ready(): Baker | null {
    if (baker && baker.generation !== deviceGeneration()) baker = null;
    if (baker) return baker.failed ? null : baker;
    const make = postProcessEffects.createSkyCloudsBake;
    if (!make) return null;
    const target = Renderer.createRenderTarget(CLOUD_PANORAMA_SIZE, CLOUD_PANORAMA_SIZE, 2 | 4);
    const id = target ? Renderer.getTargetTexture(target) : 0;
    const texture = id ? getResourceManager()?.wrapDeviceTexture?.(id, CLOUD_PANORAMA_SIZE, CLOUD_PANORAMA_SIZE) ?? 0 : 0;
    const shader = texture ? make() : 0;
    if (!shader) {
        if (target) Renderer.releaseRenderTarget(target);
        return null;
    }
    baker = { target, texture, generation: deviceGeneration(), material: Material.create({ shader }), shader, next: 0, filled: 0, last: 0, failed: false };
    return baker;
}

function bakeStrip(b: Baker, sky: BlendedEffect, eye: { x: number; z: number }, resolve: ((ref: string) => number) | null): void {
    if (b.last && Renderer.bakeState(b.last) < 0) { b.failed = true; return; }
    const def = getEffectDef('skyAtmosphere');
    const params = skyParamsOf(sky);
    for (const u of def?.uniforms ?? []) Material.setUniform(b.material, u.name, params(u.name));
    // Clouds that cast shadows are fixed to the world, so the dome over the camera is the part of the layer above where it stands.
    if (params('u_cloudShadow') > 0.001) {
        const km = Math.max(params('u_unitsPerKm'), 1e-3);
        Material.setUniform(b.material, 'u_cloudDriftX', params('u_cloudDriftX') + eye.x / km);
        Material.setUniform(b.material, 'u_cloudDriftZ', params('u_cloudDriftZ') + eye.z / km);
    }
    for (const name of ['u_cloudMask', 'u_cloudMask2']) {
        const ref = sky.textures.get(name);
        const id = ref && resolve ? resolve(ref) : 0;
        if (id) Material.setUniform(b.material, name, { __textureRef: true, textureId: id });
    }
    const sun = skySunOf(params, lightSun);
    const h = CLOUD_PANORAMA_SIZE / CLOUD_PANORAMA_STRIPS;
    b.last = Renderer.bakeMaterial(b.material, b.shader, b.target, 0, b.next * h, CLOUD_PANORAMA_SIZE, h,
        [sun[0], sun[1], sun[2], 0], [CLOUD_PANORAMA_SIZE, CLOUD_PANORAMA_SIZE, 0, 0]);
    if (!b.last) { b.failed = true; return; }
    b.next = (b.next + 1) % CLOUD_PANORAMA_STRIPS;
    b.filled = Math.min(b.filled + 1, CLOUD_PANORAMA_STRIPS + 1);
}

/**
 * Sky Atmosphere's Baked Clouds for the effects a view resolved: a strip of the panorama is drawn (once a frame, whichever view asks first)
 * and the cloud pass is told to read it, once every strip has been drawn. `eye` is the view's position, `resolve` turns a texture ref into a handle.
 */
export function applyCloudBake(effects: Map<string, BlendedEffect>, eye: { x: number; z: number }, resolve: ((ref: string) => number) | null): void {
    const sky = effects.get('skyAtmosphere');
    if (!sky || !sky.enabled) return;
    const params = skyParamsOf(sky);
    const b = params('u_bakedClouds') > 0.5 && params('u_planetRadius') <= 0 ? ready() : null;
    if (!b) {
        if (baker && baker.filled > 0) baker.filled = 0;
        sky.uniforms.set('u_cloudPanoramaOn', 0);
        return;
    }
    if (bakedFrame !== frame) {
        bakedFrame = frame;
        bakeStrip(b, sky, eye, resolve);
    }
    // A strip asked for this frame is drawn before the next one's scene: the panorama is whole the frame after its last strip.
    const whole = !b.failed && b.filled > CLOUD_PANORAMA_STRIPS;
    sky.textures.set('u_cloudPanorama', runtimeTextureRef('cloudPanorama', b.texture));
    sky.uniforms.set('u_cloudPanoramaOn', whole ? 1 : 0);
}

/** Lets the panorama go: a device lost, an app shut down, a test. */
export function resetCloudBake(): void {
    if (baker?.target) Renderer.releaseRenderTarget(baker.target);
    baker = null;
    bakedFrame = -1;
}
