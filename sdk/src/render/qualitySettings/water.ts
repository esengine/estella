// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { QualitySetting } from './types';

export const MOST_WATER_WAVES = 8;

export const WATER_SETTINGS = [
    {
        key: 'waterWaves',
        type: 'number',
        defaults: { low: 3, medium: 5, high: 8 },
        min: 1, max: MOST_WATER_WAVES, step: 1, integer: true,
        group: 'water',
        preference: false,
        label: { en: 'Water waves', zh: '水体波数' },
        description: {
            en: 'How many of the water\'s eight waves are summed, longest first: in the geometry, the shading, and what Waters.sample answers.',
            zh: '水的八道波里从最长的起累加几道：几何、着色以及 Waters.sample 的回答都按它。',
        },
    },
    {
        key: 'waterRippleCells',
        type: 'number',
        defaults: { low: 32, medium: 64, high: 128 },
        min: 0, max: 256, step: 8, integer: true,
        group: 'water',
        preference: false,
        label: { en: 'Water ripple cells', zh: '水体涟漪格数' },
        description: {
            en: 'The most cells along a side of a body\'s ripple grid; a body\'s own Ripples is held to it. 0 keeps none.',
            zh: '水体涟漪网格每边最多多少格；水体自己的 Ripples 会被限制到它。0 表示不保留。',
        },
    },
    {
        key: 'waterDisplacement',
        type: 'boolean',
        defaults: { low: false, medium: true, high: true },
        group: 'water',
        preference: false,
        label: { en: 'Water displacement', zh: '水体位移' },
        description: {
            en: 'Off is the lite water: a flat surface whose waves are in the shading only, which code reads as flat. A minigame with no quality policy gets the Low level\'s water.',
            zh: '关闭就是轻量水：平的表面，波浪只在着色里，代码读到的也是平面。没有画质策略的小游戏用低档的水。',
        },
    },
    {
        key: 'waterMirror',
        type: 'boolean',
        defaults: { low: false, medium: true, high: true },
        group: 'water',
        preference: false,
        label: { en: 'Water mirror', zh: '水体镜面' },
        description: {
            en: 'Whether the surface seen from below mirrors the world under it (a screen-space march per pixel).',
            zh: '从水下看水面时，是否映出它下面的世界（逐像素的屏幕空间步进）。',
        },
    },
    {
        key: 'waterCaustics',
        type: 'boolean',
        defaults: { low: false, medium: true, high: true },
        group: 'water',
        preference: false,
        label: { en: 'Water caustics', zh: '水体焦散' },
        description: {
            en: 'Whether the sun\'s web of light is drawn on what lies under the water, and, seen from under it, the light shafts.',
            zh: '阳光的光网是否画在水下的东西上，以及从水下看时的光束。',
        },
    },
] as const satisfies readonly QualitySetting[];
