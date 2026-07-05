// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    FsmGraphDocument.ts
 * @brief   Reactive, undoable document for a `.esfsm` — the state-machine editor's model.
 *          Same AssetDocument contract as MaterialGraphDocument: panels subscribe via
 *          useSyncExternalStore(subscribe, getRevision); edits go through the SDK's
 *          pure fsmGraph ops via {@link edit} (one undo step each). A `.esfsm` IS the
 *          runtime FsmDefinition, so there is no compile step on save.
 */
import type { FsmDefinition } from 'esengine';
import { AssetDocument } from '@/document/AssetDocument';

class FsmGraphDocumentImpl extends AssetDocument<FsmDefinition> {
  open(def: FsmDefinition, filePath: string | null): void {
    this.openAsset(def, filePath);
  }
  openJson(raw: unknown, filePath: string | null): void {
    this.open(raw as FsmDefinition, filePath);
  }
  close(): void {
    this.closeAsset();
  }
}

export const FsmGraphDocument = new FsmGraphDocumentImpl();
