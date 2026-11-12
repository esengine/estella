// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { isCustomSky } from './customSky';
import type { BuiltinTexture } from './effects';
import { defineSystem } from '../ecs/system';
import type { App } from '../app/app';
import { EditorView, editorViewEye } from '../camera/EditorView';
import { EDITOR_VIEW_ENTITY } from '../camera/uiLayoutRect';
import { defineResource, Res } from '../ecs/resource';
import { Query } from '../ecs/query';
import type { Entity } from '../types';
import { PostProcessVolume, Transform, Camera, ProjectionType, ClearFlags, type PostProcessVolumeData, type TransformData, type CameraData } from '../ecs/component';
import { PostProcess, deviceHasCompute, type PostProcessAPI } from './PostProcessAPI';
import { getEffectDef, uniformInUnits } from './effects';
import { blendVolumeEffects, computeVolumeFactor, type ActiveVolume, type BlendedEffect, type VolumeTransform } from './volumeBlending';
import type { ShaderHandle } from '../render/material';
import { Material } from '../render/material';
import { applyWeatherToEffects, currentWeather, currentWeatherDrive, WeatherDrive } from './weather';
import { applyCloudsToFog } from './cloudShafts';
import { applySkyClock } from './skyClock';
import { applyRainSheltersToRain } from '../render/rainShelter';
import { applyFogOfWarToFog } from '../render/fogOfWar';
import { runtimeTextureHandle } from './runtimeTextures';
import { applyUnderwaterToEffects, currentUnderwater } from './underwater';
import { applyTimeToEffects, currentTimeOfDay, currentTimeDrive, timeLightsApplied } from './timeOfDay';

export interface PostProcessVolumeConfig {
    enabled: boolean;
}

export const PostProcessVolumeConfigResource = defineResource<PostProcessVolumeConfig>(
    { enabled: true },
    'PostProcessVolumeConfig'
);

// Texture-param refs resolve through the App's Assets (set by PostProcessPlugin);
// preloaded by PostProcessVolume's discoverAssets, so lookups are cache hits.
let volumeTextureResolver: ((ref: string) => number) | null = null;

export function setVolumeTextureResolver(resolver: ((ref: string) => number) | null): void {
    volumeTextureResolver = resolver;
}

function getOrCreateShader(api: PostProcessAPI, key: string, factory: () => ShaderHandle): ShaderHandle {
    const existing = api.volumeShaders.get(key);
    if (existing !== undefined) return existing;

    const shader = factory();
    api.volumeShaders.set(key, shader);
    return shader;
}

function applyTextures(
    stack: ReturnType<PostProcessAPI['createStack']>,
    passName: string,
    textures: Map<string, string>,
): void {
    if (textures.size === 0 || !volumeTextureResolver) return;
    for (const [uniformName, ref] of textures) {
        const handle = runtimeTextureHandle(ref) ?? volumeTextureResolver(ref);
        if (handle) stack.setTexture(passName, uniformName, handle);
    }
}

/** Uploads the pixels of a texture an effect brings itself: set by the plugin, which is the one that knows the App's module. */
type BuiltinTextureMaker = (pixels: BuiltinTexture) => number;
let builtinTextureMaker: BuiltinTextureMaker | null = null;

export function setBuiltinTextureMaker(maker: BuiltinTextureMaker | null): void {
    builtinTextureMaker = maker;
}

/** The textures an effect brings itself, made once per App from the pixels its source group installed. */
const builtinTextureCache = new WeakMap<PostProcessAPI, Map<string, number>>();

function applyBuiltinTextures(api: PostProcessAPI, stack: ReturnType<PostProcessAPI['createStack']>, passName: string,
                              def: NonNullable<ReturnType<typeof getEffectDef>>, named: Map<string, string>): void {
    if (!def.builtinTextures) return;
    let cache = builtinTextureCache.get(api);
    if (!cache) builtinTextureCache.set(api, cache = new Map());
    for (const [uniformName, make] of Object.entries(def.builtinTextures)) {
        if (named.has(uniformName)) continue;
        const key = `${def.type}:${uniformName}`;
        let handle = cache.get(key);
        if (handle === undefined) {
            if (!builtinTextureMaker) return;
            handle = builtinTextureMaker(make());
            cache.set(key, handle);
        }
        stack.setTexture(passName, uniformName, handle);
    }
}

