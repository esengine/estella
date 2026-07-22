// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { panelDirtySource } from '../src/layout/panelDirty';
import { FsmGraphDocument } from '../src/fsm/FsmGraphDocument';
import { AnimatorGraphDocument } from '../src/animator/AnimatorGraphDocument';
import { BtDocument } from '../src/bt/BtDocument';
import { MaterialGraphDocument } from '../src/material/MaterialGraphDocument';
import { TilesetDocument } from '../src/tileset/TilesetDocument';
import { AnimClipDocument } from '../src/flipbook/AnimClipDocument';
import { TimelineDocument } from '../src/timeline/TimelineDocument';

describe('panelDirtySource', () => {
  it('routes each panel id to its document (docId read from the document, not re-typed)', () => {
    // The mapping panel-id → document is the one thing the table still hand-wires;
    // this catches a doc plugged into the wrong panel id. docId itself is derived,
    // so it necessarily equals the document's own id.
    expect(panelDirtySource('statemachine').docId).toBe(FsmGraphDocument.docId);
    expect(panelDirtySource('animatorcontroller').docId).toBe(AnimatorGraphDocument.docId);
    expect(panelDirtySource('behaviortree').docId).toBe(BtDocument.docId);
    expect(panelDirtySource('materialgraph').docId).toBe(MaterialGraphDocument.docId);
    expect(panelDirtySource('tileset').docId).toBe(TilesetDocument.docId);
    expect(panelDirtySource('flipbook').docId).toBe(AnimClipDocument.docId);
    expect(panelDirtySource('sequencer').docId).toBe(TimelineDocument.docId);
  });

  it('reflects the live dirty flag of the wired document', () => {
    const src = panelDirtySource('sequencer');
    expect(src.isDirty()).toBe(TimelineDocument.dirty);
  });

  it('gives an inert source for a panel with no document', () => {
    const src = panelDirtySource('viewport');
    expect(src.isDirty()).toBe(false);
    expect(src.docId).toBeUndefined();
    expect(src.discard).toBeUndefined();
  });
});
