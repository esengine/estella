// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { QualitySetting } from './types';

export const EFFECT_SETTINGS = [
    {
        key: 'particleLimit',
        type: 'number',
        defaults: { low: 1000, medium: 5000, high: 20000 },
        min: 0, max: 1000000, step: 100, integer: true,
        group: 'effects',
        preference: false,
        label: { en: 'Particle limit', zh: '粒子上限' },
        description: {
            en: 'The most particles alive at once across the scene at this level.',
            zh: '这一档整个场景同时存在的粒子最多多少个。',
        },
    },
    {
        key: 'shelterMaskSize',
        type: 'number',
        defaults: { low: 256, medium: 512, high: 1024 },
        min: 64, max: 2048, step: 64, integer: true,
        group: 'effects',
        preference: false,
        label: { en: '2D rain shelter mask', zh: '2D 雨遮罩尺寸' },
        description: {
            en: 'The most texels a side the 2D rain\'s shelter mask has. It is painted every frame, so a smaller one costs less and gives rain whose dry edges are softer.',
            zh: '2D 雨的遮挡遮罩每边最多多少像素。遮罩每帧都重画，小一点更省，雨的干湿边缘更软。',
        },
    },
] as const satisfies readonly QualitySetting[];
