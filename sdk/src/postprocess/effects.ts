// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ShaderHandle } from '../material';
import { postProcessEffects } from './postProcessEffects';

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
        { name: 'u_threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, defaultValue: 0.4 },
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
        { name: 'u_contrast', label: 'Contrast', min: 0, max: 2, step: 0.01, defaultValue: 1 },
        { name: 'u_saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, defaultValue: 1 },
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
        { name: 'u_zoom', label: 'Zoom', min: 0.5, max: 2, step: 0.01, defaultValue: 1 },
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
