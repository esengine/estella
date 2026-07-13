// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AnimClipDocument.ts
 * @brief   The open .esanim sprite flipbook as a reactive editor document.
 *          Same shape as TilesetDocument: a pure asset (binds to no scene
 *          entity), so the generic reactive + snapshot-undo core carries it.
 */

import { parseAnimClipAsset, type AnimClipAssetData } from 'esengine';
import { AssetDocument } from '@/document/AssetDocument';

export interface AnimClipDocMeta {
  filePath: string | null;
  dirty: boolean;
}

export class AnimClipDocumentImpl extends AssetDocument<AnimClipAssetData> {
  get meta(): AnimClipDocMeta {
    return { filePath: this.filePath, dirty: this.dirty };
  }

  /** Open an already-parsed clip asset. */
  open(asset: AnimClipAssetData, filePath: string | null): void {
    this.openAsset(asset, filePath);
  }

  /** Open from raw .esanim JSON (normalized by the SDK parser). */
  openJson(raw: unknown, filePath: string | null): void {
    this.open(parseAnimClipAsset(raw), filePath);
  }

  close(): void {
    this.closeAsset();
  }
}

/** The app's default flipbook document (the one the Flipbook editor panel drives). */
export const AnimClipDocument = new AnimClipDocumentImpl();
