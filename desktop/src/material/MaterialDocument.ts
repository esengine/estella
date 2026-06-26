// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MaterialDocument.ts
 * @brief   Reactive, undoable document for a single `.esmaterial` — the Material Editor's
 *          model. Subclasses AssetDocument with the same contract as TilesetDocument: panels
 *          subscribe via useSyncExternalStore(subscribe, getRevision); edits go through
 *          {@link AssetDocument.edit} (one undo step each).
 */
import type { MaterialAssetData } from 'esengine';
import { AssetDocument } from '@/document/AssetDocument';

export interface MaterialDocMeta {
  filePath: string | null;
  dirty: boolean;
  isInstance: boolean;
}

class MaterialDocumentImpl extends AssetDocument<MaterialAssetData> {
  /**
   * The running material handle this document edits (the one the scene's sprites use), or 0
   * when the material isn't in the current scene. The editor pushes live parameter edits onto
   * it so the viewport reflects them immediately — the document stays the source of truth.
   */
  private _liveHandle = 0;
  get liveHandle(): number {
    return this._liveHandle;
  }
  setLiveHandle(handle: number): void {
    this._liveHandle = handle;
  }

  get meta(): MaterialDocMeta {
    return {
      filePath: this.filePath,
      dirty: this.dirty,
      isInstance: this.asset?.instanceOf != null,
    };
  }

  open(asset: MaterialAssetData, filePath: string | null): void {
    this._liveHandle = 0;  // resolved by the opener once the asset is bound
    this.openAsset(asset, filePath);
  }

  openJson(raw: unknown, filePath: string | null): void {
    this.open(raw as MaterialAssetData, filePath);
  }

  close(): void {
    this._liveHandle = 0;
    this.closeAsset();
  }
}

export const MaterialDocument = new MaterialDocumentImpl();
