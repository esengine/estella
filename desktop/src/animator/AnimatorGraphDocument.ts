// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AnimatorGraphDocument.ts
 * @brief   Reactive, undoable document for a `.esanimator` — the animation
 *          controller editor's model. Same AssetDocument contract as the FSM /
 *          material graph docs: panels subscribe via useSyncExternalStore
 *          (subscribe, getRevision); edits go through the SDK's pure animatorGraph
 *          ops via {@link edit} (one undo step each). A `.esanimator` IS the
 *          runtime AnimatorControllerDef, so there is no compile step on save.
 */
import type { AnimatorControllerDef } from 'esengine';
import { AssetDocument } from '@/document/AssetDocument';

class AnimatorGraphDocumentImpl extends AssetDocument<AnimatorControllerDef> {
  open(def: AnimatorControllerDef, filePath: string | null): void {
    this.openAsset(def, filePath);
  }
  openJson(raw: unknown, filePath: string | null): void {
    this.open(raw as AnimatorControllerDef, filePath);
  }
  close(): void {
    this.closeAsset();
  }
}

export const AnimatorGraphDocument = new AnimatorGraphDocumentImpl('animator');
