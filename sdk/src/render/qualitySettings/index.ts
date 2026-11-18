// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { QualityLevel } from '../quality';
import type { QualitySetting, QualitySettingGroup, QualitySettingText, QualitySettingValue, QualitySettingValueOf } from './types';
import { RESOLUTION_SETTINGS } from './resolution';
import { VIEW_DISTANCE_SETTINGS } from './viewDistance';
import { LIGHT_SETTINGS } from './lights';
import { SHADOW_SETTINGS } from './shadows';
import { GLOBAL_ILLUMINATION_SETTINGS } from './globalIllumination';
import { REFLECTION_SETTINGS } from './reflections';
import { SKY_SETTINGS } from './sky';
import { POST_PROCESSING_SETTINGS } from './postProcessing';
import { EFFECT_SETTINGS } from './effects';
import { TERRAIN_SETTINGS } from './terrain';
import { WATER_SETTINGS } from './water';
import { TEXTURE_SETTINGS } from './textures';

export type {
    QualitySetting, QualitySettingGroup, QualitySettingText, QualitySettingValue, QualitySettingValueOf,
    QualityNumberSetting, QualityBooleanSetting, QualityChoiceSetting, QualityEnumSetting, QualityEffectUniform,
} from './types';
export { MOST_WATER_WAVES } from './water';

export interface QualitySettingGroupInfo {
    readonly id: QualitySettingGroup;
    readonly label: QualitySettingText;
}

export const QUALITY_SETTING_GROUPS: readonly QualitySettingGroupInfo[] = [
    { id: 'resolution', label: { en: 'Resolution & Anti-Aliasing', zh: '分辨率与抗锯齿' } },
    { id: 'viewDistance', label: { en: 'View Distance & Draws', zh: '视距与绘制' } },
    { id: 'lights', label: { en: 'Lights & Shading', zh: '光源与着色' } },
    { id: 'shadows', label: { en: 'Shadows', zh: '阴影' } },
    { id: 'globalIllumination', label: { en: 'Global Illumination & Occlusion', zh: '全局光照与遮蔽' } },
    { id: 'reflections', label: { en: 'Reflections', zh: '反射' } },
    { id: 'sky', label: { en: 'Sky & Volumetrics', zh: '天空与体积' } },
    { id: 'postProcessing', label: { en: 'Post-Processing', zh: '后处理' } },
    { id: 'effects', label: { en: 'Effects & Particles', zh: '特效与粒子' } },
    { id: 'terrain', label: { en: 'Terrain & Foliage', zh: '地形与植被' } },
    { id: 'water', label: { en: 'Water', zh: '水体' } },
    { id: 'textures', label: { en: 'Textures & Memory', zh: '纹理与显存' } },
];

const TABLE = [
    ...RESOLUTION_SETTINGS,
    ...VIEW_DISTANCE_SETTINGS,
    ...LIGHT_SETTINGS,
    ...SHADOW_SETTINGS,
    ...GLOBAL_ILLUMINATION_SETTINGS,
    ...REFLECTION_SETTINGS,
    ...SKY_SETTINGS,
    ...POST_PROCESSING_SETTINGS,
    ...EFFECT_SETTINGS,
    ...TERRAIN_SETTINGS,
    ...WATER_SETTINGS,
    ...TEXTURE_SETTINGS,
] as const satisfies readonly QualitySetting[];

export const QUALITY_SETTINGS: readonly QualitySetting[] = TABLE;

type Entry = typeof TABLE[number];

export type QualitySettingKey = Entry['key'];

export type QualitySettingValues = { [E in Entry as E['key']]: QualitySettingValueOf<E> };

export type QualitySettingPreferences = { [E in Entry as E['preference'] extends true ? E['key'] : never]?: QualitySettingValueOf<E> };

export function qualitySetting(key: string): QualitySetting | undefined {
    return QUALITY_SETTINGS.find((s) => s.key === key);
}

export function qualitySettingDefaults(level: QualityLevel): QualitySettingValues {
    return Object.fromEntries(QUALITY_SETTINGS.map((s) => [s.key, s.defaults[level]])) as QualitySettingValues;
}

export function parseQualitySetting(setting: QualitySetting, value: unknown, fallback: QualitySettingValue): QualitySettingValue {
    switch (setting.type) {
        case 'boolean':
            return typeof value === 'boolean' ? value : fallback;
        case 'choice':
            return typeof value === 'number' && setting.options.includes(value) ? value : fallback;
        case 'enum':
            return typeof value === 'string' && setting.options.includes(value) ? value : fallback;
        case 'number': {
            if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
            const held = Math.min(setting.max, Math.max(setting.min, value));
            return setting.integer ? Math.round(held) : held;
        }
    }
}

export function resolveQualitySettings(raw: Readonly<Record<string, unknown>>, base: Readonly<QualitySettingValues>): QualitySettingValues {
    const values = base as unknown as Readonly<Record<string, QualitySettingValue>>;
    return Object.fromEntries(QUALITY_SETTINGS.map((s) => [s.key, parseQualitySetting(s, raw[s.key], values[s.key]!)])) as QualitySettingValues;
}

export function qualitySettingPreferences(preferences: Readonly<Record<string, unknown>>): Partial<QualitySettingValues> {
    const out: Record<string, unknown> = {};
    for (const s of QUALITY_SETTINGS) {
        if (s.preference && preferences[s.key] !== undefined) out[s.key] = preferences[s.key];
    }
    return out as Partial<QualitySettingValues>;
}

export function qualitySettingRequirementsMet(setting: QualitySetting, values: object): boolean {
    return Object.entries(setting.requires ?? {}).every(([key, value]) => (values as Record<string, unknown>)[key] === value);
}

export function qualityEffectScale(values: object, effectType: string): number {
    let scale = 1;
    for (const s of QUALITY_SETTINGS) {
        if (s.type === 'number' && s.scalesEffects?.includes(effectType)) scale *= (values as Record<string, number>)[s.key]!;
    }
    return scale;
}

export function qualityEffectUniforms(values: object, effectType: string): [string, number][] {
    const out: [string, number][] = [];
    for (const s of QUALITY_SETTINGS) {
        if (s.type === 'enum' || !s.uniform?.effects.includes(effectType)) continue;
        const value = (values as Record<string, unknown>)[s.key];
        out.push([s.uniform.name, typeof value === 'boolean' ? (value ? 1 : 0) : value as number]);
    }
    return out;
}
