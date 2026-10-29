// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ShaderHandle } from '../render/material';
import { FOG_UNIFORMS, FOG_EXPLORED_TEXTURE, FOG_VISIBLE_TEXTURE } from './fogOfWarMask';
import { RAIN_SHELTER_UNIFORMS, RAIN_SHELTER_MASK_TEXTURE, RAIN_SHELTER_MASK_SIZE, RAIN_SHELTER_MASK_MIN, RAIN_SHELTER_MASK_MAX } from './rainShelterMask';
import { effectSourcesOf, computeSourceOf } from './effectSources';
import type { basicEffects } from './sources/basic';
import type { atmosphereEffects } from './sources/atmosphere';
import type { lightingEffects } from './sources/lighting';
import type { lensEffects as LensEffects } from './lensEffects';
import type { gtaoPasses as GtaoPasses } from './gtao';
import type { subsurfacePasses as SubsurfacePasses } from './subsurface';
import type { voxelGIFallback as VoxelGIFallback } from './voxelGIFallback';
import { VOXEL_ATLAS } from './voxelAtlas';

// The effect shaders are installed by group (see effectSources.ts). These read like the objects they stand for.
/** The factories of the built-in effects' shaders. Calling one needs the group that carries it installed. */
export const postProcessEffects = effectSourcesOf<typeof basicEffects & typeof atmosphereEffects & typeof lightingEffects>();
const lensEffects = effectSourcesOf<typeof LensEffects>();
const gtaoPasses = effectSourcesOf<typeof GtaoPasses>();
const subsurfacePasses = effectSourcesOf<typeof SubsurfacePasses>();
const voxelGIFallback = effectSourcesOf<typeof VoxelGIFallback>();

export interface EffectUniformDef {
    name: string;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    /**
     * The "effect does nothing" value a partial-weight volume blend fades toward.
     * 0 for additive/intensity params (default); 1 for MULTIPLICATIVE params
     * (contrast, saturation, zoom) — blending those from 0 crushes the image to
     * black / extreme distortion at a volume's soft edge.
     */
    neutralValue?: number;
    /** Set by the engine from another effect, not by a scene: an inspector does not list it. */
    internal?: boolean;
}

/** A texture parameter (LUT, mask): the sampler uniform it binds to. */
export interface EffectTextureDef {
    name: string;
    label: string;
    /** Set by the engine from another effect, not by a scene: an inspector does not list it. */
    internal?: boolean;
}

/** A colour parameter (fog colour): the vec4 uniform it feeds and its default. */
export interface EffectColorDef {
    name: string;
    label: string;
    defaultValue: { r: number; g: number; b: number; a: number };
}

export interface EffectSubPass {
    name: string;
    factory: () => ShaderHandle;
    /**
     * Fraction of the chain size this sub-pass draws at (default 1). The chain's
     * LAST pass always draws full size — it feeds the blit — so a fractional
     * effect ends on a pass that reads the small result and writes the big one.
     */
    scale?: number;
    /** Uniforms this pass always carries, whatever the volume says: constants of its design (the voxel atlas's size). */
    uniforms?: Record<string, number>;
}

/**
 * An effect that is a compute shader over the picture rather than a draw. The WGSL is handed, at group 0: `@binding(0)` the image
 * so far (`texture_2d<f32>`), `@binding(1)` the image it writes (`texture_storage_2d<rgba16float, write>`), `@binding(2)` a uniform
 * block of the effect's `uniforms` as f32s in the order they are listed, `@binding(3)` the size (`vec4f(w, h, 1/w, 1/h)`),
 * `@binding(4)` the scene's depth (`texture_depth_2d`) and `@binding(5)` a linear clamp sampler; it declares the ones it uses and
 * an entry point named `main`. Only a device with a compute stage (WebGPU) runs it: on WebGL2 the effect is left out.
 */
export interface ComputeEffectSource {
    source: string;
    /** The workgroup size the shader declares; it is dispatched over the whole picture in groups of this. Default 8 x 8. */
    workgroupSize?: [number, number];
}

/** What an effect is for, which is how an editor groups a list of thirty: the camera, the colour, the light, the air, the edges, a look. */
export type EffectCategory = 'lens' | 'color' | 'light' | 'atmosphere' | 'aa' | 'stylize';

export interface EffectDef {
    type: string;
    label: string;
    /** Set for every built-in effect, by the table at the end of this file. */
    category?: EffectCategory;
    /**
     * Set for an effect that is a stage of the chain's last pass and not a pass of its own ("displayLut"): it has no shader, and the volume's
     * values are handed to the stack for the last pass to read, which runs once and after the output transform.
     */
    stage?: 'output';
    /** What compiles the effect's draw shader. Absent for a compute effect (see {@link compute}) and an output stage. */
    factory?: () => ShaderHandle;
    /** Set instead of `factory` for an effect that runs as a compute shader. */
    compute?: ComputeEffectSource;
    /** Set instead of `factory` for an effect the engine implements itself, in compute passes of its own ("voxelGI"). */
    native?: string;
    /**
     * Passes that stand in for a `native` or `compute` effect on a device that cannot run it (a fragment version of a compute
     * one). They take every one of the effect's uniforms, as a multi-pass effect's passes do.
     */
    fallback?: EffectSubPass[];
    uniforms: EffectUniformDef[];
    /** Texture params, carried on the volume as serialized refs (`textures`). */
    textures?: EffectTextureDef[];
    /**
     * Textures the effect brings itself, by sampler uniform: made once per App from the pixels a source group installed and bound unless
     * the volume names one. For data an effect is meaningless without (AgX's table), not for a choice an author makes.
     */
    builtinTextures?: Record<string, () => { width: number; height: number; pixels: Uint8Array }>;
    /** Colour params, carried on the volume as `colors`. */
    colors?: EffectColorDef[];
    multiPass?: EffectSubPass[];
}

const effectRegistry = new Map<string, EffectDef>();

export function registerEffect(def: EffectDef): void {
    effectRegistry.set(def.type, def);
}

export function getEffectDef(type: string): EffectDef | undefined {
    return effectRegistry.get(type);
}

/**
 * The names of every pass an effect puts in the chain, in order: its sub-passes' for a multi-pass effect
 * (`ssao` is four, named `ssao_ao`, `ssao_blur_x` …; `autoExposure` is `ae_measure`, `ae_adapt`,
 * `ae_apply`), its own type otherwise. Empty for a type nobody registered. What a quality level that leaves an
 * effect out has to remove, and what no guess from the effect's name would find.
 */
export function effectPassNames(type: string): string[] {
    const wanted = type.toLowerCase();
    for (const def of effectRegistry.values()) {
        if (def.type.toLowerCase() !== wanted) continue;
        return def.multiPass ? def.multiPass.map((pass) => pass.name) : [def.type, ...(def.fallback?.map((pass) => pass.name) ?? [])];
    }
    return [];
}

export function getEffectTypes(): string[] {
    return Array.from(effectRegistry.keys());
}

export function getAllEffectDefs(): EffectDef[] {
    return Array.from(effectRegistry.values());
}

registerEffect({
    type: 'blur',
    label: 'Blur',
    factory: () => postProcessEffects.createBlur(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 20, step: 0.1, defaultValue: 2 },
    ],
});

