// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { qualitySetting } from '../render/qualitySettings/index';

function levelUniform(key: string): { name: string; max: number; min: number; high: number } {
    const setting = qualitySetting(key);
    if (!setting || setting.type !== 'number' || !setting.uniform) throw new Error(`quality setting "${key}" is not a number sent as a uniform`);
    return { name: setting.uniform.name, max: setting.max, min: setting.min, high: setting.defaults.high };
}

export function qualityUniformParam(key: string): string {
    const u = levelUniform(key);
    return `#pragma param ${u.name} float default(${u.high}) range(${u.min},${u.max})`;
}

export function qualityUniformMax(key: string): number {
    return levelUniform(key).max;
}
