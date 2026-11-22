// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    underwater.ts
 * @brief   What a camera under water sees: the state a water body reports, and the effect the volume system adds for it.
 *
 * @details Being under water is not authored into a volume: it is a fact about where the camera is. The water module reports it (the camera is this
 *          deep under a surface whose water absorbs like this and glows like that) and this adds an `underwater` effect to whatever the volumes
 *          resolved, the way a weather adds its rain. A scene that authors an `underwater` effect of its own keeps its numbers and only has the
 *          depth and the amount filled in; one that does not gets the numbers of the water it is under, so the world below the surface and
 *          the surface seen from above agree.
 *
 *          The effect itself (its shader and its definition) is registered by the water module: a build with no water has no state to report
 *          and carries none of it.
 */
import { Material } from '../render/material';
import { runtimeTextureRef } from './runtimeTextures';
import type { OpticalField, CausticBodies } from '../water/opticalField';
import type { BlendedEffect, Rgba } from './volumeBlending';

/** How a camera is under water. */
export interface UnderwaterState {
    /** How wholly the camera is under the surface, 0 to 1: it ramps in over the first stretch below it, so the cut is not a pop. */
    amount: number;
    /** How far under the surface the camera is, in world units. */
    depth: number;
    /** How fast each colour is absorbed per world unit of water (red first), and the water's density: the numbers of the surface's own material. */
    absorption: [number, number, number];
    density: number;
    /** The colour the water gives back, at the camera's depth, before the light fades with depth. */
    scatter: [number, number, number];
    /** The surface at the camera: its normal (out of the water) and the offset along it (`dot(normal, p) = offset` on the surface). A pixel is under water where its place on the camera's near plane is. */
    plane: [number, number, number, number];
    /** How soft the waterline across the lens is, in world units. */
    band: number;
    /** The Water material's caustics, so the light the camera sees is the light the surface draws. */
    causticStrength: number;
    causticScale: number;
    causticSpeed: number;
    /** Whether the sun's light is drawn through the water (the web on what is seen, the shafts). The quality level turns it off; absent is on. */
    light?: boolean;
    /** Stable rest level for sunlight; the local tangent plane is only for the waterline. */
    level?: number;
    opticalField?: OpticalField | null;
    waveCaustics?: boolean;
    material?: number;
    causticBodies?: CausticBodies | null;
}

let current: UnderwaterState | null = null;

/** Reports the camera under water, or (null) out of it. Called by the water module each frame. */
export function setUnderwaterState(state: UnderwaterState | null): void {
    current = state;
}

/** What the water module last reported. */
export function currentUnderwater(): UnderwaterState | null {
    return current;
}

/**
 * Adds the underwater effect to what the volumes resolved: filled in from the state where the scene authored none of its own, its depth and amount
 * always. Does nothing out of the water.
 */
export function applyUnderwaterToEffects(effects: Map<string, BlendedEffect>, state: UnderwaterState | null): void {
    if (!state || state.amount <= 0) return;
    let effect = effects.get('underwater');
    const authored = !!effect;
    if (!effect) {
        effect = { enabled: true, uniforms: new Map(), textures: new Map(), colors: new Map() };
        effects.set('underwater', effect);
    }
    if (!effect.enabled) return;
    const colour = (c: [number, number, number]): Rgba => ({ r: c[0], g: c[1], b: c[2], a: 1 });
    // Explicit volume overrides win per parameter. A volume that authors only shafts
    // still inherits the water material's optical settings.
    if (state.material) {
        effect.shader = Material.getShader(state.material);
        for (const [name,value] of Material.getUniforms(state.material)) {
            if (effect.uniforms.has(name) || effect.colors.has(name) || effect.textures.has(name)) continue;
            if (typeof value === 'number') effect.uniforms.set(name,value);
            else if ('__textureRef' in value) effect.textures.set(name,runtimeTextureRef(name,value.textureId));
            else if ('x' in value) effect.colors.set(name,{r:value.x,g:value.y,b:'z' in value ? value.z : 0,a:'w' in value ? value.w : 0});
        }
    }
    if (!authored) {
        if (!effect.colors.has('u_absorption')) effect.colors.set('u_absorption', colour(state.absorption));
        if (!effect.colors.has('u_scatterColor')) effect.colors.set('u_scatterColor', colour(state.scatter));
        if (!effect.uniforms.has('u_density')) effect.uniforms.set('u_density', state.density);
    }
    const bodies = !effect.uniforms.has('u_causticStrength') && state.light !== false ? state.causticBodies : null;
    if (bodies) {
        effect.textures.set('u_zoneSurfaceData', runtimeTextureRef('waterSurfaceData', bodies.texture));
        effect.colors.set('u_causticBodyRect', { r: bodies.rect.x, g: bodies.rect.y, b: bodies.rect.z, a: bodies.rect.w });
        effect.colors.set('u_causticBodyOcean', { r: bodies.ocean.x, g: bodies.ocean.y, b: bodies.ocean.z, a: bodies.ocean.w });
    } else {
        effect.colors.set('u_causticBodyOcean', { r: 0, g: 0, b: 0, a: 0 });
    }
    if (!effect.uniforms.has('u_causticStrength')) effect.uniforms.set('u_causticStrength', state.causticStrength);
    if (!effect.uniforms.has('u_causticScale')) effect.uniforms.set('u_causticScale', state.causticScale);
    if (!effect.uniforms.has('u_causticSpeed')) effect.uniforms.set('u_causticSpeed', state.causticSpeed);
    effect.uniforms.set('u_managedSurface', state.level === undefined ? 0 : 1);
    effect.uniforms.set('u_causticLevel', state.level ?? 0);
    const field = state.opticalField;
    const rect = field?.rect;
    effect.colors.set('u_causticRect', { r: rect?.x ?? 0, g: rect?.y ?? 0, b: rect?.z ?? (state.waveCaustics ? -1 : 0), a: rect?.w ?? 0 });
    if (field) {
        effect.textures.set('u_causticField', runtimeTextureRef('waterOpticalSurface', field.texture));
        effect.colors.set('u_causticElevation', { r: field.elevation.x, g: field.elevation.y, b: field.elevation.z, a: field.elevation.w });
    }
    if (state.light === false) {
        effect.uniforms.set('u_causticStrength', 0);
        effect.uniforms.set('u_shaftStrength', 0);
    }
    effect.uniforms.set('u_amount', Math.min(Math.max(state.amount, 0), 1) * (effect.uniforms.get('u_amount') ?? 1));
    effect.uniforms.set('u_cameraDepth', state.depth);
    effect.uniforms.set('u_planeNx', state.plane[0]);
    effect.uniforms.set('u_planeNy', state.plane[1]);
    effect.uniforms.set('u_planeNz', state.plane[2]);
    effect.uniforms.set('u_planeD', state.plane[3]);
    effect.uniforms.set('u_band', state.band);
}

/**
 * How far above a surface a camera may be and still have part of its lens under it: its near plane reaches this far ahead of it, and a camera looking down
 * puts the lower edge of that plane below it. Past this the whole lens is in the air.
 */
export function lensReach(nearPlane: number): number {
    return Math.max(nearPlane, 0) * 2.5;
}
