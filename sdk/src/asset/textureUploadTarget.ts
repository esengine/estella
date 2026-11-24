// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { TextureContent, type CppResourceManager } from '../wasm';

/** Recovery category and optional pool owner. An owner can reject an upload after its realm has retired. */
export interface TextureUploadTarget {
    readonly content: TextureContent;
    resourceManager?(): CppResourceManager;
}

export const assetTextureTarget: TextureUploadTarget = { content: TextureContent.Asset };