registerEffect({
    type: 'bloom',
    label: 'Bloom',
    factory: () => postProcessEffects.createBloomExtract(),
    uniforms: [
        // Threshold reaches past 1: under the linear pipeline's HDR intermediates
        // only over-range energy (bright lights) blooms, leaving LDR art crisp.
        { name: 'u_threshold', label: 'Threshold', min: 0, max: 2, step: 0.01, defaultValue: 0.4 },
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 5, step: 0.1, defaultValue: 1.5 },
        { name: 'u_radius', label: 'Radius', min: 0.5, max: 5, step: 0.1, defaultValue: 1 },
    ],
    multiPass: [
        { name: 'bloom_extract', factory: () => postProcessEffects.createBloomExtract() },
        { name: 'bloom_kawase_0', factory: () => postProcessEffects.createBloomKawase(0) },
        { name: 'bloom_kawase_1', factory: () => postProcessEffects.createBloomKawase(1) },
        { name: 'bloom_kawase_2', factory: () => postProcessEffects.createBloomKawase(2) },
        { name: 'bloom_kawase_3', factory: () => postProcessEffects.createBloomKawase(3) },
        { name: 'bloom_kawase_4', factory: () => postProcessEffects.createBloomKawase(4) },
        { name: 'bloom_composite', factory: () => postProcessEffects.createBloomComposite() },
    ],
});

registerEffect({
    type: 'vignette',
    label: 'Vignette',
    factory: () => postProcessEffects.createVignette(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 0.6 },
        { name: 'u_softness', label: 'Softness', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
    ],
});

registerEffect({
    type: 'grayscale',
    label: 'Grayscale',
    factory: () => postProcessEffects.createGrayscale(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 1 },
    ],
});

registerEffect({
    type: 'colorGrade',
    label: 'Color Grade',
    factory: () => postProcessEffects.createColorGrade(),
    uniforms: [
        { name: 'u_exposure', label: 'Exposure', min: -3, max: 3, step: 0.05, defaultValue: 0 },
        { name: 'u_contrast', label: 'Contrast', min: 0, max: 2, step: 0.01, defaultValue: 1, neutralValue: 1 },
        { name: 'u_saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, defaultValue: 1, neutralValue: 1 },
        { name: 'u_temperature', label: 'Temperature', min: -1, max: 1, step: 0.01, defaultValue: 0 },
        { name: 'u_tint', label: 'Tint', min: -1, max: 1, step: 0.01, defaultValue: 0 },
    ],
});

registerEffect({
    type: 'chromaticAberration',
    label: 'Chromatic Aberration',
    factory: () => postProcessEffects.createChromaticAberration(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 20, step: 0.1, defaultValue: 3 },
    ],
});

registerEffect({
    type: 'tonemap',
    label: 'Tonemap (ACES)',
    factory: () => postProcessEffects.createTonemap(),
    uniforms: [
        { name: 'u_exposure', label: 'Exposure', min: -3, max: 3, step: 0.05, defaultValue: 0 },
    ],
});

registerEffect({
    type: 'fxaa',
    label: 'FXAA',
    factory: () => postProcessEffects.createFxaa(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 1 },
    ],
});

registerEffect({
    type: 'lensDistortion',
    label: 'Lens Distortion',
    factory: () => postProcessEffects.createLensDistortion(),
    uniforms: [
        { name: 'u_strength', label: 'Strength', min: -1, max: 1, step: 0.01, defaultValue: 0 },
        { name: 'u_zoom', label: 'Zoom', min: 0.5, max: 2, step: 0.01, defaultValue: 1, neutralValue: 1 },
    ],
});

registerEffect({
    type: 'pixelate',
    label: 'Pixelate',
    factory: () => postProcessEffects.createPixelate(),
    uniforms: [
        { name: 'u_pixelSize', label: 'Pixel Size', min: 1, max: 64, step: 1, defaultValue: 4 },
    ],
});

registerEffect({
    type: 'outline',
    label: 'Outline',
    factory: () => postProcessEffects.createOutline(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 1 },
        { name: 'u_threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, defaultValue: 0.2 },
        { name: 'u_thickness', label: 'Thickness', min: 0.5, max: 4, step: 0.5, defaultValue: 1 },
    ],
});

registerEffect({
    type: 'depthOutline',
    label: 'Depth Outline',
    factory: () => postProcessEffects.createDepthOutline(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 1 },
        { name: 'u_threshold', label: 'Threshold', min: 0.0005, max: 0.2, step: 0.0005, defaultValue: 0.01 },
        { name: 'u_thickness', label: 'Thickness', min: 1, max: 4, step: 1, defaultValue: 1 },
    ],
});

registerEffect({
    type: 'edgeOutline',
    label: 'Edge Outline',
    factory: () => postProcessEffects.createEdgeOutline(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 1 },
        // A silhouette: how far a neighbour is behind this pixel, as a share of its own depth.
        { name: 'u_depthThreshold', label: 'Depth Threshold', min: 0.0005, max: 0.2, step: 0.0005, defaultValue: 0.01 },
        // A crease: how far the two surfaces face apart (0 the same way, 1 at a right angle, 2 opposite).
        { name: 'u_normalThreshold', label: 'Crease Threshold', min: 0.02, max: 1.5, step: 0.01, defaultValue: 0.4 },
        { name: 'u_thickness', label: 'Thickness', min: 1, max: 4, step: 1, defaultValue: 1 },
    ],
    colors: [
        { name: 'u_lineColor', label: 'Line Colour', defaultValue: { r: 0, g: 0, b: 0, a: 1 } },
    ],
});

registerEffect({
    type: 'mist2d',
    label: 'Mist 2D',
    factory: () => postProcessEffects.createMist2d(),
    uniforms: [
        // How thick the mist is where it is thickest.
        { name: 'u_density', label: 'Density', min: 0, max: 1, step: 0.01, defaultValue: 0.55, neutralValue: 0 },
        // How much of the ground it covers: 0 is none, 1 nearly all.
        { name: 'u_coverage', label: 'Coverage', min: 0, max: 1, step: 0.01, defaultValue: 0.6 },
        // WORLD lengths: the size of the banks, how fast they drift, and which way (degrees from +X).
        { name: 'u_scale', label: 'Scale', min: 40, max: 4000, step: 10, defaultValue: 520 },
        { name: 'u_speed', label: 'Speed', min: 0, max: 400, step: 1, defaultValue: 18 },
        { name: 'u_direction', label: 'Direction', min: 0, max: 360, step: 1, defaultValue: 25 },
        // How much of what is lit scatters in the mist: a lamp glows in it.
        { name: 'u_glow', label: 'Glow', min: 0, max: 2, step: 0.01, defaultValue: 0.6 },
    ],
    colors: [
        { name: 'u_fogColor', label: 'Colour', defaultValue: { r: 0.62, g: 0.72, b: 0.76, a: 1 } },
    ],
});

