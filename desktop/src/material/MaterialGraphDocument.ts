// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MaterialGraphDocument.ts
 * @brief   Reactive, undoable document for a `.esmatgraph` — the Material Graph editor's model.
 *          Same AssetDocument contract as MaterialDocument/TilesetDocument: panels subscribe via
 *          useSyncExternalStore(subscribe, getRevision); node edits go through {@link edit}
 *          (one undo step each). The graph compiles to a sibling `.esshader` on save.
 */
import type { MaterialGraph } from 'esengine';
import { AssetDocument } from '@/document/AssetDocument';

class MaterialGraphDocumentImpl extends AssetDocument<MaterialGraph> {
  open(graph: MaterialGraph, filePath: string | null): void {
    this.openAsset(graph, filePath);
  }
  openJson(raw: unknown, filePath: string | null): void {
    this.open(raw as MaterialGraph, filePath);
  }
  close(): void {
    this.closeAsset();
  }
}

export const MaterialGraphDocument = new MaterialGraphDocumentImpl();
