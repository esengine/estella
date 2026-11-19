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
    {
        key: 'refractionSamples',
        type: 'number',
        defaults: { low: 4, medium: 6, high: 8 },
        min: 1, max: 8, step: 1, integer: true,
        group: 'effects',
        preference: false,
        materialSlot: 0,
        label: { en: 'Refraction blur samples', zh: '折射模糊采样' },
        description: {
            en: 'How many points of the scene behind a rough glass or water surface it reads around where its refracted ray lands. They spread over the same blur whatever their number.',
            zh: '粗糙的玻璃或水面在折射光线落点周围读多少个背后场景的点。无论多少个都铺满同样的模糊范围。',
        },
    },
    {
        key: 'particleCollisionQueries',
        type: 'number',
        defaults: { low: 1024, medium: 2048, high: 4096 },
        min: 0, max: 65536, step: 256, integer: true,
        group: 'effects',
        preference: false,
        label: { en: 'Particle collision queries', zh: '粒子碰撞查询上限' },
        description: {
            en: 'The most rays the particles colliding with physics bodies cast in a frame, over the whole scene. A particle past it flies on through that frame. A budget the game sets itself wins over this one.',
            zh: '整个场景的粒子与物理体碰撞时，一帧最多发多少条射线。超出的粒子这一帧直接穿过。游戏自己设的预算优先于它。',
        },
    },
    {
        key: 'particleCollisionEvents',
        type: 'number',
        defaults: { low: 256, medium: 512, high: 1024 },
        min: 0, max: 16384, step: 64, integer: true,
        group: 'effects',
        preference: false,
        label: { en: 'Particle collision events', zh: '粒子碰撞事件上限' },
        description: {
            en: 'The most particle collisions reported to the game in a frame. Past it a collision still bounces the particle and is not reported. A budget the game sets itself wins over this one.',
            zh: '一帧最多向游戏报告多少次粒子碰撞。超出的碰撞粒子照样反弹，只是不报告。游戏自己设的预算优先于它。',
        },
    },
    {
        key: 'particleDepthGrid',
        type: 'number',
        defaults: { low: 320, medium: 480, high: 640 },
        min: 64, max: 640, step: 32, integer: true,
        group: 'effects',
        preference: false,
        label: { en: 'GPU particle depth grid', zh: 'GPU 粒子深度网格' },
        description: {
            en: 'How many texels across the copy of the scene\'s depth is that particles simulated on the GPU collide with, where the screen is wider. A coarser one finds the same surfaces with blunter edges.',
            zh: 'GPU 模拟的粒子用来碰撞的场景深度副本横向最多多少格（屏幕更宽时）。格子粗一些，碰到的面不变，边缘更钝。',
        },
    },
] as const satisfies readonly QualitySetting[];