registerEffect({
    type: 'rain2d',
    label: 'Rain 2D',
    factory: () => postProcessEffects.createRain2d(),
    uniforms: [
        // How much rain falls: how many of the streaks a layer could hold are there.
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 2, step: 0.01, defaultValue: 1, neutralValue: 0 },
        // How wet the ground is: how far it darkens and how clearly the rings read.
        { name: 'u_wetness', label: 'Wetness', min: 0, max: 1, step: 0.01, defaultValue: 1, neutralValue: 0 },
        // How much of the ground is standing water, and how big the pools are (a WORLD length).
        { name: 'u_puddles', label: 'Puddles', min: 0, max: 1, step: 0.01, defaultValue: 0.4, neutralValue: 0 },
        { name: 'u_puddleScale', label: 'Puddle Size', min: 20, max: 4000, step: 10, defaultValue: 220 },
        // A WORLD length: the size of the grid cell each ring lives in.
        { name: 'u_rippleScale', label: 'Ripple Scale', min: 6, max: 400, step: 1, defaultValue: 36 },
        { name: 'u_wind', label: 'Wind', min: -1, max: 1, step: 0.01, defaultValue: 0.15 },
        { name: 'u_speed', label: 'Speed', min: 0.2, max: 6, step: 0.1, defaultValue: 1.6 },
        { name: 'u_streakLength', label: 'Streak Length', min: 0.05, max: 0.9, step: 0.01, defaultValue: 0.3 },
        // How many texels a side the shelter mask is: the picture of where the rain is dry is painted this big every frame, so a bigger mask has finer
        // edges and costs more, and a quality level can hold it lower.
        { name: 'u_maskSize', label: 'Shelter Mask Size', min: RAIN_SHELTER_MASK_MIN, max: RAIN_SHELTER_MASK_MAX, step: 64, defaultValue: RAIN_SHELTER_MASK_SIZE },
        // Where the mask sits in the world, written each frame by the rain-shelter system with the mask itself.
        ...RAIN_SHELTER_UNIFORMS,
    ],
    textures: [
        { name: RAIN_SHELTER_MASK_TEXTURE, label: 'Shelter Mask', internal: true },
    ],
    colors: [
        { name: 'u_streakColor', label: 'Streak Colour', defaultValue: { r: 0.78, g: 0.82, b: 0.9, a: 1 } },
    ],
});

registerEffect({
    type: 'fog2d',
    label: 'Fog of War 2D',
    factory: () => postProcessEffects.createFog2d(),
    uniforms: [
        // How bright ground that has been seen and left is, and how much of its colour goes.
        { name: 'u_forgetLight', label: 'Remembered Brightness', min: 0, max: 1, step: 0.01, defaultValue: 0.4 },
        { name: 'u_forgetDesat', label: 'Remembered Desaturation', min: 0, max: 1, step: 0.01, defaultValue: 0.7 },
        // Where the maps sit in the world, written each frame by the fog-of-war system with the maps themselves.
        ...FOG_UNIFORMS,
    ],
    textures: [
        { name: FOG_EXPLORED_TEXTURE, label: 'Explored Map', internal: true },
        { name: FOG_VISIBLE_TEXTURE, label: 'Visible Map', internal: true },
    ],
    colors: [
        { name: 'u_unexploredColor', label: 'Unexplored Colour', defaultValue: { r: 0, g: 0, b: 0, a: 1 } },
    ],
});

registerEffect({
    type: 'distanceFog',
    label: 'Distance Fog',
    factory: () => postProcessEffects.createDistanceFog(),
    uniforms: [
        { name: 'u_fogNear', label: 'Near', min: 0, max: 500, step: 0.5, defaultValue: 10 },
        { name: 'u_fogFar', label: 'Far', min: 0, max: 500, step: 0.5, defaultValue: 60 },
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 1 },
    ],
    // The default is the shader's own `#pragma param u_fogColor` default, so a
    // volume that never names the colour fogs exactly as it always did.
    colors: [
        { name: 'u_fogColor', label: 'Colour', defaultValue: { r: 0.6, g: 0.68, b: 0.78, a: 1 } },
    ],
});

registerEffect({
    type: 'skyAtmosphere',
    label: 'Sky Atmosphere',
    factory: () => postProcessEffects.createSkyClouds(),
    // The clouds (and the shadow they cast on the ground) are smooth and dear, so they are worked out at half size and the composite
    // reads them back by the way a pixel's neighbours agree with it; the dome, sun, moon and stars, which have an edge, stay full size.
    // Not smaller: at a quarter the march's per-pixel jitter grain is four pixels coarse, a checkerboard in the cloud and vertical streaks
    // near the horizon, which a mean pixel difference against half size (0.04 of 255) did not show and the picture does.
    multiPass: [
        { name: 'sky_clouds', factory: () => postProcessEffects.createSkyClouds(), scale: 0.5 },
        { name: 'sky_composite', factory: () => postProcessEffects.createSkyAtmosphere() },
    ],
    uniforms: [
        // On a planet the sky is of the ground the camera stands on: the radius, above 0, turns that on, and the centre is where the planet stands.
        { name: 'u_planetRadius', label: 'Planet Radius', min: 0, max: 100000000, step: 100, defaultValue: 0, neutralValue: 0 },
        { name: 'u_planetX', label: 'Planet Centre X', min: -100000000, max: 100000000, step: 100, defaultValue: 0 },
        { name: 'u_planetY', label: 'Planet Centre Y', min: -100000000, max: 100000000, step: 100, defaultValue: 0 },
        { name: 'u_planetZ', label: 'Planet Centre Z', min: -100000000, max: 100000000, step: 100, defaultValue: 0 },
        // How bright the sky is.
        { name: 'u_intensity', label: 'Brightness', min: 0, max: 8, step: 0.01, defaultValue: 1 },
        // How much of the sky behind the scene (a panorama, a clear colour) is kept: 0 replaces it, 1 leaves it.
        { name: 'u_panorama', label: 'Keep Background', min: 0, max: 1, step: 0.01, defaultValue: 0, neutralValue: 1 },
        // 0 is the weather's to say not at all; 1 a sky with no break in it. A Weather component drives it.
        { name: 'u_overcast', label: 'Overcast', min: 0, max: 1, step: 0.01, defaultValue: 0 },
        // How much haze (Mie scattering) the air holds: more is a whiter, glarier sky and a redder sunset.
        { name: 'u_haze', label: 'Haze', min: 0, max: 8, step: 0.05, defaultValue: 1 },
        // The camera's height above the ground the sky is seen from, in kilometres.
        { name: 'u_altitude', label: 'Altitude', min: 0, max: 20, step: 0.1, defaultValue: 0.1 },
        { name: 'u_sunSize', label: 'Sun Size', min: 0.2, max: 8, step: 0.1, defaultValue: 1 },
        { name: 'u_sunBrightness', label: 'Sun Brightness', min: 0, max: 400, step: 1, defaultValue: 40 },
        { name: 'u_moon', label: 'Moon', min: 0, max: 4, step: 0.05, defaultValue: 1 },
        { name: 'u_stars', label: 'Stars', min: 0, max: 4, step: 0.05, defaultValue: 1 },
        // How much of the sky the clouds cover, 0 to 1. A weather raises it.
        { name: 'u_clouds', label: 'Cloud Coverage', min: 0, max: 1, step: 0.01, defaultValue: 0.45, neutralValue: 0 },
        // Where the cloud layer starts and how deep it is, in kilometres above the ground.
        { name: 'u_cloudBase', label: 'Cloud Base', min: 0.2, max: 10, step: 0.1, defaultValue: 1.5 },
        { name: 'u_cloudThickness', label: 'Cloud Thickness', min: 0.2, max: 8, step: 0.1, defaultValue: 2.5 },
        { name: 'u_cloudBrightness', label: 'Cloud Brightness', min: 0, max: 4, step: 0.05, defaultValue: 1 },
        // How fast the clouds drift (kilometres a second) and which way (degrees from +Z toward +X).
        { name: 'u_windSpeed', label: 'Wind Speed', min: 0, max: 2, step: 0.01, defaultValue: 0.05 },
        { name: 'u_windDirection', label: 'Wind Direction', min: 0, max: 360, step: 1, defaultValue: 60 },
        // 1: the sun is the scene's directional light. 0: the two angles are. A TimeOfDay component writes them.
        { name: 'u_followSun', label: 'Follow Scene Sun', min: 0, max: 1, step: 1, defaultValue: 1, neutralValue: 1 },
        { name: 'u_sunAzimuth', label: 'Sun Azimuth', min: 0, max: 360, step: 1, defaultValue: 40 },
        { name: 'u_sunElevation', label: 'Sun Elevation', min: -90, max: 90, step: 1, defaultValue: 35 },
        // How much of the sun the clouds keep off the scene's surfaces. Above 0 the clouds are fixed to the world, not carried along with the camera.
        { name: 'u_cloudShadow', label: 'Cloud Shadows', min: 0, max: 1, step: 0.01, defaultValue: 0, neutralValue: 0 },
        // How many world units are a kilometre: the sky is in kilometres, the scene in its own units.
        { name: 'u_unitsPerKm', label: 'World Units per km', min: 1, max: 100000, step: 1, defaultValue: 1000 },
        // With a Cloud Mask, how many kilometres of the cloud layer one repeat of it covers (0 leaves the clouds to the noise): the mask gives the clouds
        // their shape, the noise only erodes it. The second mask is a softer, higher layer folded in at a third.
        { name: 'u_cloudMaskTile', label: 'Cloud Mask Tile (km)', min: 0, max: 100, step: 0.1, defaultValue: 0 },
        { name: 'u_cloudMask2Tile', label: 'Cloud Mask 2 Tile (km)', min: 0, max: 100, step: 0.1, defaultValue: 0 },
    ],
    textures: [
        { name: 'u_cloudMask', label: 'Cloud Mask (tileable coverage, linear, repeat)' },
        { name: 'u_cloudMask2', label: 'Cloud Mask 2 (a softer, higher layer)' },
    ],
});

