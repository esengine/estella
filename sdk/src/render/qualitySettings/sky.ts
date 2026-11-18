// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { QualitySetting } from './types';

export const SKY_SETTINGS = [
    {
        key: 'stillSky',
        type: 'boolean',
        defaults: { low: true, medium: true, high: false },
        group: 'sky',
        preference: false,
        label: { en: 'Still sky from a panorama', zh: '静态天空走全景图' },
        description: {
            en: 'A sky effect defined still is drawn once into a panorama and read from it, where it is otherwise worked out for every pixel of every frame.',
            zh: '定义为静态的天空效果只画一次到全景图里，之后从全景图读；关闭时每帧每个像素都重新计算。',
        },
    },
    {
        key: 'fogResolution',
        type: 'number',
        defaults: { low: 0.25, medium: 0.5, high: 1 },
        min: 0.125, max: 1, step: 0.125,
        group: 'sky',
        preference: true,
        requires: { postProcess: true },
        scalesEffects: ['heightFog'],
        label: { en: 'Fog volume resolution', zh: '雾体积分辨率' },
        description: {
            en: 'How large the light in height fog (the sun through the haze, the clouds\' shafts) is walked, as a share of its authored size (half the screen on a side), down to an eighth of the screen. The haze itself stays full size.',
            zh: '高度雾里的光（穿过雾气的阳光、云的光束）按原尺寸（屏幕边长的一半）的多少比例步进，最小到屏幕的八分之一。雾本身始终全尺寸。',
        },
    },
] as const satisfies readonly QualitySetting[];
