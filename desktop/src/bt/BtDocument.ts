// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    BtDocument.ts
 * @brief   Reactive, undoable document for a `.esbt` — the behavior-tree editor's model.
 *          Same AssetDocument contract as FsmGraphDocument; edits go through the pure
 *          SDK btGraph ops via {@link edit}. A `.esbt` IS the runtime BtDefinition
 *          (nodes carry editor-only id/x/y the interpreter ignores) — no compile step.
 */
import type { BtDefinition } from 'esengine';
import { AssetDocument } from '@/document/AssetDocument';

class BtDocumentImpl extends AssetDocument<BtDefinition> {
  open(def: BtDefinition, filePath: string | null): void {
    this.openAsset(def, filePath);
  }
  openJson(raw: unknown, filePath: string | null): void {
    this.open(raw as BtDefinition, filePath);
  }
  close(): void {
    this.closeAsset();
  }
}

export const BtDocument = new BtDocumentImpl('bt');
