// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { QualitySetting } from './types';

export const TEXTURE_SETTINGS = [
    {
        key: 'textureStreaming',
        type: 'boolean',
        defaults: { low: true, medium: true, high: false },
        group: 'textures',
        preference: false,
        label: { en: 'Texture streaming', zh: '贴图流式加载' },
        description: {
            en: 'Hold each texture only meshes draw at the size its views need, and grow it back as the camera comes close. Saves GPU memory, and in a web build the download: a texture starts from a small copy, and its file is fetched only once a view needs more.',
            zh: '只被网格使用的贴图按视图实际需要的尺寸常驻，相机靠近时再变大。省显存；在 Web 构建里也省下载：贴图先用小副本，视图需要更大时才下载原文件。',
        },
    },
    {
        key: 'textureStreamingBudget',
        type: 'number',
        defaults: { low: 128, medium: 256, high: 0 },
        min: 0, max: 65536, step: 16, integer: true,
        group: 'textures',
        preference: false,
        label: { en: 'Texture streaming budget (MB)', zh: '贴图流式预算（MB）' },
        description: {
            en: 'The megabytes the streamed textures may take together; past it they are held a level softer. 0 is no cap.',
            zh: '被流式管理的贴图合计最多占用的 MB；超出时整体降一级清晰度。0 表示不设上限。',
        },
    },
] as const satisfies readonly QualitySetting[];
