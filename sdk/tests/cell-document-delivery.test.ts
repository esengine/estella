// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A scene the loader was handed is not fetched again.
 *
 * `createRuntimeSceneConfig` takes a document OR a path, and the streamed cells
 * a package boots are registered with the path. That the document wins is what
 * lets a cell be delivered from somewhere other than a file — so it is pinned
 * from both sides, or the branch could be removed and only a build would notice.
 */
import { describe, it, expect, vi } from 'vitest';
import { App } from '../src/app/app';
import { EmbeddedBackend } from '../src/asset/Backend';
import { createRuntimeSceneConfig, loadRuntimeScene } from '../src/runtime/runtimeLoader';
import type { SceneData } from '../src/scene/scene';

const FETCHED = 'the loader reached for the path';

const doc: SceneData = { version: '1.0', name: 'cell_0_0', entities: [] };

async function runtimeThatRefusesToFetch() {
  const app = App.new(), backend = new EmbeddedBackend({});
  const fetchText = vi.spyOn(backend, 'fetchText').mockRejectedValue(new Error(FETCHED));
  const options = { app, module: null, source: { backend, decodePixels: async () => { throw new Error('unexpected image'); } } };
  await loadRuntimeScene({ ...options, sceneData: { ...doc, name: 'entry' } });
  return { app, options, fetchText };
}

describe('a registered scene with a document', () => {
  it('never asks the backend for its path', async () => {
    const { app, fetchText, options } = await runtimeThatRefusesToFetch();
    const config = createRuntimeSceneConfig('cell_0_0', doc, options, 'world/cell_0_0.json');
    try {
      await config.prepare!();
      expect(fetchText).not.toHaveBeenCalled();
    } finally { config.discardPrepared!(); app.quit(); }
  });

  it('does ask when it was given only a path, so the case above is a choice', async () => {
    const { app, fetchText, options } = await runtimeThatRefusesToFetch();
    const config = createRuntimeSceneConfig('cell_0_0', undefined, options, 'world/cell_0_0.json');
    try {
      await expect(config.prepare!()).rejects.toThrow(FETCHED);
      expect(fetchText).toHaveBeenCalledWith('world/cell_0_0.json');
    } finally { app.quit(); }
  });

  it('says so when it was given neither, rather than bringing up an empty scene', async () => {
    const { app, options } = await runtimeThatRefusesToFetch();
    try {
      await expect(createRuntimeSceneConfig('cell_0_0', undefined, options).prepare!()).rejects.toThrow(/neither data nor path/);
    } finally { app.quit(); }
  });
});