// Diffuse global illumination from a world-space voxel cache the frame seeds and the camera remembers: light a surface
// that has left the screen still gives is kept. Compute passes the engine declares itself, so WebGPU only; on WebGL2
// the picture goes through as it was (use Screen Space GI there).
registerEffect({
    type: 'voxelGI',
    label: 'Voxel GI',
    native: 'voxelGI',
    // WebGL2 has no compute: the same cache built by fragment passes, at a fixed half-size gather.
    fallback: [
        { name: 'gi_voxels', factory: () => voxelGIFallback.createVoxels(), uniforms: { u_feedbackWidth: VOXEL_ATLAS.width, u_feedbackHeight: VOXEL_ATLAS.height } },
        { name: 'gi_gather', factory: () => voxelGIFallback.createGather(), scale: 0.5 },
        { name: 'gi_apply', factory: () => voxelGIFallback.createApply() },
    ],
    uniforms: [
        // How much of the gathered light is added over the picture.
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 4, step: 0.01, defaultValue: 1, neutralValue: 0 },
        // Rays per surface point: more is smoother and costs in proportion.
        { name: 'u_rays', label: 'Rays', min: 1, max: 32, step: 1, defaultValue: 8 },
        // The world size of a voxel: the cache is 128 x 64 x 128 of them around the camera, so this sets how far it reaches and how finely.
        { name: 'u_voxelSize', label: 'Voxel Size', min: 0.01, max: 400, step: 0.01, defaultValue: 40 },
        // How far a ray looks, in voxels.
        { name: 'u_range', label: 'Range', min: 4, max: 90, step: 1, defaultValue: 48 },
        // Brighter than this a surface does not give out, so one lamp does not light the street from a single pixel.
        { name: 'u_maxBounce', label: 'Max Bounce', min: 0.5, max: 16, step: 0.5, defaultValue: 3 },
        // What the cache keeps each frame of what it held: lower forgets sooner (a moving light follows faster), higher is steadier.
        { name: 'u_decay', label: 'Memory', min: 0, max: 0.99, step: 0.01, defaultValue: 0.93 },
        // How far off its own voxel a ray starts, in voxels, so a surface is not lit by itself.
        { name: 'u_bias', label: 'Start Bias', min: 0, max: 4, step: 0.1, defaultValue: 1.2 },
        // The gather runs at 1 / this of the picture's size along each axis.
        { name: 'u_divisor', label: 'Resolution Divisor', min: 1, max: 4, step: 1, defaultValue: 2 },
        // How much of each frame's gather goes into the picture; lower is smoother and slower to follow a change.
        { name: 'u_blend', label: 'Temporal Blend', min: 0.02, max: 1, step: 0.01, defaultValue: 0.2 },
        // 1 shows the gathered light alone.
        { name: 'u_debug', label: 'Show GI Only', min: 0, max: 1, step: 1, defaultValue: 0 },
    ],
});

// A compute effect on a device with a compute stage (WebGPU); a fragment pass of the same arithmetic stands in for it on one without (WebGL2).
registerEffect({
    type: 'sharpen',
    label: 'Sharpen',
    compute: { get source() { return computeSourceOf('sharpen'); } },
    fallback: [{ name: 'sharpen_fs', factory: () => postProcessEffects.createSharpen() }],
    uniforms: [
        // How hard a pixel is pushed away from the mean of its neighbours. 0 leaves the picture alone.
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 2, step: 0.01, defaultValue: 0.5, neutralValue: 0 },
        // How far past the range of its neighbours a pixel may be pushed, as a share of that range: 0 cannot overshoot at all.
        { name: 'u_limit', label: 'Overshoot Limit', min: 0, max: 1, step: 0.01, defaultValue: 0.25 },
    ],
});

