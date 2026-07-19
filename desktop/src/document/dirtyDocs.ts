// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    dirtyDocs.ts
 * @brief   Registers the built-in documents on the DirtyRegistry (side effect
 *          on import, like EditorSession): the scene plus every AssetDocument
 *          editor. Quit-save and the discard/close guards then see one
 *          aggregate dirty state instead of only the scene's.
 */
import { DirtyRegistry } from './DirtyRegistry';
import { EditorHistory } from '@/engine/EditorHistory';
import { ProjectStore } from '@/project/ProjectStore';
import { TilesetDocument } from '@/tileset/TilesetDocument';
import { TilesetCommands } from '@/tileset/TilesetCommands';
import { AnimClipDocument } from '@/flipbook/AnimClipDocument';
import { AnimClipCommands } from '@/flipbook/AnimClipCommands';
import { TimelineDocument } from '@/timeline/TimelineDocument';
import { TimelineCommands } from '@/timeline/TimelineCommands';
import { FsmGraphDocument } from '@/fsm/FsmGraphDocument';
import { BtDocument } from '@/bt/BtDocument';
import { MaterialDocument } from '@/material/MaterialDocument';
import { MaterialGraphDocument } from '@/material/MaterialGraphDocument';
import { saveMaterialGraph } from '@/material/openMaterialGraph';
import type { AssetDocument } from './AssetDocument';

// The scene: EditorHistory-tracked (asset-doc edits record there too, so this can
// over-report — a redundant scene save is harmless; a missed one is not).
DirtyRegistry.register({
  id: 'scene',
  isDirty: () => EditorHistory.isDirty(),
  save: async () => {
    try {
      await ProjectStore.save();
    } catch {
      await ProjectStore.saveAsViaDialog();
    }
  },
  subscribe: EditorHistory.subscribe,
});

// A JSON-file document whose panel save is a plain pretty-printed write (BT/FSM/
// material — mirrors the panels' own save buttons).
function jsonDoc<T>(id: string, doc: AssetDocument<T>): void {
  DirtyRegistry.register({
    id,
    isDirty: () => doc.dirty,
    save: async () => {
      const asset = doc.asset;
      const path = doc.filePath;
      if (asset == null || !path) return;
      await window.estella.fs.write(path, JSON.stringify(asset, null, 2) + '\n');
      doc.markSaved();
    },
    subscribe: doc.subscribe,
  });
}

jsonDoc('bt', BtDocument);
jsonDoc('fsm', FsmGraphDocument);
jsonDoc('material', MaterialDocument);

// Documents with a richer save (custom serializer / compiled sibling output)
// reuse the same save path their panels call.
DirtyRegistry.register({
  id: 'tileset',
  isDirty: () => TilesetDocument.dirty,
  save: () => TilesetCommands.save(),
  subscribe: TilesetDocument.subscribe,
});
DirtyRegistry.register({
  id: 'flipbook',
  isDirty: () => AnimClipDocument.dirty,
  save: () => AnimClipCommands.save(),
  subscribe: AnimClipDocument.subscribe,
});
DirtyRegistry.register({
  id: 'timeline',
  isDirty: () => TimelineDocument.dirty && TimelineDocument.filePath != null,
  save: () => TimelineCommands.save(),
  subscribe: TimelineDocument.subscribe,
});
DirtyRegistry.register({
  id: 'materialgraph',
  isDirty: () => MaterialGraphDocument.dirty,
  save: async () => {
    const graph = MaterialGraphDocument.asset;
    const path = MaterialGraphDocument.filePath;
    if (graph && path) await saveMaterialGraph(path, graph);
  },
  subscribe: MaterialGraphDocument.subscribe,
});
