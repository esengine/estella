// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { QualitySetting } from './types';

export const POST_PROCESSING_SETTINGS = [
    {
        key: 'postProcess',
        type: 'boolean',
        defaults: { low: true, medium: true, high: true },
        group: 'postProcessing',
        preference: false,
        label: { en: 'Post-processing', zh: '后处理' },
        description: {
            en: 'Off runs no effect at this level, whatever a camera\'s volume asks for.',
            zh: '关闭后这个档位不运行任何效果，不管相机的体积要求什么。',
        },
    },
    {
        key: 'lensFlareResolution',
        type: 'number',
        defaults: { low: 0.25, medium: 0.5, high: 1 },
        min: 0.125, max: 1, step: 0.125,
        group: 'postProcessing',
        preference: true,
        requires: { postProcess: true },
        scalesEffects: ['lensFlare'],
        label: { en: 'Lens flare resolution', zh: '镜头光晕分辨率' },
        description: {
            en: 'How large lens flare finds what is bright, as a share of its authored size (half the screen on a side), down to an eighth of the screen. It is laid over the full-size picture.',
            zh: '镜头光晕找亮处的尺寸，占原尺寸（屏幕边长的一半）的比例，最小到屏幕的八分之一。叠到全尺寸的画面上。',
        },
    },
] as const satisfies readonly QualitySetting[];
