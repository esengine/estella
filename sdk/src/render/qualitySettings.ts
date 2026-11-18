// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { QualityLevel } from './quality';

export type QualitySettingGroup = 'rendering' | 'shadows' | 'reflections' | 'water' | 'post';

export interface QualitySettingText {
    readonly en: string;
    readonly zh: string;
}

export interface QualityNumberSetting {
    readonly key: string;
    readonly type: 'number';
    readonly defaults: Readonly<Record<QualityLevel, number>>;
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly integer?: boolean;
    readonly group: QualitySettingGroup;
    readonly preference: boolean;
    readonly label: QualitySettingText;
    readonly description: QualitySettingText;
}

export type QualitySetting = QualityNumberSetting;

export const QUALITY_SETTINGS = [
    {
        key: 'effectResolution',
        type: 'number',
        defaults: { low: 0.25, medium: 0.5, high: 1 },
        min: 0.125, max: 1, step: 0.125,
        group: 'post',
        preference: true,
        label: { en: 'Effect resolution', zh: '效果分辨率' },
        description: {
            en: 'How large the effects that are already drawn small are drawn at this level: ambient occlusion, the light in height fog, screen-space GI, lens flare and the voxel GI gather. 1 is as authored, half the screen on a side; 0.5 is a quarter and 0.25 an eighth. Each effect stops at its own smallest size, and the passes over the whole picture (tone mapping, FXAA, grading) always run at full size.',
            zh: '这个档位下本来就降分辨率画的效果画多大：环境光遮蔽、高度雾里的光、屏幕空间 GI、镜头光晕和体素 GI 的收集。1 是原样，边长为屏幕的一半；0.5 是四分之一，0.25 是八分之一。每个效果到自己的最小尺寸就不再降，作用于整幅画面的通道（色调映射、FXAA、调色）始终按全分辨率跑。',
        },
    },
] as const satisfies readonly QualitySetting[];

type Entry = typeof QUALITY_SETTINGS[number];

export type QualitySettingKey = Entry['key'];

export type QualitySettingValues = { [K in QualitySettingKey]: number };

export type QualitySettingPreferences = { [E in Entry as E['preference'] extends true ? E['key'] : never]?: number };

export function qualitySettingDefaults(level: QualityLevel): QualitySettingValues {
    return Object.fromEntries(QUALITY_SETTINGS.map((s) => [s.key, s.defaults[level]])) as QualitySettingValues;
}

export function parseQualitySetting(setting: QualitySetting, value: unknown, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    const held = Math.min(setting.max, Math.max(setting.min, value));
    return setting.integer ? Math.round(held) : held;
}

export function resolveQualitySettings(raw: Readonly<Record<string, unknown>>, base: Readonly<QualitySettingValues>): QualitySettingValues {
    return Object.fromEntries(QUALITY_SETTINGS.map((s) => [s.key, parseQualitySetting(s, raw[s.key], base[s.key])])) as QualitySettingValues;
}

export function qualitySettingPreferences(preferences: Readonly<Record<string, unknown>>): Partial<QualitySettingValues> {
    const out: Record<string, number> = {};
    for (const s of QUALITY_SETTINGS) {
        const value = preferences[s.key];
        if (s.preference && typeof value === 'number') out[s.key] = value;
    }
    return out as Partial<QualitySettingValues>;
}
