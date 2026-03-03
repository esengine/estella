import { defineSystem } from '../system';
import { defineResource } from '../resource';
import { Query } from '../query';
import type { Entity } from '../types';
import { PostProcessVolume, Transform, Camera, type PostProcessVolumeData, type TransformData, type CameraData } from '../component';
import { PostProcess } from './PostProcessAPI';
import { PostProcessStack } from './PostProcessStack';
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

const volumeStacks = new Map<Entity, PostProcessStack>();
const volumeShaders = new Map<string, ShaderHandle>();

function getOrCreateShader(key: string, factory: () => ShaderHandle): ShaderHandle {
    const existing = volumeShaders.get(key);
    if (existing !== undefined) return existing;

    const shader = factory();
    volumeShaders.set(key, shader);
    return shader;
}

function applyBlendedEffects(camera: Entity, effects: Map<string, { enabled: boolean; uniforms: Map<string, number> }>): void {
    if (effects.size === 0) {
        const existing = volumeStacks.get(camera);
        if (existing) {
            PostProcess.unbind(camera);
            existing.destroy();
            volumeStacks.delete(camera);
        }
        return;
    }

    let stack = volumeStacks.get(camera);
    if (!stack) {
        stack = PostProcess.createStack();
        volumeStacks.set(camera, stack);
    }

    stack.clearPasses();

    for (const [effectType, effectData] of effects) {
        if (!effectData.enabled) continue;

        const def = getEffectDef(effectType);
        if (!def) continue;

        if (def.multiPass) {
            for (const subPass of def.multiPass) {
                const shader = getOrCreateShader(subPass.name, subPass.factory);
                stack.addPass(subPass.name, shader);
                for (const [uniformName, uniformValue] of effectData.uniforms) {
                    stack.setUniform(subPass.name, uniformName, uniformValue);
                }
            }
        } else {
            const shader = getOrCreateShader(effectType, def.factory);
            stack.addPass(effectType, shader);
            for (const [uniformName, uniformValue] of effectData.uniforms) {
                stack.setUniform(effectType, uniformName, uniformValue);
            }
        }
    }

    if (stack.enabledPassCount > 0) {
        PostProcess.bind(camera, stack);
    } else {
        PostProcess.unbind(camera);
    }
}

export const postProcessVolumeSystem = defineSystem(
    [Query(PostProcessVolume, Transform), Query(Camera)],
    (volumeQuery: Iterable<[Entity, PostProcessVolumeData, TransformData]>, cameraQuery: Iterable<[Entity, CameraData]>) => {
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
                applyBlendedEffects(cameraEntity, blended);
            }
        }
    },
    { name: 'PostProcessVolumeSystem' }
);

export function cleanupVolumeSystem(): void {
    for (const [camera, stack] of volumeStacks) {
        PostProcess.unbind(camera);
        stack.destroy();
    }
    volumeStacks.clear();

    for (const shader of volumeShaders.values()) {
        Material.releaseShader(shader);
    }
    volumeShaders.clear();
}
