// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { QualitySetting } from './types';

export const LIGHT_SETTINGS = [
    {
        key: 'lighting',
        type: 'enum',
        options: ['full', 'direct'],
        optionLabels: {
            full: { en: 'Full', zh: '完整' },
            direct: { en: 'Direct', zh: '直接' },
        },
        defaults: { low: 'direct', medium: 'direct', high: 'full' },
        group: 'lights',
        preference: false,
        label: { en: '3D lighting', zh: '3D 光照' },
        description: {
            en: 'Full lights a 3D surface with everything the engine has: lights past the sixteen of the light block, soft shadows, hair shadows. Direct keeps the same lighting model with the sixteen lights and hard shadows only, about half the cost of a full-screen lit surface on a phone. Sprites keep their 2D lighting either way.',
            zh: '完整：3D 表面用上引擎的全部光照，包括光源块十六盏之外的灯、软阴影、头发阴影。直接：同一套光照模型，只用十六盏灯和硬阴影，手机上铺满全屏的受光表面成本约减半。精灵的 2D 光照两种都不变。',
        },
    },
] as const satisfies readonly QualitySetting[];
