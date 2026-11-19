// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { QualitySetting } from './types';

export const RESOLUTION_SETTINGS = [
    {
        key: 'renderScale',
        type: 'number',
        defaults: { low: 0.75, medium: 1, high: 1 },
        min: 0.25, max: 1, step: 0.05,
        group: 'resolution',
        preference: false,
        label: { en: 'Render scale', zh: '渲染比例' },
        description: {
            en: 'The share of the screen\'s resolution the 3D scene is drawn at, on a side; the picture is scaled up to the screen. With dynamic resolution this is where the scale starts and the most it comes back to.',
            zh: '3D 场景按屏幕分辨率的多少比例绘制（按边长），再放大到屏幕。开了动态分辨率时，这是起始比例，也是回升的上限。',
        },
    },
    {
        key: 'minRenderScale',
        type: 'number',
        defaults: { low: 0.5, medium: 0.65, high: 0.75 },
        min: 0.25, max: 1, step: 0.05,
        group: 'resolution',
        preference: false,
        label: { en: 'Min render scale', zh: '最小渲染比例' },
        description: {
            en: 'The lowest dynamic resolution may take the render scale to while frames are late. Never above the render scale.',
            zh: '帧来不及时，动态分辨率最多把渲染比例降到多少。不会高于渲染比例。',
        },
    },
    {
        key: 'antialiasing',
        type: 'enum',
        options: ['msaa', 'temporal'],
        optionLabels: {
            msaa: { en: 'MSAA', zh: 'MSAA' },
            temporal: { en: 'Temporal', zh: '时间性' },
        },
        defaults: { low: 'msaa', medium: 'temporal', high: 'msaa' },
        group: 'resolution',
        preference: false,
        label: { en: 'Anti-aliasing', zh: '抗锯齿方式' },
        description: {
            en: 'MSAA multisamples the scene target. Temporal draws at one sample and lets the TAA pass smooth from the frames before: far cheaper at 1080p, somewhat softer, and surfaces that move without a motion vector (water) smear a little while the camera moves. Temporal needs a post-process volume on the camera.',
            zh: 'MSAA 对场景目标多重采样。时间性按 1 个采样绘制，由 TAA 通道用之前的帧来平滑：1080p 下便宜得多，画面略软，没有运动向量的表面（水）在相机移动时会有轻微拖影。时间性需要相机上有后处理体积。',
        },
    },
    {
        key: 'msaaSamples',
        type: 'choice',
        options: [1, 2, 4, 8],
        optionLabels: {
            1: { en: 'Off', zh: '关闭' },
            2: { en: '2x', zh: '2x' },
            4: { en: '4x', zh: '4x' },
            8: { en: '8x', zh: '8x' },
        },
        defaults: { low: 1, medium: 2, high: 4 },
        group: 'resolution',
        preference: false,
        requires: { antialiasing: 'msaa' },
        label: { en: 'MSAA', zh: '多重采样 (MSAA)' },
        description: {
            en: 'Samples a pixel of the scene target takes when the level smooths edges with MSAA. Each step costs memory and fill; under temporal anti-aliasing the scene is drawn at one sample whatever this says.',
            zh: '档位用 MSAA 抗锯齿时，场景目标每个像素的采样数。每多一级都多占显存和填充；用时间性抗锯齿时，不管这里写多少都按 1 个采样绘制。',
        },
    },
] as const satisfies readonly QualitySetting[];
