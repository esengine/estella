// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  skyStill.ts
 * @brief A still sky (defineSkyEffect `still`) drawn into a panorama a strip a frame, and read back by direction.
 *
 * @details A sky written as noise is worked out for every pixel of the picture every frame: a nebula of some fifty noise lookups cost
 *          2.8 ms of a 6.5 ms frame at 2400 x 1080 on a desktop GPU, and a phone has a fraction of one. A sky that only changes when its params
 *          do is drawn instead into a 2048 x 1024 panorama of the whole sphere, an eighth of it a frame, and the sky pass reads it. The params are
 *          read when it is drawn; Brightness is applied where it is read. Until the panorama is whole, and wherever the quality level does not
 *          ask for it (stillSky), the sky is worked out as before.
 */
import { Renderer, deviceGeneration, type RenderTargetHandle } from '../render/renderer';
import { Material, type MaterialHandle, type ShaderHandle } from '../render/material';
import { getResourceManager } from '../wasm/resourceManager';
import { stillSkyBake } from './customSky';
import type { BlendedEffect } from './volumeBlending';
import { runtimeTextureRef } from './runtimeTextures';

export const SKY_STILL_WIDTH = 2048;
export const SKY_STILL_HEIGHT = 1024;
export const SKY_STILL_STRIPS = 8;

/** Not part of what the panorama shows: read where it is read, or not by the sky at all. */
const UNBAKED = new Set(['u_intensity', 'u_lightScene', 'u_skyCapture', 'u_skyStillOn', 'u_sceneCoverage']);

interface Baker {
    target: RenderTargetHandle;
    texture: number;
    generation: number;
    material: MaterialHandle;
    shader: ShaderHandle;
    key: string;
    next: number;
    filled: number;
    last: number;
    failed: boolean;
}

const bakers = new Map<string, Baker>();
let wanted = false;
let frame = 0;
const bakedFrame = new Map<string, number>();

/** Whether the quality level asks for still skies to be read from their panorama (QualityProfile.stillSky). */
export function setSkyStillWanted(on: boolean): void {
    wanted = on;
}

/** Called once a frame, before the views resolve their effects. */
export function noteSkyStillFrame(): void {
    frame++;
}

function ready(type: string, make: () => ShaderHandle): Baker | null {
    let baker = bakers.get(type);
    if (baker && baker.generation !== deviceGeneration()) { bakers.delete(type); baker = undefined; }
    if (baker) return baker.failed ? null : baker;
    const target = Renderer.createRenderTarget(SKY_STILL_WIDTH, SKY_STILL_HEIGHT, 2 | 4);
    const id = target ? Renderer.getTargetTexture(target) : 0;
    const texture = id ? getResourceManager()?.wrapDeviceTexture?.(id, SKY_STILL_WIDTH, SKY_STILL_HEIGHT) ?? 0 : 0;
    const shader = texture ? make() : 0;
    if (!shader) {
        if (target) Renderer.releaseRenderTarget(target);
        return null;
    }
    baker = { target, texture, generation: deviceGeneration(), material: Material.create({ shader }), shader, key: '', next: 0, filled: 0, last: 0, failed: false };
    bakers.set(type, baker);
    return baker;
}

function keyOf(sky: BlendedEffect): string {
    let key = '';
    for (const [name, value] of [...sky.uniforms].sort(([a], [b]) => a.localeCompare(b))) if (!UNBAKED.has(name)) key += `${name}=${value};`;
    for (const [name, c] of [...sky.colors].sort(([a], [b]) => a.localeCompare(b))) key += `${name}=${c.r},${c.g},${c.b},${c.a};`;
    return key;
}

export function stillSkyKey(type: string, sky: BlendedEffect, suns: string): string | undefined {
    if (!stillSkyBake(type)) return undefined;
    return `${keyOf(sky)}u_intensity=${sky.uniforms.get('u_intensity') ?? 1};${suns}`;
}

function bakeStrip(b: Baker, sky: BlendedEffect): void {
    if (b.last && Renderer.bakeState(b.last) < 0) { b.failed = true; return; }
    for (const [name, value] of sky.uniforms) if (!UNBAKED.has(name)) Material.setUniform(b.material, name, value);
    for (const [name, c] of sky.colors) Material.setUniform(b.material, name, { x: c.r, y: c.g, z: c.b, w: c.a });
    const h = SKY_STILL_HEIGHT / SKY_STILL_STRIPS;
    b.last = Renderer.bakeMaterial(b.material, b.shader, b.target, 0, b.next * h, SKY_STILL_WIDTH, h, [0, 1, 0, 0], [SKY_STILL_WIDTH, SKY_STILL_HEIGHT, 0, 0]);
    if (!b.last) { b.failed = true; return; }
    b.next = (b.next + 1) % SKY_STILL_STRIPS;
    b.filled = Math.min(b.filled + 1, SKY_STILL_STRIPS + 1);
}

/**
 * The still skies among the effects a view resolved: a strip of each one's panorama is drawn while it is not whole (once a frame,
 * whichever view asks first), and its pass is told to read the panorama once it is.
 */
export function applySkyStill(effects: Map<string, BlendedEffect>): void {
    for (const [type, sky] of effects) {
        const make = sky.enabled ? stillSkyBake(type) : undefined;
        if (!make) continue;
        const b = wanted ? ready(type, make) : null;
        if (!b) { sky.uniforms.set('u_skyStillOn', 0); continue; }
        const key = keyOf(sky);
        if (key !== b.key) { b.key = key; b.filled = 0; b.next = 0; }
        if (b.filled <= SKY_STILL_STRIPS && bakedFrame.get(type) !== frame) {
            bakedFrame.set(type, frame);
            bakeStrip(b, sky);
        }
        const whole = !b.failed && b.filled > SKY_STILL_STRIPS;
        sky.textures.set('u_skyStill', runtimeTextureRef(`skyStill:${type}`, b.texture));
        sky.uniforms.set('u_skyStillOn', whole ? 1 : 0);
    }
}

/** Lets the panoramas go: a device lost, an app shut down, a test. */
export function resetSkyStill(): void {
    for (const b of bakers.values()) if (b.target) Renderer.releaseRenderTarget(b.target);
    bakers.clear();
    bakedFrame.clear();
}