registerEffect({
    type: 'heightFog',
    label: 'Height Fog',
    factory: () => postProcessEffects.createHeightFogVolume(),
    // The sun's light through the haze (the shadow map, the clouds' shafts) is the dear part and smooth: it is walked at half size and
    // read back by how near each texel's ray is to the pixel's. The haze itself is analytic and stays full size.
    multiPass: [
        { name: 'fog_volume', factory: () => postProcessEffects.createHeightFogVolume(), scale: 0.5 },
        { name: 'fog_composite', factory: () => postProcessEffects.createHeightFog() },
    ],
    uniforms: [
        // Per WORLD unit at the base height: the share of light a unit of fog takes out.
        { name: 'u_density', label: 'Density', min: 0, max: 0.05, step: 0.0001, defaultValue: 0.0015, neutralValue: 0 },
        // How fast the fog thins with height; 0 is a fog of one density at every height.
        { name: 'u_heightFalloff', label: 'Height Falloff', min: 0, max: 0.1, step: 0.0005, defaultValue: 0.003 },
        { name: 'u_baseHeight', label: 'Base Height', min: -1000, max: 5000, step: 10, defaultValue: 0 },
        // On a planet the fog's height is the height above the ground's sphere, not world Y: the radius, above 0, turns that on, and the centre is where the planet stands.
        { name: 'u_planetRadius', label: 'Planet Radius', min: 0, max: 100000000, step: 100, defaultValue: 0, neutralValue: 0 },
        { name: 'u_planetX', label: 'Planet Centre X', min: -100000000, max: 100000000, step: 100, defaultValue: 0 },
        { name: 'u_planetY', label: 'Planet Centre Y', min: -100000000, max: 100000000, step: 100, defaultValue: 0 },
        { name: 'u_planetZ', label: 'Planet Centre Z', min: -100000000, max: 100000000, step: 100, defaultValue: 0 },
        { name: 'u_startDistance', label: 'Start Distance', min: 0, max: 3000, step: 10, defaultValue: 0 },
        { name: 'u_maxOpacity', label: 'Max Opacity', min: 0, max: 1, step: 0.01, defaultValue: 1 },
        // 1: the sun is the scene's own directional light — its direction and colour — and the two angles below are
        // only what a scene with no sun falls back to. 0: the angles are the sun.
        { name: 'u_followSun', label: 'Follow Scene Sun', min: 0, max: 1, step: 1, defaultValue: 1, neutralValue: 1 },
        // Where the sun is when it is not followed, to colour the haze toward it: degrees from +Z toward +X, and above the horizon.
        { name: 'u_sunAzimuth', label: 'Sun Azimuth', min: 0, max: 360, step: 1, defaultValue: 40 },
        { name: 'u_sunElevation', label: 'Sun Elevation', min: -90, max: 90, step: 1, defaultValue: 25 },
        { name: 'u_inscatter', label: 'Sun Glow', min: 0, max: 2, step: 0.01, defaultValue: 0.6, neutralValue: 0 },
        { name: 'u_sunExponent', label: 'Glow Sharpness', min: 1, max: 64, step: 1, defaultValue: 8 },
        // How much of the sky takes the horizon haze; 0 leaves the sky untouched.
        { name: 'u_skyFog', label: 'Sky Haze', min: 0, max: 1, step: 0.01, defaultValue: 0.8, neutralValue: 0 },
        // How much of the sun's light through the haze comes from walking the air against the shadow map, so a
        // building's shadow is dark fog and the gap between two of them a beam. 0 is the glow alone; it needs a
        // directional light that casts a shadow, and costs 24 taps a pixel.
        { name: 'u_volumetric', label: 'Volumetric Light', min: 0, max: 1, step: 0.01, defaultValue: 0, neutralValue: 0 },
        // How far from the camera the air is walked: past it the fog still dims, but takes no shafts.
        { name: 'u_volumeRange', label: 'Volumetric Range', min: 100, max: 1000000, step: 100, defaultValue: 3000 },
        // How much the sky's clouds cut the beams: a gap in them is a shaft, and what they cover is dark air. It follows the clouds
        // of a skyAtmosphere that has Cloud Shadows above 0 (the clouds are then fixed to the world, so the shafts stand where they do).
        { name: 'u_cloudShade', label: 'Cloud Shafts', min: 0, max: 1, step: 0.01, defaultValue: 0, neutralValue: 0 },
        // What it reads of that sky, written each frame from the sky effect (see applyCloudsToFog).
        { name: 'u_skyCover', label: 'Sky Cover', min: 0, max: 1, step: 0.01, defaultValue: 0, internal: true },
        { name: 'u_skyBase', label: 'Sky Cloud Base', min: 0.2, max: 10, step: 0.1, defaultValue: 1.5, internal: true },
        { name: 'u_skyThickness', label: 'Sky Cloud Thickness', min: 0.2, max: 8, step: 0.1, defaultValue: 2.5, internal: true },
        { name: 'u_skyAltitude', label: 'Sky Altitude', min: 0, max: 20, step: 0.1, defaultValue: 0.1, internal: true },
        { name: 'u_skyUnits', label: 'Sky Units per km', min: 1, max: 100000, step: 1, defaultValue: 1000, internal: true },
        { name: 'u_skySigma', label: 'Sky Cloud Density', min: 0, max: 10, step: 0.1, defaultValue: 1.3, internal: true },
        { name: 'u_skyWindX', label: 'Sky Wind X', min: -2, max: 2, step: 0.01, defaultValue: 0, internal: true },
        { name: 'u_skyWindZ', label: 'Sky Wind Z', min: -2, max: 2, step: 0.01, defaultValue: 0, internal: true },
        { name: 'u_cloudMaskTile', label: 'Sky Cloud Mask Tile', min: 0, max: 100, step: 0.1, defaultValue: 0, internal: true },
        { name: 'u_cloudMask2Tile', label: 'Sky Cloud Mask 2 Tile', min: 0, max: 100, step: 0.1, defaultValue: 0, internal: true },
    ],
    textures: [
        { name: 'u_cloudMask', label: 'Sky Cloud Mask', internal: true },
        { name: 'u_cloudMask2', label: 'Sky Cloud Mask 2', internal: true },
    ],
    colors: [
        { name: 'u_fogColor', label: 'Colour', defaultValue: { r: 0.62, g: 0.7, b: 0.8, a: 1 } },
        { name: 'u_sunColor', label: 'Sun Colour', defaultValue: { r: 1, g: 0.82, b: 0.55, a: 1 } },
    ],
});

registerEffect({
    type: 'ssgi',
    label: 'Screen Space GI',
    factory: () => postProcessEffects.createSsgiApply(),
    uniforms: [
        // How much of the bounced light is added: 1 is what the surfaces gave out, scaled by the receiver's colour.
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 4, step: 0.01, defaultValue: 1, neutralValue: 0 },
        // A WORLD length: how far from a surface the rays look for something to bounce light from.
        { name: 'u_radius', label: 'Radius', min: 0.05, max: 1500, step: 0.05, defaultValue: 150 },
        // A WORLD length: how thick a thing the rays can land on, so a far wall is not taken for the one beside it.
        { name: 'u_thickness', label: 'Thickness', min: 0.01, max: 300, step: 0.01, defaultValue: 30 },
        // Brighter than this a surface does not bounce, so one lamp does not light the street from a single pixel.
        { name: 'u_maxBounce', label: 'Max Bounce', min: 0.5, max: 16, step: 0.5, defaultValue: 3 },
    ],
    // What each surface receives, at half size and in a float; then the neighbours on the same surface averaged and added.
    multiPass: [
        { name: 'ssgi_gather', factory: () => postProcessEffects.createSsgiGather(), scale: 0.5 },
        { name: 'ssgi_apply', factory: () => postProcessEffects.createSsgiApply() },
    ],
});

registerEffect({
    type: 'contactShadows',
    label: 'Contact Shadows',
    factory: () => postProcessEffects.createContactShadows(),
    uniforms: [
        // How dark a contact shadow is.
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 0.6, neutralValue: 0 },
        // A WORLD length: how far from a surface the ray looks for something standing in the light's way.
        { name: 'u_length', label: 'Length', min: 5, max: 600, step: 1, defaultValue: 60 },
        // A WORLD length: how thick a thing can be and still shadow, so a far wall does not shadow what is in front of it.
        { name: 'u_thickness', label: 'Thickness', min: 0.5, max: 80, step: 0.5, defaultValue: 8 },
        { name: 'u_followSun', label: 'Follow Scene Sun', min: 0, max: 1, step: 1, defaultValue: 1, neutralValue: 1 },
        { name: 'u_sunAzimuth', label: 'Sun Azimuth', min: 0, max: 360, step: 1, defaultValue: 40 },
        { name: 'u_sunElevation', label: 'Sun Elevation', min: -90, max: 90, step: 1, defaultValue: 35 },
    ],
});