type ResolvedEffects = Map<string, BlendedEffect>;

/** What the output stages among the effects ask of the last pass: the display look's table (a texture handle) and amount. */
function displayLutOf(effects: ResolvedEffects): { texture: number; amount: number } {
    for (const [type, data] of effects) {
        if (!data.enabled || getEffectDef(type)?.stage !== 'output' || type !== 'displayLut') continue;
        const ref = data.textures.get('u_lut');
        const texture = ref && volumeTextureResolver ? volumeTextureResolver(ref) : 0;
        const amount = data.uniforms.get('u_intensity') ?? getEffectDef(type)?.uniforms.find((u) => u.name === 'u_intensity')?.defaultValue ?? 1;
        return { texture, amount };
    }
    return { texture: 0, amount: 0 };
}

function applyColors(
    stack: ReturnType<PostProcessAPI['createStack']>,
    passName: string,
    colors: BlendedEffect['colors'],
): void {
    for (const [uniformName, c] of colors) {
        stack.setUniformVec4(passName, uniformName, { x: c.r, y: c.g, z: c.b, w: c.a });
    }
}

// Per-stack signature of the last-applied effect set, so an unchanged frame can
// skip the whole wasm-boundary rebuild. Keyed by the stack object (auto-cleared
// when the stack is destroyed/GC'd).
const lastEffectSig = new WeakMap<object, string>();
// And of its SHAPE alone — which effects, which parameters, which textures — so a frame that only moved numbers
// (a weather in transition, a fading volume) writes them into the passes it has instead of building them again.
const lastShapeSig = new WeakMap<object, string>();

function shapeSignature(effects: ResolvedEffects): string {
    let sig = '';
    for (const [type, data] of effects) {
        if (!data.enabled) continue;
        sig += type + ':';
        for (const k of data.uniforms.keys()) sig += k + ',';
        sig += '|';
        for (const [k, ref] of data.textures) sig += k + '=' + ref + ';';
        sig += '|';
        for (const k of data.colors.keys()) sig += k + ',';
        sig += '#';
    }
    return sig;
}

/** The names of the passes an effect becomes: one, or the several a multi-pass effect is made of. */
function passNamesOf(effectType: string): string[] {
    const def = getEffectDef(effectType);
    if (def?.multiPass) return def.multiPass.map((p) => p.name);
    return [effectType];
}

function writeValues(stack: ReturnType<PostProcessAPI['createStack']>, effects: ResolvedEffects): void {
    const look = displayLutOf(effects);
    stack.setDisplayLut(look.texture, look.amount);
    for (const [effectType, effectData] of effects) {
        if (!effectData.enabled || !getEffectDef(effectType) || getEffectDef(effectType)!.stage) continue;
        for (const passName of passNamesOf(effectType)) {
            for (const [uniformName, uniformValue] of effectData.uniforms) {
                stack.setUniform(passName, uniformName, uniformValue);
            }
            applyColors(stack, passName, effectData.colors);
        }
    }
}

/** Stable string of the enabled effects (type + uniforms + textures). */
function effectsSignature(effects: ResolvedEffects): string {
    let sig = '';
    for (const [type, data] of effects) {
        if (!data.enabled) continue;
        sig += type + ':';
        for (const [k, v] of data.uniforms) sig += k + '=' + v + ';';
        sig += '|';
        for (const [k, ref] of data.textures) sig += k + '=' + ref + ';';
        sig += '|';
        for (const [k, c] of data.colors) sig += k + '=' + c.r + ',' + c.g + ',' + c.b + ',' + c.a + ';';
        sig += '#';
    }
    return sig;
}

/**
 * The effects with the temporal anti-aliasing pass in them, where the quality level asks for it and the scene has not listed it: before the exposure
 * and the grading, after the lighting and the fog, which is where the harness measured it and where an author puts it. A level that does not ask
 * leaves the effects as they are, and so does an orthographic camera: jittered, sprites and text go soft, and a 2D game would pay a full-screen chain
 * for it. An author who lists `taa` on one still gets it.
 */
