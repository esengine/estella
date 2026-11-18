// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { QualitySetting } from './types';

export const SHADOW_SETTINGS = [
    {
        key: 'shadowAtlasSize',
        type: 'choice',
        options: [512, 1024, 2048, 4096],
        defaults: { low: 1024, medium: 2048, high: 4096 },
        group: 'shadows',
        preference: false,
        label: { en: 'Atlas size', zh: '阴影图集尺寸' },
        description: {
            en: 'Texels a side of the texture every shadow map of the frame is packed into. A cell never takes more than half of it.',
            zh: '一帧所有阴影贴图共用的图集每边多少像素。单元尺寸不会超过它的一半。',
        },
    },
    {
        key: 'shadowCellSize',
        type: 'choice',
        options: [128, 256, 512, 1024],
        defaults: { low: 256, medium: 512, high: 1024 },
        group: 'shadows',
        preference: false,
        label: { en: 'Cell size', zh: '阴影单元尺寸' },
        description: {
            en: 'Texels a side of one shadow map (a cascade, a spot light). At 512 a card that hugs a face (a brow, a hairline) falls inside one texel of the skin and the shadow speckles it; 1024 clears it for a character at arm\'s length.',
            zh: '单张阴影贴图（一个级联、一盏聚光灯）每边多少像素。512 时贴着脸的面片（眉毛、发际线）落在皮肤的同一个像素里，阴影会把它染脏；1024 能让一臂之外的角色干净。',
        },
    },
    {
        key: 'shadowCascades',
        type: 'number',
        defaults: { low: 2, medium: 3, high: 4 },
        min: 1, max: 4, step: 1, integer: true,
        group: 'shadows',
        preference: false,
        label: { en: 'Cascades', zh: '级联数' },
        description: {
            en: 'The cascades a perspective sun\'s shadow is split into. Each one draws the casters again. A sun with its own shadow extent draws a single map and uses neither this nor the distance.',
            zh: '透视相机下太阳阴影分成几级。每多一级就把投影物多画一遍。自己设了阴影范围的太阳只画一张图，不用这一项，也不用距离。',
        },
    },
    {
        key: 'shadowDistance',
        type: 'number',
        defaults: { low: 0, medium: 0, high: 0 },
        min: 0, max: 10000000, step: 1,
        group: 'shadows',
        preference: false,
        label: { en: 'Distance', zh: '阴影距离' },
        description: {
            en: 'Scene units. 0 follows the camera far plane. Limits perspective sun cascades; explicit light coverage stays unchanged. Wider manual coverage reduces nearby shadow detail.',
            zh: '使用场景单位；0 沿用相机远平面。仅限制透视太阳级联，灯光手动覆盖范围保持不变。手动覆盖越大，近景阴影精度越低。',
        },
    },
    {
        key: 'shadowSoftSamples',
        type: 'number',
        defaults: { low: 8, medium: 12, high: 16 },
        min: 1, max: 32, step: 1, integer: true,
        group: 'shadows',
        preference: false,
        label: { en: '2D soft-shadow samples', zh: '2D 软阴影采样数' },
        description: {
            en: 'How many samples across a 2D light a soft 2D shadow is drawn with: its penumbra is that many silhouettes added up. Fewer is cheaper and shows the edge as bands; sixteen is where the bands stop reading as separate shadows. 3D shadows do not read it.',
            zh: '2D 软阴影沿 2D 光源取多少个采样：半影是这么多个剪影叠起来。少了便宜，但边缘会出现条带；十六个起条带就不再像一道道分开的影子。3D 阴影不读这一项。',
        },
    },
] as const satisfies readonly QualitySetting[];