registerEffect({
    type: 'lightShafts',
    label: 'Light Shafts',
    factory: () => postProcessEffects.createLightShafts(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 3, step: 0.01, defaultValue: 0.6, neutralValue: 0 },
        { name: 'u_followSun', label: 'Follow Scene Sun', min: 0, max: 1, step: 1, defaultValue: 1, neutralValue: 1 },
        { name: 'u_sunAzimuth', label: 'Sun Azimuth', min: 0, max: 360, step: 1, defaultValue: 40 },
        { name: 'u_sunElevation', label: 'Sun Elevation', min: -90, max: 90, step: 1, defaultValue: 25 },
        // Per step of the march: lower fades the shafts sooner along their length.
        { name: 'u_decay', label: 'Decay', min: 0.8, max: 1, step: 0.005, defaultValue: 0.96 },
        // How much of the way to the sun each pixel looks: shorter shafts at lower values.
        { name: 'u_reach', label: 'Reach', min: 0.1, max: 1, step: 0.01, defaultValue: 0.6 },
    ],
    colors: [
        { name: 'u_sunColor', label: 'Sun Colour', defaultValue: { r: 1, g: 0.85, b: 0.6, a: 1 } },
    ],
});

registerEffect({
    type: 'autoExposure',
    label: 'Auto Exposure',
    factory: () => postProcessEffects.createAutoExposureApply(),
    uniforms: [
        // Stops added to the exposure the measurement chose: the look of a scene that should be
        // darker or brighter than middle grey.
        { name: 'u_bias', label: 'Compensation (EV)', min: -4, max: 4, step: 0.1, defaultValue: 0, neutralValue: 0 },
        // Stops per second's worth of rate, in each direction: an eye adapts to light faster than to dark.
        { name: 'u_speedUp', label: 'Brighten Speed', min: 0.1, max: 20, step: 0.1, defaultValue: 3 },
        { name: 'u_speedDown', label: 'Darken Speed', min: 0.1, max: 20, step: 0.1, defaultValue: 1 },
        { name: 'u_minEV', label: 'Min EV', min: -10, max: 0, step: 0.5, defaultValue: -4 },
        { name: 'u_maxEV', label: 'Max EV', min: 0, max: 10, step: 0.5, defaultValue: 4 },
        // Where the picture is measured: 0 the whole of it, 1 weighted toward the middle (a soft falloff), 2 a disc at the
        // middle and nothing else — a bright window behind a dark face stops deciding the exposure of the face.
        { name: 'u_metering', label: 'Metering (0 avg, 1 centre, 2 spot)', min: 0, max: 2, step: 1, defaultValue: 0 },
        // How far the centre-weighted falloff, or the spot, reaches: a share of the picture's height... of its width from the centre.
        { name: 'u_meterSize', label: 'Meter Size', min: 0.02, max: 1, step: 0.01, defaultValue: 0.35 },
    ],
    // A few texels measure the picture, one pass keeps the settled exposure from frame to frame,
    // and the last applies it. The first two are small; the engine keeps the second's output.
    multiPass: [
        { name: 'ae_measure', factory: () => postProcessEffects.createAutoExposureMeasure(), scale: 0.0625 },
        { name: 'ae_adapt', factory: () => postProcessEffects.createAutoExposureAdapt(), scale: 0.01 },
        { name: 'ae_apply', factory: () => postProcessEffects.createAutoExposureApply() },
    ],
});

registerEffect({
    type: 'depthOfField',
    label: 'Depth of Field',
    factory: () => postProcessEffects.createDofGather(),
    uniforms: [
        // A WORLD length from the camera to what is in focus (what the lens rests on when Auto Focus is off).
        { name: 'u_focusDistance', label: 'Focus Distance', min: 1, max: 5000, step: 1, defaultValue: 600 },
        // 1: the lens focuses on the surface under the focus point, and glides there at Focus Speed.
        { name: 'u_autoFocus', label: 'Auto Focus', min: 0, max: 1, step: 1, defaultValue: 0, neutralValue: 0 },
        // Where on the screen the auto-focus looks, as a share of its width from the left and of its height from the top.
        { name: 'u_focusX', label: 'Focus Point X', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
        { name: 'u_focusY', label: 'Focus Point Y', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
        { name: 'u_focusSpeed', label: 'Focus Speed', min: 0.1, max: 40, step: 0.1, defaultValue: 5 },
        // How deep a slab around it stays sharp, before the blur starts.
        { name: 'u_focusRange', label: 'Focus Range', min: 0, max: 2000, step: 1, defaultValue: 100 },
        // The blur, in pixels, of something infinitely far: a bigger lens blurs sooner and harder.
        { name: 'u_aperture', label: 'Aperture (px)', min: 0, max: 64, step: 0.5, defaultValue: 24, neutralValue: 0 },
        { name: 'u_maxBlur', label: 'Max Blur (px)', min: 1, max: 32, step: 0.5, defaultValue: 14 },
        // The shape of the aperture: 0 a circle, 3 or more the number of blades of a polygon.
        { name: 'u_blades', label: 'Aperture Blades (0 = round)', min: 0, max: 9, step: 1, defaultValue: 0 },
        { name: 'u_bokehRotation', label: 'Blade Rotation', min: 0, max: 360, step: 1, defaultValue: 0 },
        // How much more a bright point counts in the blur: a lamp out of focus is a bright shape, not a smear.
        { name: 'u_highlight', label: 'Highlight Boost', min: 0, max: 8, step: 0.1, defaultValue: 0 },
    ],
    // Where the lens is focused, how blurred each pixel is, and the blur: the first is a few texels and the
    // engine keeps it from frame to frame, so an auto-focus glides.
    multiPass: [
        { name: 'dof_focus', factory: () => postProcessEffects.createDofFocus(), scale: 0.01 },
        { name: 'dof_coc', factory: () => postProcessEffects.createDofCoc() },
        { name: 'dof_gather', factory: () => postProcessEffects.createDofGather() },
    ],
});

registerEffect({
    type: 'rain',
    label: 'Rain',
    factory: () => postProcessEffects.createRain(),
    uniforms: [
        // How much rain falls: how many of the streaks that a layer could hold are there.
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 2, step: 0.01, defaultValue: 1, neutralValue: 0 },
        // How wet the ground is: how far it darkens and how clearly the rings read.
        { name: 'u_wetness', label: 'Wetness', min: 0, max: 1, step: 0.01, defaultValue: 1, neutralValue: 0 },
        // The slant of the fall, and how fast it falls.
        { name: 'u_wind', label: 'Wind', min: -1, max: 1, step: 0.01, defaultValue: 0.15 },
        { name: 'u_speed', label: 'Speed', min: 0.2, max: 6, step: 0.1, defaultValue: 1.6 },
        { name: 'u_streakLength', label: 'Streak Length', min: 0.05, max: 0.9, step: 0.01, defaultValue: 0.3 },
        // A WORLD length: the size of the grid cell each ring lives in.
        { name: 'u_rippleScale', label: 'Ripple Scale', min: 5, max: 400, step: 1, defaultValue: 60 },
        // How far from the camera, in world units, the map of what stands over each place reaches: ground under an awning
        // inside it stays dry. The map is the scene drawn from straight above, so this is also how much of it costs.
        { name: 'u_shelterRange', label: 'Shelter Range', min: 100, max: 30000, step: 100, defaultValue: 3000 },
        // How much of the flat ground is standing water, and how big the pools are (a WORLD length).
        // The reflections effect draws the same pools when it is given the same two numbers.
        { name: 'u_puddles', label: 'Puddles', min: 0, max: 1, step: 0.01, defaultValue: 0.3, neutralValue: 0 },
        { name: 'u_puddleScale', label: 'Puddle Size', min: 40, max: 2000, step: 10, defaultValue: 350 },
    ],
    colors: [
        { name: 'u_streakColor', label: 'Streak Colour', defaultValue: { r: 0.78, g: 0.82, b: 0.9, a: 1 } },
    ],
});

registerEffect({
    type: 'ssao',
    label: 'Ambient Occlusion',
    factory: () => postProcessEffects.createSsaoAo(),
    // Four knobs, each a term in the estimator. Sample count, spiral turns and
    // the blur's slope limit stay constants in the shader: a number nobody can
    // set right is not a setting, it is a way to break the effect.
    uniforms: [
        // A WORLD length: positions come back in world space, so this is "how far
        // around a point counts as its neighbourhood", not a pixel count.
        { name: 'u_radius', label: 'Radius', min: 0.01, max: 400, step: 0.01, defaultValue: 60 },
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 2, step: 0.01, defaultValue: 1 },
        // How far above the tangent plane a sample must sit to count. This is
        // what keeps a flat floor from occluding itself into grey.
        { name: 'u_bias', label: 'Bias', min: 0, max: 0.6, step: 0.005, defaultValue: 0.12 },
        // Contrast on the finished term; neutral at 1, so a blend toward "no
        // effect" has to fade toward 1 and not 0.
        { name: 'u_power', label: 'Power', min: 0.5, max: 4, step: 0.05, defaultValue: 1.6, neutralValue: 1 },
    ],
    // Half resolution for the three passes that carry the term, full for the one
    // that applies it — the chain's last pass feeds the blit and is full size
    // regardless, so the composite is where the upsample has to happen.
    multiPass: [
        { name: 'ssao_ao', factory: () => postProcessEffects.createSsaoAo(), scale: 0.5 },
        { name: 'ssao_blur_x', factory: () => postProcessEffects.createSsaoBlur(0), scale: 0.5 },
        { name: 'ssao_blur_y', factory: () => postProcessEffects.createSsaoBlur(1), scale: 0.5 },
        { name: 'ssao_composite', factory: () => postProcessEffects.createSsaoComposite() },
    ],
});