export function withTemporalAntialiasing(api: PostProcessAPI, effects: ResolvedEffects, perspective: boolean): ResolvedEffects {
    if (!perspective || api.antialiasing !== 'temporal' || effects.has('taa')) return effects;
    const taa: BlendedEffect = { enabled: true, uniforms: new Map([['u_blend', 0.1], ['u_objectMotion', 1]]), textures: new Map(), colors: new Map() };
    const out: ResolvedEffects = new Map();
    let placed = false;
    for (const [type, data] of effects) {
        if (!placed && type === 'autoExposure') {
            out.set('taa', taa);
            placed = true;
        }
        out.set(type, data);
    }
    if (!placed) out.set('taa', taa);
    return out;
}

/** Let a camera's volume stack go, when it has one. */
function releaseStack(api: PostProcessAPI, camera: Entity): void {
    const existing = api.volumeStacks.get(camera);
    if (!existing) return;
    api.unbind(camera);
    existing.destroy();
    api.volumeStacks.delete(camera);
}

function applyBlendedEffects(
    api: PostProcessAPI,
    camera: Entity,
    blended: ResolvedEffects,
    perspective: boolean,
): void {
    const effects = withTemporalAntialiasing(api, blended, perspective);
    if (effects.size === 0) {
        const existing = api.volumeStacks.get(camera);
        if (existing) {
            api.unbind(camera);
            existing.destroy();
            api.volumeStacks.delete(camera);
        }
        return;
    }

    let stack = api.volumeStacks.get(camera);
    if (!stack) {
        stack = api.createStack();
        api.volumeStacks.set(camera, stack);
    }

    // The rebuild below re-uploads the whole pass list + uniforms across the wasm
    // boundary; skip it when the resolved effect set is identical to last frame
    // (a static scene, or a fixed-weight global volume, never changes it).
    const sig = effectsSignature(effects);
    if (lastEffectSig.get(stack) === sig) return;
    lastEffectSig.set(stack, sig);

    // The same effects with other numbers: write the numbers.
    const shape = shapeSignature(effects);
    if (lastShapeSig.get(stack) === shape) {
        writeValues(stack, effects);
        return;
    }
    lastShapeSig.set(stack, shape);

    stack.clearPasses();

    for (const [effectType, effectData] of effects) {
        if (!effectData.enabled) continue;

        const def = getEffectDef(effectType);
        if (!def) continue;
        // A stage of the last pass is no pass: it is read off the effects once, below.
        if (def.stage) continue;

        if (def.multiPass) {
            for (const [index, subPass] of def.multiPass.entries()) {
                const shader = getOrCreateShader(api, subPass.name, subPass.factory);
                stack.addPass(subPass.name, shader, subPass.scale ?? 1, index > 0);
                for (const [uniformName, uniformValue] of effectData.uniforms) {
                    stack.setUniform(subPass.name, uniformName, uniformValue);
                }
                applyTextures(stack, subPass.name, effectData.textures);
                applyColors(stack, subPass.name, effectData.colors);
            }
        } else if ((def.native || def.compute) && def.fallback && !deviceHasCompute()) {
            // No compute stage: the fragment version of the same effect stands in for it.
            for (const [index, subPass] of def.fallback.entries()) {
                const shader = getOrCreateShader(api, subPass.name, subPass.factory);
                stack.addPass(subPass.name, shader, subPass.scale ?? 1, index > 0);
                for (const u of def.uniforms) stack.setUniform(subPass.name, u.name, effectData.uniforms.get(u.name) ?? uniformInUnits(u).defaultValue);
                for (const [name, value] of Object.entries(subPass.uniforms ?? {})) stack.setUniform(subPass.name, name, value);
            }
        } else if (def.native) {
            stack.addNativePass(effectType, def.native);
            for (const u of def.uniforms) stack.setUniform(effectType, u.name, effectData.uniforms.get(u.name) ?? uniformInUnits(u).defaultValue);
            // The quality level's say over what the dynamic GI spends: its cheaper way where the level asks, and never dearer than the volume set.
            if (effectType === 'dynamicGI' && api.dynamicGIReduced) {
                const held = (name: string, fallback: number): number => effectData.uniforms.get(name) ?? fallback;
                stack.setUniform(effectType, 'u_halfRes', 1);
                stack.setUniform(effectType, 'u_probeStride', Math.max(held('u_probeStride', 2), 4));
                stack.setUniform(effectType, 'u_cardSlices', Math.max(held('u_cardSlices', 4), 8));
                stack.setUniform(effectType, 'u_probeDensity', Math.min(held('u_probeDensity', 1), 2 / 3));
            }
        } else if (def.compute) {
            // The params block is the effect's uniforms in their listed order, each at the volume's value or the effect's own default.
            stack.addComputePass(effectType, {
                source: def.compute.source,
                params: def.uniforms.map((u) => u.name),
                workgroupSize: def.compute.workgroupSize ?? [8, 8],
            });
            for (const u of def.uniforms) stack.setUniform(effectType, u.name, effectData.uniforms.get(u.name) ?? uniformInUnits(u).defaultValue);
        } else if (def.factory) {
            const shader = getOrCreateShader(api, effectType, def.factory);
            stack.addPass(effectType, shader);
            for (const [uniformName, uniformValue] of effectData.uniforms) {
                stack.setUniform(effectType, uniformName, uniformValue);
            }
            applyTextures(stack, effectType, effectData.textures);
            applyBuiltinTextures(api, stack, effectType, def, effectData.textures);
            applyColors(stack, effectType, effectData.colors);
        }
    }

    const look = displayLutOf(effects);
    stack.setDisplayLut(look.texture, look.amount);

    // A stack with only a display look has no pass, and is still the camera's.
    if (stack.enabledPassCount > 0 || stack.displayLut.amount > 0) {
        api.bind(camera, stack);
    } else {
        api.unbind(camera);
    }
}

