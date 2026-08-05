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
  /**
   * Open whatever the file held, as a state machine.
   *
   * The cast used to be blind, so a `.esfsm` that was not one — hand-written,
   * from another tool, half-migrated — reached the panel and crashed it on
   * `def.states.map` with "Cannot read properties of undefined". A file the
   * editor cannot read should open as an EMPTY machine you can see and repair,
   * not take the panel down: the crash names neither the file nor the reason,
   * and the panel is the only place to fix it from.
   */
  openJson(raw: unknown, filePath: string | null): void {
    const d = (raw ?? {}) as Partial<FsmDefinition>;
    this.open({
      initial: typeof d.initial === 'string' ? d.initial : '',
      states: Array.isArray(d.states) ? d.states : [],
    }, filePath);
  }
  close(): void {
    this.closeAsset();
  }
}

export const FsmGraphDocument = new FsmGraphDocumentImpl('fsm');
