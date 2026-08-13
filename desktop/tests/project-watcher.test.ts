// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The watcher's second reader.
 *
 * Main keeps state read off project files — the standing acceptance claims — and
 * an edit that did not come through the editor's own door left it stale. Silently:
 * claims that never loaded look exactly like a project that has none, so a turn
 * they should have failed comes back passed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WebContents } from 'electron';
import { startProjectWatch, stopProjectWatch } from '../electron/projectWatcher';

let root = '';

const until = async (done: () => boolean, ms = 4000): Promise<void> => {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await new Promise((r) => { setTimeout(r, 25); });
};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'estella-watch-test-'));
});

afterEach(async () => {
  stopProjectWatch();
  await rm(root, { recursive: true, force: true });
});

describe('what the watcher tells main', () => {
  it('hands it the same change set it pushes to the window', async () => {
    const seen: string[][] = [];
    const sent: { paths: string[] }[] = [];
    const wc = {
      isDestroyed: () => false,
      send: (_channel: string, payload: { paths: string[] }) => { sent.push(payload); },
    } as unknown as WebContents;

    startProjectWatch(root, wc, (paths) => { seen.push([...paths]); });
    await writeFile(path.join(root, 'project.esproject'), '{"name":"P"}', 'utf8');
    await until(() => seen.length > 0 && sent.length > 0);

    expect(seen[0]).toContain('project.esproject');
    expect(sent[0].paths).toEqual(seen[0]);
  });

  it('watches without one', async () => {
    const sent: unknown[] = [];
    const wc = {
      isDestroyed: () => false,
      send: (_channel: string, payload: unknown) => { sent.push(payload); },
    } as unknown as WebContents;

    startProjectWatch(root, wc);
    await writeFile(path.join(root, 'a.esscene'), '{}', 'utf8');
    await until(() => sent.length > 0);

    expect(sent).toHaveLength(1);
  });
});
