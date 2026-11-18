// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { QualitySetting } from './types';

export const GLOBAL_ILLUMINATION_SETTINGS = [
    {
        key: 'aoResolution',
        type: 'number',
        defaults: { low: 0.25, medium: 0.5, high: 1 },
        min: 0.125, max: 1, step: 0.125,
        group: 'globalIllumination',
        preference: true,
        requires: { postProcess: true },
        scalesEffects: ['ssao', 'gtao'],
        label: { en: 'Ambient occlusion resolution', zh: '环境光遮蔽分辨率' },
        description: {
            en: 'How large ambient occlusion (SSAO or GTAO) is worked out, as a share of its authored size, which is half the screen on a side. It stops at a quarter of the screen, where the term starts to break up; the composite over the picture stays full size.',
            zh: '环境光遮蔽（SSAO 或 GTAO）按原尺寸的多少比例计算，原尺寸是屏幕边长的一半。最小到屏幕的四分之一，再小遮蔽就会碎；叠回画面的那一步始终全尺寸。',
        },
    },
    {
        key: 'ssgiResolution',
        type: 'number',
        defaults: { low: 0.25, medium: 0.5, high: 1 },
        min: 0.125, max: 1, step: 0.125,
        group: 'globalIllumination',
        preference: true,
        requires: { postProcess: true },
        scalesEffects: ['ssgi'],
        label: { en: 'Screen-space GI resolution', zh: '屏幕空间 GI 分辨率' },
        description: {
            en: 'How large screen-space GI gathers its light, as a share of its authored size (half the screen on a side), down to an eighth of the screen.',
            zh: '屏幕空间 GI 收集光照的尺寸，占原尺寸（屏幕边长的一半）的比例，最小到屏幕的八分之一。',
        },
    },
    {
        key: 'voxelGIResolution',
        type: 'number',
        defaults: { low: 0.25, medium: 0.5, high: 1 },
        min: 0.125, max: 1, step: 0.125,
        group: 'globalIllumination',
        preference: true,
        requires: { postProcess: true },
        scalesEffects: ['voxelGI'],
        label: { en: 'Voxel GI gather resolution', zh: '体素 GI 收集分辨率' },
        description: {
            en: 'How large the voxel GI gather is drawn where it runs as fragment passes (WebGL2), as a share of its authored size (half the screen on a side), down to a quarter of the screen. The compute version on WebGPU keeps its size.',
            zh: '体素 GI 以片元通道运行时（WebGL2）收集一步画多大，占原尺寸（屏幕边长的一半）的比例，最小到屏幕的四分之一。WebGPU 上的计算版本尺寸不变。',
        },
    },
    {
        key: 'dynamicGIReduced',
        type: 'boolean',
        defaults: { low: true, medium: true, high: false },
        group: 'globalIllumination',
        preference: false,
        label: { en: 'Cheaper dynamic GI', zh: '动态 GI 降配' },
        description: {
            en: 'Run the Dynamic GI effect the cheaper way: one pixel in four asks the probes, a probe traces a quarter of its rays a frame, the cards are relit over eight frames and there are two thirds of the probe rows. About 4.5 ms instead of 7.3 on a Snapdragon 8 Elite. Light runs a pixel or two across an edge two surfaces share, and light that changes takes about twice as long to settle.',
            zh: '让 Dynamic GI 效果走省的那条路：四个像素里一个去问探针，探针每帧只打四分之一的射线，卡面分八帧更新，探针行数减到三分之二。在 Snapdragon 8 Elite 上约 4.5 ms，完整为 7.3 ms。两个面相交的边上光会串一两个像素，光照变化后要约两倍的时间才稳定。',
        },
    },
] as const satisfies readonly QualitySetting[];