/** The effects the scene's volumes resolve to for an eye at (x, y, z): blended, then moved by the weather, the time of day, the clouds and the water. */
export function effectsAt(volumes: { data: PostProcessVolumeData; tx: VolumeTransform }[], x: number, y: number, z: number): ResolvedEffects {
    const activeVolumes: ActiveVolume[] = [];
    for (const { data, tx } of volumes) {
        const factor = computeVolumeFactor(data, tx, x, y, z);
        if (factor > 0) activeVolumes.push({ data, factor });
    }
    const blended = activeVolumes.length > 0 ? blendVolumeEffects(activeVolumes) : new Map() as ResolvedEffects;
    // The weather, if a Weather component is in the scene: scales and tints what the volumes resolved, and brings the effects a weather implies.
    const weather = currentWeather();
    if (weather) applyWeatherToEffects(blended, weather, currentWeatherDrive());
    const clock = currentTimeOfDay();
    if (clock) applyTimeToEffects(blended, clock, currentTimeDrive(), timeLightsApplied());
    applySkyClock(blended, weather && (currentWeatherDrive() & WeatherDrive.Wind) ? weather.wind : 1);
    applyCloudsToFog(blended);
    // A 2D rain is told where the ground under a roof is dry, by a mask drawn this frame.
    applyRainSheltersToRain(blended);
    applyFogOfWarToFog(blended);
    // A camera under water: the effect the water module says it needs.
    applyUnderwaterToEffects(blended, currentUnderwater());
    return blended;
}

/** A sky that lights the scene: Sky Atmosphere, or one a project defined (customSky.ts), and what the volumes resolved for it. */
export interface LightingSky { type: string; effect: BlendedEffect }

/** The sky a view resolved this frame, where it asks to light the scene: the game's camera and the editor's eye each. */
interface ResolvedSkies { game: LightingSky | null; editor: LightingSky | null }
const resolvedSkies = new WeakMap<PostProcessAPI, ResolvedSkies>();

function skiesOf(api: PostProcessAPI): ResolvedSkies {
    let s = resolvedSkies.get(api);
    if (!s) { s = { game: null, editor: null }; resolvedSkies.set(api, s); }
    return s;
}

const lightingSky = (effects: ResolvedEffects): LightingSky | null => {
    for (const [type, effect] of effects) {
        if (type !== 'skyAtmosphere' && !isCustomSky(type)) continue;
        if (effect.enabled && (effect.uniforms.get('u_lightScene') ?? 0) > 0.5) return { type, effect };
    }
    return null;
};

/**
 * The Sky Atmosphere that lights the scene this frame, as resolved for the view being drawn: the editor's eye while it looks,
 * else the first active game camera's. Null when that view's sky does not ask to light the scene (or there is none).
 */
