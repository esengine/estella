// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TilesetDocument.ts
 * @brief   The open .estileset as a reactive editor document — the second
 *          {@link AssetDocument} (after the Sequencer's TimelineDocument), and the
 *          rule-of-three that confirmed the base is generic.
 *
 * A tileset is a pure asset (unlike a timeline it binds to no scene entity), so this
 * subclass adds almost nothing over the generic reactive + snapshot-undo core — just
 * typed open/close + a `meta` getter for the panel chrome.
 */

import { parseTileset, type TilesetAsset } from 'esengine';
import { AssetDocument } from '@/document/AssetDocument';

export interface TilesetDocMeta {
  filePath: string | null;
  dirty: boolean;
}

export class TilesetDocumentImpl extends AssetDocument<TilesetAsset> {
  get meta(): TilesetDocMeta {
    return { filePath: this.filePath, dirty: this.dirty };
  }

  /** Open an already-parsed tileset asset. */
  open(asset: TilesetAsset, filePath: string | null): void {
    this.openAsset(asset, filePath);
  }

  /** Open from raw .estileset JSON (normalized by the SDK parser). */
  openJson(raw: unknown, filePath: string | null): void {
    this.open(parseTileset(raw), filePath);
  }

  close(): void {
    this.closeAsset();
  }
}

/** The app's default tileset document (the one the Tileset editor panel drives). */
export const TilesetDocument = new TilesetDocumentImpl();
