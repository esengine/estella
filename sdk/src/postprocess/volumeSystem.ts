// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineSystem } from '../ecs/system';
import { defineResource, Res } from '../ecs/resource';
import { Query } from '../ecs/query';
import type { Entity } from '../types';
import { PostProcessVolume, Transform, Camera, type PostProcessVolumeData, type TransformData, type CameraData } from '../ecs/component';
import { PostProcess, type PostProcessAPI } from './PostProcessAPI';
import { getEffectDef } from './effects';
import { blendVolumeEffects, computeVolumeFactor, type ActiveVolume, type VolumeTransform } from './volumeBlending';
import type { ShaderHandle } from '../render/material';
import { Material } from '../render/material';

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
        const handle = volumeTextureResolver(ref);
        if (handle) stack.setTexture(passName, uniformName, handle);
    }
}

type ResolvedEffects = Map<string, { enabled: boolean; uniforms: Map<string, number>; textures: Map<string, string> }>;

// Per-stack signature of the last-applied effect set, so an unchanged frame can
// skip the whole wasm-boundary rebuild. Keyed by the stack object (auto-cleared
// when the stack is destroyed/GC'd).
const lastEffectSig = new WeakMap<object, string>();

/** Stable string of the enabled effects (type + uniforms + textures). */
function effectsSignature(effects: ResolvedEffects): string {
    let sig = '';
    for (const [type, data] of effects) {
        if (!data.enabled) continue;
        sig += type + ':';
        for (const [k, v] of data.uniforms) sig += k + '=' + v + ';';
        sig += '|';
        for (const [k, ref] of data.textures) sig += k + '=' + ref + ';';
        sig += '#';
    }
    return sig;
}

function applyBlendedEffects(
    api: PostProcessAPI,
    camera: Entity,
    effects: ResolvedEffects,
): void {
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

    stack.clearPasses();

    for (const [effectType, effectData] of effects) {
        if (!effectData.enabled) continue;

        const def = getEffectDef(effectType);
        if (!def) continue;

        if (def.multiPass) {
            for (const subPass of def.multiPass) {
                const shader = getOrCreateShader(api, subPass.name, subPass.factory);
                stack.addPass(subPass.name, shader);
                for (const [uniformName, uniformValue] of effectData.uniforms) {
                    stack.setUniform(subPass.name, uniformName, uniformValue);
                }
                applyTextures(stack, subPass.name, effectData.textures);
            }
        } else {
            const shader = getOrCreateShader(api, effectType, def.factory);
            stack.addPass(effectType, shader);
            for (const [uniformName, uniformValue] of effectData.uniforms) {
                stack.setUniform(effectType, uniformName, uniformValue);
            }
            applyTextures(stack, effectType, effectData.textures);
        }
    }

    if (stack.enabledPassCount > 0) {
        api.bind(camera, stack);
    } else {
        api.unbind(camera);
    }
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
        for (const [cameraEntity, cameraData, cameraTransform] of cameraQuery) {
            if (!cameraData.isActive) continue;

            const cx = cameraTransform.position.x;
            const cy = cameraTransform.position.y;
            const cz = cameraTransform.position.z;

            const activeVolumes: ActiveVolume[] = [];
            for (const { data, tx } of volumes) {
                const factor = computeVolumeFactor(data, tx, cx, cy, cz);
                if (factor > 0) activeVolumes.push({ data, factor });
            }

            const blended = activeVolumes.length > 0
                ? blendVolumeEffects(activeVolumes)
                : new Map<string, { enabled: boolean; uniforms: Map<string, number>; textures: Map<string, string> }>();

            applyBlendedEffects(api, cameraEntity, blended);
        }
    },
    { name: 'PostProcessVolumeSystem' }
);

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
