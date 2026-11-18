// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { QualitySetting } from './types';

export const REFLECTION_SETTINGS = [
    {
        key: 'planarReflectionScale',
        type: 'number',
        defaults: { low: 0.25, medium: 0.5, high: 1 },
        min: 0.125, max: 1, step: 0.125,
        group: 'reflections',
        preference: false,
        label: { en: 'Planar reflection scale', zh: '平面反射比例' },
        description: {
            en: 'The share of the screen\'s resolution a planar reflection (a mirror, a still pond) is drawn at, on a side.',
            zh: '平面反射（镜子、静水）按屏幕分辨率的多少比例绘制（按边长）。',
        },
    },
    {
        key: 'planarReflectionMaxSize',
        type: 'number',
        defaults: { low: 512, medium: 1024, high: 2048 },
        min: 64, max: 4096, step: 64, integer: true,
        group: 'reflections',
        preference: false,
        label: { en: 'Planar reflection max size', zh: '平面反射最大尺寸' },
        description: {
            en: 'The most texels a side a planar reflection is drawn at, whatever the scale makes of a large screen.',
            zh: '平面反射每边最多多少像素，不管比例在大屏上算出多大。',
        },
    },
    {
        key: 'planarReflectionUpdatesPerSecond',
        type: 'number',
        defaults: { low: 0, medium: 0, high: 0 },
        min: 0, max: 120, step: 1,
        group: 'reflections',
        preference: false,
        label: { en: 'Planar reflection updates / s', zh: '平面反射每秒更新次数' },
        description: {
            en: 'How often a planar reflection is drawn again. 0 is every frame; this never caps the main scene.',
            zh: '平面反射每秒重画几次。0 表示每帧；它不限制主场景。',
        },
    },
] as const satisfies readonly QualitySetting[];
