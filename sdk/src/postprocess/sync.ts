import type { Entity } from '../types';
import type { ShaderHandle } from '../material';
import { Material } from '../material';
import { PostProcessStack } from './PostProcessStack';
import { PostProcess } from './PostProcessAPI';
import { getEffectDef } from './effects';

export interface PostProcessEffectData {
    type: string;
    enabled: boolean;
    uniforms: Record<string, number>;
}

export interface PostProcessVolumeData {
    effects: PostProcessEffectData[];
    isGlobal: boolean;
    shape: 'box' | 'sphere';
    size: { x: number; y: number };
    priority: number;
    weight: number;
    blendDistance: number;
}

const volumeStacks = new Map<Entity, PostProcessStack>();
const volumeShaders = new Map<Entity, Map<string, ShaderHandle>>();

export function syncPostProcessVolume(camera: Entity, data: PostProcessVolumeData): void {
    let stack = volumeStacks.get(camera);
    let shaders = volumeShaders.get(camera);

    const activeEffects = data.effects.filter(e => e.enabled);
    if (activeEffects.length === 0) {
        if (stack) {
            PostProcess.unbind(camera);
            stack.destroy();
            volumeStacks.delete(camera);
        }
        if (shaders) {
            for (const handle of shaders.values()) {
                Material.releaseShader(handle);
            }
            volumeShaders.delete(camera);
        }
        return;
    }

    if (!stack) {
        stack = PostProcess.createStack();
        volumeStacks.set(camera, stack);
    }

    if (!shaders) {
        shaders = new Map();
        volumeShaders.set(camera, shaders);
    }

    while (stack.passCount > 0) {
        const passes = stack.passes;
        stack.removePass(passes[passes.length - 1].name);
    }

    for (const effect of activeEffects) {
        const def = getEffectDef(effect.type);
        if (!def) continue;

        let shader = shaders.get(effect.type);
        if (shader === undefined) {
            shader = def.factory();
            shaders.set(effect.type, shader);
        }

        stack.addPass(effect.type, shader);

        for (const uDef of def.uniforms) {
            const value = effect.uniforms[uDef.name] ?? uDef.defaultValue;
            stack.setUniform(effect.type, uDef.name, value);
        }
    }

    PostProcess.bind(camera, stack);
}

export function cleanupPostProcessVolume(camera: Entity): void {
    const stack = volumeStacks.get(camera);
    if (stack) {
        PostProcess.unbind(camera);
        stack.destroy();
        volumeStacks.delete(camera);
    }
    const shaders = volumeShaders.get(camera);
    if (shaders) {
        for (const handle of shaders.values()) {
            Material.releaseShader(handle);
        }
        volumeShaders.delete(camera);
    }
}

export function cleanupAllPostProcessVolumes(): void {
    for (const camera of volumeStacks.keys()) {
        cleanupPostProcessVolume(camera);
    }
}