registerEffect({
    type: 'subsurface',
    label: 'Subsurface Scattering',
    factory: () => subsurfacePasses.createSubsurface(0),
    // Light that enters a marked surface and leaves it nearby: the lit picture blurred along the surface, each colour by its
    // own amount. Which surfaces: the ones whose material holds a Subsurface above zero (the Model material's `u_subsurface`).
    uniforms: [
        // A world length: how far the widest colour travels. Skin is a few millimetres; wax and marble are centimetres.
        { name: 'u_width', label: 'Width', min: 0.1, max: 80, step: 0.1, defaultValue: 8 },
        { name: 'u_strength', label: 'Strength', min: 0, max: 1, step: 0.01, defaultValue: 1, neutralValue: 0 },
    ],
    // The colour sets the proportions between the channels: the brightest travels the full width.
    colors: [
        { name: 'u_color', label: 'Scatter Colour', defaultValue: { r: 1, g: 0.45, b: 0.25, a: 1 } },
    ],
    multiPass: [
        { name: 'sss_x', factory: () => subsurfacePasses.createSubsurface(0) },
        { name: 'sss_y', factory: () => subsurfacePasses.createSubsurface(1) },
    ],
});

registerEffect({
    type: 'gtao',
    label: 'Ground-Truth Ambient Occlusion',
    factory: () => gtaoPasses.createGtaoAo(),
    // The horizon-based estimator in place of the ring of samples: no bias to tune against a surface occluding itself,
    // so a flat floor stays white and a crease darkens by how closed it really is. The blur and the composite are SSAO's.
    uniforms: [
        { name: 'u_radius', label: 'Radius', min: 0.01, max: 500, step: 0.01, defaultValue: 80 },
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 2, step: 0.01, defaultValue: 1 },
        { name: 'u_power', label: 'Power', min: 0.5, max: 4, step: 0.05, defaultValue: 1.4, neutralValue: 1 },
        // 0 trusts every occluder to be as tall as it looks; 1 lets a thin one (a railing, a leaf) be seen past.
        { name: 'u_thickness', label: 'Thickness', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
    ],
    multiPass: [
        { name: 'gtao_ao', factory: () => gtaoPasses.createGtaoAo(), scale: 0.5 },
        { name: 'gtao_blur_x', factory: () => postProcessEffects.createSsaoBlur(0), scale: 0.5 },
        { name: 'gtao_blur_y', factory: () => postProcessEffects.createSsaoBlur(1), scale: 0.5 },
        { name: 'gtao_composite', factory: () => postProcessEffects.createSsaoComposite() },
    ],
});

registerEffect({
    type: 'ssr',
    label: 'Screen Space Reflections',
    factory: () => postProcessEffects.createSsr(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 2, step: 0.01, defaultValue: 1, neutralValue: 0 },
        // A WORLD length, like SSAO's radius: how far a reflected ray may travel before the
        // search gives up. Step count is a constant, so a longer reach is a coarser step.
        { name: 'u_maxDistance', label: 'Max Distance', min: 10, max: 3000, step: 10, defaultValue: 400 },
        // How far behind a visible surface a ray may pass and still count as having hit it.
        { name: 'u_thickness', label: 'Thickness', min: 1, max: 200, step: 1, defaultValue: 12 },
        // 1 = only surfaces that face up reflect (wet ground, polished floors, and not the walls beside them);
        // 0 = any surface smooth enough to show a reflection does.
        { name: 'u_floorBias', label: 'Floor Bias', min: 0, max: 1, step: 0.01, defaultValue: 0 },
        // Standing water: flat, and a mirror. Give it the same two numbers as the Rain effect's puddles
        // and the pools it darkens are the pools that reflect.
        { name: 'u_puddles', label: 'Puddles', min: 0, max: 1, step: 0.01, defaultValue: 0, neutralValue: 0 },
        { name: 'u_puddleScale', label: 'Puddle Size', min: 40, max: 2000, step: 10, defaultValue: 350 },
        // Surfaces rougher than this reflect nothing and cost nothing: the ray is never marched for them.
        { name: 'u_maxRoughness', label: 'Max Roughness', min: 0.05, max: 1, step: 0.01, defaultValue: 0.75 },
        // How wet the ground is: wet is smoother, so it reflects. Give it the Rain effect's wetness.
        { name: 'u_wetness', label: 'Wetness', min: 0, max: 1, step: 0.01, defaultValue: 0, neutralValue: 0 },
        // Where the ray finds nothing on screen, how much of the environment's reflection takes its place: the sky
        // in a puddle, and what is past the edge of the picture.
        { name: 'u_skyReflection', label: 'Sky Reflection', min: 0, max: 1, step: 0.01, defaultValue: 1, neutralValue: 0 },
    ],
});

