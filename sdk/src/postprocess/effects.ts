import type { ShaderHandle } from '../material';
import { PostProcess } from './PostProcessAPI';

export interface EffectUniformDef {
    name: string;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
}

export interface EffectSubPass {
    name: string;
    factory: () => ShaderHandle;
}

export interface EffectDef {
    type: string;
    label: string;
    factory: () => ShaderHandle;
    uniforms: EffectUniformDef[];
    multiPass?: EffectSubPass[];
}

const effectRegistry = new Map<string, EffectDef>();

export function registerEffect(def: EffectDef): void {
    effectRegistry.set(def.type, def);
}

export function getEffectDef(type: string): EffectDef | undefined {
    return effectRegistry.get(type);
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
    factory: () => PostProcess.createBlur(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 20, step: 0.1, defaultValue: 2 },
    ],
});

registerEffect({
    type: 'bloom',
    label: 'Bloom',
    factory: () => PostProcess.createBloomExtract(),
    uniforms: [
        { name: 'u_threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, defaultValue: 0.4 },
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 5, step: 0.1, defaultValue: 1.5 },
        { name: 'u_radius', label: 'Radius', min: 0.5, max: 5, step: 0.1, defaultValue: 1 },
    ],
    multiPass: [
        { name: 'bloom_extract', factory: () => PostProcess.createBloomExtract() },
        { name: 'bloom_kawase_0', factory: () => PostProcess.createBloomKawase(0) },
        { name: 'bloom_kawase_1', factory: () => PostProcess.createBloomKawase(1) },
        { name: 'bloom_kawase_2', factory: () => PostProcess.createBloomKawase(2) },
        { name: 'bloom_kawase_3', factory: () => PostProcess.createBloomKawase(3) },
        { name: 'bloom_kawase_4', factory: () => PostProcess.createBloomKawase(4) },
        { name: 'bloom_composite', factory: () => PostProcess.createBloomComposite() },
    ],
});

registerEffect({
    type: 'vignette',
    label: 'Vignette',
    factory: () => PostProcess.createVignette(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 0.6 },
        { name: 'u_softness', label: 'Softness', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
    ],
});

registerEffect({
    type: 'grayscale',
    label: 'Grayscale',
    factory: () => PostProcess.createGrayscale(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 1 },
    ],
});

registerEffect({
    type: 'chromaticAberration',
    label: 'Chromatic Aberration',
    factory: () => PostProcess.createChromaticAberration(),
    uniforms: [
        { name: 'u_intensity', label: 'Intensity', min: 0, max: 20, step: 0.1, defaultValue: 3 },
    ],
});
