// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { QualitySetting } from './types';

export const LIGHT_SETTINGS = [
    {
        key: 'lighting',
        type: 'enum',
        options: ['full', 'direct'],
        optionLabels: {
            full: { en: 'Full', zh: '完整' },
            direct: { en: 'Direct', zh: '直接' },
        },
        defaults: { low: 'direct', medium: 'direct', high: 'full' },
        group: 'lights',
        preference: false,
        label: { en: '3D lighting', zh: '3D 光照' },
        description: {
            en: 'Full lights a 3D surface with everything the engine has: lights past the sixteen of the light block, soft shadows, hair shadows. Direct keeps the same lighting model with the sixteen lights and hard shadows only, about half the cost of a full-screen lit surface on a phone. Sprites keep their 2D lighting either way.',
            zh: '完整：3D 表面用上引擎的全部光照，包括光源块十六盏之外的灯、软阴影、头发阴影。直接：同一套光照模型，只用十六盏灯和硬阴影，手机上铺满全屏的受光表面成本约减半。精灵的 2D 光照两种都不变。',
        },
    },
    {
        key: 'loopLights',
        type: 'number',
        defaults: { low: 8, medium: 12, high: 16 },
        min: 1, max: 16, step: 1, integer: true,
        group: 'lights',
        preference: false,
        engine: 'loopLights',
        label: { en: 'Per-pixel lights', zh: '逐像素光源数' },
        description: {
            en: 'How many lights every lit pixel works out in turn: the sun and the lights that cast a shadow first, then the brightest. A point or spot light past them that casts no shadow is handed to the screen tiles it reaches when 3D lighting is Full, and is left out when it is Direct. Sixteen is the most the light block holds.',
            zh: '每个受光像素逐盏计算的光源数：太阳和投影的灯排在前面，其余按亮度。超出的点光、聚光如果不投影，3D 光照为完整时交给它照到的屏幕分块去算，为直接时不画。十六是光源块能装的上限。',
        },
    },
    {
        key: 'tiledLights',
        type: 'number',
        defaults: { low: 32, medium: 64, high: 96 },
        min: 0, max: 96, step: 1, integer: true,
        group: 'lights',
        preference: false,
        requires: { lighting: 'full' },
        engine: 'tiledLights',
        label: { en: 'Tiled lights', zh: '分块光源数' },
        description: {
            en: 'How many point and spot lights past the per-pixel ones are carried at all. Each is shaded only on the screen tiles (16 by 12) its reach covers, so the cost is how many of them overlap a pixel; past this many, the dimmest are left out. Only with Full 3D lighting.',
            zh: '逐像素光源之外，最多再带多少盏点光和聚光。每盏只在它照到的屏幕分块（16×12）里计算，成本取决于一个像素上叠了几盏；超过这个数，最暗的不画。只在 3D 光照为完整时起作用。',
        },
    },
] as const satisfies readonly QualitySetting[];