registerEffect({
    type: 'taa',
    label: 'Temporal Anti-Aliasing',
    factory: () => postProcessEffects.createTaa(),
    // One knob: how much of each frame is the new one. The camera shift, the history
    // and last frame's camera are the engine's, not the effect's — they are not settings.
    uniforms: [
        // Lower is smoother and slower to follow a change; 1 is no accumulation at all,
        // which is what a blend toward "no effect" fades to.
        { name: 'u_blend', label: 'Blend', min: 0.02, max: 1, step: 0.01, defaultValue: 0.1, neutralValue: 1 },
        // 1 follows a surface that moved by itself by its own displacement; 0 trusts the camera's alone, which
        // is what every pixel gets where nothing moved — and what a moving one smears with.
        { name: 'u_objectMotion', label: 'Object Motion', min: 0, max: 1, step: 1, defaultValue: 1, neutralValue: 1 },
    ],
});

registerEffect({
    type: 'motionBlur',
    label: 'Motion Blur',
    factory: () => lensEffects.createMotionBlur(),
    // The camera's and the moving meshes' own motion, both from the frame; what is left to set is the exposure.
    uniforms: [
        // The shutter: how much of the distance a pixel moved in a frame the streak covers. 0.5 is a 180 degree shutter.
        { name: 'u_intensity', label: 'Shutter', min: 0, max: 2, step: 0.01, defaultValue: 0.5, neutralValue: 0 },
        // The longest streak as a fraction of the picture, so a cut or a teleport smears a little and not the frame.
        { name: 'u_maxBlur', label: 'Max Blur', min: 0.002, max: 0.25, step: 0.002, defaultValue: 0.05 },
        { name: 'u_objectMotion', label: 'Object Motion', min: 0, max: 1, step: 1, defaultValue: 1, neutralValue: 1 },
    ],
});

registerEffect({
    type: 'filmGrain',
    label: 'Film Grain',
    factory: () => lensEffects.createFilmGrain(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 0.15, neutralValue: 0 },
        { name: 'u_size', label: 'Grain Size', min: 1, max: 6, step: 0.1, defaultValue: 1.6 },
        // 1 puts the grain in the mid-tones where film has it; 0 spreads it evenly, blacks and whites included.
        { name: 'u_response', label: 'Mid-tone Response', min: 0, max: 1, step: 0.01, defaultValue: 0.8 },
    ],
});

registerEffect({
    type: 'lensFlare',
    label: 'Lens Flare',
    factory: () => lensEffects.createLensFlare(),
    // The flare is smooth (ghosts fade by the cube of their distance from the edge, the halo by the fourth power) and dear: ninety taps a pixel to
    // find what is bright. It is worked out at half size and laid over the full-size picture, which is a quarter of the pixels paying.
    multiPass: [
        { name: 'lensflare_flare', factory: () => lensEffects.createLensFlare(), scale: 0.5 },
        { name: 'lensflare_composite', factory: () => lensEffects.createLensFlareComposite() },
    ],
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 4, step: 0.01, defaultValue: 0.4, neutralValue: 0 },
        // Only what is brighter than this (in the picture's own units, HDR included) throws a flare.
        { name: 'u_threshold', label: 'Threshold', min: 0, max: 8, step: 0.05, defaultValue: 1.2 },
        { name: 'u_ghosts', label: 'Ghosts', min: 1, max: 8, step: 1, defaultValue: 5 },
        { name: 'u_dispersal', label: 'Dispersal', min: 0.05, max: 1, step: 0.01, defaultValue: 0.35 },
        { name: 'u_haloWidth', label: 'Halo Width', min: 0, max: 1, step: 0.01, defaultValue: 0.45 },
        { name: 'u_chromatic', label: 'Colour Fringe', min: 0, max: 0.05, step: 0.001, defaultValue: 0.012 },
    ],
    colors: [
        { name: 'u_tint', label: 'Tint', defaultValue: { r: 1, g: 0.85, b: 0.7, a: 1 } },
    ],
});

registerEffect({
    type: 'agx',
    label: 'AgX',
    factory: () => postProcessEffects.createAgx(),
    uniforms: [
        // The look: 1 is AgX Base, 1.2 is the Medium High Contrast look Blender offers.
        { name: 'u_contrast', label: 'Contrast (Look)', min: 0.5, max: 2, step: 0.01, defaultValue: 1, neutralValue: 1 },
    ],
    builtinTextures: { u_lut: () => postProcessEffects.agxLut() },
});

registerEffect({
    type: 'lutGrade',
    label: 'LUT Grade',
    factory: () => postProcessEffects.createLutGrade(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 1 },
    ],
    textures: [
        { name: 'u_lut', label: 'LUT (1024x32, 32 slices)' },
    ],
});

// A graded look read off a table by the picture as the display shows it: the last pass's, after the output transform and the transfer
// function, which no effect in the chain can be (they run on scene values, before both). For a look authored against the finished image.
// A look held to a few colours: every pixel becomes the nearest of a palette read from a strip image (N by 1, up to 64 colours), after an ordered
// dither that spreads a gradient over neighbouring colours. For pixel art that must keep to one palette however the lights and the weather move.
registerEffect({
    type: 'palette',
    label: 'Palette',
    factory: () => postProcessEffects.createPalette(),
    uniforms: [
        { name: 'u_strength', label: 'Strength', min: 0, max: 1, step: 0.01, defaultValue: 1, neutralValue: 0 },
        // How far the choice is spread between neighbouring colours, and the size in device pixels of one cell of the dither (match the art's pixel size).
        { name: 'u_dither', label: 'Dither', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
        { name: 'u_ditherScale', label: 'Dither Scale', min: 1, max: 16, step: 1, defaultValue: 1 },
    ],
    textures: [
        { name: 'u_palette', label: 'Palette (N x 1 image, one colour a pixel, up to 64)' },
    ],
});

registerEffect({
    type: 'displayLut',
    label: 'Display LUT',
    stage: 'output',
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 1 },
    ],
    textures: [
        { name: 'u_lut', label: 'LUT (1024x32, 32 slices, as the display shows it)' },
    ],
});

const CATEGORIES: Record<EffectCategory, string[]> = {
    lens: ['bloom', 'depthOfField', 'motionBlur', 'lensFlare', 'filmGrain', 'chromaticAberration', 'lensDistortion', 'vignette', 'sharpen'],
    color: ['tonemap', 'agx', 'colorGrade', 'lutGrade', 'displayLut', 'autoExposure', 'grayscale'],
    light: ['ssao', 'gtao', 'ssgi', 'ssr', 'voxelGI', 'contactShadows', 'lightShafts', 'subsurface'],
    atmosphere: ['mist2d', 'rain2d', 'fog2d', 'distanceFog', 'heightFog', 'skyAtmosphere', 'rain'],
    aa: ['fxaa', 'taa'],
    stylize: ['blur', 'pixelate', 'palette', 'outline', 'depthOutline', 'edgeOutline'],
};
for (const [category, types] of Object.entries(CATEGORIES) as [EffectCategory, string[]][]) {
    for (const type of types) {
        const def = effectRegistry.get(type);
        if (def) def.category = category;
    }
}
