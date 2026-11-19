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
    {
        key: 'lodDistanceScale',
        type: 'number',
        defaults: { low: 0.6, medium: 0.8, high: 1 },
        min: 0.25, max: 2, step: 0.05,
        group: 'viewDistance',
        preference: false,
        label: { en: 'LOD distance scale', zh: 'LOD 距离倍率' },
        description: {
            en: 'Multiplies the distances at which every LOD Group hands over to its next level and stops being drawn, and the one where an impostor card stands in. At 0.6 a model changes to its cheaper mesh at 60% of the distance its group was authored for.',
            zh: '所有 LOD Group 切到下一级和不再绘制的距离、替身卡片接手的距离，都乘以它。0.6 时，模型在作者设定距离的 60% 处就换成更省的网格。',
        },
    },
    {
        key: 'occlusionGridSize',
        type: 'choice',
        options: [16, 32, 64],
        defaults: { low: 64, medium: 64, high: 64 },
        group: 'viewDistance',
        preference: false,
        label: { en: 'Occlusion grid', zh: '遮挡剔除栅格' },
        description: {
            en: 'Texels a side of the grid the declared occluders are drawn into on the CPU, which every object is then tested against. A coarser grid costs less to fill and hides less: an occluder has to cover a whole texel to hide what is behind it.',
            zh: '声明的遮挡体在 CPU 上画进的栅格每边多少格，之后每个物体都拿它来测试。栅格越粗填得越省，挡住的也越少：遮挡体要盖满整格才能挡住后面的东西。',
        },
    },
    {
        key: 'batchScanFrames',
        type: 'number',
        defaults: { low: 60, medium: 30, high: 30 },
        min: 1, max: 600, step: 1, integer: true,
        group: 'viewDistance',
        preference: false,
        label: { en: 'Batch scan interval (frames)', zh: '合批扫描间隔（帧）' },
        description: {
            en: 'Frames between looks at a merged model, and at a static batch, for parts that moved or went away. Longer spends less of the CPU on a still scene and notices a change later; refresh() looks at once.',
            zh: '每隔多少帧检查一次合并模型和静态合批里有没有部件移动或消失。间隔越长，静止场景占用的 CPU 越少，发现变化也越晚；refresh() 会立即检查。',
        },
    },
] as const satisfies readonly QualitySetting[];
