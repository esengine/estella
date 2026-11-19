// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { QualityLevel } from '../quality';

export type QualitySettingGroup =
    | 'resolution'
    | 'viewDistance'
    | 'lights'
    | 'shadows'
    | 'globalIllumination'
    | 'reflections'
    | 'sky'
    | 'postProcessing'
    | 'effects'
    | 'terrain'
    | 'water'
    | 'textures';

export interface QualitySettingText {
    readonly en: string;
    readonly zh: string;
}

export interface QualityEffectUniform {
    readonly effects: readonly string[];
    readonly name: string;
}

interface QualitySettingBase<T> {
    readonly key: string;
    readonly defaults: Readonly<Record<QualityLevel, T>>;
    readonly group: QualitySettingGroup;
    readonly preference: boolean;
    readonly label: QualitySettingText;
    readonly description: QualitySettingText;
    readonly requires?: Readonly<Record<string, boolean | number | string>>;
    readonly engine?: string;
}

export interface QualityNumberSetting extends QualitySettingBase<number> {
    readonly type: 'number';
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly integer?: boolean;
    readonly scalesEffects?: readonly string[];
    readonly uniform?: QualityEffectUniform;
    readonly materialSlot?: 0 | 1 | 2 | 3;
}

export interface QualityBooleanSetting extends QualitySettingBase<boolean> {
    readonly type: 'boolean';
    readonly uniform?: QualityEffectUniform;
}

export interface QualityChoiceSetting extends QualitySettingBase<number> {
    readonly type: 'choice';
    readonly options: readonly number[];
    readonly optionLabels?: Readonly<Record<number, QualitySettingText>>;
    readonly uniform?: QualityEffectUniform;
    readonly materialSlot?: 0 | 1 | 2 | 3;
}

export interface QualityEnumSetting extends QualitySettingBase<string> {
    readonly type: 'enum';
    readonly options: readonly string[];
    readonly optionLabels: Readonly<Record<string, QualitySettingText>>;
}

export type QualitySetting = QualityNumberSetting | QualityBooleanSetting | QualityChoiceSetting | QualityEnumSetting;

export type QualitySettingValue = number | boolean | string;

export type QualitySettingValueOf<S> = S extends { readonly type: 'boolean' } ? boolean
    : S extends { readonly type: 'choice' | 'enum'; readonly options: readonly (infer O)[] } ? O
    : number;
