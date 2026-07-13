// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    panelDirty.ts
 * @brief   Maps dock-panel ids to their document's unsaved state, so the dock
 *          tab can show the shared dirty dot. Every asset editor's document is
 *          an AssetDocument singleton (uniform subscribe + dirty).
 */
import { FsmGraphDocument } from '@/fsm/FsmGraphDocument';
import { BtDocument } from '@/bt/BtDocument';
import { MaterialGraphDocument } from '@/material/MaterialGraphDocument';
import { TilesetDocument } from '@/tileset/TilesetDocument';
import { AnimClipDocument } from '@/flipbook/AnimClipDocument';
import { TimelineDocument } from '@/timeline/TimelineDocument';

export interface DirtySource {
  subscribe(cb: () => void): () => void;
  isDirty(): boolean;
}

const SOURCES: Record<string, DirtySource> = {
  statemachine: { subscribe: FsmGraphDocument.subscribe, isDirty: () => FsmGraphDocument.dirty },
  behaviortree: { subscribe: BtDocument.subscribe, isDirty: () => BtDocument.dirty },
  materialgraph: { subscribe: MaterialGraphDocument.subscribe, isDirty: () => MaterialGraphDocument.dirty },
  tileset: { subscribe: TilesetDocument.subscribe, isDirty: () => TilesetDocument.dirty },
  flipbook: { subscribe: AnimClipDocument.subscribe, isDirty: () => AnimClipDocument.dirty },
  sequencer: { subscribe: TimelineDocument.subscribe, isDirty: () => TimelineDocument.dirty },
};

const NONE: DirtySource = { subscribe: () => () => {}, isDirty: () => false };

/** The dirty source for a dock panel (a no-op source for panels without one). */
export function panelDirtySource(panelId: string): DirtySource {
  return SOURCES[panelId] ?? NONE;
}
