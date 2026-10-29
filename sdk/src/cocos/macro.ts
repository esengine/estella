// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/macro.ts
 * @brief   `macro`: the constants and engine switches a Cocos script reads.
 *
 * The values are Cocos's. The ones that are switches in Cocos (`ENABLE_MULTI_TOUCH`, the antialiasing flags) are plain properties
 * here, so reading and writing them works; whether they change anything is the engine's own configuration, not this object's.
 */
export const macro = {
    /** `repeat` count that means forever. */
    REPEAT_FOREVER: Number.MAX_VALUE - 1,
    INVALID_INDEX: -1,
    NODE_TAG_INVALID: -1,
    PI: Math.PI,
    PI2: Math.PI * 2,
    FLT_MAX: Number.MAX_VALUE,
    FLT_MIN: Number.MIN_VALUE,
    RAD: Math.PI / 180,
    DEG: 180 / Math.PI,
    UINT_MAX: 0xffffffff,

    ENABLE_MULTI_TOUCH: true,
    ENABLE_TILEDMAP_CULLING: true,
    ENABLE_TRANSPARENT_CANVAS: false,
    ENABLE_WEBGL_ANTIALIAS: true,
    ENABLE_ANTIALIAS_FXAA: false,
    ENABLE_BLOOM: false,
    ENABLE_WEBGL_HIGHP_STRUCT_VALUES: false,
    ENABLE_CULLING: false,
    CLEANUP_IMAGE_CACHE: false,
    SHOW_MESH_WIREFRAME: false,
    SHOW_MESH_NORMAL: false,
    ALLOW_IMAGE_BITMAP: true,
    DOWNLOAD_MAX_CONCURRENT: 64,
    BATCHER2D_MEM_INCREMENT: 144,
    CUSTOM_PIPELINE_NAME: '',
    SUPPORT_TEXTURE_FORMATS: ['.astc', '.pkm', '.pvr', '.webp', '.jpg', '.jpeg', '.bmp', '.png'],

    ORIENTATION_PORTRAIT: 1,
    ORIENTATION_LANDSCAPE: 2,
    ORIENTATION_AUTO: 3,

    TextAlignment: Object.freeze({ LEFT: 0, CENTER: 1, RIGHT: 2 }),
    VerticalTextAlignment: Object.freeze({ TOP: 0, CENTER: 1, BOTTOM: 2 }),

    /** Cocos reads these from a settings file; scripts rarely set them, and a script that does gets what it set back. */
    FIX_ARTIFACTS_BY_STRECHING_TEXEL_TMX: true,
};
