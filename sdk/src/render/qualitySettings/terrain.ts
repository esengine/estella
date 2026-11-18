// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { QualitySetting } from './types';

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
            en: 'The share of its distances a plant keeps at this level. At 0.5 a tree changes to its cheaper mesh and stops being drawn at half the distance, and its far cards take over sooner.',
            zh: '植物在这一档保留多少比例的距离。0.5 时，树在一半的距离处换成更省的网格并不再绘制，远景卡片更早接手。',
        },
    },
] as const satisfies readonly QualitySetting[];
