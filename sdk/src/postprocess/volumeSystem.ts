// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineSystem } from '../system';
import { defineResource, Res } from '../resource';
import { Query } from '../query';
import type { Entity } from '../types';
import { PostProcessVolume, Transform, Camera, type PostProcessVolumeData, type TransformData, type CameraData } from '../component';
import { PostProcess, type PostProcessApi } from './PostProcessAPI';
import { getEffectDef } from './effects';
import { blendVolumeEffects, type ActiveVolume } from './volumeBlending';
import type { ShaderHandle } from '../material';
import { Material } from '../material';

export interface PostProcessVolumeConfig {
    enabled: boolean;
}

export const PostProcessVolumeConfigResource = defineResource<PostProcessVolumeConfig>(
    { enabled: true },
    'PostProcessVolumeConfig'
);

function getOrCreateShader(api: PostProcessApi, key: string, factory: () => ShaderHandle): ShaderHandle {
    const existing = api.volumeShaders.get(key);
    if (existing !== undefined) return existing;

    const shader = factory();
    api.volumeShaders.set(key, shader);
    return shader;
}

function applyBlendedEffects(
    api: PostProcessApi,
    camera: Entity,
    effects: Map<string, { enabled: boolean; uniforms: Map<string, number> }>,
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
            }
        } else {
            const shader = getOrCreateShader(api, effectType, def.factory);
            stack.addPass(effectType, shader);
            for (const [uniformName, uniformValue] of effectData.uniforms) {
                stack.setUniform(effectType, uniformName, uniformValue);
            }
        }
    }

    if (stack.enabledPassCount > 0) {
        api.bind(camera, stack);
    } else {
        api.unbind(camera);
    }
}

export const postProcessVolumeSystem = defineSystem(
    [Res(PostProcess), Query(PostProcessVolume, Transform), Query(Camera)],
    (
        api: PostProcessApi,
        volumeQuery: Iterable<[Entity, PostProcessVolumeData, TransformData]>,
        cameraQuery: Iterable<[Entity, CameraData]>,
    ) => {
        const volumes: { data: PostProcessVolumeData; tx: { x: number; y: number } }[] = [];
        for (const [_entity, volumeData, transform] of volumeQuery) {
            volumes.push({ data: volumeData, tx: { x: transform.position.x, y: transform.position.y } });
        }

        const activeVolumes: ActiveVolume[] = [];
        for (const { data } of volumes) {
            if (data.isGlobal) {
                activeVolumes.push({ data, factor: 1 });
            }
        }

        const blended = activeVolumes.length > 0
            ? blendVolumeEffects(activeVolumes)
            : new Map<string, { enabled: boolean; uniforms: Map<string, number> }>();

        for (const [cameraEntity, cameraData] of cameraQuery) {
            if (cameraData.isActive) {
                applyBlendedEffects(api, cameraEntity, blended);
            }
        }
    },
    { name: 'PostProcessVolumeSystem' }
);

export function cleanupVolumeSystem(api: PostProcessApi): void {
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
