// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    panelDirty.ts
 * @brief   Maps dock-panel ids to their document's unsaved state, so the dock
 *          tab can show the shared dirty dot. Every asset editor's document is
 *          an AssetDocument singleton (uniform subscribe + dirty).
 */
import { FsmGraphDocument } from '@/fsm/FsmGraphDocument';
import { AnimatorGraphDocument } from '@/animator/AnimatorGraphDocument';
import { BtDocument } from '@/bt/BtDocument';
import { MaterialGraphDocument } from '@/material/MaterialGraphDocument';
import { TilesetDocument } from '@/tileset/TilesetDocument';
import { AnimClipDocument } from '@/flipbook/AnimClipDocument';
import { TimelineDocument } from '@/timeline/TimelineDocument';

export interface DirtySource {
  subscribe(cb: () => void): () => void;
  isDirty(): boolean;
  /** The panel's DirtyRegistry document id — lets context-aware Save (Ctrl+S) route
   *  to this editor's document instead of the scene. Absent for panels with no doc. */
  docId?: string;
  /** Close the underlying document, dropping its unsaved edits — the dock tab X
   *  calls this after the user confirms the discard, so the dirty state (and the
   *  document's undo steps) don't linger invisibly behind a closed tab. */
  discard?(): void;
}

/** The reactive shape every AssetDocument singleton shares — enough to build a
 *  DirtySource. Structural (not the AssetDocument<T> class) so the generic asset
 *  type doesn't have to be erased at each call site. */
interface DirtyDoc {
  readonly docId: string;
  subscribe(fn: () => void): () => void;
  readonly dirty: boolean;
}

// Derive subscribe/isDirty/docId from the document itself — only `discard` (the
// subclass `close()`) is per-entry. In particular docId is READ from the document
// rather than re-typed here, so a panel's Ctrl+S can never route to the wrong
// document id by a copy-paste drift.
function docSource(doc: DirtyDoc, discard: () => void): DirtySource {
  return { docId: doc.docId, subscribe: doc.subscribe, isDirty: () => doc.dirty, discard };
}

const SOURCES: Record<string, DirtySource> = {
  statemachine: docSource(FsmGraphDocument, () => FsmGraphDocument.close()),
  animatorcontroller: docSource(AnimatorGraphDocument, () => AnimatorGraphDocument.close()),
  behaviortree: docSource(BtDocument, () => BtDocument.close()),
  materialgraph: docSource(MaterialGraphDocument, () => MaterialGraphDocument.close()),
  tileset: docSource(TilesetDocument, () => TilesetDocument.close()),
  flipbook: docSource(AnimClipDocument, () => AnimClipDocument.close()),
  sequencer: docSource(TimelineDocument, () => TimelineDocument.close()),
};

const NONE: DirtySource = { subscribe: () => () => {}, isDirty: () => false };

/** The dirty source for a dock panel (a no-op source for panels without one). */
export function panelDirtySource(panelId: string): DirtySource {
  return SOURCES[panelId] ?? NONE;
}
