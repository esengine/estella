// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The thumbnail cache's own contract: which types it claims, that it
 *        never blocks a paint, and that a disk change re-asks. What it DRAWS is
 *        two pixel gates' business (mesh-preview, the material preview probe).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('esengine', () => ({
  Material: { renderPreview: vi.fn(async () => null) },
  renderMeshPreview: vi.fn(async () => null),
}));
vi.mock('@/engine/EngineHost', () => ({
  EngineHost: { getSnapshot: () => ({ status: 'idle' }), world: null },
}));
vi.mock('@/engine/AssetBinding', () => ({
  AssetBinding: { meshHandle: vi.fn(async () => 0), materialHandle: () => 0 },
}));
vi.mock('@/project/AssetRegistry', () => ({
  AssetRegistry: { assetTypeAt: (p: string) => (p.endsWith('.esmesh') ? 'mesh' : 'texture') },
}));

import { canRenderThumbnail, thumbnailFor, subscribeThumbnails } from '@/project/assetThumbnails';
import { fsRefresh } from '@/project/fsRefresh';

describe('asset thumbnails', () => {
  it('claims only what the engine can draw', () => {
    expect(canRenderThumbnail('mesh')).toBe(true);
    expect(canRenderThumbnail('material')).toBe(true);
    // A texture is its own picture and a prefab has none — both keep their tile.
    expect(canRenderThumbnail('texture')).toBe(false);
    expect(canRenderThumbnail('prefab')).toBe(false);
  });

  it('answers during a paint, never blocking on a render', () => {
    // Called from render(), so it returns what it has — null until one lands.
    expect(thumbnailFor('assets/tree.esmesh')).toBeNull();
    expect(thumbnailFor('assets/tree.png')).toBeNull();
  });

  it('re-asks when the DISK changes, not only when a render lands', () => {
    // A re-imported mesh keeps its path; without this a tile would show the
    // picture of the file it replaced until the panel remounted.
    let woken = 0;
    const off = subscribeThumbnails(() => { woken++; });
    fsRefresh.bump();
    expect(woken).toBe(1);
    off();
    fsRefresh.bump();
    expect(woken).toBe(1);
  });
});
