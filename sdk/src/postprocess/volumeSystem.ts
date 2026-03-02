import { defineSystem } from '../system';
import { defineResource } from '../resource';
import { Query } from '../query';
import type { Entity } from '../types';
import { PostProcessVolume, Transform, type PostProcessVolumeData, type TransformData } from '../component';
import { PostProcess } from './PostProcessAPI';
import { PostProcessStack } from './PostProcessStack';
import { getEffectDef } from './effects';
import { computeVolumeFactor, blendVolumeEffects, type ActiveVolume } from './volumeBlending';
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

function getOrCreateShader(effectType: string): ShaderHandle | null {
    const existing = volumeShaders.get(effectType);
    if (existing !== undefined) return existing;

    const def = getEffectDef(effectType);
    if (!def) return null;

    const shader = def.factory();
    volumeShaders.set(effectType, shader);
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

    while (stack.passCount > 0) {
        const passes = stack.passes;
        stack.removePass(passes[passes.length - 1].name);
    }

    for (const [effectType, effectData] of effects) {
        if (!effectData.enabled) continue;

        const shader = getOrCreateShader(effectType);
        if (shader === null) continue;

        stack.addPass(effectType, shader);

        for (const [uniformName, uniformValue] of effectData.uniforms) {
            stack.setUniform(effectType, uniformName, uniformValue);
        }
    }

    if (stack.enabledPassCount > 0) {
        PostProcess.bind(camera, stack);
    } else {
        PostProcess.unbind(camera);
    }
}

export const postProcessVolumeSystem = defineSystem(
    [Query(PostProcessVolume, Transform)],
    (query: Iterable<[Entity, PostProcessVolumeData, TransformData]>) => {
        const volumes: { data: PostProcessVolumeData; tx: { x: number; y: number } }[] = [];
        for (const [_entity, volumeData, transform] of query) {
            volumes.push({ data: volumeData, tx: { x: transform.position.x, y: transform.position.y } });
        }

        if (volumes.length === 0) return;

        const activeVolumes: ActiveVolume[] = [];
        for (const { data, tx } of volumes) {
            if (data.isGlobal) {
                activeVolumes.push({ data, factor: 1 });
            }
        }

        if (activeVolumes.length > 0) {
            const blended = blendVolumeEffects(activeVolumes);
            for (const [camera] of volumeStacks) {
                applyBlendedEffects(camera, blended);
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
