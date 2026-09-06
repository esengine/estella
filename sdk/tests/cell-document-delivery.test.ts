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
import { createRuntimeSceneConfig } from '../src/runtime/runtimeLoader';
import type { SceneData } from '../src/scene/scene';

const FETCHED = 'the loader reached for the path';

const doc = { version: '1.0', name: 'cell_0_0', entities: [] } as unknown as SceneData;

/** An app whose only observable behaviour is whether a fetch was attempted. */
function appThatRefusesToFetch() {
  const fetchJson = vi.fn(() => { throw new Error(FETCHED); });
  return { fetchJson, app: { getResource: () => ({ fetchJson }) } as never };
}

const opts = (app: unknown) => ({ app, module: null, source: {} } as never);

describe('a registered scene with a document', () => {
  it('never asks the backend for its path', async () => {
    const { app, fetchJson } = appThatRefusesToFetch();
    const config = createRuntimeSceneConfig('cell_0_0', doc, opts(app), 'world/cell_0_0.json');
    // prepare goes on to need a real app; which step it fails at is the point.
    await config.prepare!().catch((e: Error) => expect(e.message).not.toContain(FETCHED));
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('does ask when it was given only a path, so the case above is a choice', async () => {
    const { app, fetchJson } = appThatRefusesToFetch();
    const config = createRuntimeSceneConfig('cell_0_0', undefined, opts(app), 'world/cell_0_0.json');
    await expect(config.prepare!()).rejects.toThrow(FETCHED);
    expect(fetchJson).toHaveBeenCalledWith('world/cell_0_0.json');
  });

  it('says so when it was given neither, rather than bringing up an empty scene', async () => {
    const { app } = appThatRefusesToFetch();
    await expect(createRuntimeSceneConfig('cell_0_0', undefined, opts(app)).prepare!())
      .rejects.toThrow(/neither data nor path/);
  });
});
