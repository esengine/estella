// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { QualitySetting } from './types';

export const MOST_PLANET_LEVELS = 12;

export const TERRAIN_SETTINGS = [
    {
        key: 'detailScale',
        type: 'number',
        defaults: { low: 0.5, medium: 0.8, high: 1 },
        min: 0.25, max: 1, step: 0.05,
        group: 'terrain',
        preference: false,
        label: { en: 'Detail distance', zh: '细节距离' },
        description: {
            en: 'The share of its detail distances the ground and the plants keep at this level: how far a terrain or a planet keeps its finest cells, and how far a Foliage field and a grown plant are drawn and keep their finer mesh. At 0.5 each is half as far.',
            zh: '地面和植物在这一档保留多少比例的细节距离：地形和星球最细网格铺多远，Foliage 和生长的植物画多远、多远内保持精细网格。0.5 时都减半。',
        },
    },
    {
        key: 'terrainSurfaceTexels',
        type: 'choice',
        options: [64, 128, 256],
        defaults: { low: 128, medium: 256, high: 256 },
        group: 'terrain',
        preference: false,
        label: { en: 'Terrain surface page size', zh: '地形表面烘焙页尺寸' },
        description: {
            en: 'The side, in texels, of a page of a terrain\'s baked surface (Virtual Texture on). Half is a quarter of the memory and of the time a page takes to bake, and a softer ground from its first baked level out. With no quality policy a minigame takes the Low level\'s.',
            zh: '地形烘焙表面（开启 Virtual Texture 时）每页的边长（纹素）。减半，显存和每页烘焙时间都只剩四分之一，从第一个烘焙层级往外的地面更糊。没有画质策略的小游戏用低档的值。',
        },
    },
    {
        key: 'terrainSurfacesPerFrame',
        type: 'number',
        defaults: { low: 1, medium: 2, high: 2 },
        min: 1, max: 16, step: 1, integer: true,
        group: 'terrain',
        preference: false,
        label: { en: 'Terrain surface pages a frame', zh: '每帧烘焙地形页数' },
        description: {
            en: 'How many pages of a terrain\'s baked surface are drawn in one frame. Fewer spreads the baking over more frames: the ground comes in slower, and no frame pays for many pages at once.',
            zh: '每帧画几页地形烘焙表面。越少，烘焙摊到越多帧：地面出现得慢些，但不会有某一帧一次付很多页的代价。',
        },
    },
    {
        key: 'terrainAtlasSize',
        type: 'choice',
        options: [512, 1024, 2048],
        defaults: { low: 1024, medium: 2048, high: 2048 },
        group: 'terrain',
        preference: false,
        label: { en: 'Terrain page atlas', zh: '地形页图集尺寸' },
        description: {
            en: 'The side, in texels, of the atlases a terrain and a planet keep their pages of heights and paint in. Half holds a quarter of the pages: a ground that asks for more is drawn at the share of its detail distance that fits.',
            zh: '地形和星球存放高度页、绘制页的图集边长（纹素）。减半只能放四分之一的页：需要更多页的地面会按放得下的比例缩短细节距离。',
        },
    },
    {
        key: 'planetDrawLevels',
        type: 'number',
        defaults: { low: 10, medium: 11, high: 12 },
        min: 1, max: MOST_PLANET_LEVELS, step: 1, integer: true,
        group: 'terrain',
        preference: false,
        label: { en: 'Planet draw levels', zh: '星球绘制层级上限' },
        description: {
            en: 'The most levels of a planet\'s tree that are drawn: a planet whose cell size asks for more is drawn no finer than this many levels up from its whole face. Its collision and what code reads of its ground keep the cell size the Planet was given.',
            zh: '星球细分树最多画几层：单元尺寸要求更多层的星球，最细只画到从整个面往下这么多层。碰撞和代码读到的地面仍按 Planet 上设的单元尺寸。',
        },
    },
    {
        key: 'voxelRebuildBudgetMs',
        type: 'number',
        defaults: { low: 2, medium: 3, high: 4 },
        min: 0.5, max: 16, step: 0.5,
        group: 'terrain',
        preference: false,
        label: { en: 'Voxel rebuild budget (ms)', zh: '体素重建预算（毫秒）' },
        description: {
            en: 'The most of a frame, in milliseconds, a voxel terrain spends making again the chunks an edit changed. At least one chunk is made each frame, so a dig is never left waiting.',
            zh: '体素地形每帧最多花多少毫秒重建被编辑改动的分块。每帧至少重建一块，挖掘不会一直等着。',
        },
    },
    {
        key: 'plantInteractionActive',
        type: 'number',
        defaults: { low: 128, medium: 256, high: 512 },
        min: 0, max: 4096, step: 16, integer: true,
        group: 'terrain',
        preference: false,
        label: { en: 'Plants that bend', zh: '可同时弯曲的植物数' },
        description: {
            en: 'The most plants bending away from a body at once. A game\'s own PlantInteraction.maxActive lower than this is kept.',
            zh: '同时被身体推弯的植物最多有几株。游戏自己设的 PlantInteraction.maxActive 更低时用它的。',
        },
    },
    {
        key: 'plantInteractionPerFrame',
        type: 'number',
        defaults: { low: 16, medium: 32, high: 48 },
        min: 0, max: 512, step: 1, integer: true,
        group: 'terrain',
        preference: false,
        label: { en: 'Plants starting to bend a frame', zh: '每帧开始弯曲的植物数' },
        description: {
            en: 'The most plants that start bending in one frame. A game\'s own PlantInteraction.maxActivatedPerFrame lower than this is kept.',
            zh: '每帧最多有几株植物开始弯曲。游戏自己设的 PlantInteraction.maxActivatedPerFrame 更低时用它的。',
        },
    },
] as const satisfies readonly QualitySetting[];
