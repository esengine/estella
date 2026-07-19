// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  dirtyDocs — the built-in DirtyRegistry registrations: an edited
 *        AssetDocument (here the BT editor) makes the aggregate dirty and
 *        quit-save (saveAll) writes it to disk + clears its dirty flag.
 *        Pure TS with a stubbed window.estella.fs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DirtyRegistry } from '@/document/DirtyRegistry';
import { BtDocument } from '@/bt/BtDocument';
import { FsmGraphDocument } from '@/fsm/FsmGraphDocument';
import type { BtDefinition } from 'esengine';
import '@/document/dirtyDocs';

const write = vi.fn(async (_path: string, _text: string) => {});

beforeEach(() => {
  write.mockClear();
  (globalThis as { window?: unknown }).window = { estella: { fs: { write } } };
});

afterEach(() => {
  BtDocument.close();
  FsmGraphDocument.close();
  delete (globalThis as { window?: unknown }).window;
});

const btDef = (): BtDefinition =>
  ({ root: { id: 'root', type: 'selector', children: [] } }) as unknown as BtDefinition;

describe('built-in dirty documents', () => {
  it('an edited asset document makes the aggregate dirty (scene history aside)', () => {
    BtDocument.open(btDef(), 'assets/ai/x.esbt');
    expect(DirtyRegistry.isDirty()).toBe(false);
    BtDocument.edit('Add node', (d) => {
      (d as { root: { children: unknown[] } }).root.children.push({ id: 'n1', type: 'action' });
    });
    expect(BtDocument.dirty).toBe(true);
    expect(DirtyRegistry.isDirty()).toBe(true);
  });

  it('saveAll writes every dirty document and clears its flag', async () => {
    BtDocument.open(btDef(), 'assets/ai/x.esbt');
    BtDocument.edit('Add node', (d) => {
      (d as { root: { children: unknown[] } }).root.children.push({ id: 'n1', type: 'action' });
    });
    FsmGraphDocument.open({ initial: 'idle', states: {} } as never, 'assets/ai/y.esfsm');
    FsmGraphDocument.edit('Rename', (d) => {
      (d as { initial: string }).initial = 'run';
    });

    await DirtyRegistry.saveAll();

    const paths = write.mock.calls.map((c) => c[0]);
    expect(paths).toContain('assets/ai/x.esbt');
    expect(paths).toContain('assets/ai/y.esfsm');
    expect(BtDocument.dirty).toBe(false);
    expect(FsmGraphDocument.dirty).toBe(false);
    expect(JSON.parse(write.mock.calls.find((c) => c[0] === 'assets/ai/y.esfsm')![1] as string)).toEqual({
      initial: 'run',
      states: {},
    });
  });

  it('a clean (or closed) document is not written', async () => {
    await DirtyRegistry.saveAll();
    expect(write).not.toHaveBeenCalled();
  });
});