export function resolvedLightingSky(api: PostProcessAPI, editorLooking: boolean): LightingSky | null {
    const s = skiesOf(api);
    return editorLooking ? s.editor : s.game;
}

export const postProcessVolumeSystem = defineSystem(
    [Res(PostProcess), Query(PostProcessVolume, Transform), Query(Camera, Transform)],
    (
        api: PostProcessAPI,
        volumeQuery: Iterable<[Entity, PostProcessVolumeData, TransformData]>,
        cameraQuery: Iterable<[Entity, CameraData, TransformData]>,
    ) => {
        const volumes: { data: PostProcessVolumeData; tx: VolumeTransform }[] = [];
        for (const [_entity, volumeData, transform] of volumeQuery) {
            volumes.push({
                data: volumeData,
                tx: { x: transform.position.x, y: transform.position.y, z: transform.position.z },
            });
        }

        // Recomputed per camera: a local volume's weight depends on the camera position.
        const skies = skiesOf(api);
        skies.game = null;
        let first = true;
        for (const [cameraEntity, cameraData, cameraTransform] of cameraQuery) {
            if (!cameraData.isActive) continue;
            // A camera that keeps the colour under it (a first-person view model's, any overlay) draws over another camera's
            // finished image. A stack of its own would run fog, sky and the look over that whole image again, with this camera's
            // cleared depth reading as "infinitely far": the world under a held gun went to fog and sky.
            if (cameraData.clearFlags === ClearFlags.Depth || cameraData.clearFlags === ClearFlags.Nothing) {
                releaseStack(api, cameraEntity);
                continue;
            }
            // Where the camera IS: a camera under a player has a local position near zero.
            const p = cameraTransform.worldPosition ?? cameraTransform.position;
            const effects = effectsAt(volumes, p.x, p.y, p.z);
            // The scene has one environment: the first camera's sky lights it.
            if (first) { skies.game = lightingSky(effects); first = false; }
            applyBlendedEffects(api, cameraEntity, effects, cameraData.projectionType !== ProjectionType.Orthographic);
        }
    },
    { name: 'PostProcessVolumeSystem', runWhenPaused: true }
);

/**
 * The same for the editor's own eye, which is not a camera entity: while the editor looks at the scene through it, the scene's volumes are resolved at the eye
 * and bound to it, so the sky, the haze and the look are in the viewport as they are in the game. When it stops looking (the game's camera is) its stack is let go.
 */
export function editorViewVolumeSystem(app: App) {
    return defineSystem(
        [Res(PostProcess), Query(PostProcessVolume, Transform)],
        (api: PostProcessAPI, volumeQuery: Iterable<[Entity, PostProcessVolumeData, TransformData]>) => {
            const view = app.hasResource(EditorView) ? app.getResource(EditorView) : null;
            const eye = EDITOR_VIEW_ENTITY as Entity;
            if (!view || !view.active || !app.getResource(PostProcessVolumeConfigResource).enabled) {
                skiesOf(api).editor = null;
                if (api.volumeStacks.has(eye)) applyBlendedEffects(api, eye, new Map() as ResolvedEffects, false);
                return;
            }
            const volumes: { data: PostProcessVolumeData; tx: VolumeTransform }[] = [];
            for (const [_entity, volumeData, transform] of volumeQuery) {
                volumes.push({ data: volumeData, tx: { x: transform.position.x, y: transform.position.y, z: transform.position.z } });
            }
            const at = view.perspective ? editorViewEye(view) : { x: view.x, y: view.y, z: view.z };
            const effects = effectsAt(volumes, at.x, at.y, at.z);
            skiesOf(api).editor = lightingSky(effects);
            applyBlendedEffects(api, eye, effects, view.perspective);
        },
        { name: 'EditorViewVolumeSystem', runWhenPaused: true },
    );
}

export function cleanupVolumeSystem(api: PostProcessAPI): void {
    for (const [camera, stack] of api.volumeStacks) {
        api.unbind(camera);
        stack.destroy();
    }
    api.volumeStacks.clear();

    for (const shader of api.volumeShaders.values()) {
        Material.releaseShader(shader);
    }
    api.volumeShaders.clear();
}
