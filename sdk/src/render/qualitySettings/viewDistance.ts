// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { QualitySetting } from './types';

export const VIEW_DISTANCE_SETTINGS = [
    {
        key: 'depthPrepass',
        type: 'boolean',
        defaults: { low: false, medium: true, high: true },
        group: 'viewDistance',
        preference: false,
        label: { en: 'Depth pre-pass', zh: '深度预通道' },
        description: {
            en: 'Draw the opaque scene twice, depth alone first, so each pixel is shaded once for the surface in front. It pays where surfaces overlap (a wood, a crowd of foliage) on a GPU that shades what it rasterises; on one that defers shading to the end of a tile it is geometry paid for twice.',
            zh: '不透明场景画两遍，先只画深度，让每个像素只为最前面的表面着色一次。表面大量重叠（树林、成片植被）且 GPU 对光栅化出的像素立即着色时划算；对把着色推迟到分块末尾的 GPU，等于几何多付一遍。',
        },
    },
    {
        key: 'drawCallBudget',
        type: 'number',
        defaults: { low: 150, medium: 400, high: 1500 },
        min: 1, max: 100000, step: 10, integer: true,
        group: 'viewDistance',
        preference: false,
        label: { en: 'Draw call budget', zh: 'Draw call 预算' },
        description: {
            en: 'The most draws a frame at this level should ask of the GPU, every pass counted (shadows, prepass, reflections, post-processing). Nothing is held back to meet it: the Profiler and the stats overlay show a frame over it.',
            zh: '这一档每帧最多应向 GPU 发出的 draw 数，所有 pass 都算（阴影、预深度、反射、后处理）。不会为了达标而少画：Profiler 和统计浮层会标出超出的帧。',
        },
    },
] as const satisfies readonly QualitySetting[];
