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
import { createRuntimeSceneConfig, loadRuntimeScene, prepareRuntimeScene } from '../src/runtime/runtimeLoader';
import type { SceneData } from '../src/scene/scene';
import { connectFakeCpp } from './helpers/fakeEngine';
import { reservePromise } from '../src/util/reservePromise';
import { Assets as AssetsResource } from '../src/asset/AssetPlugin';

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

it('rejects discarded scene preparation while its document fetch is pending', async () => {
  const { app, options, fetchText } = await runtimeThatRefusesToFetch();
  const fetched = reservePromise<string>();
  fetchText.mockReturnValueOnce(fetched.promise);
  const config = createRuntimeSceneConfig(doc.name, undefined, options, 'world/cell_0_0.json');
  const phase = vi.fn();
  config.onPhase = phase;
  const settled = vi.fn();
  const pending = config.prepare!().then(() => settled('prepared'), error => settled(error.name));
  try {
    await vi.waitFor(() => expect(fetchText).toHaveBeenCalledTimes(1));
    config.discardPrepared!();
    await vi.waitFor(() => expect(settled).toHaveBeenCalledWith('SceneLoadCancelled'));
    expect(phase).not.toHaveBeenCalled();
  } finally {
    fetched.resolve(JSON.stringify(doc));
    await pending;
    app.quit();
  }
});

it('releases prefab receipts that arrive after a custom scene preparation is discarded', async () => {
  const { app, options } = await runtimeThatRefusesToFetch();
  const assets = app.getResource(AssetsResource);
  const readStarted = reservePromise<void>(), slow = reservePromise<void>(), callbackFinished = reservePromise<void>();
  const unload = vi.fn();
  const load = vi.fn(async (path: string) => {
    if (path === 'slow.esprefab') { readStarted.resolve(); await slow.promise; }
    return { path, data: { version: '2', name: path, rootEntityId: 'root', entities: [] } };
  });
  assets.register({ type: 'prefab', extensions: [], load, unload });
  const install = vi.fn();
  const config = createRuntimeSceneConfig(doc.name, doc, {
    ...options,
    async prepareDocument(data, _check, publish, readPrefab) {
      publish(install);
      try {
        await readPrefab('first.esprefab');
        await readPrefab('slow.esprefab');
        return data;
      } finally { callbackFinished.resolve(); }
    },
  });
  const cancelled = expect(config.prepare!()).rejects.toThrow(/cancelled/i);
  try {
    await readStarted.promise;
    config.discardPrepared!();
    await cancelled;
    expect(unload.mock.calls.map(([entry]) => entry.path)).toEqual(['first.esprefab']);
    slow.resolve();
    await callbackFinished.promise;
    expect(unload.mock.calls.map(([entry]) => entry.path)).toEqual(['first.esprefab', 'slow.esprefab']);
    expect(assets.sizes().refRows).toBe(0);
    expect(install).not.toHaveBeenCalled();
  } finally {
    slow.resolve();
    await cancelled;
    app.quit();
  }
});

it('rejects preparation on core disconnect while the next frame budget is pending', async () => {
  const { app, options } = await runtimeThatRefusesToFetch();
  connectFakeCpp(app.world);
  const turn = reservePromise<void>();
  const gate = vi.fn(() => turn.promise);
  const settled = vi.fn();
  const phases = vi.fn();
  const pending = prepareRuntimeScene({ ...options, sceneData: doc, gate, onPhase: phases })
    .then(() => settled('prepared'), error => settled(error.name));
  try {
    await vi.waitFor(() => expect(gate).toHaveBeenCalledTimes(1));
    app.world.disconnectCpp();
    await vi.waitFor(() => expect(settled).toHaveBeenCalledWith('SceneLoadCancelled'));
    expect(phases.mock.calls.map(([phase]) => phase)).toEqual(['migrate']);
  } finally {
    turn.resolve();
    await pending;
    app.quit();
  }
  expect(gate).toHaveBeenCalledTimes(1);
});
